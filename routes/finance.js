/**
 * Finance & Expense Tracking Routes
 *
 * CRUD endpoints for expenses, categories, wages, mileage,
 * recurring expenses, income entries, and financial reports.
 * All routes require ADMIN_TOKEN in Authorization header.
 */

const Anthropic = require('@anthropic-ai/sdk');

let supabase;

function setSupabaseClient(client) {
  supabase = client;
}

// ========================
// EXPENSE CATEGORIES
// ========================

/**
 * GET /admin/finance/categories
 * List expense categories (active only by default, ?all=true for inactive too)
 */
async function listCategories(req, res) {
  try {
    let query = supabase
      .from('expense_categories')
      .select('*')
      .order('sort_order', { ascending: true });

    if (req.query.all !== 'true') {
      query = query.eq('is_active', true);
    }

    const { data, error } = await query;

    if (error) {
      console.error('[Finance] Categories list error:', error);
      return res.status(500).json({ success: false, error: 'Failed to fetch categories' });
    }

    res.json({ success: true, data });
  } catch (error) {
    console.error('[Finance] Categories list error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

/**
 * POST /admin/finance/categories
 * Create a custom expense category
 */
async function createCategory(req, res) {
  try {
    const { name, colour, is_tax_deductible, hmrc_category } = req.body;

    if (!name) {
      return res.status(400).json({ success: false, error: 'Name is required' });
    }

    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

    // Get next sort_order
    const { data: maxOrder } = await supabase
      .from('expense_categories')
      .select('sort_order')
      .order('sort_order', { ascending: false })
      .limit(1);

    const sortOrder = (maxOrder && maxOrder.length > 0) ? maxOrder[0].sort_order + 1 : 50;

    const { data, error } = await supabase
      .from('expense_categories')
      .insert({
        name,
        slug,
        colour: colour || '#737373',
        is_tax_deductible: is_tax_deductible !== false,
        hmrc_category: hmrc_category || 'admin',
        sort_order: sortOrder
      })
      .select();

    if (error) {
      console.error('[Finance] Create category error:', error);
      return res.status(500).json({ success: false, error: 'Failed to create category' });
    }

    res.json({ success: true, data: data[0] });
  } catch (error) {
    console.error('[Finance] Create category error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

/**
 * PATCH /admin/finance/categories/:id
 * Update an expense category
 */
async function updateCategory(req, res) {
  try {
    const { id } = req.params;
    const allowed = ['name', 'colour', 'is_tax_deductible', 'hmrc_category', 'sort_order', 'is_active'];
    const updates = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ success: false, error: 'No valid fields to update' });
    }

    const { data, error } = await supabase
      .from('expense_categories')
      .update(updates)
      .eq('id', id)
      .select();

    if (error) {
      console.error('[Finance] Update category error:', error);
      return res.status(500).json({ success: false, error: 'Failed to update category' });
    }

    res.json({ success: true, data: data[0] });
  } catch (error) {
    console.error('[Finance] Update category error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

// ========================
// EXPENSES CRUD
// ========================

/**
 * GET /admin/finance/expenses
 * List expenses with filters
 */
async function listExpenses(req, res) {
  try {
    const { date_from, date_to, category_id, payment_method, is_business, limit, offset } = req.query;

    let query = supabase
      .from('expenses')
      .select('*, expense_categories(name, slug, colour)', { count: 'exact' })
      .order('date', { ascending: false })
      .order('created_at', { ascending: false });

    if (date_from) query = query.gte('date', date_from);
    if (date_to) query = query.lte('date', date_to);
    if (category_id) query = query.eq('category_id', category_id);
    if (payment_method) query = query.eq('payment_method', payment_method);
    if (is_business !== undefined) query = query.eq('is_business', is_business === 'true');

    const lim = Math.min(parseInt(limit) || 50, 200);
    const off = parseInt(offset) || 0;
    query = query.range(off, off + lim - 1);

    const { data, error, count } = await query;

    if (error) {
      console.error('[Finance] List expenses error:', error);
      return res.status(500).json({ success: false, error: 'Failed to fetch expenses' });
    }

    res.json({
      success: true,
      data,
      total: count,
      hasMore: off + lim < count
    });
  } catch (error) {
    console.error('[Finance] List expenses error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

/**
 * POST /admin/finance/expenses
 * Create a new expense
 */
async function createExpense(req, res) {
  try {
    const {
      date, description, amount, vat_amount, category_id,
      payment_method, is_business, job_id, supplier, reference,
      recurring_expense_id, notes, receipt_path, receipt_url
    } = req.body;

    if (!description || amount === undefined) {
      return res.status(400).json({ success: false, error: 'Description and amount are required' });
    }

    const { data, error } = await supabase
      .from('expenses')
      .insert({
        date: date || new Date().toISOString().split('T')[0],
        description,
        amount: parseFloat(amount),
        vat_amount: parseFloat(vat_amount) || 0,
        category_id: category_id || null,
        payment_method: payment_method || 'bank_transfer',
        is_business: is_business !== false,
        job_id: job_id || null,
        supplier: supplier || null,
        reference: reference || null,
        recurring_expense_id: recurring_expense_id || null,
        notes: notes || null,
        receipt_path: receipt_path || null,
        receipt_url: receipt_url || null
      })
      .select('*, expense_categories(name, slug, colour)');

    if (error) {
      console.error('[Finance] Create expense error:', error);
      return res.status(500).json({ success: false, error: 'Failed to create expense' });
    }

    res.json({ success: true, data: data[0] });
  } catch (error) {
    console.error('[Finance] Create expense error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

/**
 * PATCH /admin/finance/expenses/:id
 * Update an expense
 */
async function updateExpense(req, res) {
  try {
    const { id } = req.params;
    const allowed = [
      'date', 'description', 'amount', 'vat_amount', 'category_id',
      'payment_method', 'is_business', 'job_id', 'supplier', 'reference', 'notes',
      'receipt_path', 'receipt_url'
    ];
    const updates = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }

    if (updates.amount !== undefined) updates.amount = parseFloat(updates.amount);
    if (updates.vat_amount !== undefined) updates.vat_amount = parseFloat(updates.vat_amount);

    const { data, error } = await supabase
      .from('expenses')
      .update(updates)
      .eq('id', id)
      .select('*, expense_categories(name, slug, colour)');

    if (error) {
      console.error('[Finance] Update expense error:', error);
      return res.status(500).json({ success: false, error: 'Failed to update expense' });
    }

    res.json({ success: true, data: data[0] });
  } catch (error) {
    console.error('[Finance] Update expense error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

/**
 * DELETE /admin/finance/expenses/:id
 * Delete an expense
 */
async function deleteExpense(req, res) {
  try {
    const { id } = req.params;

    const { error } = await supabase
      .from('expenses')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('[Finance] Delete expense error:', error);
      return res.status(500).json({ success: false, error: 'Failed to delete expense' });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('[Finance] Delete expense error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

// ========================
// WAGES CRUD
// ========================

/**
 * GET /admin/finance/wages
 * List wage payments with filters
 */
async function listWages(req, res) {
  try {
    const { team_member_id, date_from, date_to, limit, offset } = req.query;

    let query = supabase
      .from('wage_payments')
      .select('*', { count: 'exact' })
      .order('date', { ascending: false })
      .order('created_at', { ascending: false });

    if (team_member_id) query = query.eq('team_member_id', team_member_id);
    if (date_from) query = query.gte('date', date_from);
    if (date_to) query = query.lte('date', date_to);

    const lim = Math.min(parseInt(limit) || 50, 200);
    const off = parseInt(offset) || 0;
    query = query.range(off, off + lim - 1);

    const { data, error, count } = await query;

    if (error) {
      console.error('[Finance] List wages error:', error);
      return res.status(500).json({ success: false, error: 'Failed to fetch wages' });
    }

    res.json({ success: true, data, total: count, hasMore: off + lim < count });
  } catch (error) {
    console.error('[Finance] List wages error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

/**
 * POST /admin/finance/wages
 * Record a wage payment
 */
async function createWage(req, res) {
  try {
    const {
      team_member_id, team_member_name, date, amount,
      payment_type, payment_method, job_id, period_start, period_end, notes
    } = req.body;

    if (!team_member_name || amount === undefined) {
      return res.status(400).json({ success: false, error: 'Team member name and amount are required' });
    }

    const { data, error } = await supabase
      .from('wage_payments')
      .insert({
        team_member_id: team_member_id || null,
        team_member_name,
        date: date || new Date().toISOString().split('T')[0],
        amount: parseFloat(amount),
        payment_type: payment_type || 'weekly_wage',
        payment_method: payment_method || 'bank_transfer',
        job_id: job_id || null,
        period_start: period_start || null,
        period_end: period_end || null,
        notes: notes || null
      })
      .select();

    if (error) {
      console.error('[Finance] Create wage error:', error);
      return res.status(500).json({ success: false, error: 'Failed to create wage payment' });
    }

    res.json({ success: true, data: data[0] });
  } catch (error) {
    console.error('[Finance] Create wage error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

/**
 * PATCH /admin/finance/wages/:id
 * Update a wage payment
 */
async function updateWage(req, res) {
  try {
    const { id } = req.params;
    const allowed = [
      'team_member_id', 'team_member_name', 'date', 'amount',
      'payment_type', 'payment_method', 'job_id', 'period_start', 'period_end', 'notes'
    ];
    const updates = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }
    if (updates.amount !== undefined) updates.amount = parseFloat(updates.amount);

    const { data, error } = await supabase
      .from('wage_payments')
      .update(updates)
      .eq('id', id)
      .select();

    if (error) {
      console.error('[Finance] Update wage error:', error);
      return res.status(500).json({ success: false, error: 'Failed to update wage payment' });
    }

    res.json({ success: true, data: data[0] });
  } catch (error) {
    console.error('[Finance] Update wage error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

/**
 * DELETE /admin/finance/wages/:id
 * Delete a wage payment
 */
async function deleteWage(req, res) {
  try {
    const { id } = req.params;
    const { error } = await supabase.from('wage_payments').delete().eq('id', id);

    if (error) {
      console.error('[Finance] Delete wage error:', error);
      return res.status(500).json({ success: false, error: 'Failed to delete wage payment' });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('[Finance] Delete wage error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

// ========================
// MILEAGE CRUD
// ========================

/**
 * GET /admin/finance/mileage
 * List mileage entries with filters
 */
async function listMileage(req, res) {
  try {
    const { date_from, date_to, limit, offset } = req.query;

    let query = supabase
      .from('mileage_log')
      .select('*', { count: 'exact' })
      .order('date', { ascending: false })
      .order('created_at', { ascending: false });

    if (date_from) query = query.gte('date', date_from);
    if (date_to) query = query.lte('date', date_to);

    const lim = Math.min(parseInt(limit) || 50, 200);
    const off = parseInt(offset) || 0;
    query = query.range(off, off + lim - 1);

    const { data, error, count } = await query;

    if (error) {
      console.error('[Finance] List mileage error:', error);
      return res.status(500).json({ success: false, error: 'Failed to fetch mileage' });
    }

    res.json({ success: true, data, total: count, hasMore: off + lim < count });
  } catch (error) {
    console.error('[Finance] List mileage error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

/**
 * POST /admin/finance/mileage
 * Log a mileage entry
 */
async function createMileage(req, res) {
  try {
    const { date, from_location, to_location, miles, purpose, job_id, rate_per_mile, is_return, notes } = req.body;

    if (!from_location || !to_location || miles === undefined) {
      return res.status(400).json({ success: false, error: 'From, to, and miles are required' });
    }

    const { data, error } = await supabase
      .from('mileage_log')
      .insert({
        date: date || new Date().toISOString().split('T')[0],
        from_location,
        to_location,
        miles: parseFloat(miles),
        purpose: purpose || null,
        job_id: job_id || null,
        rate_per_mile: parseFloat(rate_per_mile) || 0.45,
        is_return: is_return || false,
        notes: notes || null
      })
      .select();

    if (error) {
      console.error('[Finance] Create mileage error:', error);
      return res.status(500).json({ success: false, error: 'Failed to create mileage entry' });
    }

    res.json({ success: true, data: data[0] });
  } catch (error) {
    console.error('[Finance] Create mileage error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

/**
 * PATCH /admin/finance/mileage/:id
 * Update a mileage entry
 */
async function updateMileage(req, res) {
  try {
    const { id } = req.params;
    const allowed = ['date', 'from_location', 'to_location', 'miles', 'purpose', 'job_id', 'rate_per_mile', 'is_return', 'notes'];
    const updates = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }
    if (updates.miles !== undefined) updates.miles = parseFloat(updates.miles);
    if (updates.rate_per_mile !== undefined) updates.rate_per_mile = parseFloat(updates.rate_per_mile);

    const { data, error } = await supabase
      .from('mileage_log')
      .update(updates)
      .eq('id', id)
      .select();

    if (error) {
      console.error('[Finance] Update mileage error:', error);
      return res.status(500).json({ success: false, error: 'Failed to update mileage entry' });
    }

    res.json({ success: true, data: data[0] });
  } catch (error) {
    console.error('[Finance] Update mileage error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

/**
 * DELETE /admin/finance/mileage/:id
 * Delete a mileage entry
 */
async function deleteMileage(req, res) {
  try {
    const { id } = req.params;
    const { error } = await supabase.from('mileage_log').delete().eq('id', id);

    if (error) {
      console.error('[Finance] Delete mileage error:', error);
      return res.status(500).json({ success: false, error: 'Failed to delete mileage entry' });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('[Finance] Delete mileage error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

// ========================
// RECURRING EXPENSES
// ========================

/**
 * GET /admin/finance/recurring
 * List recurring expense templates
 */
async function listRecurring(req, res) {
  try {
    const { data, error } = await supabase
      .from('recurring_expenses')
      .select('*, expense_categories(name, slug, colour)')
      .order('next_due_date', { ascending: true });

    if (error) {
      console.error('[Finance] List recurring error:', error);
      return res.status(500).json({ success: false, error: 'Failed to fetch recurring expenses' });
    }

    res.json({ success: true, data });
  } catch (error) {
    console.error('[Finance] List recurring error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

/**
 * POST /admin/finance/recurring
 * Create a recurring expense template
 */
async function createRecurring(req, res) {
  try {
    const {
      description, amount, vat_amount, category_id, payment_method,
      is_business, supplier, frequency, day_of_month, next_due_date,
      start_date, end_date, notes
    } = req.body;

    if (!description || amount === undefined || !frequency || !next_due_date) {
      return res.status(400).json({ success: false, error: 'Description, amount, frequency, and next due date are required' });
    }

    const { data, error } = await supabase
      .from('recurring_expenses')
      .insert({
        description,
        amount: parseFloat(amount),
        vat_amount: parseFloat(vat_amount) || 0,
        category_id: category_id || null,
        payment_method: payment_method || 'bank_transfer',
        is_business: is_business !== false,
        supplier: supplier || null,
        frequency,
        day_of_month: day_of_month || null,
        next_due_date,
        start_date: start_date || new Date().toISOString().split('T')[0],
        end_date: end_date || null,
        notes: notes || null
      })
      .select('*, expense_categories(name, slug, colour)');

    if (error) {
      console.error('[Finance] Create recurring error:', error);
      return res.status(500).json({ success: false, error: 'Failed to create recurring expense' });
    }

    res.json({ success: true, data: data[0] });
  } catch (error) {
    console.error('[Finance] Create recurring error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

/**
 * PATCH /admin/finance/recurring/:id
 * Update a recurring expense template
 */
async function updateRecurring(req, res) {
  try {
    const { id } = req.params;
    const allowed = [
      'description', 'amount', 'vat_amount', 'category_id', 'payment_method',
      'is_business', 'supplier', 'frequency', 'day_of_month', 'next_due_date',
      'end_date', 'is_active', 'notes'
    ];
    const updates = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }
    if (updates.amount !== undefined) updates.amount = parseFloat(updates.amount);
    if (updates.vat_amount !== undefined) updates.vat_amount = parseFloat(updates.vat_amount);
    updates.updated_at = new Date().toISOString();

    const { data, error } = await supabase
      .from('recurring_expenses')
      .update(updates)
      .eq('id', id)
      .select('*, expense_categories(name, slug, colour)');

    if (error) {
      console.error('[Finance] Update recurring error:', error);
      return res.status(500).json({ success: false, error: 'Failed to update recurring expense' });
    }

    res.json({ success: true, data: data[0] });
  } catch (error) {
    console.error('[Finance] Update recurring error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

/**
 * DELETE /admin/finance/recurring/:id
 * Delete a recurring expense template
 */
async function deleteRecurring(req, res) {
  try {
    const { id } = req.params;
    const { error } = await supabase.from('recurring_expenses').delete().eq('id', id);

    if (error) {
      console.error('[Finance] Delete recurring error:', error);
      return res.status(500).json({ success: false, error: 'Failed to delete recurring expense' });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('[Finance] Delete recurring error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

/**
 * POST /admin/finance/recurring/:id/generate
 * Generate expense entries from a recurring template up to today
 */
async function generateFromRecurring(req, res) {
  try {
    const { id } = req.params;

    const { data: template, error: fetchError } = await supabase
      .from('recurring_expenses')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchError || !template) {
      return res.status(404).json({ success: false, error: 'Recurring expense not found' });
    }

    if (!template.is_active) {
      return res.status(400).json({ success: false, error: 'Recurring expense is paused' });
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    let nextDue = new Date(template.next_due_date);
    const generated = [];

    while (nextDue <= today) {
      // Check end date
      if (template.end_date && nextDue > new Date(template.end_date)) break;

      const { data: expense, error: insertError } = await supabase
        .from('expenses')
        .insert({
          date: nextDue.toISOString().split('T')[0],
          description: template.description,
          amount: template.amount,
          vat_amount: template.vat_amount || 0,
          category_id: template.category_id,
          payment_method: template.payment_method,
          is_business: template.is_business,
          supplier: template.supplier,
          recurring_expense_id: template.id,
          notes: 'Auto-generated from recurring: ' + template.description
        })
        .select();

      if (!insertError && expense) {
        generated.push(expense[0]);
      }

      // Advance to next due date
      switch (template.frequency) {
        case 'weekly':
          nextDue.setDate(nextDue.getDate() + 7);
          break;
        case 'fortnightly':
          nextDue.setDate(nextDue.getDate() + 14);
          break;
        case 'monthly':
          nextDue.setMonth(nextDue.getMonth() + 1);
          break;
        case 'quarterly':
          nextDue.setMonth(nextDue.getMonth() + 3);
          break;
        case 'annually':
          nextDue.setFullYear(nextDue.getFullYear() + 1);
          break;
        default:
          nextDue.setMonth(nextDue.getMonth() + 1);
      }
    }

    // Update the template with new next_due_date
    await supabase
      .from('recurring_expenses')
      .update({
        next_due_date: nextDue.toISOString().split('T')[0],
        last_generated_date: new Date().toISOString().split('T')[0],
        updated_at: new Date().toISOString()
      })
      .eq('id', id);

    res.json({ success: true, generated: generated.length, data: generated });
  } catch (error) {
    console.error('[Finance] Generate from recurring error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

// ========================
// INCOME ENTRIES
// ========================

/**
 * GET /admin/finance/income
 * List manual income entries
 */
async function listIncome(req, res) {
  try {
    const { date_from, date_to } = req.query;

    let query = supabase
      .from('income_entries')
      .select('*')
      .order('date', { ascending: false });

    if (date_from) query = query.gte('date', date_from);
    if (date_to) query = query.lte('date', date_to);

    const { data, error } = await query;

    if (error) {
      console.error('[Finance] List income error:', error);
      return res.status(500).json({ success: false, error: 'Failed to fetch income entries' });
    }

    res.json({ success: true, data });
  } catch (error) {
    console.error('[Finance] List income error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

/**
 * POST /admin/finance/income
 * Add a manual income entry
 */
async function createIncome(req, res) {
  try {
    const { date, description, amount, source, payment_method, notes } = req.body;

    if (!description || amount === undefined) {
      return res.status(400).json({ success: false, error: 'Description and amount are required' });
    }

    const { data, error } = await supabase
      .from('income_entries')
      .insert({
        date: date || new Date().toISOString().split('T')[0],
        description,
        amount: parseFloat(amount),
        source: source || 'cash_job',
        payment_method: payment_method || 'cash',
        notes: notes || null
      })
      .select();

    if (error) {
      console.error('[Finance] Create income error:', error);
      return res.status(500).json({ success: false, error: 'Failed to create income entry' });
    }

    res.json({ success: true, data: data[0] });
  } catch (error) {
    console.error('[Finance] Create income error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

/**
 * DELETE /admin/finance/income/:id
 * Delete a manual income entry
 */
async function deleteIncome(req, res) {
  try {
    const { id } = req.params;
    const { error } = await supabase.from('income_entries').delete().eq('id', id);

    if (error) {
      console.error('[Finance] Delete income error:', error);
      return res.status(500).json({ success: false, error: 'Failed to delete income entry' });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('[Finance] Delete income error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

// ========================
// REPORTS & SUMMARIES
// ========================

/**
 * GET /admin/finance/summary
 * Dashboard summary: income, expenses, profit for current month and YTD
 */
async function getSummary(req, res) {
  try {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
    const yearStart = new Date(now.getFullYear(), 0, 1).toISOString().split('T')[0];
    const today = now.toISOString().split('T')[0];

    // Paid invoices this month
    const { data: monthInvoices } = await supabase
      .from('invoices')
      .select('total')
      .eq('status', 'paid')
      .gte('paid_at', monthStart)
      .lte('paid_at', today + 'T23:59:59');

    // Paid invoices YTD
    const { data: ytdInvoices } = await supabase
      .from('invoices')
      .select('total')
      .eq('status', 'paid')
      .gte('paid_at', yearStart)
      .lte('paid_at', today + 'T23:59:59');

    // Manual income this month
    const { data: monthManualIncome } = await supabase
      .from('income_entries')
      .select('amount')
      .gte('date', monthStart)
      .lte('date', today);

    // Manual income YTD
    const { data: ytdManualIncome } = await supabase
      .from('income_entries')
      .select('amount')
      .gte('date', yearStart)
      .lte('date', today);

    // Business expenses this month
    const { data: monthExpenses } = await supabase
      .from('expenses')
      .select('amount')
      .eq('is_business', true)
      .gte('date', monthStart)
      .lte('date', today);

    // Business expenses YTD
    const { data: ytdExpenses } = await supabase
      .from('expenses')
      .select('amount')
      .eq('is_business', true)
      .gte('date', yearStart)
      .lte('date', today);

    // Wages this month
    const { data: monthWages } = await supabase
      .from('wage_payments')
      .select('amount')
      .gte('date', monthStart)
      .lte('date', today);

    // Wages YTD
    const { data: ytdWages } = await supabase
      .from('wage_payments')
      .select('amount')
      .gte('date', yearStart)
      .lte('date', today);

    // Mileage this month
    const { data: monthMileage } = await supabase
      .from('mileage_log')
      .select('calculated_amount')
      .gte('date', monthStart)
      .lte('date', today);

    // Mileage YTD
    const { data: ytdMileage } = await supabase
      .from('mileage_log')
      .select('calculated_amount')
      .gte('date', yearStart)
      .lte('date', today);

    // Upcoming recurring (next 30 days)
    const thirtyDays = new Date(now);
    thirtyDays.setDate(thirtyDays.getDate() + 30);
    const { data: upcomingRecurring } = await supabase
      .from('recurring_expenses')
      .select('description, amount, next_due_date')
      .eq('is_active', true)
      .lte('next_due_date', thirtyDays.toISOString().split('T')[0])
      .order('next_due_date', { ascending: true });

    const sum = (arr, field) => (arr || []).reduce((s, r) => s + parseFloat(r[field] || 0), 0);

    const monthIncomeTotal = sum(monthInvoices, 'total') + sum(monthManualIncome, 'amount');
    const monthExpenseTotal = sum(monthExpenses, 'amount') + sum(monthWages, 'amount') + sum(monthMileage, 'calculated_amount');
    const ytdIncomeTotal = sum(ytdInvoices, 'total') + sum(ytdManualIncome, 'amount');
    const ytdExpenseTotal = sum(ytdExpenses, 'amount') + sum(ytdWages, 'amount') + sum(ytdMileage, 'calculated_amount');

    res.json({
      success: true,
      data: {
        month: {
          income: Math.round(monthIncomeTotal * 100) / 100,
          expenses: Math.round(monthExpenseTotal * 100) / 100,
          profit: Math.round((monthIncomeTotal - monthExpenseTotal) * 100) / 100
        },
        ytd: {
          income: Math.round(ytdIncomeTotal * 100) / 100,
          expenses: Math.round(ytdExpenseTotal * 100) / 100,
          profit: Math.round((ytdIncomeTotal - ytdExpenseTotal) * 100) / 100
        },
        wages_this_month: Math.round(sum(monthWages, 'amount') * 100) / 100,
        upcoming_recurring: upcomingRecurring || []
      }
    });
  } catch (error) {
    console.error('[Finance] Summary error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

/**
 * GET /admin/finance/cashflow
 * Monthly cashflow data for the last 12 months
 */
async function getCashflow(req, res) {
  try {
    const months = [];
    const now = new Date();

    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const monthStart = d.toISOString().split('T')[0];
      const nextMonth = new Date(d.getFullYear(), d.getMonth() + 1, 1);
      const monthEnd = new Date(nextMonth - 1).toISOString().split('T')[0];
      const label = d.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' });

      months.push({ start: monthStart, end: monthEnd, label });
    }

    const results = [];
    for (const m of months) {
      // Income from paid invoices
      const { data: invoices } = await supabase
        .from('invoices')
        .select('total')
        .eq('status', 'paid')
        .gte('paid_at', m.start)
        .lte('paid_at', m.end + 'T23:59:59');

      // Manual income
      const { data: manualIncome } = await supabase
        .from('income_entries')
        .select('amount')
        .gte('date', m.start)
        .lte('date', m.end);

      // Expenses
      const { data: expenses } = await supabase
        .from('expenses')
        .select('amount')
        .eq('is_business', true)
        .gte('date', m.start)
        .lte('date', m.end);

      // Wages
      const { data: wages } = await supabase
        .from('wage_payments')
        .select('amount')
        .gte('date', m.start)
        .lte('date', m.end);

      // Mileage
      const { data: mileage } = await supabase
        .from('mileage_log')
        .select('calculated_amount')
        .gte('date', m.start)
        .lte('date', m.end);

      const sum = (arr, f) => (arr || []).reduce((s, r) => s + parseFloat(r[f] || 0), 0);
      const income = sum(invoices, 'total') + sum(manualIncome, 'amount');
      const expenseTotal = sum(expenses, 'amount') + sum(wages, 'amount') + sum(mileage, 'calculated_amount');

      results.push({
        label: m.label,
        income: Math.round(income * 100) / 100,
        expenses: Math.round(expenseTotal * 100) / 100,
        profit: Math.round((income - expenseTotal) * 100) / 100
      });
    }

    res.json({ success: true, data: results });
  } catch (error) {
    console.error('[Finance] Cashflow error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

/**
 * GET /admin/finance/category-breakdown
 * Expenses grouped by category for a date range
 */
async function getCategoryBreakdown(req, res) {
  try {
    const { date_from, date_to } = req.query;

    let query = supabase
      .from('expenses')
      .select('amount, category_id, expense_categories(name, slug, colour, hmrc_category)')
      .eq('is_business', true);

    if (date_from) query = query.gte('date', date_from);
    if (date_to) query = query.lte('date', date_to);

    const { data, error } = await query;

    if (error) {
      console.error('[Finance] Category breakdown error:', error);
      return res.status(500).json({ success: false, error: 'Failed to fetch breakdown' });
    }

    // Group by category
    const categories = {};
    let total = 0;

    (data || []).forEach(exp => {
      const cat = exp.expense_categories || { name: 'Uncategorised', slug: 'uncategorised', colour: '#737373' };
      const key = cat.slug || 'uncategorised';
      if (!categories[key]) {
        categories[key] = { name: cat.name, colour: cat.colour, hmrc_category: cat.hmrc_category, total: 0, count: 0 };
      }
      categories[key].total += parseFloat(exp.amount);
      categories[key].count++;
      total += parseFloat(exp.amount);
    });

    // Convert to array and add percentages
    const breakdown = Object.entries(categories)
      .map(([slug, data]) => ({
        slug,
        ...data,
        total: Math.round(data.total * 100) / 100,
        percentage: total > 0 ? Math.round((data.total / total) * 10000) / 100 : 0
      }))
      .sort((a, b) => b.total - a.total);

    res.json({ success: true, data: breakdown, total: Math.round(total * 100) / 100 });
  } catch (error) {
    console.error('[Finance] Category breakdown error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

/**
 * GET /admin/finance/tax-summary
 * Expenses grouped by HMRC category for tax year
 */
async function getTaxSummary(req, res) {
  try {
    // UK tax year: 6 April to 5 April
    const now = new Date();
    let taxYearStart;
    if (now.getMonth() > 3 || (now.getMonth() === 3 && now.getDate() >= 6)) {
      taxYearStart = new Date(now.getFullYear(), 3, 6).toISOString().split('T')[0];
    } else {
      taxYearStart = new Date(now.getFullYear() - 1, 3, 6).toISOString().split('T')[0];
    }

    const today = now.toISOString().split('T')[0];

    // Business expenses
    const { data: expenses } = await supabase
      .from('expenses')
      .select('amount, vat_amount, net_amount, expense_categories(name, hmrc_category, is_tax_deductible)')
      .eq('is_business', true)
      .gte('date', taxYearStart)
      .lte('date', today);

    // Wages
    const { data: wages } = await supabase
      .from('wage_payments')
      .select('amount')
      .gte('date', taxYearStart)
      .lte('date', today);

    // Mileage
    const { data: mileage } = await supabase
      .from('mileage_log')
      .select('miles, calculated_amount')
      .gte('date', taxYearStart)
      .lte('date', today);

    // Income
    const { data: invoices } = await supabase
      .from('invoices')
      .select('total')
      .eq('status', 'paid')
      .gte('paid_at', taxYearStart)
      .lte('paid_at', today + 'T23:59:59');

    const { data: manualIncome } = await supabase
      .from('income_entries')
      .select('amount')
      .gte('date', taxYearStart)
      .lte('date', today);

    // Group expenses by HMRC category
    const hmrcGroups = {};
    let totalDeductible = 0;
    let totalVat = 0;

    (expenses || []).forEach(exp => {
      const cat = exp.expense_categories || {};
      const hmrc = cat.hmrc_category || 'admin';
      if (!hmrcGroups[hmrc]) hmrcGroups[hmrc] = { total: 0, vat: 0, count: 0 };
      hmrcGroups[hmrc].total += parseFloat(exp.amount);
      hmrcGroups[hmrc].vat += parseFloat(exp.vat_amount || 0);
      hmrcGroups[hmrc].count++;
      if (cat.is_tax_deductible !== false) totalDeductible += parseFloat(exp.amount);
      totalVat += parseFloat(exp.vat_amount || 0);
    });

    const sum = (arr, f) => (arr || []).reduce((s, r) => s + parseFloat(r[f] || 0), 0);
    const totalIncome = sum(invoices, 'total') + sum(manualIncome, 'amount');
    const totalWages = sum(wages, 'amount');
    const totalMiles = (mileage || []).reduce((s, r) => s + parseFloat(r.miles || 0), 0);
    const totalMileageClaim = sum(mileage, 'calculated_amount');

    // Round all values
    Object.keys(hmrcGroups).forEach(key => {
      hmrcGroups[key].total = Math.round(hmrcGroups[key].total * 100) / 100;
      hmrcGroups[key].vat = Math.round(hmrcGroups[key].vat * 100) / 100;
    });

    res.json({
      success: true,
      data: {
        tax_year: taxYearStart + ' to ' + today,
        total_income: Math.round(totalIncome * 100) / 100,
        hmrc_categories: hmrcGroups,
        total_deductible_expenses: Math.round(totalDeductible * 100) / 100,
        total_wages: Math.round(totalWages * 100) / 100,
        mileage: {
          total_miles: Math.round(totalMiles * 10) / 10,
          total_claim: Math.round(totalMileageClaim * 100) / 100
        },
        total_vat_paid: Math.round(totalVat * 100) / 100,
        taxable_profit: Math.round((totalIncome - totalDeductible - totalWages - totalMileageClaim) * 100) / 100
      }
    });
  } catch (error) {
    console.error('[Finance] Tax summary error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

/**
 * GET /admin/finance/export
 * CSV export of financial data
 */
async function exportFinance(req, res) {
  try {
    const { type, date_from, date_to } = req.query;

    if (type === 'wages') {
      let query = supabase.from('wage_payments').select('*').order('date', { ascending: false });
      if (date_from) query = query.gte('date', date_from);
      if (date_to) query = query.lte('date', date_to);
      const { data } = await query;

      const rows = (data || []).map(w => ({
        Date: w.date,
        'Team Member': w.team_member_name,
        Amount: w.amount,
        Type: w.payment_type,
        Method: w.payment_method,
        'Period Start': w.period_start || '',
        'Period End': w.period_end || '',
        Notes: w.notes || ''
      }));

      return sendCSV(res, rows, 'wages-export.csv');
    }

    if (type === 'mileage') {
      let query = supabase.from('mileage_log').select('*').order('date', { ascending: false });
      if (date_from) query = query.gte('date', date_from);
      if (date_to) query = query.lte('date', date_to);
      const { data } = await query;

      const rows = (data || []).map(m => ({
        Date: m.date,
        From: m.from_location,
        To: m.to_location,
        Miles: m.miles,
        'Return Trip': m.is_return ? 'Yes' : 'No',
        Rate: m.rate_per_mile,
        Amount: m.calculated_amount,
        Purpose: m.purpose || '',
        Notes: m.notes || ''
      }));

      return sendCSV(res, rows, 'mileage-export.csv');
    }

    // Default: expenses
    let query = supabase
      .from('expenses')
      .select('*, expense_categories(name, hmrc_category)')
      .order('date', { ascending: false });
    if (date_from) query = query.gte('date', date_from);
    if (date_to) query = query.lte('date', date_to);
    const { data } = await query;

    const rows = (data || []).map(e => ({
      Date: e.date,
      Description: e.description,
      Category: e.expense_categories ? e.expense_categories.name : '',
      'HMRC Category': e.expense_categories ? e.expense_categories.hmrc_category : '',
      Amount: e.amount,
      VAT: e.vat_amount,
      'Net Amount': e.net_amount,
      'Payment Method': e.payment_method,
      'Business/Personal': e.is_business ? 'Business' : 'Personal',
      Supplier: e.supplier || '',
      Reference: e.reference || '',
      Notes: e.notes || ''
    }));

    return sendCSV(res, rows, 'expenses-export.csv');
  } catch (error) {
    console.error('[Finance] Export error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

/**
 * Convert array of objects to CSV and send as download
 */
function sendCSV(res, rows, filename) {
  if (!rows || rows.length === 0) {
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=' + filename);
    return res.send('No data');
  }

  const headers = Object.keys(rows[0]);
  const csvLines = [headers.join(',')];

  rows.forEach(row => {
    const values = headers.map(h => {
      const val = String(row[h] || '').replace(/"/g, '""');
      return '"' + val + '"';
    });
    csvLines.push(values.join(','));
  });

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=' + filename);
  res.send(csvLines.join('\n'));
}

// ========================
// RECEIPT SCANNING
// ========================

/**
 * POST /admin/finance/expenses/scan-receipt
 * Upload receipt image → Supabase Storage, OCR via Claude Vision
 */
async function scanReceipt(req, res) {
  try {
    const { filename, contentType, data: fileData } = req.body;

    if (!filename || !fileData) {
      return res.status(400).json({ success: false, error: 'Filename and image data are required' });
    }

    // Validate image type
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'];
    if (contentType && !allowedTypes.includes(contentType)) {
      return res.status(400).json({ success: false, error: 'File type not allowed. Please upload a JPEG, PNG, or WebP image.' });
    }

    // Decode and validate size
    const buffer = Buffer.from(fileData, 'base64');
    if (buffer.length > 10 * 1024 * 1024) {
      return res.status(400).json({ success: false, error: 'Image too large (max 10MB)' });
    }

    // Step 1: Upload to Supabase Storage
    const filePath = `${Date.now()}-${filename.replace(/[^a-zA-Z0-9._-]/g, '_')}`;

    const { error: uploadError } = await supabase.storage
      .from('expense-receipts')
      .upload(filePath, buffer, {
        contentType: contentType || 'image/jpeg',
        upsert: false
      });

    if (uploadError) {
      console.error('[Finance] Receipt upload error:', uploadError);
      return res.status(500).json({ success: false, error: 'Failed to upload receipt: ' + uploadError.message });
    }

    const { data: urlData } = supabase.storage
      .from('expense-receipts')
      .getPublicUrl(filePath);

    const receiptUrl = urlData.publicUrl;

    // Step 2: OCR via Claude Vision
    let extracted = null;
    let extractionError = null;

    try {
      const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

      // Fetch current categories for matching
      const { data: categories } = await supabase
        .from('expense_categories')
        .select('name, slug')
        .eq('is_active', true)
        .order('sort_order', { ascending: true });

      const categoryList = (categories || []).map(c => c.slug).join(', ');

      const response = await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1000,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: contentType || 'image/jpeg',
                  data: fileData
                }
              },
              {
                type: 'text',
                text: `You are an expense receipt scanner for a UK exterior cleaning business. Extract the following details from this receipt image and return ONLY valid JSON (no markdown, no explanation).

Required JSON format:
{
  "date": "YYYY-MM-DD or null if not readable",
  "amount": 0.00,
  "vat_amount": 0.00,
  "supplier": "Business/shop name or null",
  "description": "Brief description of items purchased (max 60 chars)",
  "suggested_category": "one of: ${categoryList}",
  "payment_method": "card or cash or bank_transfer",
  "is_business": true,
  "confidence": "high or medium or low"
}

Rules:
- amount should be the TOTAL amount paid (including VAT)
- vat_amount should be the VAT portion if shown, or calculate as amount/6 if the receipt shows VAT-inclusive pricing at 20%. If no VAT info visible, set to 0
- For date, use YYYY-MM-DD format. If only day/month visible, assume current year (2026)
- For suggested_category, pick the closest match from the list. This is an exterior cleaning/property services business, so "materials", "cleaning-solutions", "fuel", "tools", "equipment-purchase" are common
- For description, summarise the main items purchased concisely
- confidence: "high" if receipt is clear and complete, "medium" if some fields are guessed, "low" if receipt is hard to read
- is_business should be true unless the items are clearly personal (food, clothing, etc.)
- Return ONLY the JSON object, nothing else`
              }
            ]
          }
        ]
      });

      const textBlock = response.content.find(b => b.type === 'text');
      if (textBlock) {
        let jsonStr = textBlock.text.trim();
        // Strip markdown code fences if present
        if (jsonStr.startsWith('```')) {
          jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
        }
        extracted = JSON.parse(jsonStr);

        // Sanitise extracted values
        if (extracted.amount) extracted.amount = parseFloat(extracted.amount) || 0;
        if (extracted.vat_amount) extracted.vat_amount = parseFloat(extracted.vat_amount) || 0;
        if (extracted.date && !/^\d{4}-\d{2}-\d{2}$/.test(extracted.date)) {
          extracted.date = null;
        }
      }
    } catch (ocrError) {
      console.error('[Finance] Receipt OCR error:', ocrError.message);
      extractionError = 'Could not read receipt automatically. Please enter details manually.';
    }

    console.log(`[Finance] Receipt scanned: ${filename}, extracted: ${extracted ? 'yes' : 'no'}`);

    res.json({
      success: true,
      extracted,
      extraction_error: extractionError,
      receipt_path: filePath,
      receipt_url: receiptUrl
    });

  } catch (error) {
    console.error('[Finance] Scan receipt error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

// ========================
// EXPORTS
// ========================

module.exports = {
  setSupabaseClient,
  listCategories,
  createCategory,
  updateCategory,
  listExpenses,
  createExpense,
  updateExpense,
  deleteExpense,
  scanReceipt,
  listWages,
  createWage,
  updateWage,
  deleteWage,
  listMileage,
  createMileage,
  updateMileage,
  deleteMileage,
  listRecurring,
  createRecurring,
  updateRecurring,
  deleteRecurring,
  generateFromRecurring,
  listIncome,
  createIncome,
  deleteIncome,
  getSummary,
  getCashflow,
  getCategoryBreakdown,
  getTaxSummary,
  exportFinance
};
