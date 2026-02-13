/**
 * Admin Routes
 *
 * Protected endpoints for managing quotes.
 * All routes require ADMIN_TOKEN in Authorization header.
 */

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

module.exports = {
  setSupabaseClient,
  listQuotes,
  updateQuoteStatus,
  updateQuoteNotes,
  getQuote
};
