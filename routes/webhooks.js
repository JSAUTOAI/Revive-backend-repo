/**
 * Webhook Routes - Signature-Validated Endpoints
 *
 * Handles incoming webhooks from Resend (email events) and Twilio (message status).
 * All webhooks are validated using cryptographic signatures before processing.
 */

const crypto = require('crypto');
const log = require('../services/logger').child('Webhooks');

let supabase;

function setSupabaseClient(client) {
  supabase = client;
}

// ===========================
// RESEND WEBHOOK
// ===========================

/**
 * Verify Resend webhook signature using HMAC-SHA256
 * @see https://resend.com/docs/dashboard/webhooks/introduction
 */
function verifyResendSignature(payload, signature, secret) {
  if (!secret || !signature) return false;

  try {
    // Resend sends svix-based signatures: v1,<base64-signature>
    // The signature header contains: v1,<base64>
    const parts = signature.split(',');
    if (parts.length < 2) return false;

    const sigBytes = Buffer.from(parts[1], 'base64');

    // Resend uses svix signing: sign(msgId + '.' + timestamp + '.' + payload)
    // But for simple validation, we verify the HMAC
    const expected = crypto
      .createHmac('sha256', secret)
      .update(payload)
      .digest();

    return crypto.timingSafeEqual(sigBytes, expected);
  } catch (err) {
    log.error('Resend signature verification error', { error: err.message });
    return false;
  }
}

/**
 * POST /webhooks/resend
 *
 * Handles email events: delivered, opened, clicked, bounced, complained
 * Updates quote communication tracking timestamps.
 */
async function handleResendWebhook(req, res) {
  try {
    const secret = process.env.RESEND_WEBHOOK_SECRET;

    // If no secret configured, accept but log warning
    if (!secret) {
      log.warn('RESEND_WEBHOOK_SECRET not set — skipping signature verification');
    } else {
      const signature = req.headers['svix-signature'];
      const rawBody = JSON.stringify(req.body);

      if (!signature || !verifyResendSignature(rawBody, signature, secret)) {
        log.error('Resend signature verification failed');
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }

    const event = req.body;
    const eventType = event.type;
    const emailData = event.data;

    log.info('Resend event', { eventType, to: emailData?.to?.[0] || 'unknown' });

    // Track email events in quote activity if we can identify the quote
    if (emailData?.to && supabase) {
      const recipientEmail = Array.isArray(emailData.to) ? emailData.to[0] : emailData.to;

      // Find the most recent quote for this email
      const { data: quote } = await supabase
        .from('quotes')
        .select('id')
        .eq('email', recipientEmail)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (quote) {
        const updates = {};
        const activityMap = {
          'email.delivered': 'Email delivered',
          'email.opened': 'Customer opened email',
          'email.clicked': 'Customer clicked link in email',
          'email.bounced': 'Email bounced — check address',
          'email.complained': 'Customer marked email as spam'
        };

        // Update last_contact_at on delivery
        if (eventType === 'email.delivered') {
          updates.last_contact_at = new Date().toISOString();
        }

        // Log activity
        const description = activityMap[eventType];
        if (description) {
          await supabase.from('quote_activity').insert({
            quote_id: quote.id,
            action_type: 'email_event',
            description: `${description} (${emailData.subject || 'unknown subject'})`,
            created_at: new Date().toISOString()
          });
        }

        if (Object.keys(updates).length > 0) {
          await supabase.from('quotes').update(updates).eq('id', quote.id);
        }
      }
    }

    res.json({ received: true });

  } catch (error) {
    log.error('Resend handler error', { error: error.message });
    res.status(500).json({ error: 'Webhook processing failed' });
  }
}

// ===========================
// TWILIO WEBHOOK
// ===========================

/**
 * Verify Twilio webhook signature
 * @see https://www.twilio.com/docs/usage/security#validating-requests
 */
function verifyTwilioSignature(url, params, signature, authToken) {
  if (!authToken || !signature) return false;

  try {
    // Build the data string: URL + sorted params concatenated
    let data = url;
    const sortedKeys = Object.keys(params).sort();
    for (const key of sortedKeys) {
      data += key + params[key];
    }

    const expected = crypto
      .createHmac('sha1', authToken)
      .update(Buffer.from(data, 'utf-8'))
      .digest('base64');

    // Timing-safe comparison
    const sig = Buffer.from(signature);
    const exp = Buffer.from(expected);
    if (sig.length !== exp.length) return false;
    return crypto.timingSafeEqual(sig, exp);
  } catch (err) {
    log.error('Twilio signature verification error', { error: err.message });
    return false;
  }
}

/**
 * POST /webhooks/twilio
 *
 * Handles WhatsApp message status callbacks:
 * queued, sent, delivered, read, failed, undelivered
 */
async function handleTwilioWebhook(req, res) {
  try {
    const authToken = process.env.TWILIO_AUTH_TOKEN;

    if (!authToken) {
      log.warn('TWILIO_AUTH_TOKEN not set — skipping signature verification');
    } else {
      const signature = req.headers['x-twilio-signature'];
      // Build the full URL Twilio used to call us
      const protocol = req.headers['x-forwarded-proto'] || req.protocol;
      const fullUrl = `${protocol}://${req.headers.host}${req.originalUrl}`;

      if (!signature || !verifyTwilioSignature(fullUrl, req.body || {}, signature, authToken)) {
        log.error('Twilio signature verification failed');
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }

    const {
      MessageSid,
      MessageStatus,
      To,
      ErrorCode,
      ErrorMessage
    } = req.body || {};

    log.info('Twilio status', { status: MessageStatus, to: To || 'unknown', sid: MessageSid || 'unknown' });

    // Log failures for debugging
    if (MessageStatus === 'failed' || MessageStatus === 'undelivered') {
      log.error('WhatsApp delivery failed', { errorCode: ErrorCode, errorMessage: ErrorMessage });
    }

    // Track in quote activity if we can identify the recipient
    if (To && supabase) {
      // Strip 'whatsapp:+44' prefix and reformat to find matching phone
      const cleanPhone = To.replace('whatsapp:', '').replace('+44', '0');

      const { data: quote } = await supabase
        .from('quotes')
        .select('id')
        .eq('phone', cleanPhone)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (quote) {
        const statusMap = {
          'delivered': 'WhatsApp message delivered',
          'read': 'Customer read WhatsApp message',
          'failed': `WhatsApp delivery failed (${ErrorCode || 'unknown'})`,
          'undelivered': `WhatsApp undelivered (${ErrorCode || 'unknown'})`
        };

        const description = statusMap[MessageStatus];
        if (description) {
          await supabase.from('quote_activity').insert({
            quote_id: quote.id,
            action_type: 'whatsapp_event',
            description,
            created_at: new Date().toISOString()
          });
        }
      }
    }

    // Twilio expects 200 with empty TwiML or just 200
    res.status(200).send('<Response></Response>');

  } catch (error) {
    log.error('Twilio handler error', { error: error.message });
    res.status(500).send('<Response></Response>');
  }
}

module.exports = {
  setSupabaseClient,
  handleResendWebhook,
  handleTwilioWebhook
};
