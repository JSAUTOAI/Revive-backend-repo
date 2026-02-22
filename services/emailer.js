/**
 * Email Service - Resend Integration
 *
 * Handles all automated email sending via Resend API
 */

const { Resend } = require('resend');

// Initialize Resend client
const resend = new Resend(process.env.RESEND_API_KEY);

// Email sender - set FROM_EMAIL in Railway env vars once your domain is verified with Resend
const FROM_EMAIL = process.env.FROM_EMAIL || 'onboarding@resend.dev';

/**
 * Send confirmation email immediately after quote submission
 *
 * @param {Object} quote - Quote data from database
 * @returns {Promise<Object>} - Resend API response
 */
async function sendConfirmationEmail(quote) {
  try {
    console.log(`[Email] Sending confirmation to ${quote.email}`);

    const { data, error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: quote.email,
      subject: `Quote Request Received - Revive Exterior Cleaning`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background-color: #84cc16; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0;">
            <h1 style="margin: 0; font-size: 24px;">Thank You, ${quote.name}!</h1>
          </div>

          <div style="background-color: #f9f9f9; padding: 30px; border-radius: 0 0 8px 8px;">
            <p style="font-size: 16px; margin-top: 0;">We've received your quote request and we're excited to help transform your property.</p>

            <div style="background-color: white; padding: 20px; border-radius: 8px; margin: 20px 0;">
              <h2 style="color: #84cc16; margin-top: 0; font-size: 18px;">What Happens Next?</h2>
              <ul style="padding-left: 20px;">
                <li style="margin-bottom: 10px;"><strong>We're calculating your estimate</strong> - You'll receive a detailed quote within 24 hours</li>
                <li style="margin-bottom: 10px;"><strong>Personal consultation</strong> - We may reach out to discuss your specific needs</li>
                <li style="margin-bottom: 10px;"><strong>Flexible scheduling</strong> - We'll work around your availability</li>
              </ul>
            </div>

            <div style="background-color: white; padding: 20px; border-radius: 8px; margin: 20px 0;">
              <h2 style="color: #333; margin-top: 0; font-size: 18px;">Your Quote Details</h2>
              <p style="margin: 5px 0;"><strong>Services:</strong> ${quote.services.join(', ')}</p>
              <p style="margin: 5px 0;"><strong>Address:</strong> ${quote.address_line1}, ${quote.postcode}</p>
              <p style="margin: 5px 0;"><strong>Preferred Contact:</strong> ${quote.preferred_contact || 'Email'}</p>
            </div>

            <p style="font-size: 14px; color: #666; margin-top: 20px;">
              Have questions? Just reply to this email or call us directly.
            </p>

            <p style="font-size: 14px; color: #666;">
              Best regards,<br>
              <strong>The Revive Team</strong>
            </p>
          </div>

          <div style="text-align: center; padding: 20px; font-size: 12px; color: #999;">
            <p>Revive Exterior Cleaning - Professional Property Care</p>
          </div>
        </body>
        </html>
      `
    });

    if (error) {
      console.error('[Email] Confirmation send error:', error);
      throw error;
    }

    console.log('[Email] Confirmation sent successfully:', data.id);
    return { success: true, emailId: data.id };

  } catch (error) {
    console.error('[Email] Failed to send confirmation:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Send estimate email after calculation completes
 *
 * @param {Object} quote - Quote data with estimate fields
 * @returns {Promise<Object>} - Resend API response
 */
async function sendEstimateEmail(quote) {
  try {
    console.log(`[Email] Sending estimate to ${quote.email}`);

    const { data, error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: quote.email,
      subject: `Your Estimate is Ready - £${quote.estimated_value_min}-${quote.estimated_value_max}`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background-color: #84cc16; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0;">
            <h1 style="margin: 0; font-size: 24px;">Your Estimate is Ready!</h1>
          </div>

          <div style="background-color: #f9f9f9; padding: 30px; border-radius: 0 0 8px 8px;">
            <p style="font-size: 16px; margin-top: 0;">Hi ${quote.name},</p>
            <p style="font-size: 16px;">Based on your requirements, here's your estimated cost:</p>

            <div style="background-color: white; padding: 30px; border-radius: 8px; margin: 20px 0; text-align: center; border: 3px solid #84cc16;">
              <h2 style="color: #84cc16; margin: 0; font-size: 36px;">£${quote.estimated_value_min} - £${quote.estimated_value_max}</h2>
              <p style="color: #666; margin: 10px 0 0 0;">Estimated Price Range</p>
            </div>

            <div style="background-color: white; padding: 20px; border-radius: 8px; margin: 20px 0;">
              <h3 style="margin-top: 0; color: #333;">Services Included:</h3>
              <ul style="padding-left: 20px;">
                ${quote.services.map(service => `<li style="margin-bottom: 8px; text-transform: capitalize;">${service}</li>`).join('')}
              </ul>
            </div>

            <div style="background-color: #fff3cd; padding: 15px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #ffc107;">
              <p style="margin: 0; font-size: 14px;">
                <strong>Please note:</strong> This is an estimated range. Final pricing will be confirmed after we assess your property in person.
              </p>
            </div>

            <div style="text-align: center; margin: 30px 0;">
              <p style="font-size: 18px; margin-bottom: 15px;"><strong>Happy with this price range?</strong></p>
              <a href="https://revive-backend-repo-production.up.railway.app/accept-estimate/${quote.id}"
                 style="display: inline-block; background-color: #84cc16; color: white; padding: 16px 40px; text-decoration: none; border-radius: 8px; font-size: 18px; font-weight: bold; margin: 10px 0;">
                ✓ Yes, Accept This Quote
              </a>
              <p style="font-size: 13px; color: #888; margin-top: 15px; line-height: 1.5;">
                By accepting, you confirm your interest in proceeding. We'll contact you ${quote.best_time ? `at your preferred time (${quote.best_time})` : 'shortly'} via ${quote.preferred_contact || 'email'} to discuss the job in detail and provide a final, accurate quotation.
              </p>
            </div>

            <div style="text-align: center; margin: 20px 0; padding-top: 20px; border-top: 1px solid #e0e0e0;">
              <p style="font-size: 14px; color: #666; margin-bottom: 8px;">Have questions first?</p>
              <p style="font-size: 14px; color: #666;">Reply to this email or give us a call.</p>
            </div>

            <p style="font-size: 14px; color: #666;">
              Best regards,<br>
              <strong>The Revive Team</strong>
            </p>
          </div>

          <div style="text-align: center; padding: 20px; font-size: 12px; color: #999;">
            <p>Revive Exterior Cleaning - Professional Property Care</p>
          </div>
        </body>
        </html>
      `
    });

    if (error) {
      console.error('[Email] Estimate send error:', error);
      throw error;
    }

    console.log('[Email] Estimate sent successfully:', data.id);
    return { success: true, emailId: data.id };

  } catch (error) {
    console.error('[Email] Failed to send estimate:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Send admin alert for high-value or hot leads
 *
 * @param {Object} quote - Quote data with lead scoring
 * @param {boolean} isAcceptance - True if customer just accepted the estimate
 * @returns {Promise<Object>} - Resend API response
 */
async function sendAdminAlert(quote, isAcceptance = false) {
  try {
    // Skip threshold check if this is an acceptance notification
    if (!isAcceptance) {
      // Only send if lead score is high (80+) or high estimated value
      if (quote.lead_score < 80 && quote.estimated_value_max < 500) {
        console.log('[Email] Skipping admin alert - lead score too low');
        return { success: true, skipped: true };
      }
    }

    const alertType = isAcceptance ? 'Customer Accepted Quote' : 'High-Value Lead';
    console.log(`[Email] Sending admin alert for ${alertType.toLowerCase()}`);

    const adminEmail = process.env.ADMIN_EMAIL || 'admin@revive.com'; // TODO: Set in .env

    const subject = isAcceptance
      ? `🎉 Customer Accepted Quote - ${quote.name} (£${quote.estimated_value_max})`
      : `🔥 Hot Lead Alert - £${quote.estimated_value_max} potential`;

    const { data, error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: adminEmail,
      subject: subject,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
        </head>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; padding: 20px;">
          ${isAcceptance ? `
          <div style="background-color: #10b981; color: white; padding: 20px; border-radius: 8px; text-align: center; margin-bottom: 20px;">
            <h2 style="margin: 0; font-size: 24px;">🎉 Customer Accepted Quote!</h2>
          </div>
          <p style="font-size: 16px; color: #065f46; font-weight: bold;">
            ${quote.name} just accepted the estimated quote. Contact them ASAP!
          </p>
          ` : `
          <h2 style="color: #84cc16;">🔥 New High-Value Lead</h2>
          `}

          <div style="background-color: #f9f9f9; padding: 15px; border-radius: 8px; margin: 20px 0;">
            <p><strong>Lead Score:</strong> ${quote.lead_score}/100</p>
            <p><strong>Estimated Value:</strong> £${quote.estimated_value_min} - £${quote.estimated_value_max}</p>
            <p><strong>Qualification:</strong> ${quote.qualification_status}</p>
            ${isAcceptance ? `<p><strong>Accepted At:</strong> ${new Date(quote.customer_accepted_at).toLocaleString('en-GB')}</p>` : ''}
          </div>

          <h3>Customer Details</h3>
          <ul>
            <li><strong>Name:</strong> ${quote.name}</li>
            <li><strong>Email:</strong> ${quote.email}</li>
            <li><strong>Phone:</strong> ${quote.phone}</li>
            <li><strong>Address:</strong> ${quote.address_line1}, ${quote.postcode}</li>
            <li><strong>Services:</strong> ${quote.services.join(', ')}</li>
            <li><strong>Preferred Contact:</strong> ${quote.preferred_contact || 'Email'}</li>
            ${quote.best_time ? `<li><strong>Best Time to Contact:</strong> ${quote.best_time}</li>` : ''}
          </ul>

          ${isAcceptance ? `
          <div style="background-color: #d1fae5; padding: 15px; border-radius: 8px; border-left: 4px solid #10b981; margin: 20px 0;">
            <p style="margin: 0; font-weight: bold; color: #065f46;">
              ⚡ Action Required: Contact ${quote.name} to schedule and finalize the quote!
            </p>
          </div>
          ` : ''}

          <p style="margin-top: 20px;">
            <a href="https://revive-backend-repo-production.up.railway.app/admin/quotes/${quote.id}" style="background-color: #84cc16; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">View in Admin</a>
          </p>
        </body>
        </html>
      `
    });

    if (error) {
      console.error('[Email] Admin alert send error:', error);
      throw error;
    }

    console.log('[Email] Admin alert sent successfully:', data.id);
    return { success: true, emailId: data.id };

  } catch (error) {
    console.error('[Email] Failed to send admin alert:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Send follow-up email to a customer
 *
 * @param {Object} customer - Customer data from database
 * @param {string} subject - Email subject line
 * @param {string} body - Email body text (plain text, converted to HTML)
 * @returns {Promise<Object>} - Resend API response
 */
async function sendFollowUpEmail(customer, subject, body) {
  try {
    console.log(`[Email] Sending follow-up to ${customer.email}`);

    // Convert plain text body to HTML paragraphs
    const htmlBody = body.split('\n').filter(l => l.trim()).map(l => `<p style="margin: 0 0 12px 0;">${l}</p>`).join('');

    const { data, error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: customer.email,
      subject: subject,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background-color: #84cc16; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0;">
            <h1 style="margin: 0; font-size: 22px;">Revive Exterior Cleaning</h1>
          </div>

          <div style="background-color: #f9f9f9; padding: 30px; border-radius: 0 0 8px 8px;">
            <div style="font-size: 15px; color: #333;">
              ${htmlBody}
            </div>

            <div style="margin-top: 25px; padding-top: 20px; border-top: 1px solid #e0e0e0;">
              <p style="font-size: 14px; color: #666;">
                Want to book or have questions? Just reply to this email or give us a call.
              </p>
              <p style="font-size: 14px; color: #666;">
                Best regards,<br>
                <strong>The Revive Team</strong>
              </p>
            </div>
          </div>

          <div style="text-align: center; padding: 20px; font-size: 12px; color: #999;">
            <p>Revive Exterior Cleaning - Professional Property Care</p>
          </div>
        </body>
        </html>
      `
    });

    if (error) {
      console.error('[Email] Follow-up send error:', error);
      throw error;
    }

    console.log('[Email] Follow-up sent successfully:', data.id);
    return { success: true, emailId: data.id };

  } catch (error) {
    console.error('[Email] Failed to send follow-up:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Send reschedule notification email to customer
 *
 * @param {Object} job - Job data with customer info and new schedule
 * @param {string} formattedDate - Human-readable date (e.g. "Monday 24th February")
 * @param {string} timeSlot - Time slot (e.g. "09:00")
 * @returns {Promise<Object>} - Resend API response
 */
async function sendRescheduleEmail(job, formattedDate, timeSlot) {
  try {
    if (!job.customer_email) {
      console.log('[Email] No customer email for reschedule notification');
      return { success: false, error: 'No customer email' };
    }

    console.log(`[Email] Sending reschedule notification to ${job.customer_email}`);

    const { data, error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: job.customer_email,
      subject: `Your ${job.service || 'cleaning'} appointment has been rescheduled - Revive`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background-color: #84cc16; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0;">
            <h1 style="margin: 0; font-size: 22px;">Revive Exterior Cleaning</h1>
          </div>

          <div style="background-color: #f9f9f9; padding: 30px; border-radius: 0 0 8px 8px;">
            <p style="font-size: 16px; margin: 0 0 15px 0;">Hi ${job.customer_name || 'there'},</p>

            <p style="font-size: 15px; margin: 0 0 15px 0;">
              We wanted to let you know that your <strong>${job.service || 'cleaning'}</strong> appointment has been rescheduled.
            </p>

            <div style="background-color: #fff; border: 2px solid #84cc16; border-radius: 8px; padding: 20px; margin: 20px 0;">
              <p style="font-size: 14px; color: #666; margin: 0 0 8px 0;">NEW DATE & TIME</p>
              <p style="font-size: 20px; font-weight: bold; color: #333; margin: 0 0 5px 0;">${formattedDate}</p>
              <p style="font-size: 16px; color: #84cc16; font-weight: bold; margin: 0;">${timeSlot || 'Time TBC'}</p>
            </div>

            <p style="font-size: 15px; margin: 0 0 15px 0;">
              If this time doesn't work for you, please get in touch and we'll find an alternative.
            </p>

            <div style="margin-top: 25px; padding-top: 20px; border-top: 1px solid #e0e0e0;">
              <p style="font-size: 14px; color: #666;">
                Best regards,<br>
                <strong>The Revive Team</strong>
              </p>
            </div>
          </div>

          <div style="text-align: center; padding: 20px; font-size: 12px; color: #999;">
            <p>Revive Exterior Cleaning - Professional Property Care</p>
          </div>
        </body>
        </html>
      `
    });

    if (error) {
      console.error('[Email] Reschedule send error:', error);
      throw error;
    }

    console.log('[Email] Reschedule notification sent:', data.id);
    return { success: true, emailId: data.id };

  } catch (error) {
    console.error('[Email] Failed to send reschedule notification:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Send invoice email to customer
 *
 * @param {Object} invoice - Invoice data from database
 * @param {string} viewUrl - Public URL to view the invoice
 * @returns {Promise<Object>} - Resend API response
 */
async function sendInvoiceEmail(invoice, viewUrl) {
  try {
    if (!invoice.customer_email) {
      console.log('[Email] No customer email for invoice');
      return { success: false, error: 'No customer email' };
    }

    console.log(`[Email] Sending invoice ${invoice.invoice_number} to ${invoice.customer_email}`);

    const bizName = process.env.BUSINESS_NAME || 'Revive Exterior Cleaning';
    const bizAddress = process.env.BUSINESS_ADDRESS || '';
    const bizPhone = process.env.BUSINESS_PHONE || '';
    const bizEmail = process.env.BUSINESS_EMAIL || '';
    const bankName = process.env.BUSINESS_BANK_NAME || '';
    const accountName = process.env.BUSINESS_ACCOUNT_NAME || '';
    const sortCode = process.env.BUSINESS_SORT_CODE || '';
    const accountNumber = process.env.BUSINESS_ACCOUNT_NUMBER || '';
    const logoUrl = process.env.BUSINESS_LOGO_URL || '';

    const lineItems = Array.isArray(invoice.line_items) ? invoice.line_items : [];
    const invoiceDate = invoice.created_at ? new Date(invoice.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : '';

    const lineItemsHtml = lineItems.map(item =>
      `<tr>
        <td style="padding: 10px 12px; border-bottom: 1px solid #e5e7eb; text-align: left;">${item.description || ''}</td>
        <td style="padding: 10px 12px; border-bottom: 1px solid #e5e7eb; text-align: center;">${item.quantity || 1}</td>
        <td style="padding: 10px 12px; border-bottom: 1px solid #e5e7eb; text-align: right;">&pound;${Number(item.unit_price || 0).toFixed(2)}</td>
        <td style="padding: 10px 12px; border-bottom: 1px solid #e5e7eb; text-align: right;">&pound;${Number(item.total || 0).toFixed(2)}</td>
      </tr>`
    ).join('');

    const vatSection = parseFloat(invoice.vat_rate) > 0 ? `
      <tr>
        <td colspan="3" style="padding: 6px 12px; text-align: right; color: #6b7280; font-size: 14px;">Subtotal</td>
        <td style="padding: 6px 12px; text-align: right; font-size: 14px;">&pound;${Number(invoice.subtotal).toFixed(2)}</td>
      </tr>
      <tr>
        <td colspan="3" style="padding: 6px 12px; text-align: right; color: #6b7280; font-size: 14px;">VAT (${Number(invoice.vat_rate)}%)</td>
        <td style="padding: 6px 12px; text-align: right; font-size: 14px;">&pound;${Number(invoice.vat_amount).toFixed(2)}</td>
      </tr>
    ` : '';

    const bankSection = sortCode && accountNumber ? `
      <div style="background: #f9fafb; padding: 16px; border-radius: 8px; margin: 20px 0;">
        <p style="margin: 0 0 8px; font-size: 14px; font-weight: 600; color: #374151;">Payment Details</p>
        ${bankName ? `<p style="margin: 2px 0; font-size: 13px; color: #4b5563;"><strong>Bank:</strong> ${bankName}</p>` : ''}
        ${accountName ? `<p style="margin: 2px 0; font-size: 13px; color: #4b5563;"><strong>Account Name:</strong> ${accountName}</p>` : ''}
        <p style="margin: 2px 0; font-size: 13px; color: #4b5563;"><strong>Sort Code:</strong> ${sortCode}</p>
        <p style="margin: 2px 0; font-size: 13px; color: #4b5563;"><strong>Account Number:</strong> ${accountNumber}</p>
        <p style="margin: 8px 0 0; font-size: 12px; color: #6b7280;">Please use <strong>${invoice.invoice_number}</strong> as payment reference.</p>
      </div>
    ` : '';

    const { data, error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: invoice.customer_email,
      subject: `Invoice ${invoice.invoice_number} - £${Number(invoice.total).toFixed(2)} - ${bizName}`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background-color: #84cc16; color: white; padding: 24px; border-radius: 8px 8px 0 0;">
            <table style="width: 100%;">
              <tr>
                <td>
                  ${logoUrl ? `<img src="${logoUrl}" alt="${bizName}" style="height: 48px; width: auto; border-radius: 6px; margin-bottom: 8px; display: block;">` : ''}
                  <h1 style="margin: 0; font-size: 22px;">${bizName}</h1>
                </td>
                <td style="text-align: right;">
                  <div style="font-size: 24px; font-weight: 800; letter-spacing: 1px;">INVOICE</div>
                  <div style="font-size: 13px; opacity: 0.9;">${invoice.invoice_number}</div>
                </td>
              </tr>
            </table>
          </div>

          <div style="background-color: #f9f9f9; padding: 30px; border-radius: 0 0 8px 8px;">
            <p style="font-size: 16px; margin-top: 0;">Hi ${invoice.customer_name},</p>
            <p style="font-size: 15px;">Please find your invoice below for services provided.</p>

            <!-- Invoice Details -->
            <div style="background: white; border-radius: 8px; overflow: hidden; margin: 20px 0;">
              <table style="width: 100%; font-size: 13px; color: #4b5563; margin-bottom: 16px;">
                <tr>
                  <td style="padding: 8px 12px;"><strong>Invoice Date:</strong> ${invoiceDate}</td>
                  <td style="padding: 8px 12px; text-align: right;"><strong>Terms:</strong> ${invoice.payment_terms || 'Due on receipt'}</td>
                </tr>
              </table>

              <!-- Line Items -->
              <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
                <thead>
                  <tr style="background: #f3f4f6;">
                    <th style="padding: 10px 12px; text-align: left; font-size: 11px; text-transform: uppercase; color: #6b7280; border-bottom: 2px solid #e5e7eb;">Description</th>
                    <th style="padding: 10px 12px; text-align: center; font-size: 11px; text-transform: uppercase; color: #6b7280; border-bottom: 2px solid #e5e7eb;">Qty</th>
                    <th style="padding: 10px 12px; text-align: right; font-size: 11px; text-transform: uppercase; color: #6b7280; border-bottom: 2px solid #e5e7eb;">Price</th>
                    <th style="padding: 10px 12px; text-align: right; font-size: 11px; text-transform: uppercase; color: #6b7280; border-bottom: 2px solid #e5e7eb;">Total</th>
                  </tr>
                </thead>
                <tbody>
                  ${lineItemsHtml}
                </tbody>
                <tfoot>
                  ${vatSection}
                  <tr>
                    <td colspan="3" style="padding: 12px; text-align: right; font-size: 18px; font-weight: 700; border-top: 2px solid #333;">Total Due</td>
                    <td style="padding: 12px; text-align: right; font-size: 18px; font-weight: 700; color: #84cc16; border-top: 2px solid #333;">&pound;${Number(invoice.total).toFixed(2)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>

            ${invoice.notes ? `
            <div style="background: #fffbeb; padding: 12px; border-left: 4px solid #f59e0b; border-radius: 4px; margin: 16px 0;">
              <p style="margin: 0; font-size: 13px; color: #92400e;"><strong>Notes:</strong> ${invoice.notes}</p>
            </div>
            ` : ''}

            ${bankSection}

            <div style="text-align: center; margin: 24px 0 16px;">
              <a href="${viewUrl}" style="display: inline-block; background-color: #84cc16; color: white; padding: 14px 36px; text-decoration: none; border-radius: 8px; font-size: 16px; font-weight: bold;">
                View Invoice Online
              </a>
              <p style="font-size: 12px; color: #888; margin-top: 8px;">You can also print or save as PDF from the online view.</p>
            </div>

            <p style="font-size: 14px; color: #666; margin-top: 24px;">
              If you have any questions about this invoice, please don't hesitate to get in touch.
            </p>

            <p style="font-size: 14px; color: #666;">
              Best regards,<br>
              <strong>The ${bizName.split(' ')[0]} Team</strong>
            </p>
          </div>

          <div style="text-align: center; padding: 20px; font-size: 12px; color: #999;">
            <p>${bizName}${bizAddress ? ' - ' + bizAddress : ''}</p>
            ${bizPhone ? `<p>${bizPhone}${bizEmail ? ' | ' + bizEmail : ''}</p>` : ''}
          </div>
        </body>
        </html>
      `
    });

    if (error) {
      console.error('[Email] Invoice send error:', error);
      throw error;
    }

    console.log('[Email] Invoice sent successfully:', data.id);
    return { success: true, emailId: data.id };

  } catch (error) {
    console.error('[Email] Failed to send invoice:', error);
    return { success: false, error: error.message };
  }
}

module.exports = {
  sendConfirmationEmail,
  sendEstimateEmail,
  sendAdminAlert,
  sendFollowUpEmail,
  sendRescheduleEmail,
  sendInvoiceEmail
};
