/**
 * Customer Routes
 *
 * Protected endpoints for managing customer profiles and follow-ups.
 * All routes require ADMIN_TOKEN in Authorization header.
 */

// Supabase client will be passed from index.js
let supabase;

function setSupabaseClient(client) {
  supabase = client;
}

// ========================
// CUSTOMER CRUD
// ========================

/**
 * GET /admin/customers
 * List customers with search, filter, sort, pagination
 */
async function listCustomers(req, res) {
  try {
    const { search, tag, sort, order, limit, offset } = req.query;

    let query = supabase
      .from('customers')
      .select('*', { count: 'exact' });

    // Search by name, email, phone, or postcode
    if (search) {
      query = query.or(
        `name.ilike.%${search}%,email.ilike.%${search}%,phone.ilike.%${search}%,postcode.ilike.%${search}%`
      );
    }

    // Filter by tag
    if (tag) {
      query = query.contains('tags', [tag]);
    }

    // Sort
    const sortField = sort || 'created_at';
    const sortOrder = order === 'asc' ? { ascending: true } : { ascending: false };
    query = query.order(sortField, sortOrder);

    // Pagination
    const lim = Math.min(parseInt(limit) || 50, 200);
    const off = parseInt(offset) || 0;
    query = query.range(off, off + lim - 1);

    const { data, error, count } = await query;

    if (error) {
      console.error('[Customers] List error:', error);
      return res.status(500).json({ success: false, error: 'Failed to fetch customers' });
    }

    res.json({ success: true, data, total: count });
  } catch (error) {
    console.error('[Customers] List error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

/**
 * GET /admin/customers/search?q=
 * Quick search for typeahead (returns max 10 results)
 */
async function searchCustomers(req, res) {
  try {
    const { q } = req.query;

    if (!q || q.length < 2) {
      return res.json({ success: true, data: [] });
    }

    const { data, error } = await supabase
      .from('customers')
      .select('id, name, email, phone, address, postcode, total_jobs, total_spent')
      .or(
        `name.ilike.%${q}%,email.ilike.%${q}%,phone.ilike.%${q}%,postcode.ilike.%${q}%`
      )
      .order('total_jobs', { ascending: false })
      .limit(10);

    if (error) {
      console.error('[Customers] Search error:', error);
      return res.status(500).json({ success: false, error: 'Search failed' });
    }

    res.json({ success: true, data });
  } catch (error) {
    console.error('[Customers] Search error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

/**
 * GET /admin/customers/stats
 * Overview statistics
 */
async function getStats(req, res) {
  try {
    const { data, error, count } = await supabase
      .from('customers')
      .select('total_spent, total_jobs, last_job_date', { count: 'exact' });

    if (error) {
      console.error('[Customers] Stats error:', error);
      return res.status(500).json({ success: false, error: 'Failed to fetch stats' });
    }

    const totalCustomers = count || 0;
    const totalSpent = data.reduce((sum, c) => sum + Number(c.total_spent || 0), 0);
    const avgSpend = totalCustomers > 0 ? totalSpent / totalCustomers : 0;
    const activeCustomers = data.filter(c => {
      if (!c.last_job_date) return false;
      const sixMonthsAgo = new Date();
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
      return new Date(c.last_job_date) >= sixMonthsAgo;
    }).length;

    res.json({
      success: true,
      stats: {
        total_customers: totalCustomers,
        active_customers: activeCustomers,
        total_revenue: totalSpent,
        avg_spend: Math.round(avgSpend * 100) / 100
      }
    });
  } catch (error) {
    console.error('[Customers] Stats error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

/**
 * GET /admin/customers/:id
 * Full customer profile with their quotes and jobs
 */
async function getCustomer(req, res) {
  try {
    const { id } = req.params;

    // Get customer
    const { data: customer, error: custError } = await supabase
      .from('customers')
      .select('*')
      .eq('id', id)
      .single();

    if (custError || !customer) {
      return res.status(404).json({ success: false, error: 'Customer not found' });
    }

    // Get their quotes
    const { data: quotes } = await supabase
      .from('quotes')
      .select('id, created_at, services, status, qualification_status, estimated_value_min, estimated_value_max, customer_accepted_estimate')
      .eq('customer_id', id)
      .order('created_at', { ascending: false });

    // Get their jobs
    const { data: jobs } = await supabase
      .from('jobs')
      .select('id, scheduled_date, service, job_value, status, payment_status, payment_method, assigned_to, time_slot')
      .eq('customer_id', id)
      .order('scheduled_date', { ascending: false });

    res.json({
      success: true,
      data: {
        ...customer,
        quotes: quotes || [],
        jobs: jobs || []
      }
    });
  } catch (error) {
    console.error('[Customers] Get error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

/**
 * PATCH /admin/customers/:id
 * Update customer details, tags, notes
 */
async function updateCustomer(req, res) {
  try {
    const { id } = req.params;
    const updates = req.body;

    const allowed = ['name', 'email', 'phone', 'address', 'postcode', 'tags', 'admin_notes'];
    const filtered = {};
    for (const key of allowed) {
      if (updates[key] !== undefined) {
        filtered[key] = updates[key];
      }
    }

    if (Object.keys(filtered).length === 0) {
      return res.status(400).json({ success: false, error: 'No valid fields to update' });
    }

    const { data, error } = await supabase
      .from('customers')
      .update(filtered)
      .eq('id', id)
      .select();

    if (error) {
      console.error('[Customers] Update error:', error);
      return res.status(500).json({ success: false, error: 'Failed to update customer' });
    }

    if (!data || data.length === 0) {
      return res.status(404).json({ success: false, error: 'Customer not found' });
    }

    console.log(`[Customers] Updated ${id}:`, Object.keys(filtered).join(', '));
    res.json({ success: true, data: data[0] });
  } catch (error) {
    console.error('[Customers] Update error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

// ========================
// FOLLOW-UP EMAILS
// ========================

// Lazy-load emailer to avoid circular dependency
let emailer = null;
function getEmailer() {
  if (!emailer) {
    emailer = require('../services/emailer');
  }
  return emailer;
}

/**
 * POST /admin/customers/:id/followup
 * Send a follow-up email to a single customer
 * Body: { template, subject, body }
 */
async function sendFollowUp(req, res) {
  try {
    const { id } = req.params;
    const { subject, body } = req.body;

    if (!subject || !body) {
      return res.status(400).json({ success: false, error: 'Subject and body are required' });
    }

    // Get customer
    const { data: customer, error: custError } = await supabase
      .from('customers')
      .select('*')
      .eq('id', id)
      .single();

    if (custError || !customer) {
      return res.status(404).json({ success: false, error: 'Customer not found' });
    }

    if (!customer.email) {
      return res.status(400).json({ success: false, error: 'Customer has no email address' });
    }

    // Send email via Resend
    const result = await getEmailer().sendFollowUpEmail(customer, subject, body);

    if (!result.success) {
      return res.status(500).json({ success: false, error: 'Failed to send email' });
    }

    // Update last_followup_sent_at
    await supabase
      .from('customers')
      .update({ last_followup_sent_at: new Date().toISOString() })
      .eq('id', id);

    console.log(`[Customers] Follow-up sent to ${customer.email}`);
    res.json({ success: true, emailId: result.emailId });
  } catch (error) {
    console.error('[Customers] Follow-up error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

/**
 * POST /admin/customers/bulk-followup
 * Send follow-up email to multiple customers
 * Body: { customer_ids: [], subject, body }
 */
async function sendBulkFollowUp(req, res) {
  try {
    const { customer_ids, subject, body } = req.body;

    if (!customer_ids || !Array.isArray(customer_ids) || customer_ids.length === 0) {
      return res.status(400).json({ success: false, error: 'customer_ids array is required' });
    }
    if (!subject || !body) {
      return res.status(400).json({ success: false, error: 'Subject and body are required' });
    }

    // Get all selected customers
    const { data: customers, error } = await supabase
      .from('customers')
      .select('*')
      .in('id', customer_ids);

    if (error) {
      return res.status(500).json({ success: false, error: 'Failed to fetch customers' });
    }

    const results = { sent: 0, failed: 0, skipped: 0 };

    for (const customer of customers) {
      if (!customer.email) {
        results.skipped++;
        continue;
      }

      // Personalise body with customer name
      const personalBody = body.replace(/\{name\}/g, customer.name);
      const personalSubject = subject.replace(/\{name\}/g, customer.name);

      const result = await getEmailer().sendFollowUpEmail(customer, personalSubject, personalBody);

      if (result.success) {
        results.sent++;
        // Update last_followup_sent_at
        await supabase
          .from('customers')
          .update({ last_followup_sent_at: new Date().toISOString() })
          .eq('id', customer.id);
      } else {
        results.failed++;
      }
    }

    console.log(`[Customers] Bulk follow-up: ${results.sent} sent, ${results.failed} failed, ${results.skipped} skipped`);
    res.json({ success: true, results });
  } catch (error) {
    console.error('[Customers] Bulk follow-up error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

// ========================
// BULK PREVIEW (Server-side filtering)
// ========================

/**
 * GET /admin/customers/bulk-preview?filter=<type>
 * Returns customer IDs matching the filter for bulk follow-up
 * Supports both job-history and quote-status filters
 */
async function getBulkPreview(req, res) {
  try {
    const { filter } = req.query;
    let customerIds = [];

    if (filter === 'accepted_no_job' || filter === 'quoted_no_response' || filter === 'never_quoted') {
      // Quote-status filters require joining quotes data
      const { data: quotes } = await supabase
        .from('quotes')
        .select('customer_id, customer_accepted_estimate, estimate_email_sent_at')
        .not('customer_id', 'is', null);

      if (!quotes || quotes.length === 0) {
        return res.json({ success: true, customer_ids: [], count: 0 });
      }

      if (filter === 'accepted_no_job') {
        // Customers who accepted a quote but have no completed job
        const acceptedIds = [...new Set(
          quotes.filter(q => q.customer_accepted_estimate === true).map(q => q.customer_id)
        )];
        if (acceptedIds.length === 0) {
          return res.json({ success: true, customer_ids: [], count: 0 });
        }
        const { data: jobs } = await supabase
          .from('jobs')
          .select('customer_id')
          .eq('status', 'completed')
          .in('customer_id', acceptedIds);
        const completedIds = new Set((jobs || []).map(j => j.customer_id));
        customerIds = acceptedIds.filter(id => !completedIds.has(id));

      } else if (filter === 'quoted_no_response') {
        // Customers who received an estimate email but haven't accepted
        customerIds = [...new Set(
          quotes
            .filter(q => q.estimate_email_sent_at && !q.customer_accepted_estimate)
            .map(q => q.customer_id)
        )];

      } else if (filter === 'never_quoted') {
        // Customers who submitted but never received an estimate
        const quotedIds = new Set(
          quotes.filter(q => q.estimate_email_sent_at).map(q => q.customer_id)
        );
        const allQuoteCustomerIds = [...new Set(quotes.map(q => q.customer_id))];
        customerIds = allQuoteCustomerIds.filter(id => !quotedIds.has(id));
      }

      // Filter to only those with a valid email
      if (customerIds.length > 0) {
        const { data: customers } = await supabase
          .from('customers')
          .select('id')
          .in('id', customerIds)
          .not('email', 'is', null)
          .neq('email', '');
        customerIds = (customers || []).map(c => c.id);
      }

    } else {
      // Job-history filters - query customers table directly
      let query = supabase
        .from('customers')
        .select('id, last_job_date')
        .not('email', 'is', null)
        .neq('email', '');

      const { data: customers } = await query;
      if (!customers) {
        return res.json({ success: true, customer_ids: [], count: 0 });
      }

      const now = new Date();
      customerIds = customers.filter(c => {
        if (filter === 'all') return true;
        if (filter === 'never') return !c.last_job_date;
        const months = filter === '3months' ? 3 : filter === '6months' ? 6 : filter === '12months' ? 12 : 0;
        if (months === 0) return true;
        if (!c.last_job_date) return true; // Include those with no job in time-based filters
        const cutoff = new Date(now);
        cutoff.setMonth(cutoff.getMonth() - months);
        return new Date(c.last_job_date) < cutoff;
      }).map(c => c.id);
    }

    res.json({ success: true, customer_ids: customerIds, count: customerIds.length });
  } catch (error) {
    console.error('[Customers] Bulk preview error:', error);
    res.status(500).json({ success: false, error: 'Failed to preview recipients' });
  }
}

// ========================
// CONVERSION ANALYTICS
// ========================

/**
 * GET /admin/customers/analytics
 * Compute conversion funnel metrics from quotes, jobs, and customers
 */
async function getConversionAnalytics(req, res) {
  try {
    // Fetch data in parallel
    const [quotesRes, jobsRes, customersRes] = await Promise.all([
      supabase.from('quotes').select(
        'id, customer_id, customer_accepted_estimate, customer_accepted_at, ' +
        'estimate_email_sent_at, whatsapp_sent_at, estimated_at, ' +
        'services, created_at, status, ' +
        'estimated_value_min, estimated_value_max, ' +
        'preferred_contact, postcode, ' +
        'qualification_status, lead_score, last_contact_at'
      ),
      supabase.from('jobs').select(
        'id, customer_id, status, job_value, payment_status, service, scheduled_date, quote_id'
      ),
      supabase.from('customers').select('id, last_followup_sent_at')
    ]);

    const quotes = quotesRes.data || [];
    const jobs = jobsRes.data || [];
    const customers = customersRes.data || [];

    // ===== CONVERSION RATES (fixed) =====

    // 1. Quote-to-acceptance rate (use estimated_at as fallback)
    const quotesWithEstimate = quotes.filter(q => q.estimate_email_sent_at || q.estimated_at);
    const quotesAccepted = quotes.filter(q => q.customer_accepted_estimate === true);
    const quoteToAcceptanceRate = quotesWithEstimate.length > 0
      ? Math.round((quotesAccepted.length / quotesWithEstimate.length) * 100)
      : 0;

    // 2. Acceptance-to-job rate (include booked/scheduled, not just completed)
    const acceptedCustomerIds = [...new Set(quotesAccepted.filter(q => q.customer_id).map(q => q.customer_id))];
    const jobCustomerIds = [...new Set(
      jobs.filter(j => ['completed', 'scheduled', 'in_progress'].includes(j.status) && j.customer_id)
        .map(j => j.customer_id)
    )];
    const acceptedThenBooked = acceptedCustomerIds.filter(id => jobCustomerIds.includes(id));
    const acceptanceToJobRate = acceptedCustomerIds.length > 0
      ? Math.round((acceptedThenBooked.length / acceptedCustomerIds.length) * 100)
      : 0;

    // 3. Average time from estimate to acceptance (hours)
    const timeDiffs = quotesAccepted
      .filter(q => q.customer_accepted_at && (q.estimate_email_sent_at || q.estimated_at))
      .map(q => {
        const sentAt = q.estimate_email_sent_at || q.estimated_at;
        return new Date(q.customer_accepted_at) - new Date(sentAt);
      })
      .filter(d => d > 0);
    const avgTimeToAcceptHours = timeDiffs.length > 0
      ? Math.round(timeDiffs.reduce((a, b) => a + b, 0) / timeDiffs.length / (1000 * 60 * 60) * 10) / 10
      : 0;

    // 4. Revenue by service type
    const paidJobs = jobs.filter(j => j.status === 'completed' && j.payment_status === 'paid');
    const revenueByService = {};
    paidJobs.forEach(j => {
      const svc = j.service || 'Unknown';
      revenueByService[svc] = (revenueByService[svc] || 0) + Number(j.job_value || 0);
    });

    // 5. Follow-up effectiveness
    const followedUpCustomers = customers.filter(c => c.last_followup_sent_at);
    const followedUpThenBooked = followedUpCustomers.filter(c => {
      return jobs.some(j =>
        j.customer_id === c.id &&
        ['completed', 'scheduled', 'in_progress'].includes(j.status) &&
        new Date(j.scheduled_date) > new Date(c.last_followup_sent_at)
      );
    });
    const followUpEffectiveness = followedUpCustomers.length > 0
      ? Math.round((followedUpThenBooked.length / followedUpCustomers.length) * 100)
      : 0;

    // ===== CONVERSION FUNNEL =====
    const paidQuoteIds = new Set(jobs.filter(j => j.payment_status === 'paid' && j.quote_id).map(j => j.quote_id));
    const funnel = {
      total_quotes: quotes.length,
      estimated: quotes.filter(q => q.estimated_at).length,
      sent_to_customer: quotes.filter(q => q.estimate_email_sent_at || q.whatsapp_sent_at).length,
      accepted: quotesAccepted.length,
      booked: quotes.filter(q => ['booked', 'completed'].includes(q.status)).length,
      completed: quotes.filter(q => q.status === 'completed').length,
      paid: paidQuoteIds.size
    };

    // ===== PIPELINE SNAPSHOT =====
    const now = new Date();
    const dayOfWeek = now.getDay();
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1));
    startOfWeek.setHours(0, 0, 0, 0);
    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(startOfWeek.getDate() + 7);
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

    const pipeline = {
      awaiting_action: quotes.filter(q => q.status === 'new').length,
      hot_leads_uncontacted: quotes.filter(q => q.qualification_status === 'hot' && q.status === 'new').length,
      accepted_not_booked: quotes.filter(q =>
        q.customer_accepted_estimate === true &&
        !['booked', 'completed'].includes(q.status)
      ).length,
      jobs_this_week: jobs.filter(j => {
        const d = new Date(j.scheduled_date);
        return d >= startOfWeek && d < endOfWeek && j.status !== 'cancelled';
      }).length,
      jobs_this_month: jobs.filter(j => {
        const d = new Date(j.scheduled_date);
        return d >= startOfMonth && d <= endOfMonth && j.status !== 'cancelled';
      }).length,
      total_pipeline_value: quotes
        .filter(q => ['new', 'contacted', 'quoted'].includes(q.status))
        .reduce((sum, q) => sum + Number(q.estimated_value_max || 0), 0)
    };

    // ===== SERVICE INSIGHTS =====
    const serviceStats = {};
    quotes.forEach(q => {
      (q.services || []).forEach(svc => {
        if (!serviceStats[svc]) serviceStats[svc] = { quote_count: 0, converted: 0, total_value: 0 };
        serviceStats[svc].quote_count++;
        if (['booked', 'completed'].includes(q.status) || q.customer_accepted_estimate) {
          serviceStats[svc].converted++;
        }
      });
    });
    paidJobs.forEach(j => {
      const svc = (j.service || '').toLowerCase();
      if (serviceStats[svc]) serviceStats[svc].total_value += Number(j.job_value || 0);
    });
    const mostRequested = Object.entries(serviceStats)
      .map(([service, stats]) => ({
        service,
        quote_count: stats.quote_count,
        conversion_rate: stats.quote_count > 0 ? Math.round((stats.converted / stats.quote_count) * 100) : 0,
        avg_value: stats.converted > 0 ? Math.round(stats.total_value / stats.converted) : 0
      }))
      .sort((a, b) => b.quote_count - a.quote_count);

    // ===== CUSTOMER BEHAVIOUR =====
    const contactBreakdown = {};
    quotes.forEach(q => {
      const method = (q.preferred_contact || 'no_preference').toLowerCase();
      contactBreakdown[method] = (contactBreakdown[method] || 0) + 1;
    });

    const peakHours = new Array(24).fill(0);
    const peakDays = new Array(7).fill(0);
    quotes.forEach(q => {
      const d = new Date(q.created_at);
      peakHours[d.getHours()]++;
      peakDays[d.getDay()]++;
    });

    const postcodeAreas = {};
    quotes.forEach(q => {
      if (q.postcode) {
        const area = q.postcode.replace(/\s/g, '').match(/^[A-Za-z]+/);
        if (area) {
          const key = area[0].toUpperCase();
          postcodeAreas[key] = (postcodeAreas[key] || 0) + 1;
        }
      }
    });
    const topPostcodes = Object.entries(postcodeAreas)
      .map(([postcode_area, count]) => ({ postcode_area, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    const customerQuoteCounts = {};
    quotes.forEach(q => {
      if (q.customer_id) customerQuoteCounts[q.customer_id] = (customerQuoteCounts[q.customer_id] || 0) + 1;
    });
    const uniqueCustomers = Object.keys(customerQuoteCounts).length;
    const repeatCustomers = Object.values(customerQuoteCounts).filter(c => c >= 2).length;
    const repeatRate = uniqueCustomers > 0 ? Math.round((repeatCustomers / uniqueCustomers) * 100) : 0;

    // ===== RESPONSE METRICS =====
    const contactedQuotes = quotes.filter(q => q.last_contact_at && q.status !== 'new');
    const timeToAction = contactedQuotes
      .map(q => new Date(q.last_contact_at) - new Date(q.created_at))
      .filter(d => d > 0);
    const avgTimeToFirstAction = timeToAction.length > 0
      ? Math.round(timeToAction.reduce((a, b) => a + b, 0) / timeToAction.length / (1000 * 60 * 60) * 10) / 10
      : 0;

    const estimatedQuotes = quotes.filter(q => q.estimated_at);
    const timeToEstimate = estimatedQuotes
      .map(q => new Date(q.estimated_at) - new Date(q.created_at))
      .filter(d => d > 0);
    const avgTimeToEstimate = timeToEstimate.length > 0
      ? Math.round(timeToEstimate.reduce((a, b) => a + b, 0) / timeToEstimate.length / (1000 * 60 * 60) * 10) / 10
      : 0;

    res.json({
      success: true,
      analytics: {
        // Existing metrics (fixed)
        quote_to_acceptance_rate: quoteToAcceptanceRate,
        quotes_with_estimate: quotesWithEstimate.length,
        quotes_accepted: quotesAccepted.length,
        acceptance_to_job_rate: acceptanceToJobRate,
        accepted_customers: acceptedCustomerIds.length,
        accepted_then_booked: acceptedThenBooked.length,
        avg_time_to_accept_hours: avgTimeToAcceptHours,
        revenue_by_service: revenueByService,
        total_revenue: paidJobs.reduce((sum, j) => sum + Number(j.job_value || 0), 0),
        followup_effectiveness: followUpEffectiveness,
        followed_up_count: followedUpCustomers.length,
        followed_up_then_booked: followedUpThenBooked.length,
        total_quotes: quotes.length,
        // New metrics
        funnel,
        pipeline,
        service_insights: { most_requested: mostRequested },
        customer_behaviour: {
          preferred_contact_breakdown: contactBreakdown,
          peak_submission_hours: peakHours,
          peak_submission_days: peakDays,
          top_postcodes: topPostcodes,
          repeat_customer_rate: repeatRate
        },
        response_metrics: {
          avg_time_to_first_action_hours: avgTimeToFirstAction,
          avg_time_to_estimate_hours: avgTimeToEstimate
        }
      }
    });
  } catch (error) {
    console.error('[Customers] Analytics error:', error);
    res.status(500).json({ success: false, error: 'Failed to compute analytics' });
  }
}

// ========================
// CUSTOMER AGGREGATES
// ========================

/**
 * Refresh a customer's aggregate fields (total_spent, total_jobs, last_job_date)
 * Called after job status/payment changes
 */
async function refreshCustomerAggregates(customerId) {
  if (!customerId) return;

  try {
    // Get all completed jobs for this customer
    const { data: jobs } = await supabase
      .from('jobs')
      .select('job_value, payment_status, scheduled_date, status')
      .eq('customer_id', customerId);

    if (!jobs) return;

    const completedJobs = jobs.filter(j => j.status === 'completed');
    const paidJobs = completedJobs.filter(j => j.payment_status === 'paid');

    const totalSpent = paidJobs.reduce((sum, j) => sum + Number(j.job_value || 0), 0);
    const totalJobs = completedJobs.length;

    let lastJobDate = null;
    if (completedJobs.length > 0) {
      lastJobDate = completedJobs
        .map(j => j.scheduled_date)
        .sort()
        .reverse()[0];
    }

    await supabase
      .from('customers')
      .update({
        total_spent: totalSpent,
        total_jobs: totalJobs,
        last_job_date: lastJobDate
      })
      .eq('id', customerId);

    console.log(`[Customers] Refreshed aggregates for ${customerId}: £${totalSpent}, ${totalJobs} jobs`);
  } catch (error) {
    console.error('[Customers] Aggregate refresh error:', error);
  }
}

// ========================
// FIND OR CREATE CUSTOMER
// ========================

/**
 * Find existing customer by email/phone or create a new one
 * Returns the customer_id
 */
async function findOrCreateCustomer(quoteData) {
  try {
    const { name, email, phone, address_line1, postcode, created_at } = quoteData;

    // Try to find existing customer by email or phone
    let existing = null;

    if (email) {
      const { data } = await supabase
        .from('customers')
        .select('id')
        .ilike('email', email)
        .limit(1);
      if (data && data.length > 0) existing = data[0];
    }

    if (!existing && phone) {
      const { data } = await supabase
        .from('customers')
        .select('id')
        .eq('phone', phone)
        .limit(1);
      if (data && data.length > 0) existing = data[0];
    }

    if (existing) {
      // Update address/name if it's changed
      await supabase
        .from('customers')
        .update({
          name: name,
          address: address_line1,
          postcode: postcode
        })
        .eq('id', existing.id);

      console.log(`[Customers] Linked to existing customer ${existing.id}`);
      return existing.id;
    }

    // Create new customer
    const { data, error } = await supabase
      .from('customers')
      .insert([{
        name,
        email: email || null,
        phone: phone || null,
        address: address_line1 || null,
        postcode: postcode || null,
        first_contact_date: created_at || new Date().toISOString()
      }])
      .select();

    if (error) {
      console.error('[Customers] Create error:', error);
      return null;
    }

    console.log(`[Customers] Created new customer ${data[0].id} for ${name}`);
    return data[0].id;
  } catch (error) {
    console.error('[Customers] findOrCreate error:', error);
    return null;
  }
}

module.exports = {
  setSupabaseClient,
  listCustomers,
  searchCustomers,
  getStats,
  getCustomer,
  updateCustomer,
  sendFollowUp,
  sendBulkFollowUp,
  getBulkPreview,
  getConversionAnalytics,
  refreshCustomerAggregates,
  findOrCreateCustomer
};
