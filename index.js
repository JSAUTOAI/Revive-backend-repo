console.log("INDEX.JS IS RUNNING");

// Load environment variables
require('dotenv').config();

// Import required packages
const express = require('express');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

// Import estimation services
const { queueEstimation } = require('./services/estimationJob');

// Import email service
const { sendConfirmationEmail } = require('./services/emailer');

// Import WhatsApp service
const { sendConfirmationWhatsApp } = require('./services/whatsapp');

// Import Google Sheets service
const { syncQuoteToSheets } = require('./services/googleSheets');

// Import chatbot service
const { chat } = require('./services/chatbot');

// Import admin notification functions
const { sendAdminAlert } = require('./services/emailer');
const { sendAdminAlertWhatsApp } = require('./services/whatsapp');

// Import admin middleware and routes
const { requireAdminAuth } = require('./middleware/auth');
const adminRoutes = require('./routes/admin');
const jobRoutes = require('./routes/jobs');
const customerRoutes = require('./routes/customers');

// Create Express app
const app = express();

// Define port
const PORT = process.env.PORT || 3000;

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Pass Supabase client to admin routes, job routes, and customer routes
adminRoutes.setSupabaseClient(supabase);
jobRoutes.setSupabaseClient(supabase);
customerRoutes.setSupabaseClient(supabase);

// =======================
// MIDDLEWARE
// =======================

// CORS - Allow Aura form to submit and admin API access
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Parse JSON bodies
app.use(express.json({ limit: '15mb' }));

// Parse URL-encoded bodies (from forms)
app.use(express.urlencoded({ extended: true }));

// Serve static files from /public
app.use(express.static(path.join(__dirname, 'public')));

// =======================
// ROUTES
// =======================

// Home route
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Example API route
app.get('/api/hello', (req, res) => {
  res.json({
    message: 'Hello from the backend!',
    timestamp: new Date()
  });
});

// Example POST route
app.post('/api/data', (req, res) => {
  const receivedData = req.body;
  console.log('Received data:', receivedData);

  res.json({
    success: true,
    message: 'Data received successfully',
    data: receivedData
  });
});

// Quote request route (flexible + future-proof)
app.post('/api/quote', async (req, res) => {
  try {
    const {
      name,
      email,
      phone,
      addressLine1,
      postcode,
      preferredContact,
      bestTime,
      remindersOk,
      formVersion,
      services,
      answers
    } = req.body;

    // Validate required fields
    const missing = [];
    if (!name) missing.push('name');
    if (!email) missing.push('email');
    if (!phone) missing.push('phone');
    if (!addressLine1) missing.push('addressLine1');
    if (!postcode) missing.push('postcode');

    if (missing.length > 0) {
      return res.status(400).json({
        success: false,
        error: `Missing required fields: ${missing.join(', ')}`
      });
    }

    // Extract services array (accept from top-level or derive from answers)
    let servicesArray = services || [];

    // Fallback: derive from answers if services not provided
    if ((!servicesArray || servicesArray.length === 0) && answers) {
      const derivedServices = [];
      // Map form values to service slugs
      const serviceMap = {
        roof: 'roof',
        driveway: 'driveway',
        gutter: 'gutter',
        softwash: 'softwash',
        render: 'render',
        window: 'window',
        solar: 'solar',
        other: 'other'
      };

      // Check if services are in answers object
      Object.keys(serviceMap).forEach(key => {
        if (answers[key] === true || answers[key] === 'true') {
          derivedServices.push(serviceMap[key]);
        }
      });

      servicesArray = derivedServices;
    }

    // Insert into Supabase
    const { data, error } = await supabase
      .from('quotes')
      .insert([
        {
          name,
          email,
          phone,
          address_line1: addressLine1,
          postcode,
          preferred_contact: preferredContact || null,
          best_time: bestTime || null,
          reminders_ok: remindersOk || null,
          form_version: formVersion || null,
          services: servicesArray,
          answers: answers || null,
          status: 'new'
        }
      ])
      .select();

    if (error) {
      console.error('Database error:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to save quote request'
      });
    }

    // Log successful submission
    console.log('--- NEW QUOTE SAVED ---');
    console.log('ID:', data[0].id);
    console.log('Name:', name);
    console.log('Email:', email);
    console.log('Services:', servicesArray.join(', ') || 'none');
    console.log('Time:', new Date().toISOString());
    console.log('-------------------------');

    const savedQuote = data[0];

    // Auto-link to customer profile (find existing or create new)
    const customerId = await customerRoutes.findOrCreateCustomer(savedQuote);
    if (customerId) {
      await supabase.from('quotes').update({ customer_id: customerId }).eq('id', savedQuote.id);
      savedQuote.customer_id = customerId;
    }

    // Sync to Google Sheets (non-blocking)
    syncQuoteToSheets(savedQuote).catch(err => {
      console.error('[Quote Route] Failed to sync to Google Sheets:', err);
      // Continue even if Sheets sync fails - don't block customer workflow
    });

    // Trigger async estimation job (non-blocking)
    queueEstimation(supabase, savedQuote.id, savedQuote);

    // Send confirmation via both WhatsApp and email (belt and suspenders)
    sendConfirmationWhatsApp(savedQuote).catch(err => {
      console.error('[Quote Route] Failed to send confirmation WhatsApp:', err);
    });

    sendConfirmationEmail(savedQuote).catch(err => {
      console.error('[Quote Route] Failed to send confirmation email:', err);
    });

    // Return success (same format as before)
    res.json({
      success: true,
      message: 'Quote request received. We will be in touch soon.'
    });

  } catch (err) {
    console.error('Unexpected error:', err);
    res.status(500).json({
      success: false,
      error: 'An unexpected error occurred'
    });
  }
});

// =======================
// CHATBOT ROUTE
// =======================

// Simple in-memory rate limiter for chat
const chatRateLimit = new Map();
const CHAT_RATE_WINDOW = 10 * 60 * 1000; // 10 minutes
const CHAT_RATE_MAX = 30; // max messages per window

function checkChatRateLimit(ip) {
  const now = Date.now();
  const entry = chatRateLimit.get(ip);
  if (!entry || now - entry.windowStart > CHAT_RATE_WINDOW) {
    chatRateLimit.set(ip, { windowStart: now, count: 1 });
    return true;
  }
  if (entry.count >= CHAT_RATE_MAX) return false;
  entry.count++;
  return true;
}

// Clean up rate limit map periodically
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of chatRateLimit) {
    if (now - entry.windowStart > CHAT_RATE_WINDOW) chatRateLimit.delete(ip);
  }
}, 5 * 60 * 1000);

app.post('/api/chat', async (req, res) => {
  try {
    const ip = req.ip || req.socket?.remoteAddress || 'unknown';
    if (!checkChatRateLimit(ip)) {
      return res.status(429).json({ success: false, error: 'Too many messages. Please wait a moment.' });
    }

    const { messages } = req.body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ success: false, error: 'Messages array is required' });
    }

    // Limit conversation length to prevent abuse
    const trimmedMessages = messages.slice(-20);

    const response = await chat(trimmedMessages);

    res.json({ success: true, response });

  } catch (err) {
    console.error('[Chat Route] Error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to process chat message' });
  }
});

// =======================
// CUSTOMER ACCEPTANCE ROUTE
// =======================

// Accept estimate route - Customer clicks link from email/WhatsApp
app.get('/accept-estimate/:quoteId', async (req, res) => {
  try {
    const { quoteId } = req.params;

    // Validate UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(quoteId)) {
      return res.status(400).send(`
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Invalid Link - Revive Exterior Cleaning</title>
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
              background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
              margin: 0;
              padding: 20px;
              min-height: 100vh;
              display: flex;
              align-items: center;
              justify-content: center;
            }
            .container {
              background: white;
              border-radius: 16px;
              box-shadow: 0 20px 60px rgba(0,0,0,0.3);
              padding: 40px;
              max-width: 500px;
              text-align: center;
            }
            h1 { color: #dc2626; margin-bottom: 16px; }
            p { color: #64748b; line-height: 1.6; margin-bottom: 24px; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>⚠️ Invalid Link</h1>
            <p>This acceptance link appears to be invalid or incomplete. Please use the link provided in your quote email or WhatsApp message.</p>
            <p>If you continue to have issues, please contact us directly.</p>
          </div>
        </body>
        </html>
      `);
    }

    // Fetch quote from database
    const { data: quote, error } = await supabase
      .from('quotes')
      .select('*')
      .eq('id', quoteId)
      .single();

    if (error || !quote) {
      console.error('[Accept Route] Quote not found:', quoteId, error);
      return res.status(404).send(`
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Quote Not Found - Revive Exterior Cleaning</title>
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
              background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
              margin: 0;
              padding: 20px;
              min-height: 100vh;
              display: flex;
              align-items: center;
              justify-content: center;
            }
            .container {
              background: white;
              border-radius: 16px;
              box-shadow: 0 20px 60px rgba(0,0,0,0.3);
              padding: 40px;
              max-width: 500px;
              text-align: center;
            }
            h1 { color: #dc2626; margin-bottom: 16px; }
            p { color: #64748b; line-height: 1.6; margin-bottom: 24px; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>❌ Quote Not Found</h1>
            <p>We couldn't find this quote in our system. The link may have expired or the quote may have already been processed.</p>
            <p>Please contact us directly if you need assistance.</p>
          </div>
        </body>
        </html>
      `);
    }

    // Show confirmation page (not auto-accept to avoid link preview issues)
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Confirm Acceptance - Revive Exterior Cleaning</title>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            background: linear-gradient(135deg, #10b981 0%, #059669 100%);
            margin: 0;
            padding: 20px;
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
          }
          .container {
            background: white;
            border-radius: 16px;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
            padding: 40px;
            max-width: 500px;
            text-align: center;
          }
          h1 {
            color: #065f46;
            margin-bottom: 16px;
            font-size: 28px;
          }
          p {
            color: #64748b;
            line-height: 1.6;
            margin-bottom: 16px;
          }
          .estimate {
            background: #f0fdf4;
            padding: 20px;
            border-radius: 12px;
            margin: 24px 0;
            border-left: 4px solid #10b981;
          }
          .estimate-amount {
            font-size: 32px;
            font-weight: bold;
            color: #065f46;
            margin: 8px 0;
          }
          .services {
            text-align: left;
            margin: 16px 0;
          }
          .service-item {
            padding: 8px 0;
            border-bottom: 1px solid #e2e8f0;
          }
          .service-item:last-child {
            border-bottom: none;
          }
          .disclaimer {
            background: #f8fafc;
            padding: 16px;
            border-radius: 8px;
            font-size: 13px;
            color: #64748b;
            line-height: 1.5;
            margin-top: 24px;
          }
          .accept-button {
            background: #10b981;
            color: white;
            border: none;
            padding: 16px 40px;
            font-size: 18px;
            font-weight: bold;
            border-radius: 8px;
            cursor: pointer;
            margin: 24px 0;
            width: 100%;
            transition: background 0.2s;
          }
          .accept-button:hover {
            background: #059669;
          }
          .accept-button:active {
            transform: scale(0.98);
          }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>Ready to Proceed, ${quote.name}?</h1>
          <p>Please confirm you're happy with this estimated price range:</p>

          <div class="estimate">
            <p style="margin: 0 0 8px 0; color: #065f46; font-weight: 600;">Estimated Price Range</p>
            <div class="estimate-amount">£${quote.estimated_value_min} - £${quote.estimated_value_max}</div>
            <div class="services">
              ${quote.services.map(s => `<div class="service-item">✓ ${s.charAt(0).toUpperCase() + s.slice(1)} Cleaning</div>`).join('')}
            </div>
          </div>

          <form method="POST" action="/confirm-acceptance/${quoteId}">
            <button type="submit" class="accept-button">
              ✓ Yes, I Accept This Quote
            </button>
          </form>

          <p style="font-size: 14px; color: #666; margin-top: 16px;">
            We'll contact you ${quote.best_time ? `at your preferred time (${quote.best_time})` : 'shortly'} via ${quote.preferred_contact || 'email'} to discuss the job in detail.
          </p>

          <div class="disclaimer">
            <strong>Please note:</strong> The price range provided is an estimate based on the information you've supplied. The final quote will be confirmed following a detailed discussion of your specific requirements and may be subject to adjustment based on site conditions, accessibility, and the full scope of work required.
          </div>
        </div>
      </body>
      </html>
    `);

  } catch (err) {
    console.error('[Accept Route] Unexpected error:', err);
    res.status(500).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Error - Revive Exterior Cleaning</title>
      </head>
      <body>
        <h1>An unexpected error occurred</h1>
        <p>Please contact us directly.</p>
      </body>
      </html>
    `);
  }
});

// =======================
// CONFIRM ACCEPTANCE ROUTE (POST)
// =======================

// Confirm acceptance - Customer clicks the button
app.post('/confirm-acceptance/:quoteId', async (req, res) => {
  try {
    const { quoteId } = req.params;

    // Validate UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(quoteId)) {
      return res.status(400).send(`
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Invalid Link - Revive Exterior Cleaning</title>
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
              background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
              margin: 0;
              padding: 20px;
              min-height: 100vh;
              display: flex;
              align-items: center;
              justify-content: center;
            }
            .container {
              background: white;
              border-radius: 16px;
              box-shadow: 0 20px 60px rgba(0,0,0,0.3);
              padding: 40px;
              max-width: 500px;
              text-align: center;
            }
            h1 { color: #dc2626; margin-bottom: 16px; }
            p { color: #64748b; line-height: 1.6; margin-bottom: 24px; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>⚠️ Invalid Link</h1>
            <p>This acceptance link appears to be invalid or incomplete. Please use the link provided in your quote email or WhatsApp message.</p>
            <p>If you continue to have issues, please contact us directly.</p>
          </div>
        </body>
        </html>
      `);
    }

    // Fetch quote from database
    const { data: quote, error } = await supabase
      .from('quotes')
      .select('*')
      .eq('id', quoteId)
      .single();

    if (error || !quote) {
      console.error('[Confirm Route] Quote not found:', quoteId, error);
      return res.status(404).send(`
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Quote Not Found - Revive Exterior Cleaning</title>
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
              background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
              margin: 0;
              padding: 20px;
              min-height: 100vh;
              display: flex;
              align-items: center;
              justify-content: center;
            }
            .container {
              background: white;
              border-radius: 16px;
              box-shadow: 0 20px 60px rgba(0,0,0,0.3);
              padding: 40px;
              max-width: 500px;
              text-align: center;
            }
            h1 { color: #dc2626; margin-bottom: 16px; }
            p { color: #64748b; line-height: 1.6; margin-bottom: 24px; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>❌ Quote Not Found</h1>
            <p>We couldn't find this quote in our system. The link may have expired or the quote may have already been processed.</p>
            <p>Please contact us directly if you need assistance.</p>
          </div>
        </body>
        </html>
      `);
    }

    // Check if already accepted
    if (quote.customer_accepted_estimate) {
      console.log(`[Confirm Route] Quote ${quoteId} already accepted at ${quote.customer_accepted_at}`);
      return res.send(`
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Already Accepted - Revive Exterior Cleaning</title>
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
              background: linear-gradient(135deg, #10b981 0%, #059669 100%);
              margin: 0;
              padding: 20px;
              min-height: 100vh;
              display: flex;
              align-items: center;
              justify-content: center;
            }
            .container {
              background: white;
              border-radius: 16px;
              box-shadow: 0 20px 60px rgba(0,0,0,0.3);
              padding: 40px;
              max-width: 500px;
              text-align: center;
            }
            .checkmark {
              width: 80px;
              height: 80px;
              border-radius: 50%;
              background: #10b981;
              margin: 0 auto 24px;
              display: flex;
              align-items: center;
              justify-content: center;
              font-size: 48px;
            }
            h1 { color: #065f46; margin-bottom: 16px; }
            p { color: #64748b; line-height: 1.6; margin-bottom: 16px; }
            .info { background: #f0fdf4; padding: 16px; border-radius: 8px; border-left: 4px solid #10b981; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="checkmark">✓</div>
            <h1>Quote Already Accepted</h1>
            <p>You've already accepted this quote. We've noted your interest and will be in touch soon!</p>
            <div class="info">
              <p style="margin: 0; font-size: 14px;"><strong>What happens next?</strong><br>
              We'll contact you at your preferred time to discuss the job in detail and provide a precise, finalised quote.</p>
            </div>
          </div>
        </body>
        </html>
      `);
    }

    // Update database - mark as accepted
    const { error: updateError } = await supabase
      .from('quotes')
      .update({
        customer_accepted_estimate: true,
        customer_accepted_at: new Date().toISOString(),
        customer_response: 'accepted'
      })
      .eq('id', quoteId);

    if (updateError) {
      console.error('[Accept Route] Failed to update quote:', updateError);
      return res.status(500).send(`
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Error - Revive Exterior Cleaning</title>
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
              background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
              margin: 0;
              padding: 20px;
              min-height: 100vh;
              display: flex;
              align-items: center;
              justify-content: center;
            }
            .container {
              background: white;
              border-radius: 16px;
              box-shadow: 0 20px 60px rgba(0,0,0,0.3);
              padding: 40px;
              max-width: 500px;
              text-align: center;
            }
            h1 { color: #dc2626; margin-bottom: 16px; }
            p { color: #64748b; line-height: 1.6; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>⚠️ Something Went Wrong</h1>
            <p>We encountered an error recording your acceptance. Please try again or contact us directly.</p>
          </div>
        </body>
        </html>
      `);
    }

    console.log(`[Accept Route] ✅ Quote ${quoteId} accepted by ${quote.name}`);

    const acceptedAt = new Date().toISOString();

    // Update Google Sheets with acceptance status (non-blocking)
    const { updateQuoteInSheets } = require('./services/googleSheets');
    updateQuoteInSheets(quoteId, {
      customer_accepted_estimate: true,
      customer_accepted_at: acceptedAt
    }).catch(err => {
      console.error('[Accept Route] Failed to update Google Sheets:', err);
    });

    // Send admin notification (email)
    const updatedQuote = { ...quote, customer_accepted_estimate: true, customer_accepted_at: acceptedAt };
    sendAdminAlert(updatedQuote, true).catch(err => {
      console.error('[Accept Route] Failed to send admin alert email:', err);
    });

    // Send admin notification (WhatsApp if configured)
    if (process.env.ADMIN_PHONE) {
      sendAdminAlertWhatsApp(updatedQuote, true).catch(err => {
        console.error('[Accept Route] Failed to send admin alert WhatsApp:', err);
      });
    }

    // Success page
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Quote Accepted - Revive Exterior Cleaning</title>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            background: linear-gradient(135deg, #10b981 0%, #059669 100%);
            margin: 0;
            padding: 20px;
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
          }
          .container {
            background: white;
            border-radius: 16px;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
            padding: 40px;
            max-width: 500px;
            text-align: center;
          }
          .checkmark {
            width: 80px;
            height: 80px;
            border-radius: 50%;
            background: #10b981;
            margin: 0 auto 24px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 48px;
            animation: scaleIn 0.5s ease-out;
          }
          @keyframes scaleIn {
            from { transform: scale(0); }
            to { transform: scale(1); }
          }
          h1 {
            color: #065f46;
            margin-bottom: 16px;
            font-size: 28px;
          }
          p {
            color: #64748b;
            line-height: 1.6;
            margin-bottom: 16px;
          }
          .estimate {
            background: #f0fdf4;
            padding: 20px;
            border-radius: 12px;
            margin: 24px 0;
            border-left: 4px solid #10b981;
          }
          .estimate-amount {
            font-size: 32px;
            font-weight: bold;
            color: #065f46;
            margin: 8px 0;
          }
          .disclaimer {
            background: #f8fafc;
            padding: 16px;
            border-radius: 8px;
            font-size: 13px;
            color: #64748b;
            line-height: 1.5;
            margin-top: 24px;
          }
          .services {
            text-align: left;
            margin: 16px 0;
          }
          .service-item {
            padding: 8px 0;
            border-bottom: 1px solid #e2e8f0;
          }
          .service-item:last-child {
            border-bottom: none;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="checkmark">✓</div>
          <h1>Thank You, ${quote.name}!</h1>
          <p>We've received your acceptance of the estimated quote.</p>

          <div class="estimate">
            <p style="margin: 0 0 8px 0; color: #065f46; font-weight: 600;">Estimated Price Range</p>
            <div class="estimate-amount">£${quote.estimated_value_min} - £${quote.estimated_value_max}</div>
            <div class="services">
              ${quote.services.map(s => `<div class="service-item">✓ ${s.charAt(0).toUpperCase() + s.slice(1)} Cleaning</div>`).join('')}
            </div>
          </div>

          <p><strong>What happens next?</strong></p>
          <p>Our team will contact you ${quote.best_time ? `at your preferred time (${quote.best_time})` : 'shortly'} via ${quote.preferred_contact || 'email'} to discuss your requirements in detail and arrange a convenient time for the service.</p>

          <div class="disclaimer">
            <strong>Please note:</strong> The price range provided is an estimate based on the information you've supplied. The final quote will be confirmed following a detailed discussion of your specific requirements and may be subject to adjustment based on site conditions, accessibility, and the full scope of work required.
          </div>
        </div>
      </body>
      </html>
    `);

  } catch (err) {
    console.error('[Accept Route] Unexpected error:', err);
    res.status(500).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Error - Revive Exterior Cleaning</title>
      </head>
      <body>
        <h1>An unexpected error occurred</h1>
        <p>Please contact us directly.</p>
      </body>
      </html>
    `);
  }
});

// =======================
// ADMIN ROUTES (Protected)
// =======================

// Export quotes as CSV
app.get('/admin/export', requireAdminAuth, adminRoutes.exportQuotes);

// List quotes with filtering
app.get('/admin/quotes', requireAdminAuth, adminRoutes.listQuotes);

// Get single quote
app.get('/admin/quotes/:id', requireAdminAuth, adminRoutes.getQuote);

// Update quote status
app.patch('/admin/quotes/:id/status', requireAdminAuth, adminRoutes.updateQuoteStatus);

// Update admin notes
app.patch('/admin/quotes/:id/notes', requireAdminAuth, adminRoutes.updateQuoteNotes);

// General quote update (editable fields)
app.patch('/admin/quotes/:id', requireAdminAuth, adminRoutes.updateQuote);

// Quote activity log
app.get('/admin/quotes/:id/activity', requireAdminAuth, adminRoutes.getQuoteActivity);
app.post('/admin/quotes/:id/activity', requireAdminAuth, adminRoutes.addQuoteActivity);

// Quote attachments
app.post('/admin/quotes/:id/attachments', requireAdminAuth, adminRoutes.uploadAttachment);
app.get('/admin/quotes/:id/attachments', requireAdminAuth, adminRoutes.listAttachments);
app.delete('/admin/quotes/:id/attachments/:filename', requireAdminAuth, adminRoutes.deleteAttachment);

// =======================
// JOB SCHEDULING ROUTES (Protected)
// =======================

// Jobs CRUD
app.get('/admin/jobs', requireAdminAuth, jobRoutes.listJobs);
app.post('/admin/jobs', requireAdminAuth, jobRoutes.createJob);
app.get('/admin/jobs/availability', requireAdminAuth, jobRoutes.getAvailability);
app.patch('/admin/jobs/:id', requireAdminAuth, jobRoutes.updateJob);
app.delete('/admin/jobs/:id', requireAdminAuth, jobRoutes.deleteJob);
app.post('/admin/jobs/:id/notify-reschedule', requireAdminAuth, jobRoutes.notifyReschedule);
app.get('/admin/jobs/week/:date', requireAdminAuth, jobRoutes.getWeekJobs);

// Recurring jobs
app.get('/admin/recurring', requireAdminAuth, jobRoutes.listRecurring);
app.post('/admin/recurring', requireAdminAuth, jobRoutes.createRecurring);
app.patch('/admin/recurring/:id', requireAdminAuth, jobRoutes.updateRecurring);
app.post('/admin/recurring/:id/generate', requireAdminAuth, jobRoutes.generateFromRecurring);

// Team members
app.get('/admin/team', requireAdminAuth, jobRoutes.listTeam);
app.post('/admin/team', requireAdminAuth, jobRoutes.createTeamMember);
app.patch('/admin/team/:id', requireAdminAuth, jobRoutes.updateTeamMember);

// =======================
// CUSTOMER ROUTES (Protected)
// =======================

app.get('/admin/customers', requireAdminAuth, customerRoutes.listCustomers);
app.get('/admin/customers/search', requireAdminAuth, customerRoutes.searchCustomers);
app.get('/admin/customers/stats', requireAdminAuth, customerRoutes.getStats);
app.post('/admin/customers/bulk-followup', requireAdminAuth, customerRoutes.sendBulkFollowUp);
app.get('/admin/customers/bulk-preview', requireAdminAuth, customerRoutes.getBulkPreview);
app.get('/admin/customers/analytics', requireAdminAuth, customerRoutes.getConversionAnalytics);
app.get('/admin/customers/:id', requireAdminAuth, customerRoutes.getCustomer);
app.patch('/admin/customers/:id', requireAdminAuth, customerRoutes.updateCustomer);
app.post('/admin/customers/:id/followup', requireAdminAuth, customerRoutes.sendFollowUp);

// =======================
// TEAM MEMBER SCHEDULE (Public - UUID as access key)
// =======================

app.get('/api/my-schedule/:memberId', jobRoutes.getMySchedule);
app.patch('/api/my-schedule/:memberId/jobs/:jobId', jobRoutes.updateMyJob);

// =======================
// ERROR HANDLING
// =======================

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Route not found',
    message: `Cannot ${req.method} ${req.url}`
  });
});

// General error handler
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: err.message
  });
});

// =======================
// START SERVER
// =======================

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  console.log(`Serving static files from ${path.join(__dirname, 'public')}`);
});

// Optional export
module.exports = app;