/**
 * Admin Routes
 *
 * Protected endpoints for managing quotes.
 * All routes require ADMIN_TOKEN in Authorization header.
 */

const { parse } = require('json2csv');

// Supabase client will be passed from index.js
let supabase;

function setSupabaseClient(client) {
  supabase = client;
}

/**
 * GET /admin/quotes
 *
 * List and filter quotes
 *
 * Query params:
 * - status: Filter by qualification_status (hot, warm, cold, unqualified)
 * - service: Filter by service (roof, driveway, gutter, etc.)
 * - limit: Number of results (default 50, max 200)
 * - offset: Pagination offset (default 0)
 * - sort: Sort by field (default: created_at)
 * - order: Sort order (asc or desc, default: desc)
 */
async function listQuotes(req, res) {
  try {
    const {
      status,
      service,
      limit = 50,
      offset = 0,
      sort = 'created_at',
      order = 'desc'
    } = req.query;

    // Build query
    let query = supabase
      .from('quotes')
      .select('*', { count: 'exact' });

    // Apply filters
    if (status) {
      query = query.eq('qualification_status', status);
    }

    if (service) {
      // Filter by service array contains value
      query = query.contains('services', [service]);
    }

    // Apply sorting
    const ascending = order === 'asc';
    query = query.order(sort, { ascending });

    // Apply pagination
    const limitNum = Math.min(parseInt(limit), 200);
    const offsetNum = parseInt(offset);
    query = query.range(offsetNum, offsetNum + limitNum - 1);

    // Execute query
    const { data, error, count } = await query;

    if (error) {
      console.error('[Admin] Database query error:', error);
      return res.status(500).json({
        success: false,
        error: 'Database query failed'
      });
    }

    console.log(`[Admin] Returned ${data.length} quotes (total: ${count})`);

    res.json({
      success: true,
      data: data,
      pagination: {
        total: count,
        limit: limitNum,
        offset: offsetNum,
        hasMore: offsetNum + limitNum < count
      }
    });

  } catch (error) {
    console.error('[Admin] List quotes error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
}

/**
 * PATCH /admin/quotes/:id/status
 *
 * Update quote status
 *
 * Body:
 * - status: new, contacted, quoted, booked, completed, cancelled
 */
async function updateQuoteStatus(req, res) {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!status) {
      return res.status(400).json({
        success: false,
        error: 'Status is required'
      });
    }

    // Valid status values
    const validStatuses = ['new', 'contacted', 'quoted', 'booked', 'completed', 'cancelled'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        error: `Invalid status. Must be one of: ${validStatuses.join(', ')}`
      });
    }

    // Update status
    const { data, error } = await supabase
      .from('quotes')
      .update({
        status: status,
        last_contact_at: new Date().toISOString()
      })
      .eq('id', id)
      .select();

    if (error) {
      console.error('[Admin] Update status error:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to update status'
      });
    }

    if (!data || data.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Quote not found'
      });
    }

    console.log(`[Admin] Updated quote ${id} status to: ${status}`);

    res.json({
      success: true,
      data: data[0]
    });

  } catch (error) {
    console.error('[Admin] Update status error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
}

/**
 * PATCH /admin/quotes/:id/notes
 *
 * Add or update admin notes
 *
 * Body:
 * - notes: Admin notes text
 */
async function updateQuoteNotes(req, res) {
  try {
    const { id } = req.params;
    const { notes } = req.body;

    if (notes === undefined) {
      return res.status(400).json({
        success: false,
        error: 'Notes field is required'
      });
    }

    // Update notes
    const { data, error } = await supabase
      .from('quotes')
      .update({ admin_notes: notes })
      .eq('id', id)
      .select();

    if (error) {
      console.error('[Admin] Update notes error:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to update notes'
      });
    }

    if (!data || data.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Quote not found'
      });
    }

    console.log(`[Admin] Updated notes for quote ${id}`);

    res.json({
      success: true,
      data: data[0]
    });

  } catch (error) {
    console.error('[Admin] Update notes error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
}

/**
 * GET /admin/quotes/:id
 *
 * Get single quote by ID
 */
async function getQuote(req, res) {
  try {
    const { id } = req.params;

    const { data, error } = await supabase
      .from('quotes')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return res.status(404).json({
          success: false,
          error: 'Quote not found'
        });
      }
      console.error('[Admin] Get quote error:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to retrieve quote'
      });
    }

    res.json({
      success: true,
      data: data
    });

  } catch (error) {
    console.error('[Admin] Get quote error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
}

/**
 * GET /admin/export
 *
 * Export quotes as CSV file
 *
 * Query params:
 * - status: Filter by qualification_status (optional)
 * - service: Filter by service (optional)
 * - from_date: Filter quotes created after this date (YYYY-MM-DD)
 * - to_date: Filter quotes created before this date (YYYY-MM-DD)
 */
async function exportQuotes(req, res) {
  try {
    const { status, service, from_date, to_date } = req.query;

    console.log('[Admin] Exporting quotes with filters:', { status, service, from_date, to_date });

    // Build query
    let query = supabase
      .from('quotes')
      .select('*')
      .order('created_at', { ascending: false });

    // Apply filters
    if (status) {
      query = query.eq('qualification_status', status);
    }

    if (service) {
      query = query.contains('services', [service]);
    }

    if (from_date) {
      query = query.gte('created_at', from_date);
    }

    if (to_date) {
      // Add one day to include the entire to_date
      const toDateEnd = new Date(to_date);
      toDateEnd.setDate(toDateEnd.getDate() + 1);
      query = query.lt('created_at', toDateEnd.toISOString());
    }

    // Execute query (no limit - get all matching quotes)
    const { data, error } = await query;

    if (error) {
      console.error('[Admin] Export query error:', error);
      return res.status(500).json({
        success: false,
        error: 'Database query failed'
      });
    }

    if (!data || data.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'No quotes found matching the criteria'
      });
    }

    // Flatten quote data for CSV
    const csvRows = data.map(quote => ({
      // Core fields
      id: quote.id,
      created_at: quote.created_at,
      name: quote.name,
      email: quote.email,
      phone: quote.phone,
      address_line1: quote.address_line1,
      postcode: quote.postcode,

      // Preferences
      preferred_contact: quote.preferred_contact || '',
      best_time: quote.best_time || '',
      reminders_ok: quote.reminders_ok ? 'Yes' : 'No',

      // Services (array to comma-separated)
      services: Array.isArray(quote.services) ? quote.services.join(', ') : '',

      // Estimates
      estimated_min: quote.estimated_value_min || '',
      estimated_max: quote.estimated_value_max || '',
      estimation_confidence: quote.estimation_confidence || '',
      lead_score: quote.lead_score || '',
      qualification_status: quote.qualification_status || '',

      // Status tracking
      status: quote.status || 'new',

      // Acceptance tracking
      customer_accepted: quote.customer_accepted_estimate ? 'Yes' : 'No',
      customer_accepted_at: quote.customer_accepted_at || '',

      // Admin fields
      admin_notes: quote.admin_notes || '',

      // Communication tracking
      confirmation_email_sent_at: quote.confirmation_email_sent_at || '',
      estimate_email_sent_at: quote.estimate_email_sent_at || '',

      // Flatten common answer fields (if answers exists)
      property_type: quote.answers?.propertyType || '',
      rough_size: quote.answers?.roughSize || '',
      last_cleaned: quote.answers?.lastCleaned || '',
      specific_details: quote.answers?.specificDetails || '',
      access_notes: quote.answers?.accessNotes || '',

      // Full answers JSON as fallback (for edge cases)
      answers_json: quote.answers ? JSON.stringify(quote.answers) : ''
    }));

    // Convert to CSV
    const csv = parse(csvRows);

    // Generate filename with timestamp
    const timestamp = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const filename = `revive-quotes-${timestamp}.csv`;

    console.log(`[Admin] Exported ${csvRows.length} quotes to CSV`);

    // Send as downloadable file
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);

  } catch (error) {
    console.error('[Admin] Export error:', error);
    res.status(500).json({
      success: false,
      error: 'Export failed: ' + error.message
    });
  }
}

/**
 * PATCH /admin/quotes/:id
 *
 * General-purpose quote update. Accepts any combination of editable fields.
 * Auto-logs changes to quote_activity table.
 */
async function updateQuote(req, res) {
  try {
    const { id } = req.params;
    const updates = req.body;

    const allowed = [
      'status', 'admin_notes', 'final_value',
      'estimated_value_min', 'estimated_value_max',
      'internal_priority', 'assigned_to'
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

    // Validate status if provided
    if (filtered.status) {
      const validStatuses = ['new', 'contacted', 'quoted', 'booked', 'completed', 'cancelled'];
      if (!validStatuses.includes(filtered.status)) {
        return res.status(400).json({ success: false, error: 'Invalid status' });
      }
    }

    // Validate priority if provided
    if (filtered.internal_priority) {
      const validPriorities = ['high', 'medium', 'low'];
      if (!validPriorities.includes(filtered.internal_priority)) {
        return res.status(400).json({ success: false, error: 'Invalid priority' });
      }
    }

    // Always update last_contact_at
    filtered.last_contact_at = new Date().toISOString();

    // Fetch current quote for activity logging
    const { data: oldQuote } = await supabase
      .from('quotes')
      .select('status, admin_notes, final_value, internal_priority, assigned_to, estimated_value_min, estimated_value_max')
      .eq('id', id)
      .single();

    const { data, error } = await supabase
      .from('quotes')
      .update(filtered)
      .eq('id', id)
      .select();

    if (error) {
      console.error('[Admin] Update quote error:', error);
      return res.status(500).json({ success: false, error: 'Failed to update quote' });
    }

    if (!data || data.length === 0) {
      return res.status(404).json({ success: false, error: 'Quote not found' });
    }

    // Auto-log activity for each changed field
    if (oldQuote) {
      const activities = [];
      if (filtered.status && filtered.status !== oldQuote.status) {
        activities.push({ action_type: 'status_change', description: `Status changed from ${oldQuote.status || 'new'} to ${filtered.status}` });
      }
      if (filtered.final_value !== undefined && filtered.final_value !== oldQuote.final_value) {
        activities.push({ action_type: 'price_update', description: `Final price set to £${Number(filtered.final_value).toFixed(2)}` });
      }
      if (filtered.internal_priority && filtered.internal_priority !== oldQuote.internal_priority) {
        activities.push({ action_type: 'priority_change', description: `Priority set to ${filtered.internal_priority}` });
      }
      if (filtered.assigned_to !== undefined && filtered.assigned_to !== oldQuote.assigned_to) {
        activities.push({ action_type: 'assignment', description: filtered.assigned_to ? `Assigned to ${filtered.assigned_to}` : 'Unassigned' });
      }
      if (filtered.estimated_value_min !== undefined || filtered.estimated_value_max !== undefined) {
        const min = filtered.estimated_value_min ?? oldQuote.estimated_value_min;
        const max = filtered.estimated_value_max ?? oldQuote.estimated_value_max;
        activities.push({ action_type: 'price_update', description: `Estimate updated to £${min} - £${max}` });
      }
      if (filtered.admin_notes !== undefined && filtered.admin_notes !== oldQuote.admin_notes) {
        activities.push({ action_type: 'note', description: 'Admin notes updated' });
      }

      for (const act of activities) {
        await supabase.from('quote_activity').insert({
          quote_id: id,
          action_type: act.action_type,
          description: act.description
        }).then(() => {}).catch(() => {});
      }
    }

    console.log(`[Admin] Updated quote ${id}:`, Object.keys(filtered).join(', '));
    res.json({ success: true, data: data[0] });

  } catch (error) {
    console.error('[Admin] Update quote error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

/**
 * GET /admin/quotes/:id/activity
 * Fetch activity log for a quote
 */
async function getQuoteActivity(req, res) {
  try {
    const { id } = req.params;

    const { data, error } = await supabase
      .from('quote_activity')
      .select('*')
      .eq('quote_id', id)
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) {
      console.error('[Admin] Get activity error:', error);
      return res.status(500).json({ success: false, error: 'Failed to fetch activity' });
    }

    res.json({ success: true, data: data || [] });

  } catch (error) {
    console.error('[Admin] Get activity error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

/**
 * POST /admin/quotes/:id/activity
 * Add manual activity log entry
 */
async function addQuoteActivity(req, res) {
  try {
    const { id } = req.params;
    const { description, action_type } = req.body;

    if (!description) {
      return res.status(400).json({ success: false, error: 'Description is required' });
    }

    const { data, error } = await supabase
      .from('quote_activity')
      .insert({
        quote_id: id,
        action_type: action_type || 'manual',
        description: description
      })
      .select();

    if (error) {
      console.error('[Admin] Add activity error:', error);
      return res.status(500).json({ success: false, error: 'Failed to add activity' });
    }

    res.json({ success: true, data: data[0] });

  } catch (error) {
    console.error('[Admin] Add activity error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

/**
 * POST /admin/quotes/:id/attachments
 * Upload file attachment (base64 encoded in body)
 */
async function uploadAttachment(req, res) {
  try {
    const { id } = req.params;
    const { filename, contentType, data: fileData } = req.body;

    if (!filename || !fileData) {
      return res.status(400).json({ success: false, error: 'Filename and data are required' });
    }

    // Validate file type
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
    if (contentType && !allowedTypes.includes(contentType)) {
      return res.status(400).json({ success: false, error: 'File type not allowed' });
    }

    // Decode base64
    const buffer = Buffer.from(fileData, 'base64');

    // Max 10MB
    if (buffer.length > 10 * 1024 * 1024) {
      return res.status(400).json({ success: false, error: 'File too large (max 10MB)' });
    }

    const filePath = `${id}/${Date.now()}-${filename}`;

    const { error } = await supabase.storage
      .from('quote-attachments')
      .upload(filePath, buffer, {
        contentType: contentType || 'application/octet-stream',
        upsert: false
      });

    if (error) {
      console.error('[Admin] Upload error:', error);
      return res.status(500).json({ success: false, error: 'Upload failed: ' + error.message });
    }

    // Get public URL
    const { data: urlData } = supabase.storage
      .from('quote-attachments')
      .getPublicUrl(filePath);

    // Log activity
    await supabase.from('quote_activity').insert({
      quote_id: id,
      action_type: 'attachment',
      description: `File attached: ${filename}`
    }).then(() => {}).catch(() => {});

    console.log(`[Admin] Uploaded attachment ${filename} for quote ${id}`);
    res.json({ success: true, url: urlData.publicUrl, path: filePath });

  } catch (error) {
    console.error('[Admin] Upload error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

/**
 * GET /admin/quotes/:id/attachments
 * List all attachments for a quote
 */
async function listAttachments(req, res) {
  try {
    const { id } = req.params;

    const { data, error } = await supabase.storage
      .from('quote-attachments')
      .list(id, { limit: 100, sortBy: { column: 'created_at', order: 'desc' } });

    if (error) {
      console.error('[Admin] List attachments error:', error);
      return res.status(500).json({ success: false, error: 'Failed to list attachments' });
    }

    // Add public URLs
    const files = (data || []).map(f => {
      const { data: urlData } = supabase.storage
        .from('quote-attachments')
        .getPublicUrl(`${id}/${f.name}`);
      return {
        name: f.name,
        size: f.metadata?.size,
        type: f.metadata?.mimetype,
        created_at: f.created_at,
        url: urlData.publicUrl
      };
    });

    res.json({ success: true, data: files });

  } catch (error) {
    console.error('[Admin] List attachments error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

/**
 * DELETE /admin/quotes/:id/attachments/:filename
 * Delete a specific attachment
 */
async function deleteAttachment(req, res) {
  try {
    const { id, filename } = req.params;

    const { error } = await supabase.storage
      .from('quote-attachments')
      .remove([`${id}/${filename}`]);

    if (error) {
      console.error('[Admin] Delete attachment error:', error);
      return res.status(500).json({ success: false, error: 'Failed to delete attachment' });
    }

    // Log activity
    await supabase.from('quote_activity').insert({
      quote_id: id,
      action_type: 'attachment',
      description: `File removed: ${filename}`
    }).then(() => {}).catch(() => {});

    console.log(`[Admin] Deleted attachment ${filename} for quote ${id}`);
    res.json({ success: true });

  } catch (error) {
    console.error('[Admin] Delete attachment error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

// ========================
// PRICING SETTINGS
// ========================

const pricingConfig = require('../services/pricingConfig');
const { calculateTestEstimate } = require('../services/estimator');

/**
 * GET /admin/settings/pricing
 * Returns the active pricing configuration
 */
async function getPricingSettings(req, res) {
  try {
    const config = await pricingConfig.getPricingConfig();
    const defaults = pricingConfig.getFileDefaults();

    // Check if using DB config or file defaults
    let source = 'defaults';
    let lastUpdated = null;

    const { data } = await supabase
      .from('settings')
      .select('updated_at')
      .eq('key', 'pricing_config')
      .single();

    if (data) {
      source = 'database';
      lastUpdated = data.updated_at;
    }

    res.json({
      success: true,
      data: {
        servicePricing: config.SERVICE_PRICING,
        modifiers: config.MODIFIERS,
        multiServiceDiscount: config.MULTI_SERVICE_DISCOUNT,
        leadScoring: config.LEAD_SCORING,
        qualificationThresholds: config.QUALIFICATION_THRESHOLDS,
        conversionFactors: config.CONVERSION_FACTORS
      },
      defaults: {
        servicePricing: defaults.SERVICE_PRICING,
        modifiers: defaults.MODIFIERS,
        multiServiceDiscount: defaults.MULTI_SERVICE_DISCOUNT,
        leadScoring: defaults.LEAD_SCORING,
        qualificationThresholds: defaults.QUALIFICATION_THRESHOLDS,
        conversionFactors: defaults.CONVERSION_FACTORS
      },
      source,
      lastUpdated
    });
  } catch (error) {
    console.error('[Admin] Get pricing settings error:', error);
    res.status(500).json({ success: false, error: 'Failed to load pricing settings' });
  }
}

/**
 * PUT /admin/settings/pricing
 * Save updated pricing configuration
 */
async function updatePricingSettings(req, res) {
  try {
    const updates = req.body;
    if (!updates || Object.keys(updates).length === 0) {
      return res.status(400).json({ success: false, error: 'No data provided' });
    }

    // Get current config for comparison/history
    const currentConfig = await pricingConfig.getPricingConfig();

    // Build the new config by merging updates with current
    const newConfig = {};
    const changedSections = [];

    if (updates.servicePricing) {
      // Validate service pricing
      for (const [service, sizes] of Object.entries(updates.servicePricing)) {
        for (const [size, range] of Object.entries(sizes)) {
          if (!Array.isArray(range) || range.length !== 2) continue;
          if (range[0] < 0 || range[1] < 0) {
            return res.status(400).json({ success: false, error: `Prices cannot be negative (${service} ${size})` });
          }
          if (range[0] > range[1]) {
            return res.status(400).json({ success: false, error: `Min price cannot exceed max price (${service} ${size})` });
          }
        }
      }
      newConfig.SERVICE_PRICING = updates.servicePricing;
      changedSections.push('service_pricing');
    } else {
      newConfig.SERVICE_PRICING = currentConfig.SERVICE_PRICING;
    }

    if (updates.modifiers) {
      // Validate modifiers (must be positive numbers)
      for (const [key, value] of Object.entries(updates.modifiers)) {
        if (typeof value !== 'number' || value <= 0) {
          return res.status(400).json({ success: false, error: `Invalid modifier value for ${key}` });
        }
      }
      newConfig.MODIFIERS = updates.modifiers;
      changedSections.push('modifiers');
    } else {
      newConfig.MODIFIERS = currentConfig.MODIFIERS;
    }

    if (updates.multiServiceDiscount) {
      const msd = updates.multiServiceDiscount;
      if (msd.threshold < 2) {
        return res.status(400).json({ success: false, error: 'Multi-service threshold must be at least 2' });
      }
      if (msd.discount <= 0 || msd.discount > 1) {
        return res.status(400).json({ success: false, error: 'Discount must be between 0 and 1' });
      }
      newConfig.MULTI_SERVICE_DISCOUNT = msd;
      changedSections.push('multi_service_discount');
    } else {
      newConfig.MULTI_SERVICE_DISCOUNT = currentConfig.MULTI_SERVICE_DISCOUNT;
    }

    if (updates.leadScoring) {
      newConfig.LEAD_SCORING = updates.leadScoring;
      changedSections.push('lead_scoring');
    } else {
      newConfig.LEAD_SCORING = currentConfig.LEAD_SCORING;
    }

    if (updates.qualificationThresholds) {
      const qt = updates.qualificationThresholds;
      if (qt.hot <= qt.warm || qt.warm <= qt.cold) {
        return res.status(400).json({ success: false, error: 'Thresholds must be in order: hot > warm > cold' });
      }
      newConfig.QUALIFICATION_THRESHOLDS = qt;
      changedSections.push('qualification_thresholds');
    } else {
      newConfig.QUALIFICATION_THRESHOLDS = currentConfig.QUALIFICATION_THRESHOLDS;
    }

    if (updates.conversionFactors) {
      newConfig.CONVERSION_FACTORS = updates.conversionFactors;
      changedSections.push('conversion_factors');
    } else {
      newConfig.CONVERSION_FACTORS = currentConfig.CONVERSION_FACTORS;
    }

    // Save to database
    await pricingConfig.savePricingConfig(newConfig);

    // Log changes to pricing history
    for (const section of changedSections) {
      const sectionKeyMap = {
        service_pricing: ['SERVICE_PRICING', 'servicePricing'],
        modifiers: ['MODIFIERS', 'modifiers'],
        multi_service_discount: ['MULTI_SERVICE_DISCOUNT', 'multiServiceDiscount'],
        lead_scoring: ['LEAD_SCORING', 'leadScoring'],
        qualification_thresholds: ['QUALIFICATION_THRESHOLDS', 'qualificationThresholds'],
        conversion_factors: ['CONVERSION_FACTORS', 'conversionFactors']
      };
      const [configKey, updateKey] = sectionKeyMap[section];
      await pricingConfig.logPricingChange(
        section,
        currentConfig[configKey],
        newConfig[configKey],
        `Updated ${section.replace(/_/g, ' ')}`
      );
    }

    console.log(`[Admin] Pricing settings updated: ${changedSections.join(', ')}`);
    res.json({ success: true, changedSections });

  } catch (error) {
    console.error('[Admin] Update pricing settings error:', error);
    res.status(500).json({ success: false, error: 'Failed to save pricing settings' });
  }
}

/**
 * POST /admin/settings/pricing/reset
 * Reset pricing to file defaults
 */
async function resetPricingSettings(req, res) {
  try {
    const currentConfig = await pricingConfig.getPricingConfig();

    await pricingConfig.resetPricingConfig();

    // Log the reset
    await pricingConfig.logPricingChange(
      'full_reset',
      currentConfig,
      null,
      'Reset all pricing to file defaults'
    );

    console.log('[Admin] Pricing settings reset to defaults');
    res.json({ success: true });

  } catch (error) {
    console.error('[Admin] Reset pricing settings error:', error);
    res.status(500).json({ success: false, error: 'Failed to reset pricing settings' });
  }
}

/**
 * POST /admin/settings/pricing/test-estimate
 * Preview what an estimate would produce with current settings
 */
async function testEstimate(req, res) {
  try {
    const { services, size, modifiers } = req.body;

    if (!services || !Array.isArray(services) || services.length === 0) {
      return res.status(400).json({ success: false, error: 'At least one service is required' });
    }

    const config = await pricingConfig.getPricingConfig();
    const result = calculateTestEstimate({ services, size, modifiers }, config);

    res.json({ success: true, data: result });

  } catch (error) {
    console.error('[Admin] Test estimate error:', error);
    res.status(500).json({ success: false, error: 'Failed to calculate test estimate' });
  }
}

/**
 * GET /admin/settings/pricing/history
 * Get pricing change history
 */
async function getPricingHistory(req, res) {
  try {
    const limit = parseInt(req.query.limit) || 20;
    const history = await pricingConfig.getPricingHistory(limit);

    res.json({ success: true, data: history });

  } catch (error) {
    console.error('[Admin] Get pricing history error:', error);
    res.status(500).json({ success: false, error: 'Failed to load pricing history' });
  }
}

module.exports = {
  setSupabaseClient,
  listQuotes,
  updateQuoteStatus,
  updateQuoteNotes,
  getQuote,
  exportQuotes,
  updateQuote,
  getQuoteActivity,
  addQuoteActivity,
  uploadAttachment,
  listAttachments,
  deleteAttachment,
  getPricingSettings,
  updatePricingSettings,
  resetPricingSettings,
  testEstimate,
  getPricingHistory
};
