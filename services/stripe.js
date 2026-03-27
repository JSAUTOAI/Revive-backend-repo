/**
 * Stripe Service
 *
 * Handles Stripe Checkout Session creation for invoice payments
 * and webhook event processing.
 */

const log = require('./logger').child('Stripe');

let stripe = null;

/**
 * Get or initialise the Stripe client
 */
function getStripe() {
  if (!stripe && process.env.STRIPE_SECRET_KEY) {
    stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
  }
  return stripe;
}

/**
 * Create a Stripe Checkout Session for an invoice
 *
 * @param {Object} invoice - Invoice data from database
 * @returns {Promise<Object>} - { success, sessionId, paymentUrl } or { success: false, error }
 */
async function createCheckoutSession(invoice) {
  const client = getStripe();
  if (!client) {
    log.warn('Stripe not configured — STRIPE_SECRET_KEY missing');
    return { success: false, error: 'Stripe not configured' };
  }

  try {
    const baseUrl = process.env.BASE_URL;
    if (!baseUrl) {
      return { success: false, error: 'BASE_URL not configured' };
    }

    const lineItems = (Array.isArray(invoice.line_items) ? invoice.line_items : []).map(item => ({
      price_data: {
        currency: 'gbp',
        product_data: {
          name: item.description || 'Cleaning Service',
        },
        unit_amount: Math.round((parseFloat(item.unit_price) || 0) * 100), // Stripe uses pence
      },
      quantity: parseInt(item.quantity) || 1,
    }));

    // Add VAT as a separate line item if applicable
    if (parseFloat(invoice.vat_amount) > 0) {
      lineItems.push({
        price_data: {
          currency: 'gbp',
          product_data: {
            name: `VAT (${invoice.vat_rate}%)`,
          },
          unit_amount: Math.round(parseFloat(invoice.vat_amount) * 100),
        },
        quantity: 1,
      });
    }

    const session = await client.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      customer_email: invoice.customer_email || undefined,
      client_reference_id: invoice.id,
      metadata: {
        invoice_id: invoice.id,
        invoice_number: invoice.invoice_number,
      },
      line_items: lineItems,
      success_url: `${baseUrl}/invoice/${invoice.view_token}?paid=true`,
      cancel_url: `${baseUrl}/invoice/${invoice.view_token}`,
    });

    log.info('Checkout session created', {
      invoiceNumber: invoice.invoice_number,
      sessionId: session.id,
    });

    return {
      success: true,
      sessionId: session.id,
      paymentUrl: session.url,
    };

  } catch (error) {
    log.error('Checkout session creation failed', { error: error.message });
    return { success: false, error: error.message };
  }
}

/**
 * Check if Stripe is configured
 */
function isConfigured() {
  return !!process.env.STRIPE_SECRET_KEY;
}

module.exports = {
  getStripe,
  createCheckoutSession,
  isConfigured,
};
