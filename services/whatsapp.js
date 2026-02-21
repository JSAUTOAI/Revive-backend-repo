/**
 * WhatsApp Service - Twilio Integration
 *
 * Handles all WhatsApp messaging via Twilio API
 * Uses pre-approved Content Templates for business-initiated messages
 */

const twilio = require('twilio');

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
    console.log(`[WhatsApp] Sending confirmation to ${quote.phone}`);

    const toWhatsApp = formatPhoneNumber(quote.phone);
    const servicesBullets = (quote.services || []).map(s => '• ' + capitalizeService(s)).join('\n');
    const location = [quote.address_line1, quote.postcode].filter(Boolean).join(', ');

    const vars = {
      '1': String(quote.name || 'Customer'),
      '2': String(servicesBullets || '• Cleaning service'),
      '3': String(location || 'Location TBC')
    };
    console.log(`[WhatsApp] Confirmation variables:`, JSON.stringify(vars));

    const message = await client.messages.create({
      from: FROM_WHATSAPP,
      to: toWhatsApp,
      contentSid: TEMPLATES.QUOTE_CONFIRMATION,
      contentVariables: JSON.stringify(vars)
    });

    console.log(`[WhatsApp] Confirmation sent successfully: ${message.sid}`);
    return { success: true, messageSid: message.sid };

  } catch (error) {
    console.error('[WhatsApp] Failed to send confirmation:', error.message);
    console.error('[WhatsApp] Error details:', JSON.stringify({ code: error.code, status: error.status, moreInfo: error.moreInfo }));
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
    console.log(`[WhatsApp] Sending estimate to ${quote.phone}`);

    const toWhatsApp = formatPhoneNumber(quote.phone);
    const priceRange = `£${quote.estimated_value_min || 0} - £${quote.estimated_value_max || 0}`;
    const servicesBullets = (quote.services || []).map(s => '• ' + capitalizeService(s)).join('\n');
    const location = [quote.address_line1, quote.postcode].filter(Boolean).join(', ');
    const contactTiming = quote.best_time
      ? `at your preferred time (${quote.best_time})`
      : 'shortly';

    const vars = {
      '1': String(quote.name || 'Customer'),
      '2': String(priceRange || 'Price TBC'),
      '3': String(servicesBullets || '• Cleaning service'),
      '4': String(location || 'Location TBC'),
      '5': String(contactTiming),
      '6': String(`https://revive-backend-repo-production.up.railway.app/accept-estimate/${quote.id}`)
    };
    console.log(`[WhatsApp] Estimate variables:`, JSON.stringify(vars));

    const message = await client.messages.create({
      from: FROM_WHATSAPP,
      to: toWhatsApp,
      contentSid: TEMPLATES.ESTIMATE_READY,
      contentVariables: JSON.stringify(vars)
    });

    console.log(`[WhatsApp] Estimate sent successfully: ${message.sid}`);
    return { success: true, messageSid: message.sid };

  } catch (error) {
    console.error('[WhatsApp] Failed to send estimate:', error.message);
    console.error('[WhatsApp] Error details:', JSON.stringify({ code: error.code, status: error.status, moreInfo: error.moreInfo }));
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
        console.log('[WhatsApp] Skipping admin alert - lead score too low');
        return { success: true, skipped: true };
      }
    }

    const alertType = isAcceptance ? 'CUSTOMER ACCEPTED QUOTE!' : 'HOT LEAD ALERT';
    console.log(`[WhatsApp] Sending admin alert for ${alertType}`);

    const adminPhone = process.env.ADMIN_PHONE || quote.phone;
    const toWhatsApp = formatPhoneNumber(adminPhone);
    const priceRange = `£${quote.estimated_value_min || 0} - £${quote.estimated_value_max || 0}`;
    const servicesBullets = (quote.services || []).map(s => '• ' + capitalizeService(s)).join('\n');

    // Build customer details block
    const customerDetails = [
      `Name: ${quote.name || 'Unknown'}`,
      `Phone: ${quote.phone || 'N/A'}`,
      `Email: ${quote.email || 'N/A'}`,
      `Address: ${[quote.address_line1, quote.postcode].filter(Boolean).join(', ') || 'N/A'}`
    ].join('\n');

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
    console.log(`[WhatsApp] Admin alert variables:`, JSON.stringify(vars));

    const message = await client.messages.create({
      from: FROM_WHATSAPP,
      to: toWhatsApp,
      contentSid: TEMPLATES.ADMIN_ALERT,
      contentVariables: JSON.stringify(vars)
    });

    console.log(`[WhatsApp] Admin alert sent successfully: ${message.sid}`);
    return { success: true, messageSid: message.sid };

  } catch (error) {
    console.error('[WhatsApp] Failed to send admin alert:', error.message);
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
  sendAdminAlertWhatsApp
};
