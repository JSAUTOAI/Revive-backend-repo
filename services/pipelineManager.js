/**
 * Pipeline Manager
 *
 * Orchestrates the automated quote-to-booking pipeline.
 * Handles stage transitions and triggers the appropriate actions
 * (emails, WhatsApp, AI pricing, job creation) at each stage.
 */

const { analysePhotosAndPrice } = require('./visionPricer');
const log = require('./logger').child('Pipeline');

/**
 * Load pipeline config from settings table
 */
async function getPipelineConfig(supabase) {
  const defaults = {
    pricing_mode: 'ai_suggest_admin_approves',
    confidence_threshold: 0.7,
    photo_reminder_days: 2,
    final_price_reminder_days: 3,
    max_booking_slots_initial: 5,
    booking_lookahead_weeks: 6,
    max_jobs_per_day: 4,
    honesty_clause: 'This price is based on the information provided and access to the site. If conditions differ from what was described, any adjustments will be discussed before work begins.'
  };

  try {
    const { data } = await supabase
      .from('settings')
      .select('value')
      .eq('key', 'pipeline_config')
      .single();

    return { ...defaults, ...(data?.value || {}) };
  } catch (e) {
    return defaults;
  }
}

/**
 * Advance pipeline after estimation completes
 * Checks if photos already exist; if so, triggers AI pricing.
 * If not, sends photo request message.
 */
async function advanceAfterEstimation(supabase, quoteId, quote) {
  try {
    log.info('Advancing after estimation', { quoteId });

    // Check if photos already exist in storage
    const { data: files } = await supabase.storage
      .from('quote-attachments')
      .list(quoteId, { limit: 10 });

    const customerPhotos = (files || []).filter(f =>
      f.name.startsWith('customer-') &&
      /\.(jpg|jpeg|png|webp)$/i.test(f.name)
    );

    const now = new Date().toISOString();

    if (customerPhotos.length > 0) {
      // Photos already submitted with form — skip photo request, go to AI pricing
      log.info('Photos already exist, advancing to AI pricing', { quoteId, count: customerPhotos.length });

      await supabase
        .from('quotes')
        .update({
          photos_uploaded_at: now,
          photo_count: customerPhotos.length,
          pipeline_stage: 'photos_uploaded'
        })
        .eq('id', quoteId);

      // Trigger AI pricing (async)
      advanceAfterPhotos(supabase, quoteId).catch(err => {
        log.error('AI pricing failed after auto-detect', { quoteId, error: err.message });
      });

    } else {
      // No photos — send photo request
      log.info('No photos found, requesting photos', { quoteId });

      await supabase
        .from('quotes')
        .update({
          pipeline_stage: 'photos_requested',
          photos_requested_at: now,
          // Schedule photo reminder follow-up
          next_follow_up_at: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
          follow_up_step: 0
        })
        .eq('id', quoteId);

      // Send photo request messages
      const freshQuote = await getQuote(supabase, quoteId);
      if (freshQuote) {
        await sendPhotoRequestMessages(freshQuote);
      }
    }

    // Log activity
    await supabase.from('quote_activity').insert({
      quote_id: quoteId,
      action_type: 'pipeline_advanced',
      description: customerPhotos.length > 0
        ? 'Photos detected, advancing to AI pricing'
        : 'Photo request sent to customer'
    }).catch(() => {});

  } catch (error) {
    log.error('advanceAfterEstimation failed', { quoteId, error: error.message });
  }
}

/**
 * Advance pipeline after photos are uploaded
 * Triggers AI Vision analysis and handles the 3 pricing modes.
 */
async function advanceAfterPhotos(supabase, quoteId) {
  try {
    log.info('Advancing after photos', { quoteId });

    // Run AI Vision pricing
    const result = await analysePhotosAndPrice(supabase, quoteId);

    if (!result.success) {
      // AI failed — escalate to admin
      log.error('AI pricing failed, escalating to admin', { quoteId, error: result.error });

      await supabase
        .from('quotes')
        .update({
          pipeline_stage: 'final_price_pending_approval',
          final_price_reasoning: 'AI analysis failed: ' + result.error + '. Manual pricing required.',
          final_price_ai_version: result.aiVersion
        })
        .eq('id', quoteId);

      await notifyAdminPendingApproval(supabase, quoteId, null, 'AI analysis failed — manual pricing required');
      return;
    }

    const now = new Date().toISOString();
    const config = await getPipelineConfig(supabase);

    // Store AI results
    const updateData = {
      final_price: result.finalPrice,
      final_price_confidence: result.confidence,
      final_price_reasoning: result.reasoning,
      final_price_ai_version: result.aiVersion,
      final_price_set_at: now,
      final_price_set_by: 'ai'
    };

    // Check confidence threshold
    const forceAdminReview = result.confidence < config.confidence_threshold;

    if (forceAdminReview) {
      log.info('Low confidence, forcing admin review', {
        quoteId, confidence: result.confidence, threshold: config.confidence_threshold
      });
    }

    // Apply pricing mode
    const mode = forceAdminReview ? 'ai_suggest_admin_approves' : config.pricing_mode;

    switch (mode) {
      case 'ai_suggest_admin_approves':
        updateData.pipeline_stage = 'final_price_pending_approval';
        updateData.final_price_admin_approved = false;
        break;

      case 'fully_automated_with_override':
        updateData.pipeline_stage = 'final_price_sent';
        updateData.final_price_sent_at = now;
        updateData.final_price_admin_approved = false;
        break;

      case 'fully_automated':
        updateData.pipeline_stage = 'final_price_sent';
        updateData.final_price_sent_at = now;
        updateData.final_price_admin_approved = true;
        updateData.final_price_admin_approved_at = now;
        break;

      default:
        updateData.pipeline_stage = 'final_price_pending_approval';
        updateData.final_price_admin_approved = false;
    }

    await supabase
      .from('quotes')
      .update(updateData)
      .eq('id', quoteId);

    // Log activity
    await supabase.from('quote_activity').insert({
      quote_id: quoteId,
      action_type: 'ai_pricing_complete',
      description: `AI set price at £${result.finalPrice} (confidence: ${(result.confidence * 100).toFixed(0)}%, mode: ${mode})`
    }).catch(() => {});

    // Send messages based on mode
    if (mode === 'ai_suggest_admin_approves') {
      await notifyAdminPendingApproval(supabase, quoteId, result, 'AI has suggested a price — awaiting your approval');
    } else {
      // Auto or override mode: send final price to customer
      const freshQuote = await getQuote(supabase, quoteId);
      if (freshQuote) {
        await sendFinalPriceMessages(freshQuote);

        // Schedule follow-up for final price acceptance
        await supabase
          .from('quotes')
          .update({
            next_follow_up_at: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
            follow_up_step: 0
          })
          .eq('id', quoteId);
      }

      // Notify admin (informational for auto mode, action for override mode)
      await notifyAdminPriceSet(supabase, quoteId, result, mode);
    }

    log.info('Pipeline advanced after photos', { quoteId, mode, price: result.finalPrice });

  } catch (error) {
    log.error('advanceAfterPhotos failed', { quoteId, error: error.message });
  }
}

/**
 * Advance pipeline after admin approves/adjusts the AI price
 */
async function advanceAfterAdminApproval(supabase, quoteId, approvedPrice, adminNotes) {
  try {
    log.info('Advancing after admin approval', { quoteId, price: approvedPrice });

    const now = new Date().toISOString();

    await supabase
      .from('quotes')
      .update({
        final_price: approvedPrice,
        final_price_admin_approved: true,
        final_price_admin_approved_at: now,
        final_price_set_by: 'ai+admin_approved',
        final_price_sent_at: now,
        pipeline_stage: 'final_price_sent',
        admin_notes: adminNotes || undefined,
        // Schedule follow-up
        next_follow_up_at: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
        follow_up_step: 0
      })
      .eq('id', quoteId);

    // Log activity
    await supabase.from('quote_activity').insert({
      quote_id: quoteId,
      action_type: 'admin_approved_price',
      description: `Admin approved final price of £${approvedPrice}${adminNotes ? '. Notes: ' + adminNotes : ''}`
    }).catch(() => {});

    // Send final price to customer
    const freshQuote = await getQuote(supabase, quoteId);
    if (freshQuote) {
      await sendFinalPriceMessages(freshQuote);
    }

    log.info('Admin approval processed', { quoteId, price: approvedPrice });
    return { success: true };

  } catch (error) {
    log.error('advanceAfterAdminApproval failed', { quoteId, error: error.message });
    return { success: false, error: error.message };
  }
}

/**
 * Advance pipeline after customer accepts the final price
 */
async function advanceAfterFinalPriceAccepted(supabase, quoteId) {
  try {
    log.info('Advancing after final price accepted', { quoteId });

    const now = new Date().toISOString();

    await supabase
      .from('quotes')
      .update({
        pipeline_stage: 'booking_offered',
        booking_offered_at: now,
        // Schedule booking reminder
        next_follow_up_at: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
        follow_up_step: 0
      })
      .eq('id', quoteId);

    // Log activity
    await supabase.from('quote_activity').insert({
      quote_id: quoteId,
      action_type: 'pipeline_advanced',
      description: 'Customer accepted final price, booking page offered'
    }).catch(() => {});

    // Send booking link messages
    const freshQuote = await getQuote(supabase, quoteId);
    if (freshQuote) {
      await sendBookingLinkMessages(freshQuote);
    }

    // Notify admin
    await notifyAdminAcceptance(supabase, quoteId);

  } catch (error) {
    log.error('advanceAfterFinalPriceAccepted failed', { quoteId, error: error.message });
  }
}

/**
 * Advance pipeline after customer books a slot
 * Creates a job in the jobs table.
 */
async function advanceAfterBooking(supabase, quoteId, date, timeSlot) {
  try {
    log.info('Advancing after booking', { quoteId, date, timeSlot });

    // Fetch full quote
    const quote = await getQuote(supabase, quoteId);
    if (!quote) throw new Error('Quote not found');

    // Create job
    const servicesList = (quote.services || []).join(' | ');
    const { data: job, error: jobErr } = await supabase
      .from('jobs')
      .insert({
        quote_id: quoteId,
        customer_id: quote.customer_id || null,
        customer_name: quote.name,
        customer_phone: quote.phone,
        customer_email: quote.email,
        customer_address: [quote.address_line1, quote.postcode].filter(Boolean).join(', '),
        customer_postcode: quote.postcode,
        service: servicesList,
        scheduled_date: date,
        time_slot: timeSlot,
        job_value: quote.final_price,
        status: 'pending',
        assigned_to: null,
        notes: `Auto-booked via pipeline. Customer selected ${timeSlot} slot.`
      })
      .select()
      .single();

    if (jobErr) {
      log.error('Job creation failed', { quoteId, error: jobErr.message });
      throw new Error('Job creation failed: ' + jobErr.message);
    }

    // Update quote
    const now = new Date().toISOString();
    await supabase
      .from('quotes')
      .update({
        pipeline_stage: 'booked',
        status: 'booked',
        booked_at: now,
        booked_date: date,
        booked_time_slot: timeSlot,
        booked_job_id: job.id,
        next_follow_up_at: null  // Stop follow-ups
      })
      .eq('id', quoteId);

    // Log activity
    await supabase.from('quote_activity').insert({
      quote_id: quoteId,
      action_type: 'booked',
      description: `Customer booked ${date} (${timeSlot}). Job ID: ${job.id}`
    }).catch(() => {});

    // Send booking confirmation messages
    const freshQuote = await getQuote(supabase, quoteId);
    if (freshQuote) {
      await sendBookingConfirmationMessages(freshQuote, job);
    }

    // Notify admin to assign team member
    await notifyAdminNewBooking(supabase, quoteId, job);

    log.info('Booking created successfully', { quoteId, jobId: job.id, date, timeSlot });

    return { success: true, jobId: job.id };

  } catch (error) {
    log.error('advanceAfterBooking failed', { quoteId, error: error.message });
    return { success: false, error: error.message };
  }
}

// ─── Helper Functions ───────────────────────────────────────────────

async function getQuote(supabase, quoteId) {
  const { data } = await supabase
    .from('quotes')
    .select('*')
    .eq('id', quoteId)
    .single();
  return data;
}

/**
 * Send photo request via email + WhatsApp
 */
async function sendPhotoRequestMessages(quote) {
  try {
    const { sendPhotoRequestEmail } = require('./emailer');
    await sendPhotoRequestEmail(quote).catch(err => {
      log.error('Photo request email failed', { quoteId: quote.id, error: err.message });
    });
  } catch (e) {
    log.error('Photo request email import failed', { error: e.message });
  }

  try {
    const { sendPhotoRequestWhatsApp } = require('./whatsapp');
    if (quote.phone) {
      await sendPhotoRequestWhatsApp(quote).catch(err => {
        log.error('Photo request WhatsApp failed', { quoteId: quote.id, error: err.message });
      });
    }
  } catch (e) {
    log.error('Photo request WhatsApp import failed', { error: e.message });
  }
}

/**
 * Send final price via email + WhatsApp
 */
async function sendFinalPriceMessages(quote) {
  try {
    const { sendFinalPriceEmail } = require('./emailer');
    await sendFinalPriceEmail(quote).catch(err => {
      log.error('Final price email failed', { quoteId: quote.id, error: err.message });
    });
  } catch (e) {
    log.error('Final price email import failed', { error: e.message });
  }

  try {
    const { sendFinalPriceWhatsApp } = require('./whatsapp');
    if (quote.phone) {
      await sendFinalPriceWhatsApp(quote).catch(err => {
        log.error('Final price WhatsApp failed', { quoteId: quote.id, error: err.message });
      });
    }
  } catch (e) {
    log.error('Final price WhatsApp import failed', { error: e.message });
  }
}

/**
 * Send booking link messages (after price accepted, before slot selected)
 */
async function sendBookingLinkMessages(quote) {
  const BASE_URL = process.env.BASE_URL || 'https://your-app.railway.app';
  const bookingUrl = `${BASE_URL}/book/${quote.id}`;

  // For now, the booking link is included in the final price acceptance flow
  // The customer is redirected to the booking page after accepting
  // Additional messages can be added here if needed
  log.info('Booking link available', { quoteId: quote.id, url: bookingUrl });
}

/**
 * Send booking confirmation via email + WhatsApp
 */
async function sendBookingConfirmationMessages(quote, job) {
  try {
    const { sendBookingConfirmationEmail } = require('./emailer');
    await sendBookingConfirmationEmail(quote, job).catch(err => {
      log.error('Booking confirmation email failed', { quoteId: quote.id, error: err.message });
    });
  } catch (e) {
    log.error('Booking confirmation email import failed', { error: e.message });
  }

  try {
    const { sendBookingConfirmationWhatsApp } = require('./whatsapp');
    if (quote.phone) {
      await sendBookingConfirmationWhatsApp(quote, job).catch(err => {
        log.error('Booking confirmation WhatsApp failed', { quoteId: quote.id, error: err.message });
      });
    }
  } catch (e) {
    log.error('Booking confirmation WhatsApp import failed', { error: e.message });
  }
}

// ─── Admin Notifications ────────────────────────────────────────────

async function notifyAdminPendingApproval(supabase, quoteId, aiResult, message) {
  try {
    const { sendAdminAlert } = require('./emailer');
    const { sendAdminAlertWhatsApp } = require('./whatsapp');
    const quote = await getQuote(supabase, quoteId);
    if (!quote) return;

    // Enhance quote with context for admin alert
    quote._pipelineAlert = {
      type: 'pending_approval',
      message: message,
      suggestedPrice: aiResult?.finalPrice,
      confidence: aiResult?.confidence,
      reasoning: aiResult?.reasoning
    };

    await sendAdminAlert(quote).catch(err => {
      log.error('Admin alert email failed', { quoteId, error: err.message });
    });

    if (process.env.ADMIN_PHONE) {
      await sendAdminAlertWhatsApp(quote).catch(err => {
        log.error('Admin alert WhatsApp failed', { quoteId, error: err.message });
      });
    }
  } catch (e) {
    log.error('Admin notification failed', { quoteId, error: e.message });
  }
}

async function notifyAdminPriceSet(supabase, quoteId, aiResult, mode) {
  try {
    const { sendAdminAlert } = require('./emailer');
    const quote = await getQuote(supabase, quoteId);
    if (!quote) return;

    quote._pipelineAlert = {
      type: mode === 'fully_automated_with_override' ? 'price_sent_override' : 'price_sent_auto',
      message: `AI price of £${aiResult.finalPrice} sent to customer (mode: ${mode})`,
      suggestedPrice: aiResult.finalPrice,
      confidence: aiResult.confidence
    };

    await sendAdminAlert(quote).catch(err => {
      log.error('Admin price notification failed', { quoteId, error: err.message });
    });
  } catch (e) {
    log.error('Admin notification failed', { quoteId, error: e.message });
  }
}

async function notifyAdminAcceptance(supabase, quoteId) {
  try {
    const { sendAdminAlert } = require('./emailer');
    const { sendAdminAlertWhatsApp } = require('./whatsapp');
    const quote = await getQuote(supabase, quoteId);
    if (!quote) return;

    quote._pipelineAlert = {
      type: 'final_price_accepted',
      message: `Customer accepted final price of £${quote.final_price} — booking page sent`
    };

    await sendAdminAlert(quote).catch(err => {
      log.error('Admin alert email failed', { quoteId, error: err.message });
    });

    if (process.env.ADMIN_PHONE) {
      await sendAdminAlertWhatsApp(quote).catch(err => {
        log.error('Admin alert WhatsApp failed', { quoteId, error: err.message });
      });
    }
  } catch (e) {
    log.error('Admin notification failed', { quoteId, error: e.message });
  }
}

async function notifyAdminNewBooking(supabase, quoteId, job) {
  try {
    const { sendAdminAlert } = require('./emailer');
    const { sendAdminAlertWhatsApp } = require('./whatsapp');
    const quote = await getQuote(supabase, quoteId);
    if (!quote) return;

    quote._pipelineAlert = {
      type: 'new_booking',
      message: `New booking! ${quote.name} booked ${job.scheduled_date} (${job.time_slot}) for £${quote.final_price}. Please assign a team member.`,
      jobId: job.id,
      date: job.scheduled_date,
      timeSlot: job.time_slot
    };

    await sendAdminAlert(quote).catch(err => {
      log.error('Admin booking alert email failed', { quoteId, error: err.message });
    });

    if (process.env.ADMIN_PHONE) {
      await sendAdminAlertWhatsApp(quote).catch(err => {
        log.error('Admin booking alert WhatsApp failed', { quoteId, error: err.message });
      });
    }
  } catch (e) {
    log.error('Admin notification failed', { quoteId, error: e.message });
  }
}

module.exports = {
  getPipelineConfig,
  advanceAfterEstimation,
  advanceAfterPhotos,
  advanceAfterAdminApproval,
  advanceAfterFinalPriceAccepted,
  advanceAfterBooking
};
