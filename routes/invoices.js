/**
 * Invoice Routes
 *
 * CRUD endpoints for invoices, sending, and public viewing.
 * Admin routes require ADMIN_TOKEN in Authorization header.
 * Public view route uses view_token for access.
 */

const crypto = require('crypto');

let supabase;

function setSupabaseClient(client) {
  supabase = client;
}

// ========================
// HELPERS
// ========================

/**
 * Generate next invoice number (INV-0001, INV-0002, etc.)
 */
async function getNextInvoiceNumber() {
  const { data } = await supabase
    .from('invoices')
    .select('invoice_number')
    .order('created_at', { ascending: false })
    .limit(1);

  if (!data || data.length === 0) {
    return 'INV-0001';
  }

  const lastNum = parseInt(data[0].invoice_number.replace('INV-', ''), 10) || 0;
  return 'INV-' + String(lastNum + 1).padStart(4, '0');
}

/**
 * Get business details from environment variables
 */
function getBusinessDetails() {
  return {
    name: process.env.BUSINESS_NAME || 'Revive Exterior Cleaning',
    address: process.env.BUSINESS_ADDRESS || '',
    phone: process.env.BUSINESS_PHONE || '',
    email: process.env.BUSINESS_EMAIL || '',
    bankName: process.env.BUSINESS_BANK_NAME || '',
    sortCode: process.env.BUSINESS_SORT_CODE || '',
    accountNumber: process.env.BUSINESS_ACCOUNT_NUMBER || ''
  };
}

// ========================
// INVOICE CRUD
// ========================

/**
 * POST /admin/jobs/:id/invoice
 * Generate invoice from a completed job
 */
async function createInvoice(req, res) {
  try {
    const { id: jobId } = req.params;

    // Fetch the job
    const { data: job, error: jobError } = await supabase
      .from('jobs')
      .select('*')
      .eq('id', jobId)
      .single();

    if (jobError || !job) {
      return res.status(404).json({ success: false, error: 'Job not found' });
    }

    if (job.status !== 'completed') {
      return res.status(400).json({ success: false, error: 'Job must be completed to generate invoice' });
    }

    // Check if invoice already exists for this job
    const { data: existing } = await supabase
      .from('invoices')
      .select('id, invoice_number')
      .eq('job_id', jobId)
      .limit(1);

    if (existing && existing.length > 0) {
      return res.status(400).json({
        success: false,
        error: 'Invoice already exists for this job',
        invoice_id: existing[0].id,
        invoice_number: existing[0].invoice_number
      });
    }

    // Generate invoice number and view token
    const invoiceNumber = await getNextInvoiceNumber();
    const viewToken = crypto.randomUUID();

    // Build line items from job
    const jobValue = parseFloat(job.job_value) || 0;
    const lineItems = [{
      description: job.service || 'Cleaning Service',
      quantity: 1,
      unit_price: jobValue,
      total: jobValue
    }];

    const subtotal = jobValue;
    const vatRate = 0; // Default no VAT, admin can change
    const vatAmount = 0;
    const total = subtotal;

    const { data: invoice, error } = await supabase
      .from('invoices')
      .insert([{
        invoice_number: invoiceNumber,
        job_id: jobId,
        customer_id: job.customer_id || null,
        customer_name: job.customer_name,
        customer_email: job.customer_email || null,
        customer_phone: job.customer_phone || null,
        address: job.address || '',
        postcode: job.postcode || '',
        service: job.service || '',
        line_items: lineItems,
        subtotal,
        vat_rate: vatRate,
        vat_amount: vatAmount,
        total,
        payment_terms: 'Due on receipt',
        due_date: new Date().toISOString().split('T')[0],
        status: 'draft',
        view_token: viewToken
      }])
      .select()
      .single();

    if (error) {
      console.error('[Invoices] Create error:', error);
      return res.status(500).json({ success: false, error: 'Failed to create invoice' });
    }

    console.log(`[Invoices] Created ${invoiceNumber} for job ${jobId} (${job.customer_name})`);
    res.status(201).json({ success: true, data: invoice });
  } catch (error) {
    console.error('[Invoices] Create error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

/**
 * GET /admin/invoices
 * List all invoices with optional filters
 */
async function listInvoices(req, res) {
  try {
    const { status, customer_id } = req.query;

    let query = supabase
      .from('invoices')
      .select('*')
      .order('created_at', { ascending: false });

    if (status) {
      query = query.eq('status', status);
    }
    if (customer_id) {
      query = query.eq('customer_id', customer_id);
    }

    const { data, error } = await query;

    if (error) {
      console.error('[Invoices] List error:', error);
      return res.status(500).json({ success: false, error: 'Failed to fetch invoices' });
    }

    res.json({ success: true, data });
  } catch (error) {
    console.error('[Invoices] List error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

/**
 * GET /admin/invoices/:id
 * Get single invoice
 */
async function getInvoice(req, res) {
  try {
    const { id } = req.params;

    const { data, error } = await supabase
      .from('invoices')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !data) {
      return res.status(404).json({ success: false, error: 'Invoice not found' });
    }

    res.json({ success: true, data });
  } catch (error) {
    console.error('[Invoices] Get error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

/**
 * PATCH /admin/invoices/:id
 * Update invoice (line items, notes, VAT, status, mark paid)
 */
async function updateInvoice(req, res) {
  try {
    const { id } = req.params;
    const updates = req.body;

    const allowed = [
      'line_items', 'subtotal', 'vat_rate', 'vat_amount', 'total',
      'notes', 'payment_terms', 'due_date', 'status', 'paid_at'
    ];

    const filtered = {};
    for (const key of allowed) {
      if (updates[key] !== undefined) {
        filtered[key] = updates[key];
      }
    }

    if (Object.keys(filtered).length === 0) {
      return res.status(400).json({ success: false, error: 'No valid fields to update' });
    }

    filtered.updated_at = new Date().toISOString();

    const { data, error } = await supabase
      .from('invoices')
      .update(filtered)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('[Invoices] Update error:', error);
      return res.status(500).json({ success: false, error: 'Failed to update invoice' });
    }

    if (!data) {
      return res.status(404).json({ success: false, error: 'Invoice not found' });
    }

    console.log(`[Invoices] Updated ${data.invoice_number}:`, Object.keys(filtered).join(', '));
    res.json({ success: true, data });
  } catch (error) {
    console.error('[Invoices] Update error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

/**
 * POST /admin/invoices/:id/send
 * Send invoice email to customer
 */
async function sendInvoice(req, res) {
  try {
    const { id } = req.params;

    // Fetch invoice
    const { data: invoice, error: fetchError } = await supabase
      .from('invoices')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchError || !invoice) {
      return res.status(404).json({ success: false, error: 'Invoice not found' });
    }

    if (!invoice.customer_email) {
      return res.status(400).json({ success: false, error: 'No customer email on invoice' });
    }

    // Build view URL
    const baseUrl = process.env.BASE_URL || `https://revive-backend-repo-production.up.railway.app`;
    const viewUrl = `${baseUrl}/invoice/${invoice.view_token}`;

    // Send email
    const { sendInvoiceEmail } = require('../services/emailer');
    const emailResult = await sendInvoiceEmail(invoice, viewUrl);

    if (!emailResult.success) {
      return res.status(500).json({ success: false, error: 'Failed to send invoice email' });
    }

    // Update invoice status
    const { data: updated, error: updateError } = await supabase
      .from('invoices')
      .update({
        status: invoice.status === 'draft' ? 'sent' : invoice.status,
        sent_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single();

    if (updateError) {
      console.error('[Invoices] Status update after send failed:', updateError);
    }

    console.log(`[Invoices] Sent ${invoice.invoice_number} to ${invoice.customer_email}`);
    res.json({ success: true, data: updated || invoice });
  } catch (error) {
    console.error('[Invoices] Send error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

/**
 * GET /admin/jobs/:id/invoice
 * Check if an invoice exists for a job
 */
async function getJobInvoice(req, res) {
  try {
    const { id: jobId } = req.params;

    const { data, error } = await supabase
      .from('invoices')
      .select('*')
      .eq('job_id', jobId)
      .limit(1);

    if (error) {
      console.error('[Invoices] Job invoice lookup error:', error);
      return res.status(500).json({ success: false, error: 'Failed to check invoice' });
    }

    res.json({ success: true, data: data && data.length > 0 ? data[0] : null });
  } catch (error) {
    console.error('[Invoices] Job invoice lookup error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

/**
 * GET /invoice/:token
 * Public invoice view page (no auth required)
 */
async function viewInvoice(req, res) {
  try {
    const { token } = req.params;

    const { data: invoice, error } = await supabase
      .from('invoices')
      .select('*')
      .eq('view_token', token)
      .single();

    if (error || !invoice) {
      return res.status(404).send('<html><body><h1>Invoice not found</h1><p>This invoice link may be invalid or expired.</p></body></html>');
    }

    const biz = getBusinessDetails();
    const lineItems = Array.isArray(invoice.line_items) ? invoice.line_items : [];
    const invoiceDate = invoice.created_at ? new Date(invoice.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
    const dueDate = invoice.due_date ? new Date(invoice.due_date + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : '';

    const lineItemsHtml = lineItems.map(item => `
      <tr>
        <td style="padding: 12px 16px; border-bottom: 1px solid #e5e7eb; text-align: left;">${item.description || ''}</td>
        <td style="padding: 12px 16px; border-bottom: 1px solid #e5e7eb; text-align: center;">${item.quantity || 1}</td>
        <td style="padding: 12px 16px; border-bottom: 1px solid #e5e7eb; text-align: right;">&pound;${Number(item.unit_price || 0).toFixed(2)}</td>
        <td style="padding: 12px 16px; border-bottom: 1px solid #e5e7eb; text-align: right;">&pound;${Number(item.total || 0).toFixed(2)}</td>
      </tr>
    `).join('');

    const vatSection = parseFloat(invoice.vat_rate) > 0 ? `
      <tr>
        <td colspan="3" style="padding: 8px 16px; text-align: right; color: #6b7280;">Subtotal</td>
        <td style="padding: 8px 16px; text-align: right;">&pound;${Number(invoice.subtotal).toFixed(2)}</td>
      </tr>
      <tr>
        <td colspan="3" style="padding: 8px 16px; text-align: right; color: #6b7280;">VAT (${Number(invoice.vat_rate)}%)</td>
        <td style="padding: 8px 16px; text-align: right;">&pound;${Number(invoice.vat_amount).toFixed(2)}</td>
      </tr>
    ` : '';

    const bankSection = biz.sortCode && biz.accountNumber ? `
      <div style="margin-top: 32px; padding: 20px; background: #f9fafb; border-radius: 8px;">
        <h3 style="margin: 0 0 12px 0; font-size: 14px; color: #374151; font-weight: 600;">Payment Details</h3>
        <table style="font-size: 14px; color: #4b5563;">
          ${biz.bankName ? `<tr><td style="padding: 2px 16px 2px 0; color: #6b7280;">Account Name</td><td>${biz.bankName}</td></tr>` : ''}
          <tr><td style="padding: 2px 16px 2px 0; color: #6b7280;">Sort Code</td><td>${biz.sortCode}</td></tr>
          <tr><td style="padding: 2px 16px 2px 0; color: #6b7280;">Account Number</td><td>${biz.accountNumber}</td></tr>
        </table>
        <p style="margin: 12px 0 0 0; font-size: 13px; color: #6b7280;">Please use <strong>${invoice.invoice_number}</strong> as the payment reference.</p>
      </div>
    ` : '';

    const paidWatermark = invoice.status === 'paid' ? `
      <div style="position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%) rotate(-30deg); font-size: 120px; font-weight: 900; color: rgba(34, 197, 94, 0.08); pointer-events: none; z-index: 0; letter-spacing: 8px;">PAID</div>
    ` : '';

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Invoice ${invoice.invoice_number} - ${biz.name}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #1f2937; background: #f3f4f6; }
    .container { max-width: 800px; margin: 24px auto; background: white; border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); overflow: hidden; position: relative; }
    @media print {
      body { background: white; }
      .container { margin: 0; box-shadow: none; border-radius: 0; }
      .no-print { display: none !important; }
    }
    @media (max-width: 640px) {
      .container { margin: 0; border-radius: 0; }
      .grid-2 { grid-template-columns: 1fr !important; }
    }
  </style>
</head>
<body>
  ${paidWatermark}
  <div class="container" style="position: relative; z-index: 1;">
    <!-- Header -->
    <div style="background: #84cc16; color: white; padding: 32px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 16px;">
      <div>
        <h1 style="font-size: 28px; font-weight: 800; margin: 0;">${biz.name}</h1>
        ${biz.address ? `<p style="margin: 4px 0 0; font-size: 14px; opacity: 0.9;">${biz.address}</p>` : ''}
      </div>
      <div style="text-align: right;">
        <div style="font-size: 32px; font-weight: 800; letter-spacing: 2px;">INVOICE</div>
        <div style="font-size: 14px; opacity: 0.9; margin-top: 4px;">${invoice.invoice_number}</div>
      </div>
    </div>

    <div style="padding: 32px;">
      <!-- Invoice Meta + Bill To -->
      <div class="grid-2" style="display: grid; grid-template-columns: 1fr 1fr; gap: 32px; margin-bottom: 32px;">
        <div>
          <h3 style="font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: #9ca3af; margin-bottom: 8px;">Bill To</h3>
          <p style="font-size: 16px; font-weight: 600; color: #111827;">${invoice.customer_name}</p>
          ${invoice.address ? `<p style="font-size: 14px; color: #4b5563; margin-top: 4px;">${invoice.address}</p>` : ''}
          ${invoice.postcode ? `<p style="font-size: 14px; color: #4b5563;">${invoice.postcode}</p>` : ''}
          ${invoice.customer_email ? `<p style="font-size: 14px; color: #4b5563; margin-top: 4px;">${invoice.customer_email}</p>` : ''}
          ${invoice.customer_phone ? `<p style="font-size: 14px; color: #4b5563;">${invoice.customer_phone}</p>` : ''}
        </div>
        <div style="text-align: right;">
          <div style="margin-bottom: 8px;">
            <span style="font-size: 13px; color: #9ca3af;">Invoice Date</span>
            <p style="font-size: 14px; font-weight: 500; color: #111827;">${invoiceDate}</p>
          </div>
          ${dueDate ? `
          <div style="margin-bottom: 8px;">
            <span style="font-size: 13px; color: #9ca3af;">Due Date</span>
            <p style="font-size: 14px; font-weight: 500; color: #111827;">${dueDate}</p>
          </div>` : ''}
          <div>
            <span style="font-size: 13px; color: #9ca3af;">Payment Terms</span>
            <p style="font-size: 14px; font-weight: 500; color: #111827;">${invoice.payment_terms || 'Due on receipt'}</p>
          </div>
        </div>
      </div>

      <!-- Line Items -->
      <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
        <thead>
          <tr style="background: #f9fafb;">
            <th style="padding: 12px 16px; text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: #6b7280; border-bottom: 2px solid #e5e7eb;">Description</th>
            <th style="padding: 12px 16px; text-align: center; font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: #6b7280; border-bottom: 2px solid #e5e7eb;">Qty</th>
            <th style="padding: 12px 16px; text-align: right; font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: #6b7280; border-bottom: 2px solid #e5e7eb;">Unit Price</th>
            <th style="padding: 12px 16px; text-align: right; font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: #6b7280; border-bottom: 2px solid #e5e7eb;">Total</th>
          </tr>
        </thead>
        <tbody>
          ${lineItemsHtml}
        </tbody>
        <tfoot>
          ${vatSection}
          <tr>
            <td colspan="3" style="padding: 12px 16px; text-align: right; font-size: 18px; font-weight: 700; border-top: 2px solid #111827;">Total Due</td>
            <td style="padding: 12px 16px; text-align: right; font-size: 18px; font-weight: 700; color: #84cc16; border-top: 2px solid #111827;">&pound;${Number(invoice.total).toFixed(2)}</td>
          </tr>
        </tfoot>
      </table>

      ${invoice.notes ? `
      <div style="margin-bottom: 24px; padding: 16px; background: #fffbeb; border-left: 4px solid #f59e0b; border-radius: 4px;">
        <p style="font-size: 13px; color: #92400e; margin: 0;"><strong>Notes:</strong> ${invoice.notes}</p>
      </div>
      ` : ''}

      ${bankSection}

      <!-- Footer -->
      <div style="margin-top: 40px; padding-top: 20px; border-top: 1px solid #e5e7eb; text-align: center; color: #9ca3af; font-size: 13px;">
        <p>${biz.name}</p>
        ${biz.phone ? `<p>${biz.phone} | ${biz.email || ''}</p>` : ''}
        <p style="margin-top: 8px;">Thank you for your business.</p>
      </div>
    </div>
  </div>

  <!-- Print Button -->
  <div class="no-print" style="text-align: center; padding: 16px;">
    <button onclick="window.print()" style="background: #84cc16; color: white; border: none; padding: 12px 32px; border-radius: 8px; font-size: 16px; font-weight: 600; cursor: pointer;">
      Print / Save as PDF
    </button>
  </div>
</body>
</html>`;

    res.send(html);
  } catch (error) {
    console.error('[Invoices] View error:', error);
    res.status(500).send('<html><body><h1>Error</h1><p>Failed to load invoice.</p></body></html>');
  }
}

module.exports = {
  setSupabaseClient,
  createInvoice,
  listInvoices,
  getInvoice,
  updateInvoice,
  sendInvoice,
  getJobInvoice,
  viewInvoice
};
