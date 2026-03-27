/**
 * WhatsApp Service - Twilio Integration
 *
 * Handles all WhatsApp messaging via Twilio API
 * Uses pre-approved Content Templates for business-initiated messages
 */

const twilio = require('twilio');
const log = require('./logger').child('WhatsApp');

// Initialize Twilio client
const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

// Twilio WhatsApp number (production)
const FROM_WHATSAPP = `whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER}`;

// Content Template SIDs (v3 - rich formatting with emojis, bold, bullet points)
const TEMPLATES = {
  QUOTE_CONFIRMATION: 'HXe1a33f5eaa1799f1c5c596f3e496769e',
  ESTIMATE_READY: 'HXf579b26142676cd0271ea20ed54c379d',
  ADMIN_ALERT: 'HX4ec1c09e9d04022e7758a80b865f8991',
  FOLLOW_UP: process.env.TWILIO_FOLLOW_UP_TEMPLATE || null,
};

/**
 * Send confirmation message via WhatsApp (v3 template)
 *
 * Template variables:
 *   {{1}} = Customer name
 *   {{2}} = Services list (bullet pointed)
 *   {{3}} = Location (address, postcode)
 *
 * @param {Object} quote - Quote data from database
 * @returns {Promise<Object>} - Twilio API response
 */
async function sendConfirmationWhatsApp(quote) {
  try {
    log.info('Sending confirmation', { phone: quote.phone });

    const toWhatsApp = formatPhoneNumber(quote.phone);
    const servicesBullets = (quote.services || []).map(s => capitalizeService(s)).join(', ');
    const location = [quote.address_line1, quote.postcode].filter(Boolean).join(', ');

    const vars = {
      '1': String(quote.name || 'Customer'),
      '2': String(servicesBullets || '• Cleaning service'),
      '3': String(location || 'Location TBC')
    };
    log.debug('Confirmation variables', vars);

    const message = await client.messages.create({
      from: FROM_WHATSAPP,
      to: toWhatsApp,
      contentSid: TEMPLATES.QUOTE_CONFIRMATION,
      contentVariables: JSON.stringify(vars)
    });

    log.info('Confirmation sent', { messageSid: message.sid });
    return { success: true, messageSid: message.sid };

  } catch (error) {
    log.error('Confirmation failed', { error: error.message, code: error.code, status: error.status });
    return { success: false, error: error.message };
  }
}

/**
 * Send estimate message via WhatsApp (v3 text template)
 *
 * Template variables:
 *   {{1}} = Customer name
 *   {{2}} = Price range (e.g. "£150 - £300")
 *   {{3}} = Services list (bullet pointed)
 *   {{4}} = Location (address, postcode)
 *   {{5}} = Contact timing (e.g. "at your preferred time (evenings)" or "shortly")
 *   {{6}} = Accept estimate URL
 *
 * @param {Object} quote - Quote data with estimate fields
 * @returns {Promise<Object>} - Twilio API response
 */
async function sendEstimateWhatsApp(quote) {
  try {
    log.info('Sending estimate', { phone: quote.phone });

    const toWhatsApp = formatPhoneNumber(quote.phone);
    const priceRange = `£${quote.estimated_value_min || 0} - £${quote.estimated_value_max || 0}`;
    const servicesBullets = (quote.services || []).map(s => capitalizeService(s)).join(', ');
    const location = [quote.address_line1, quote.postcode].filter(Boolean).join(', ');
    const contactTiming = quote.best_time
      ? `at your preferred time (${quote.best_time})`
      : 'shortly';

    const baseUrl = process.env.BASE_URL || '';
    const vars = {
      '1': String(quote.name || 'Customer'),
      '2': String(priceRange || 'Price TBC'),
      '3': String(servicesBullets || '• Cleaning service'),
      '4': String(location || 'Location TBC'),
      '5': String(contactTiming),
      '6': String(`${baseUrl}/accept-estimate/${quote.id}`)
    };
    log.debug('Estimate variables', vars);

    const message = await client.messages.create({
      from: FROM_WHATSAPP,
      to: toWhatsApp,
      contentSid: TEMPLATES.ESTIMATE_READY,
      contentVariables: JSON.stringify(vars)
    });

    log.info('Estimate sent', { messageSid: message.sid });
    return { success: true, messageSid: message.sid };

  } catch (error) {
    log.error('Estimate failed', { error: error.message, code: error.code, status: error.status });
    return { success: false, error: error.message };
  }
}

/**
 * Send admin alert via WhatsApp for high-value leads (v3 template)
 *
 * Template variables:
 *   {{1}} = Alert type ("HOT LEAD ALERT" or "CUSTOMER ACCEPTED QUOTE!")
 *   {{2}} = Lead score
 *   {{3}} = Price range
 *   {{4}} = Customer details block (multi-line)
 *   {{5}} = Services list (bullet pointed)
 *   {{6}} = Preferred contact + best time
 *
 * @param {Object} quote - Quote data with lead scoring
 * @param {boolean} isAcceptance - True if customer just accepted the estimate
 * @returns {Promise<Object>} - Result object
 */
async function sendAdminAlertWhatsApp(quote, isAcceptance = false) {
  try {
    // Skip threshold check if this is an acceptance notification
    if (!isAcceptance) {
      if (quote.lead_score < 80 && quote.estimated_value_max < 500) {
        log.info('Skipping admin alert — lead score too low', { score: quote.lead_score });
        return { success: true, skipped: true };
      }
    }

    const alertType = isAcceptance ? 'CUSTOMER ACCEPTED QUOTE!' : 'HOT LEAD ALERT';
    log.info(`Sending admin alert: ${alertType}`);

    const adminPhone = process.env.ADMIN_PHONE || quote.phone;
    const toWhatsApp = formatPhoneNumber(adminPhone);
    const priceRange = `£${quote.estimated_value_min || 0} - £${quote.estimated_value_max || 0}`;
    const servicesBullets = (quote.services || []).map(s => capitalizeService(s)).join(', ');

    // Build customer details block
    const customerDetails = [
      `Name: ${quote.name || 'Unknown'}`,
      `Phone: ${quote.phone || 'N/A'}`,
      `Email: ${quote.email || 'N/A'}`,
      `Address: ${[quote.address_line1, quote.postcode].filter(Boolean).join(', ') || 'N/A'}`
    ].join(' | ');

    // Build contact preference string
    const contactPref = quote.preferred_contact || 'Email';
    const contactInfo = quote.best_time
      ? `${contactPref} (${quote.best_time})`
      : contactPref;

    const vars = {
      '1': String(alertType),
      '2': String(quote.lead_score || 0),
      '3': String(priceRange),
      '4': String(customerDetails),
      '5': String(servicesBullets || '• Cleaning service'),
      '6': String(contactInfo)
    };
    log.debug('Admin alert variables', vars);

    const message = await client.messages.create({
      from: FROM_WHATSAPP,
      to: toWhatsApp,
      contentSid: TEMPLATES.ADMIN_ALERT,
      contentVariables: JSON.stringify(vars)
    });

    log.info('Admin alert sent', { messageSid: message.sid });
    return { success: true, messageSid: message.sid };

  } catch (error) {
    log.error('Admin alert failed', { error: error.message });
    return { success: false, error: error.message };
  }
}

/**
 * Send follow-up message via WhatsApp
 *
 * Uses Content Template if approved (TWILIO_FOLLOW_UP_TEMPLATE env var),
 * otherwise falls back to freeform message (only works within 24h service window).
 *
 * @param {Object} quote - Quote data with estimation fields
 * @param {number} step - Follow-up step (1 or 2)
 * @returns {Promise<Object>} - Result object
 */
async function sendFollowUpWhatsApp(quote, step = 1) {
  try {
    if (!quote.phone) {
      return { success: false, error: 'No phone number' };
    }

    const toWhatsApp = formatPhoneNumber(quote.phone);
    const priceRange = `£${Number(quote.estimated_value_min || 0).toFixed(0)} – £${Number(quote.estimated_value_max || 0).toFixed(0)}`;
    const services = (quote.services || []).map(s => capitalizeService(s)).join(', ') || 'cleaning';

    if (TEMPLATES.FOLLOW_UP) {
      // Use approved Content Template
      const vars = {
        '1': String(quote.name || 'there'),
        '2': String(services),
        '3': String(priceRange)
      };

      const message = await client.messages.create({
        from: FROM_WHATSAPP,
        to: toWhatsApp,
        contentSid: TEMPLATES.FOLLOW_UP,
        contentVariables: JSON.stringify(vars)
      });

      log.info(`Follow-up step ${step} sent via template`, { quoteId: quote.id, messageSid: message.sid });
      return { success: true, messageSid: message.sid };
    }

    // Fallback: freeform message (only works within 24h customer service window)
    const body = step === 1
      ? `Hi ${quote.name || 'there'}, just checking in! We sent your ${services} estimate of ${priceRange} a few days ago. If you have any questions or would like to book, just reply to this message. No pressure at all!`
      : `Hi ${quote.name || 'there'}, one last check-in about your ${services} quote (${priceRange}). We'd love to help if you're still interested — just drop us a message whenever you're ready. All the best!`;

    const message = await client.messages.create({
      from: FROM_WHATSAPP,
      to: toWhatsApp,
      body: body
    });

    log.info(`Follow-up step ${step} sent via freeform`, { quoteId: quote.id, messageSid: message.sid });
    return { success: true, messageSid: message.sid };

  } catch (error) {
    // Don't throw — email is the primary follow-up channel
    log.warn(`Follow-up step ${step} failed`, { quoteId: quote.id, error: error.message });
    return { success: false, error: error.message };
  }
}

/**
 * Send reschedule notification via WhatsApp (freeform message)
 *
 * Note: This uses a freeform message which only works within the 24-hour
 * customer service window. For business-initiated messages outside this
 * window, a Content Template would need to be approved by Meta.
 * If freeform fails, the email notification serves as fallback.
 *
 * @param {Object} job - Job data with customer info
 * @param {string} formattedDate - Human-readable date
 * @param {string} timeSlot - Time slot
 * @returns {Promise<Object>} - Twilio API response
 */
async function sendRescheduleWhatsApp(job, formattedDate, timeSlot) {
  try {
    if (!job.customer_phone) {
      log.info('No customer phone for reschedule notification');
      return { success: false, error: 'No customer phone' };
    }

    log.info('Sending reschedule notification', { phone: job.customer_phone });

    const toWhatsApp = formatPhoneNumber(job.customer_phone);
    const body = `Hi ${job.customer_name || 'there'}, this is Revive Exterior Cleaning. Your ${job.service || 'cleaning'} appointment has been rescheduled to *${formattedDate}* at *${timeSlot || 'TBC'}*. If this doesn't work for you, please let us know and we'll find an alternative. Thanks!`;

    const message = await client.messages.create({
      from: FROM_WHATSAPP,
      to: toWhatsApp,
      body: body
    });

    log.info('Reschedule notification sent', { messageSid: message.sid });
    return { success: true, messageSid: message.sid };

  } catch (error) {
    log.error('Reschedule notification failed', { error: error.message });
    return { success: false, error: error.message };
  }
}

/**
 * Format phone number for WhatsApp (add country code if missing)
 */
function formatPhoneNumber(phone) {
  let cleaned = phone.replace(/[\s\-\(\)]/g, '');

  if (cleaned.startsWith('0')) {
    cleaned = '+44' + cleaned.substring(1);
  }

  if (!cleaned.startsWith('+')) {
    cleaned = '+44' + cleaned;
  }

  return `whatsapp:${cleaned}`;
}

/**
 * Capitalize service name for display
 */
function capitalizeService(service) {
  const serviceNames = {
    'roof': 'Roof Cleaning',
    'driveway': 'Driveway Cleaning',
    'gutter': 'Gutter Cleaning',
    'softwash': 'Soft Wash',
    'render': 'Render Cleaning',
    'window': 'Window Cleaning',
    'solar': 'Solar Panel Cleaning',
    'patio': 'Patio Cleaning',
    'other': 'Other Services'
  };

  return serviceNames[service] || service.charAt(0).toUpperCase() + service.slice(1);
}

/**
 * Send review request via WhatsApp (freeform - within 24h window)
 *
 * @param {Object} job - Job data with customer info
 * @param {string} reviewUrl - Google Business Profile review URL
 * @returns {Promise<Object>} - Twilio API response
 */
async function sendReviewRequestWhatsApp(job, reviewUrl) {
  try {
    if (!job.customer_phone) {
      log.info('No customer phone for review request');
      return { success: false, error: 'No customer phone' };
    }

    log.info('Sending review request', { phone: job.customer_phone });

    const toWhatsApp = formatPhoneNumber(job.customer_phone);
    const body = `Hi ${job.customer_name || 'there'}, thanks for choosing Revive! We hope your ${job.service || 'property'} is looking brilliant. If you have 30 seconds, a quick Google review would really help us out:\n\n${reviewUrl}\n\nThanks again! - The Revive Team`;

    const message = await client.messages.create({
      from: FROM_WHATSAPP,
      to: toWhatsApp,
      body: body
    });

    log.info('Review request sent', { messageSid: message.sid });
    return { success: true, messageSid: message.sid };

  } catch (error) {
    log.error('Review request failed', { error: error.message });
    return { success: false, error: error.message };
  }
}

// ─── Pipeline WhatsApp Templates ────────────────────────────────────

/**
 * Send photo request via WhatsApp
 * Uses freeform message (works within 24h window) or template if configured.
 */
async function sendPhotoRequestWhatsApp(quote) {
  try {
    if (!quote.phone) {
      return { success: false, error: 'No phone number' };
    }

    log.info('Sending photo request', { phone: quote.phone });

    const toWhatsApp = formatPhoneNumber(quote.phone);
    const services = (quote.services || []).map(s => capitalizeService(s)).join(', ');
    const priceRange = `£${Number(quote.estimated_value_min || 0).toFixed(0)} - £${Number(quote.estimated_value_max || 0).toFixed(0)}`;
    const baseUrl = process.env.BASE_URL || '';
    const uploadUrl = `${baseUrl}/upload-photos/${quote.id}`;

    const templateSid = process.env.TWILIO_PHOTO_REQUEST_TEMPLATE;

    if (templateSid) {
      const vars = {
        '1': String(quote.name || 'there'),
        '2': String(services),
        '3': String(priceRange),
        '4': String(uploadUrl)
      };

      const message = await client.messages.create({
        from: FROM_WHATSAPP,
        to: toWhatsApp,
        contentSid: templateSid,
        contentVariables: JSON.stringify(vars)
      });

      log.info('Photo request sent via template', { messageSid: message.sid });
      return { success: true, messageSid: message.sid };
    }

    // Freeform fallback
    const body = `Hi ${quote.name || 'there'}, thanks for your enquiry about ${services}!\n\nYour estimated range is *${priceRange}*.\n\nTo get you a *fixed price*, we just need a few photos of the area to be cleaned. You can upload them here:\n\n${uploadUrl}\n\nOnce we've reviewed them, we'll send your final price straight through. 📸`;

    const message = await client.messages.create({
      from: FROM_WHATSAPP,
      to: toWhatsApp,
      body: body
    });

    log.info('Photo request sent via freeform', { messageSid: message.sid });
    return { success: true, messageSid: message.sid };

  } catch (error) {
    log.warn('Photo request WhatsApp failed', { quoteId: quote.id, error: error.message });
    return { success: false, error: error.message };
  }
}

/**
 * Send final fixed price via WhatsApp
 */
async function sendFinalPriceWhatsApp(quote) {
  try {
    if (!quote.phone) {
      return { success: false, error: 'No phone number' };
    }

    log.info('Sending final price', { phone: quote.phone, price: quote.final_price });

    const toWhatsApp = formatPhoneNumber(quote.phone);
    const services = (quote.services || []).map(s => capitalizeService(s)).join(', ');
    const baseUrl = process.env.BASE_URL || '';
    const acceptUrl = `${baseUrl}/final-price/${quote.id}`;

    const templateSid = process.env.TWILIO_FINAL_PRICE_TEMPLATE;

    if (templateSid) {
      const vars = {
        '1': String(quote.name || 'there'),
        '2': String(`£${Number(quote.final_price).toFixed(0)}`),
        '3': String(services),
        '4': String(acceptUrl)
      };

      const message = await client.messages.create({
        from: FROM_WHATSAPP,
        to: toWhatsApp,
        contentSid: templateSid,
        contentVariables: JSON.stringify(vars)
      });

      log.info('Final price sent via template', { messageSid: message.sid });
      return { success: true, messageSid: message.sid };
    }

    // Freeform fallback
    const body = `Hi ${quote.name || 'there'}, we've reviewed your photos and here's your fixed price:\n\n*£${Number(quote.final_price).toFixed(0)}* for ${services}\n\nHappy with this? Accept and book your slot online:\n${acceptUrl}\n\nPlease note: this price is based on the information and photos provided. If conditions differ on-site, we'll discuss any adjustments before starting.`;

    const message = await client.messages.create({
      from: FROM_WHATSAPP,
      to: toWhatsApp,
      body: body
    });

    log.info('Final price sent via freeform', { messageSid: message.sid });
    return { success: true, messageSid: message.sid };

  } catch (error) {
    log.warn('Final price WhatsApp failed', { quoteId: quote.id, error: error.message });
    return { success: false, error: error.message };
  }
}

/**
 * Send booking confirmation via WhatsApp
 */
async function sendBookingConfirmationWhatsApp(quote, job) {
  try {
    if (!quote.phone) {
      return { success: false, error: 'No phone number' };
    }

    log.info('Sending booking confirmation', { phone: quote.phone });

    const toWhatsApp = formatPhoneNumber(quote.phone);
    const services = (quote.services || []).map(s => capitalizeService(s)).join(', ');
    const timeLabels = { morning: 'Morning (8am-12pm)', afternoon: 'Afternoon (12pm-4pm)', evening: 'Evening (4pm-7pm)' };
    const dateFormatted = new Date(job.scheduled_date + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    const timeFormatted = timeLabels[job.time_slot] || job.time_slot;

    const templateSid = process.env.TWILIO_BOOKING_CONFIRMATION_TEMPLATE;

    if (templateSid) {
      const vars = {
        '1': String(quote.name || 'there'),
        '2': String(dateFormatted),
        '3': String(timeFormatted),
        '4': String(services)
      };

      const message = await client.messages.create({
        from: FROM_WHATSAPP,
        to: toWhatsApp,
        contentSid: templateSid,
        contentVariables: JSON.stringify(vars)
      });

      log.info('Booking confirmation sent via template', { messageSid: message.sid });
      return { success: true, messageSid: message.sid };
    }

    // Freeform fallback
    const body = `Hi ${quote.name || 'there'}, you're all booked in! 🎉\n\n📅 *${dateFormatted}*\n⏰ *${timeFormatted}*\n🏠 ${services}\n💰 £${Number(quote.final_price).toFixed(0)}\n\nBefore the day:\n• Move vehicles/items away from the work area\n• Ensure access to outdoor taps if possible\n• Let us know about any pets or gates\n\nNeed to reschedule? Just reply to this message. See you soon!`;

    const message = await client.messages.create({
      from: FROM_WHATSAPP,
      to: toWhatsApp,
      body: body
    });

    log.info('Booking confirmation sent via freeform', { messageSid: message.sid });
    return { success: true, messageSid: message.sid };

  } catch (error) {
    log.warn('Booking confirmation WhatsApp failed', { quoteId: quote.id, error: error.message });
    return { success: false, error: error.message };
  }
}

module.exports = {
  sendConfirmationWhatsApp,
  sendEstimateWhatsApp,
  sendAdminAlertWhatsApp,
  sendFollowUpWhatsApp,
  sendRescheduleWhatsApp,
  sendReviewRequestWhatsApp,
  sendPhotoRequestWhatsApp,
  sendFinalPriceWhatsApp,
  sendBookingConfirmationWhatsApp
};
