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

// Content Template SIDs (approved by Meta)
// Update these SIDs when creating richer V3 templates
const TEMPLATES = {
  QUOTE_CONFIRMATION: 'HXc8939b6d34aaab6915ffc30cc36c511f',
  ESTIMATE_READY: 'HX32ba36a8fd9c1a9b0b40076188f5ef8d',
};

/**
 * Send confirmation message via WhatsApp (using Content Template)
 *
 * Template: "Hi {{1}}, thank you for your enquiry with Revive Exterior Cleaning.
 *           We have received your request for {{2}} and are preparing your estimate now."
 *
 * @param {Object} quote - Quote data from database
 * @returns {Promise<Object>} - Twilio API response
 */
async function sendConfirmationWhatsApp(quote) {
  try {
    console.log(`[WhatsApp] Sending confirmation to ${quote.phone}`);

    const toWhatsApp = formatPhoneNumber(quote.phone);
    const servicesText = quote.services.map(s => capitalizeService(s)).join(', ');

    const message = await client.messages.create({
      from: FROM_WHATSAPP,
      to: toWhatsApp,
      contentSid: TEMPLATES.QUOTE_CONFIRMATION,
      contentVariables: JSON.stringify({
        '1': quote.name,
        '2': servicesText
      })
    });

    console.log(`[WhatsApp] Confirmation sent successfully: ${message.sid}`);
    return { success: true, messageSid: message.sid };

  } catch (error) {
    console.error('[WhatsApp] Failed to send confirmation:', error.message);
    return { success: false, error: error.message };
  }
}

/*
 * ========================================================================
 * ORIGINAL CONFIRMATION MESSAGE (for reference when creating V3 template)
 * ========================================================================
 *
 * Hi ${quote.name}! 👋
 *
 * Thank you for requesting a quote from Revive Exterior Cleaning.
 *
 * ✅ We've received your request for:
 * ${quote.services.map(s => `• ${capitalizeService(s)}`).join('\n')}
 *
 * 📍 Location: ${quote.address_line1}, ${quote.postcode}
 *
 * We're calculating your personalised estimate now. You'll receive it within the next few minutes!
 *
 * Questions? Just reply to this message.
 *
 * - The Revive Team
 *
 * ========================================================================
 */

/**
 * Send estimate message via WhatsApp (using Content Template)
 *
 * Template: "Hi {{1}}, your estimate for {{2}} is ready.
 *           Estimated price range: {{3}}. We will be in touch shortly to discuss next steps."
 *
 * @param {Object} quote - Quote data with estimate fields
 * @returns {Promise<Object>} - Twilio API response
 */
async function sendEstimateWhatsApp(quote) {
  try {
    console.log(`[WhatsApp] Sending estimate to ${quote.phone}`);

    const toWhatsApp = formatPhoneNumber(quote.phone);
    const servicesText = quote.services.map(s => capitalizeService(s)).join(', ');
    const priceRange = `£${quote.estimated_value_min}-£${quote.estimated_value_max}`;

    const message = await client.messages.create({
      from: FROM_WHATSAPP,
      to: toWhatsApp,
      contentSid: TEMPLATES.ESTIMATE_READY,
      contentVariables: JSON.stringify({
        '1': quote.name,
        '2': servicesText,
        '3': priceRange
      })
    });

    console.log(`[WhatsApp] Estimate sent successfully: ${message.sid}`);
    return { success: true, messageSid: message.sid };

  } catch (error) {
    console.error('[WhatsApp] Failed to send estimate:', error.message);
    return { success: false, error: error.message };
  }
}

/*
 * ========================================================================
 * ORIGINAL ESTIMATE MESSAGE (for reference when creating V3 template)
 * ========================================================================
 *
 * Hi ${quote.name}, your estimate is ready! 💚
 *
 * 📊 *ESTIMATED PRICE RANGE*
 * £${quote.estimated_value_min} - £${quote.estimated_value_max}
 *
 * ✅ *Services Included:*
 * ${quote.services.map(s => `• ${capitalizeService(s)}`).join('\n')}
 *
 * 📍 *Location:* ${quote.address_line1}, ${quote.postcode}
 *
 * ℹ️ *Please note:* This is an estimated range. Final pricing will be confirmed after we assess your property in person.
 *
 * ✅ *Happy with this price range?*
 * Tap here to accept: https://revive-backend-repo-production.up.railway.app/accept-estimate/${quote.id}
 *
 * We'll contact you ${quote.best_time ? `at your preferred time (${quote.best_time})` : 'shortly'} to discuss the job in detail and provide a final quotation.
 *
 * 💬 Have questions? Just reply to this message!
 *
 * - The Revive Team
 * Professional Property Care
 *
 * ========================================================================
 */

/**
 * Send admin alert via WhatsApp for high-value leads
 * NOTE: Admin alerts now handled via email only (no WhatsApp template needed)
 * This function is kept for backwards compatibility - it logs and returns success
 *
 * @param {Object} quote - Quote data with lead scoring
 * @param {boolean} isAcceptance - True if customer just accepted the estimate
 * @returns {Promise<Object>} - Result object
 */
async function sendAdminAlertWhatsApp(quote, isAcceptance = false) {
  // Admin alerts are now sent via email only (see services/emailer.js)
  // No WhatsApp template needed for internal notifications
  const alertType = isAcceptance ? 'customer acceptance' : 'high-value lead';
  console.log(`[WhatsApp] Admin alert for ${alertType} - handled via email instead`);
  return { success: true, skipped: true, reason: 'Admin alerts sent via email' };
}

/*
 * ========================================================================
 * ORIGINAL ADMIN ALERT MESSAGE (for reference if template created later)
 * ========================================================================
 *
 * 🔥 *HOT LEAD ALERT* (or 🎉 *CUSTOMER ACCEPTED QUOTE!*)
 *
 * Lead Score: ${quote.lead_score}/100
 * Qualification: ${quote.qualification_status.toUpperCase()}
 * Estimated Value: £${quote.estimated_value_min}-£${quote.estimated_value_max}
 *
 * *Customer Details:*
 * Name: ${quote.name}
 * Phone: ${quote.phone}
 * Email: ${quote.email}
 * Address: ${quote.address_line1}, ${quote.postcode}
 *
 * *Services:*
 * ${quote.services.map(s => `• ${capitalizeService(s)}`).join('\n')}
 *
 * *Preferred Contact:* ${quote.preferred_contact || 'Email'}
 * ${quote.best_time ? `*Best Time:* ${quote.best_time}` : ''}
 *
 * Contact them ASAP! 🚀
 *
 * ========================================================================
 */

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
