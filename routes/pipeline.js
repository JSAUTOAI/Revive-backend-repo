/**
 * Pipeline Routes
 *
 * Customer-facing routes for the automated quote-to-booking pipeline:
 * - Photo upload page + API
 * - Final price acceptance page
 * - Booking slot selection page + API
 * - Pipeline status API
 */

const express = require('express');
const router = express.Router();
const path = require('path');
const log = require('../services/logger').child('Pipeline');

let supabase;

function setSupabaseClient(client) {
  supabase = client;
}

// UUID validation helper
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// HTML escape helper
function h(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Service name formatter
function formatServiceName(service) {
  const names = {
    roof: 'Roof Cleaning', driveway: 'Driveway Cleaning', patio: 'Patio Cleaning',
    gutter: 'Gutter Cleaning', softwash: 'Soft Washing', render: 'Render Cleaning',
    decking: 'Decking Cleaning', fence: 'Fence Cleaning', conservatory: 'Conservatory Cleaning',
    solar: 'Solar Panel Cleaning', cladding: 'Cladding Cleaning', window: 'Window Cleaning'
  };
  return names[service] || service.charAt(0).toUpperCase() + service.slice(1);
}

// Error page helper
function errorPage(title, message) {
  return `<!DOCTYPE html>
<html><head>
  <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} - Revive Exterior Cleaning</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); margin: 0; padding: 20px; min-height: 100vh; display: flex; align-items: center; justify-content: center; }
    .container { background: white; border-radius: 16px; box-shadow: 0 20px 60px rgba(0,0,0,0.3); padding: 40px; max-width: 500px; text-align: center; }
    h1 { color: #dc2626; margin-bottom: 16px; } p { color: #64748b; line-height: 1.6; }
  </style>
</head><body><div class="container"><h1>${title}</h1><p>${message}</p></div></body></html>`;
}

// ─── Photo Upload Page ──────────────────────────────────────────────

router.get('/upload-photos/:quoteId', async (req, res) => {
  try {
    const { quoteId } = req.params;

    if (!UUID_REGEX.test(quoteId)) {
      return res.status(400).send(errorPage('Invalid Link', 'This link appears to be invalid. Please use the link from your email or WhatsApp message.'));
    }

    const { data: quote, error } = await supabase
      .from('quotes')
      .select('id, name, services, estimated_value_min, estimated_value_max, photos_uploaded_at, pipeline_stage')
      .eq('id', quoteId)
      .is('deleted_at', null)
      .single();

    if (error || !quote) {
      return res.status(404).send(errorPage('Quote Not Found', 'We couldn\'t find this quote. The link may have expired.'));
    }

    // If photos already uploaded, show thank-you
    if (quote.photos_uploaded_at) {
      return res.send(photosAlreadyUploadedPage(quote));
    }

    res.sendFile(path.join(__dirname, '..', 'public', 'upload-photos.html'));
  } catch (err) {
    log.error('Upload page error', { error: err.message });
    res.status(500).send(errorPage('Something Went Wrong', 'Please try again or contact us directly.'));
  }
});

// ─── Photo Upload API ───────────────────────────────────────────────

router.post('/api/pipeline/:quoteId/upload-photos', async (req, res) => {
  try {
    const { quoteId } = req.params;

    if (!UUID_REGEX.test(quoteId)) {
      return res.status(400).json({ success: false, error: 'Invalid quote ID' });
    }

    const { photos } = req.body;

    if (!photos || !Array.isArray(photos) || photos.length === 0) {
      return res.status(400).json({ success: false, error: 'At least one photo is required' });
    }

    if (photos.length > 10) {
      return res.status(400).json({ success: false, error: 'Maximum 10 photos allowed' });
    }

    // Validate quote exists and is in correct stage
    const { data: quote, error: quoteErr } = await supabase
      .from('quotes')
      .select('id, name, pipeline_stage')
      .eq('id', quoteId)
      .is('deleted_at', null)
      .single();

    if (quoteErr || !quote) {
      return res.status(404).json({ success: false, error: 'Quote not found' });
    }

    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
    const uploadedFiles = [];

    for (const photo of photos) {
      const { filename, contentType, data: fileData } = photo;

      if (!filename || !fileData) {
        return res.status(400).json({ success: false, error: 'Each photo needs filename and data' });
      }

      if (!allowedTypes.includes(contentType)) {
        return res.status(400).json({ success: false, error: `File type not allowed: ${contentType}. Use JPEG, PNG, or WebP.` });
      }

      const buffer = Buffer.from(fileData, 'base64');

      if (buffer.length > 10 * 1024 * 1024) {
        return res.status(400).json({ success: false, error: `File too large: ${filename} (max 10MB)` });
      }

      const filePath = `${quoteId}/customer-${Date.now()}-${filename}`;

      const { error: uploadErr } = await supabase.storage
        .from('quote-attachments')
        .upload(filePath, buffer, {
          contentType: contentType || 'image/jpeg',
          upsert: false
        });

      if (uploadErr) {
        log.error('Photo upload failed', { quoteId, filename, error: uploadErr.message });
        return res.status(500).json({ success: false, error: 'Upload failed for ' + filename });
      }

      const { data: urlData } = supabase.storage
        .from('quote-attachments')
        .getPublicUrl(filePath);

      uploadedFiles.push({ filename, url: urlData.publicUrl, path: filePath });
    }

    // Update quote with photo info
    const now = new Date().toISOString();
    await supabase
      .from('quotes')
      .update({
        photos_uploaded_at: now,
        photo_count: uploadedFiles.length,
        pipeline_stage: 'photos_uploaded'
      })
      .eq('id', quoteId);

    // Log activity
    await supabase.from('quote_activity').insert({
      quote_id: quoteId,
      action_type: 'photos_uploaded',
      description: `Customer uploaded ${uploadedFiles.length} photo(s)`
    }).catch(() => {});

    log.info('Photos uploaded', { quoteId, count: uploadedFiles.length });

    // Trigger pipeline advancement (async, non-blocking)
    const { advanceAfterPhotos } = require('../services/pipelineManager');
    advanceAfterPhotos(supabase, quoteId).catch(err => {
      log.error('Pipeline advancement failed after photos', { quoteId, error: err.message });
    });

    res.json({ success: true, count: uploadedFiles.length, files: uploadedFiles });

  } catch (err) {
    log.error('Photo upload error', { error: err.message });
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ─── Pipeline Status API ────────────────────────────────────────────

router.get('/api/pipeline/:quoteId/status', async (req, res) => {
  try {
    const { quoteId } = req.params;

    if (!UUID_REGEX.test(quoteId)) {
      return res.status(400).json({ success: false, error: 'Invalid quote ID' });
    }

    const { data: quote, error } = await supabase
      .from('quotes')
      .select('id, name, services, estimated_value_min, estimated_value_max, photo_count, pipeline_stage, final_price')
      .eq('id', quoteId)
      .is('deleted_at', null)
      .single();

    if (error || !quote) {
      return res.status(404).json({ success: false, error: 'Quote not found' });
    }

    res.json({
      success: true,
      data: {
        name: quote.name ? quote.name.split(' ')[0] : 'Customer',
        services: quote.services,
        estimateMin: quote.estimated_value_min,
        estimateMax: quote.estimated_value_max,
        photoCount: quote.photo_count,
        pipelineStage: quote.pipeline_stage,
        finalPrice: quote.final_price
      }
    });
  } catch (err) {
    log.error('Status error', { error: err.message });
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ─── Final Price Page ───────────────────────────────────────────────

router.get('/final-price/:quoteId', async (req, res) => {
  try {
    const { quoteId } = req.params;

    if (!UUID_REGEX.test(quoteId)) {
      return res.status(400).send(errorPage('Invalid Link', 'This link appears to be invalid.'));
    }

    const { data: quote, error } = await supabase
      .from('quotes')
      .select('*')
      .eq('id', quoteId)
      .is('deleted_at', null)
      .single();

    if (error || !quote) {
      return res.status(404).send(errorPage('Quote Not Found', 'We couldn\'t find this quote.'));
    }

    if (!quote.final_price) {
      return res.send(errorPage('Price Not Ready', 'We\'re still working on your final price. You\'ll receive it shortly via email and WhatsApp.'));
    }

    if (quote.customer_accepted_final_price) {
      return res.send(alreadyAcceptedPage(quote));
    }

    // Load honesty clause from settings
    let honestyClause = 'This price is based on the information provided and access to the site. If conditions differ from what was described, any adjustments will be discussed before work begins.';
    try {
      const { data: settings } = await supabase
        .from('settings')
        .select('value')
        .eq('key', 'pipeline_config')
        .single();
      if (settings?.value?.honesty_clause) {
        honestyClause = settings.value.honesty_clause;
      }
    } catch (e) { /* use default */ }

    res.send(finalPricePage(quote, honestyClause));

  } catch (err) {
    log.error('Final price page error', { error: err.message });
    res.status(500).send(errorPage('Something Went Wrong', 'Please try again or contact us directly.'));
  }
});

// ─── Confirm Final Price (POST) ─────────────────────────────────────

router.post('/confirm-final-price/:quoteId', async (req, res) => {
  try {
    const { quoteId } = req.params;

    if (!UUID_REGEX.test(quoteId)) {
      return res.status(400).send(errorPage('Invalid Link', 'This link appears to be invalid.'));
    }

    const { data: quote, error } = await supabase
      .from('quotes')
      .select('*')
      .eq('id', quoteId)
      .is('deleted_at', null)
      .single();

    if (error || !quote) {
      return res.status(404).send(errorPage('Quote Not Found', 'We couldn\'t find this quote.'));
    }

    if (quote.customer_accepted_final_price) {
      return res.redirect(`/book/${quoteId}`);
    }

    // Mark accepted
    const now = new Date().toISOString();
    await supabase
      .from('quotes')
      .update({
        customer_accepted_final_price: true,
        customer_accepted_final_price_at: now,
        pipeline_stage: 'final_price_accepted'
      })
      .eq('id', quoteId);

    // Log activity
    await supabase.from('quote_activity').insert({
      quote_id: quoteId,
      action_type: 'final_price_accepted',
      description: `Customer accepted final price of £${quote.final_price}`
    }).catch(() => {});

    log.info('Final price accepted', { quoteId, price: quote.final_price });

    // Advance pipeline (async)
    const { advanceAfterFinalPriceAccepted } = require('../services/pipelineManager');
    advanceAfterFinalPriceAccepted(supabase, quoteId).catch(err => {
      log.error('Pipeline advancement failed after acceptance', { quoteId, error: err.message });
    });

    res.redirect(`/book/${quoteId}`);

  } catch (err) {
    log.error('Confirm final price error', { error: err.message });
    res.status(500).send(errorPage('Something Went Wrong', 'Please try again or contact us directly.'));
  }
});

// ─── Booking Page ───────────────────────────────────────────────────

router.get('/book/:quoteId', async (req, res) => {
  try {
    const { quoteId } = req.params;

    if (!UUID_REGEX.test(quoteId)) {
      return res.status(400).send(errorPage('Invalid Link', 'This link appears to be invalid.'));
    }

    const { data: quote, error } = await supabase
      .from('quotes')
      .select('id, name, services, final_price, customer_accepted_final_price, pipeline_stage, booked_job_id')
      .eq('id', quoteId)
      .is('deleted_at', null)
      .single();

    if (error || !quote) {
      return res.status(404).send(errorPage('Quote Not Found', 'We couldn\'t find this quote.'));
    }

    if (quote.booked_job_id) {
      return res.send(alreadyBookedPage(quote));
    }

    if (!quote.customer_accepted_final_price) {
      return res.redirect(`/final-price/${quoteId}`);
    }

    res.sendFile(path.join(__dirname, '..', 'public', 'book-slot.html'));

  } catch (err) {
    log.error('Booking page error', { error: err.message });
    res.status(500).send(errorPage('Something Went Wrong', 'Please try again or contact us directly.'));
  }
});

// ─── Available Slots API ────────────────────────────────────────────

router.get('/api/pipeline/:quoteId/available-slots', async (req, res) => {
  try {
    const { quoteId } = req.params;

    if (!UUID_REGEX.test(quoteId)) {
      return res.status(400).json({ success: false, error: 'Invalid quote ID' });
    }

    // Verify quote exists
    const { data: quote, error: quoteErr } = await supabase
      .from('quotes')
      .select('id')
      .eq('id', quoteId)
      .is('deleted_at', null)
      .single();

    if (quoteErr || !quote) {
      return res.status(404).json({ success: false, error: 'Quote not found' });
    }

    // Load pipeline config
    let config = { max_jobs_per_day: 4, booking_lookahead_weeks: 6 };
    try {
      const { data: settings } = await supabase
        .from('settings')
        .select('value')
        .eq('key', 'pipeline_config')
        .single();
      if (settings?.value) {
        config = { ...config, ...settings.value };
      }
    } catch (e) { /* use defaults */ }

    const maxPerDay = config.max_jobs_per_day || 4;
    const lookaheadWeeks = config.booking_lookahead_weeks || 6;
    const timeSlots = ['morning', 'afternoon', 'evening'];

    // Get start date (tomorrow)
    const startDate = new Date();
    startDate.setDate(startDate.getDate() + 1);
    startDate.setHours(0, 0, 0, 0);

    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + (lookaheadWeeks * 7));

    // Fetch existing jobs in the date range
    const { data: existingJobs, error: jobsErr } = await supabase
      .from('jobs')
      .select('scheduled_date, time_slot')
      .gte('scheduled_date', startDate.toISOString().split('T')[0])
      .lte('scheduled_date', endDate.toISOString().split('T')[0])
      .not('status', 'eq', 'cancelled')
      .is('deleted_at', null);

    if (jobsErr) {
      log.error('Jobs query error', { error: jobsErr.message });
      return res.status(500).json({ success: false, error: 'Failed to check availability' });
    }

    // Build job count map
    const jobCountByDate = {};
    const slotsTaken = {};
    for (const job of (existingJobs || [])) {
      const dateKey = job.scheduled_date;
      jobCountByDate[dateKey] = (jobCountByDate[dateKey] || 0) + 1;
      if (!slotsTaken[dateKey]) slotsTaken[dateKey] = [];
      if (job.time_slot) slotsTaken[dateKey].push(job.time_slot);
    }

    // Build available slots
    const availableSlots = [];
    const current = new Date(startDate);

    while (current <= endDate) {
      const dayOfWeek = current.getDay();

      // Skip Sundays
      if (dayOfWeek !== 0) {
        const dateKey = current.toISOString().split('T')[0];
        const jobCount = jobCountByDate[dateKey] || 0;

        if (jobCount < maxPerDay) {
          const takenSlots = slotsTaken[dateKey] || [];
          const freeSlots = timeSlots.filter(s => !takenSlots.includes(s));

          if (freeSlots.length > 0) {
            availableSlots.push({
              date: dateKey,
              dayName: current.toLocaleDateString('en-GB', { weekday: 'long' }),
              dateFormatted: current.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }),
              slots: freeSlots
            });
          }
        }
      }

      current.setDate(current.getDate() + 1);
    }

    res.json({
      success: true,
      data: {
        slots: availableSlots,
        totalAvailable: availableSlots.length
      }
    });

  } catch (err) {
    log.error('Available slots error', { error: err.message });
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ─── Book a Slot (POST) ────────────────────────────────────────────

router.post('/api/pipeline/:quoteId/book', async (req, res) => {
  try {
    const { quoteId } = req.params;
    const { date, timeSlot } = req.body;

    if (!UUID_REGEX.test(quoteId)) {
      return res.status(400).json({ success: false, error: 'Invalid quote ID' });
    }

    if (!date || !timeSlot) {
      return res.status(400).json({ success: false, error: 'Date and time slot are required' });
    }

    const validSlots = ['morning', 'afternoon', 'evening'];
    if (!validSlots.includes(timeSlot)) {
      return res.status(400).json({ success: false, error: 'Invalid time slot' });
    }

    // Validate date format
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ success: false, error: 'Invalid date format' });
    }

    // Fetch quote
    const { data: quote, error: quoteErr } = await supabase
      .from('quotes')
      .select('*')
      .eq('id', quoteId)
      .is('deleted_at', null)
      .single();

    if (quoteErr || !quote) {
      return res.status(404).json({ success: false, error: 'Quote not found' });
    }

    if (quote.booked_job_id) {
      return res.status(400).json({ success: false, error: 'This quote has already been booked' });
    }

    if (!quote.customer_accepted_final_price) {
      return res.status(400).json({ success: false, error: 'Final price must be accepted before booking' });
    }

    // Race condition check: verify slot is still available
    const { data: conflicting } = await supabase
      .from('jobs')
      .select('id')
      .eq('scheduled_date', date)
      .eq('time_slot', timeSlot)
      .not('status', 'eq', 'cancelled')
      .is('deleted_at', null);

    // Load config for max per day
    let maxPerDay = 4;
    try {
      const { data: settings } = await supabase
        .from('settings')
        .select('value')
        .eq('key', 'pipeline_config')
        .single();
      if (settings?.value?.max_jobs_per_day) {
        maxPerDay = settings.value.max_jobs_per_day;
      }
    } catch (e) { /* use default */ }

    // Check total jobs for that day
    const { data: dayJobs } = await supabase
      .from('jobs')
      .select('id')
      .eq('scheduled_date', date)
      .not('status', 'eq', 'cancelled')
      .is('deleted_at', null);

    if ((dayJobs || []).length >= maxPerDay) {
      return res.status(409).json({ success: false, error: 'This day is now fully booked. Please choose another date.' });
    }

    // Create job
    const servicesList = (quote.services || []).join(' | ');
    const { advanceAfterBooking } = require('../services/pipelineManager');

    const result = await advanceAfterBooking(supabase, quoteId, date, timeSlot);

    if (!result.success) {
      return res.status(500).json({ success: false, error: result.error || 'Booking failed' });
    }

    log.info('Booking created', { quoteId, date, timeSlot, jobId: result.jobId });

    res.json({
      success: true,
      data: {
        jobId: result.jobId,
        date,
        timeSlot,
        message: 'Booking confirmed! You\'ll receive a confirmation shortly.'
      }
    });

  } catch (err) {
    log.error('Booking error', { error: err.message });
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ─── HTML page generators ───────────────────────────────────────────

function photosAlreadyUploadedPage(quote) {
  return `<!DOCTYPE html>
<html><head>
  <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Photos Received - Revive Exterior Cleaning</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; background: linear-gradient(135deg, #84cc16 0%, #65a30d 100%); margin: 0; padding: 20px; min-height: 100vh; display: flex; align-items: center; justify-content: center; }
    .container { background: white; border-radius: 16px; box-shadow: 0 20px 60px rgba(0,0,0,0.3); padding: 40px; max-width: 500px; text-align: center; }
    h1 { color: #365314; margin-bottom: 16px; } p { color: #64748b; line-height: 1.6; }
    .icon { font-size: 48px; margin-bottom: 16px; }
  </style>
</head><body><div class="container">
  <div class="icon">&#10003;</div>
  <h1>Photos Already Received</h1>
  <p>Thanks, ${h(quote.name ? quote.name.split(' ')[0] : 'there')}! We've already got your photos and we're working on your final price.</p>
  <p>You'll receive your fixed price via email and WhatsApp shortly.</p>
</div></body></html>`;
}

function alreadyAcceptedPage(quote) {
  return `<!DOCTYPE html>
<html><head>
  <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Price Accepted - Revive Exterior Cleaning</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; background: linear-gradient(135deg, #84cc16 0%, #65a30d 100%); margin: 0; padding: 20px; min-height: 100vh; display: flex; align-items: center; justify-content: center; }
    .container { background: white; border-radius: 16px; box-shadow: 0 20px 60px rgba(0,0,0,0.3); padding: 40px; max-width: 500px; text-align: center; }
    h1 { color: #365314; margin-bottom: 16px; } p { color: #64748b; line-height: 1.6; }
    .btn { display: inline-block; background: #84cc16; color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 16px; margin-top: 16px; }
  </style>
</head><body><div class="container">
  <h1>Price Already Accepted</h1>
  <p>You've already accepted the price of <strong>&pound;${Number(quote.final_price).toFixed(0)}</strong>.</p>
  <a href="/book/${quote.id}" class="btn">Book Your Slot &rarr;</a>
</div></body></html>`;
}

function alreadyBookedPage(quote) {
  return `<!DOCTYPE html>
<html><head>
  <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Already Booked - Revive Exterior Cleaning</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; background: linear-gradient(135deg, #84cc16 0%, #65a30d 100%); margin: 0; padding: 20px; min-height: 100vh; display: flex; align-items: center; justify-content: center; }
    .container { background: white; border-radius: 16px; box-shadow: 0 20px 60px rgba(0,0,0,0.3); padding: 40px; max-width: 500px; text-align: center; }
    h1 { color: #365314; margin-bottom: 16px; } p { color: #64748b; line-height: 1.6; }
    .icon { font-size: 48px; margin-bottom: 16px; }
  </style>
</head><body><div class="container">
  <div class="icon">&#128197;</div>
  <h1>You're All Booked In!</h1>
  <p>Your appointment is confirmed. Check your email or WhatsApp for the full details.</p>
  <p>If you need to change anything, just get in touch with us directly.</p>
</div></body></html>`;
}

function finalPricePage(quote, honestyClause) {
  const servicesHtml = (quote.services || []).map(s =>
    `<div class="service-item">&#10003; ${formatServiceName(s)}</div>`
  ).join('');

  return `<!DOCTYPE html>
<html><head>
  <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Your Fixed Price - Revive Exterior Cleaning</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; background: linear-gradient(135deg, #84cc16 0%, #65a30d 100%); margin: 0; padding: 20px; min-height: 100vh; display: flex; align-items: center; justify-content: center; }
    .container { background: white; border-radius: 16px; box-shadow: 0 20px 60px rgba(0,0,0,0.3); padding: 40px; max-width: 500px; text-align: center; }
    h1 { color: #365314; margin-bottom: 8px; font-size: 26px; }
    p { color: #64748b; line-height: 1.6; margin-bottom: 16px; }
    .price-box { background: linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%); padding: 24px; border-radius: 12px; margin: 24px 0; border: 2px solid #84cc16; }
    .price { font-size: 48px; font-weight: 800; color: #365314; margin: 8px 0; }
    .price-label { font-size: 14px; color: #65a30d; font-weight: 600; text-transform: uppercase; letter-spacing: 1px; }
    .services { text-align: left; margin: 16px 0; }
    .service-item { padding: 8px 0; border-bottom: 1px solid #e2e8f0; color: #334155; }
    .service-item:last-child { border-bottom: none; }
    .accept-btn { background: #84cc16; color: white; border: none; padding: 16px 40px; font-size: 18px; font-weight: bold; border-radius: 8px; cursor: pointer; width: 100%; margin: 24px 0 16px; transition: background 0.2s; }
    .accept-btn:hover { background: #65a30d; }
    .accept-btn:active { transform: scale(0.98); }
    .clause { background: #f8fafc; padding: 16px; border-radius: 8px; font-size: 13px; color: #64748b; line-height: 1.5; margin-top: 20px; }
    .questions { font-size: 14px; color: #666; margin-top: 16px; }
  </style>
</head><body>
  <div class="container">
    <h1>Your Fixed Price, ${h(quote.name ? quote.name.split(' ')[0] : 'there')}</h1>
    <p>Based on the photos and details you've provided, here's your price:</p>

    <div class="price-box">
      <div class="price-label">Your Price</div>
      <div class="price">&pound;${Number(quote.final_price).toFixed(0)}</div>
      <div class="services">
        ${servicesHtml}
      </div>
    </div>

    <form method="POST" action="/confirm-final-price/${quote.id}">
      <button type="submit" class="accept-btn">&#10003; Accept This Price</button>
    </form>

    <p class="questions">Have questions? Reply to your email or WhatsApp message and we'll be happy to help.</p>

    <div class="clause">
      <strong>Please note:</strong> ${h(honestyClause)}
    </div>
  </div>
</body></html>`;
}

module.exports = {
  router,
  setSupabaseClient
};
