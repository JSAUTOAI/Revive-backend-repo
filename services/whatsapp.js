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

module.exports = {
  sendConfirmationWhatsApp,
  sendEstimateWhatsApp,
  sendAdminAlertWhatsApp,
  sendFollowUpWhatsApp,
  sendRescheduleWhatsApp
};
