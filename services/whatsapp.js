/**
 * WhatsApp Service - Twilio Integration
 *
 * Handles all WhatsApp messaging via Twilio API
 */

const twilio = require('twilio');

// Initialize Twilio client
const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

// Twilio WhatsApp number (sandbox or production)
const FROM_WHATSAPP = `whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER}`;

/**
 * Send confirmation message via WhatsApp
 *
 * @param {Object} quote - Quote data from database
 * @returns {Promise<Object>} - Twilio API response
 */
async function sendConfirmationWhatsApp(quote) {
  try {
    console.log(`[WhatsApp] Sending confirmation to ${quote.phone}`);

    // Format phone number for WhatsApp (must include country code)
    const toWhatsApp = formatPhoneNumber(quote.phone);

    const message = await client.messages.create({
      from: FROM_WHATSAPP,
      to: toWhatsApp,
      body: `Hi ${quote.name}! 👋

Thank you for requesting a quote from Revive Exterior Cleaning.

✅ We've received your request for:
${quote.services.map(s => `• ${capitalizeService(s)}`).join('\n')}

📍 Location: ${quote.address_line1}, ${quote.postcode}

We're calculating your personalised estimate now. You'll receive it within the next few minutes!

Questions? Just reply to this message.

- The Revive Team`
    });

    console.log(`[WhatsApp] Confirmation sent successfully: ${message.sid}`);
    return { success: true, messageSid: message.sid };

  } catch (error) {
    console.error('[WhatsApp] Failed to send confirmation:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Send estimate message via WhatsApp
 *
 * @param {Object} quote - Quote data with estimate fields
 * @returns {Promise<Object>} - Twilio API response
 */
async function sendEstimateWhatsApp(quote) {
  try {
    console.log(`[WhatsApp] Sending estimate to ${quote.phone}`);

    const toWhatsApp = formatPhoneNumber(quote.phone);

    const message = await client.messages.create({
      from: FROM_WHATSAPP,
      to: toWhatsApp,
      body: `Hi ${quote.name}, your estimate is ready! 💚

📊 *ESTIMATED PRICE RANGE*
£${quote.estimated_value_min} - £${quote.estimated_value_max}

✅ *Services Included:*
${quote.services.map(s => `• ${capitalizeService(s)}`).join('\n')}

📍 *Location:* ${quote.address_line1}, ${quote.postcode}

ℹ️ *Please note:* This is an estimated range. Final pricing will be confirmed after we assess your property in person.

🗓️ *Ready to book?*
Reply to this message or call us to schedule your service!

- The Revive Team
Professional Property Care`
    });

    console.log(`[WhatsApp] Estimate sent successfully: ${message.sid}`);
    return { success: true, messageSid: message.sid };

  } catch (error) {
    console.error('[WhatsApp] Failed to send estimate:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Send admin alert via WhatsApp for high-value leads
 *
 * @param {Object} quote - Quote data with lead scoring
 * @returns {Promise<Object>} - Twilio API response
 */
async function sendAdminAlertWhatsApp(quote) {
  try {
    // Only send if lead score is high (80+) or high estimated value
    if (quote.lead_score < 80 && quote.estimated_value_max < 500) {
      console.log('[WhatsApp] Skipping admin alert - lead score too low');
      return { success: true, skipped: true };
    }

    console.log(`[WhatsApp] Sending admin alert for high-value lead`);

    // Get admin phone from env or use a default
    const adminPhone = process.env.ADMIN_PHONE || quote.phone; // Fallback for testing
    const toWhatsApp = formatPhoneNumber(adminPhone);

    const message = await client.messages.create({
      from: FROM_WHATSAPP,
      to: toWhatsApp,
      body: `🔥 *HOT LEAD ALERT*

Lead Score: ${quote.lead_score}/100
Qualification: ${quote.qualification_status.toUpperCase()}
Estimated Value: £${quote.estimated_value_min}-£${quote.estimated_value_max}

*Customer Details:*
Name: ${quote.name}
Phone: ${quote.phone}
Email: ${quote.email}
Address: ${quote.address_line1}, ${quote.postcode}

*Services:*
${quote.services.map(s => `• ${capitalizeService(s)}`).join('\n')}

*Preferred Contact:* ${quote.preferred_contact || 'Email'}
${quote.best_time ? `*Best Time:* ${quote.best_time}` : ''}

Contact them ASAP! 🚀`
    });

    console.log(`[WhatsApp] Admin alert sent successfully: ${message.sid}`);
    return { success: true, messageSid: message.sid };

  } catch (error) {
    console.error('[WhatsApp] Failed to send admin alert:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Format phone number for WhatsApp (add country code if missing)
 *
 * @param {string} phone - Phone number from form
 * @returns {string} - Formatted WhatsApp number
 */
function formatPhoneNumber(phone) {
  // Remove spaces, dashes, parentheses
  let cleaned = phone.replace(/[\s\-\(\)]/g, '');

  // If it starts with 0, replace with +44 (UK)
  if (cleaned.startsWith('0')) {
    cleaned = '+44' + cleaned.substring(1);
  }

  // If it doesn't start with +, assume UK and add +44
  if (!cleaned.startsWith('+')) {
    cleaned = '+44' + cleaned;
  }

  return `whatsapp:${cleaned}`;
}

/**
 * Capitalize service name for display
 *
 * @param {string} service - Service slug
 * @returns {string} - Formatted service name
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
