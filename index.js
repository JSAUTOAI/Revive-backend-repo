console.log("INDEX.JS IS RUNNING");

// Load environment variables
require('dotenv').config();

// Import required packages
const express = require('express');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

// Create Express app
const app = express();

// Define port
const PORT = process.env.PORT || 3000;

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// =======================
// MIDDLEWARE
// =======================

// Parse JSON bodies
app.use(express.json());

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