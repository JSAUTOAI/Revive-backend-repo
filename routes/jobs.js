/**
 * Job Scheduling Routes
 *
 * CRUD endpoints for jobs, recurring jobs, and team members.
 * All routes require ADMIN_TOKEN in Authorization header.
 */

let supabase;

function setSupabaseClient(client) {
  supabase = client;
}

// ========================
// JOBS CRUD
// ========================

/**
 * GET /admin/jobs
 * List jobs with filters (date, assigned_to, status)
 */
async function listJobs(req, res) {
  try {
    const { date, assigned_to, status, from_date, to_date } = req.query;

    let query = supabase
      .from('jobs')
      .select('*')
      .order('scheduled_date', { ascending: true })
      .order('time_slot', { ascending: true });

    if (date) {
      query = query.eq('scheduled_date', date);
    }
    if (from_date) {
      query = query.gte('scheduled_date', from_date);
    }
    if (to_date) {
      query = query.lte('scheduled_date', to_date);
    }
    if (assigned_to) {
      query = query.eq('assigned_to', assigned_to);
    }
    if (status) {
      query = query.eq('status', status);
    }

    const { data, error } = await query;

    if (error) {
      console.error('[Jobs] List error:', error);
      return res.status(500).json({ success: false, error: 'Failed to fetch jobs' });
    }

    res.json({ success: true, data });
  } catch (error) {
    console.error('[Jobs] List error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

/**
 * POST /admin/jobs
 * Create a new job (manual or from quote)
 */
async function createJob(req, res) {
  try {
    const {
      quote_id,
      customer_id,
      customer_name,
      customer_phone,
      customer_email,
      address,
      postcode,
      service,
      assigned_to,
      scheduled_date,
      time_slot,
      estimated_duration,
      job_value,
      notes,
      recurring_job_id
    } = req.body;

    // Validate required fields
    const missing = [];
    if (!customer_name) missing.push('customer_name');
    if (!address) missing.push('address');
    if (!postcode) missing.push('postcode');
    if (!service) missing.push('service');
    if (!scheduled_date) missing.push('scheduled_date');

    if (missing.length > 0) {
      return res.status(400).json({
        success: false,
        error: `Missing required fields: ${missing.join(', ')}`
      });
    }

    // Resolve customer_id if not provided but we have email/phone
    let resolvedCustomerId = customer_id || null;
    if (!resolvedCustomerId && (customer_email || customer_phone)) {
      try {
        const customerRoutes = require('./customers');
        resolvedCustomerId = await customerRoutes.findOrCreateCustomer({
          name: customer_name,
          email: customer_email,
          phone: customer_phone,
          address_line1: address,
          postcode: postcode
        });
      } catch (e) {
        console.error('[Jobs] Customer resolution failed, continuing:', e.message);
      }
    }

    const { data, error } = await supabase
      .from('jobs')
      .insert([{
        quote_id: quote_id || null,
        customer_id: resolvedCustomerId,
        customer_name,
        customer_phone: customer_phone || null,
        customer_email: customer_email || null,
        address,
        postcode,
        service,
        assigned_to: assigned_to || null,
        scheduled_date,
        time_slot: time_slot || 'morning',
        estimated_duration: estimated_duration || null,
        job_value: job_value || null,
        notes: notes || null,
        recurring_job_id: recurring_job_id || null
      }])
      .select();

    if (error) {
      console.error('[Jobs] Create error:', error);
      return res.status(500).json({ success: false, error: 'Failed to create job' });
    }

    console.log(`[Jobs] Created job ${data[0].id} for ${customer_name} on ${scheduled_date}`);
    res.status(201).json({ success: true, data: data[0] });
  } catch (error) {
    console.error('[Jobs] Create error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

/**
 * PATCH /admin/jobs/:id
 * Update a job (status, payment, reassign, reschedule)
 */
async function updateJob(req, res) {
  try {
    const { id } = req.params;
    const updates = req.body;

    // Only allow specific fields to be updated
    const allowed = [
      'customer_name', 'customer_phone', 'customer_email',
      'address', 'postcode', 'service', 'assigned_to',
      'scheduled_date', 'time_slot', 'estimated_duration',
      'job_value', 'status', 'payment_status', 'payment_method',
      'amount_paid', 'notes'
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

    const { data, error } = await supabase
      .from('jobs')
      .update(filtered)
      .eq('id', id)
      .select();

    if (error) {
      console.error('[Jobs] Update error:', error);
      return res.status(500).json({ success: false, error: 'Failed to update job' });
    }

    if (!data || data.length === 0) {
      return res.status(404).json({ success: false, error: 'Job not found' });
    }

    console.log(`[Jobs] Updated job ${id}:`, Object.keys(filtered).join(', '));

    // Refresh customer aggregates if status or payment changed
    if ((filtered.status || filtered.payment_status) && data[0].customer_id) {
      try {
        const customerRoutes = require('./customers');
        customerRoutes.refreshCustomerAggregates(data[0].customer_id);
      } catch (e) {
        console.error('[Jobs] Customer aggregate refresh failed:', e.message);
      }
    }

    res.json({ success: true, data: data[0] });
  } catch (error) {
    console.error('[Jobs] Update error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

/**
 * DELETE /admin/jobs/:id
 * Delete a job
 */
async function deleteJob(req, res) {
  try {
    const { id } = req.params;

    const { data, error } = await supabase
      .from('jobs')
      .delete()
      .eq('id', id)
      .select();

    if (error) {
      console.error('[Jobs] Delete error:', error);
      return res.status(500).json({ success: false, error: 'Failed to delete job' });
    }

    if (!data || data.length === 0) {
      return res.status(404).json({ success: false, error: 'Job not found' });
    }

    console.log(`[Jobs] Deleted job ${id}`);
    res.json({ success: true, message: 'Job deleted' });
  } catch (error) {
    console.error('[Jobs] Delete error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

/**
 * GET /admin/jobs/availability
 * Returns job count per day for a date range (for calendar availability view)
 * Query: from_date, to_date (YYYY-MM-DD)
 */
async function getAvailability(req, res) {
  try {
    let { from_date, to_date } = req.query;

    if (!from_date) {
      from_date = new Date().toISOString().split('T')[0];
    }
    if (!to_date) {
      const d = new Date();
      d.setDate(d.getDate() + 42); // 6 weeks
      to_date = d.toISOString().split('T')[0];
    }

    const { data, error } = await supabase
      .from('jobs')
      .select('scheduled_date, assigned_to')
      .gte('scheduled_date', from_date)
      .lte('scheduled_date', to_date)
      .not('status', 'eq', 'cancelled');

    if (error) {
      console.error('[Jobs] Availability query error:', error);
      return res.status(500).json({ success: false, error: 'Failed to fetch availability' });
    }

    // Count jobs per day
    const dates = {};
    (data || []).forEach(function(j) {
      if (!dates[j.scheduled_date]) dates[j.scheduled_date] = 0;
      dates[j.scheduled_date]++;
    });

    res.json({ success: true, dates });

  } catch (error) {
    console.error('[Jobs] Availability error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

/**
 * GET /admin/jobs/week/:date
 * Get all jobs for the week containing :date (Monday-Sunday)
 */
async function getWeekJobs(req, res) {
  try {
    const { date } = req.params;
    const target = new Date(date + 'T00:00:00');

    // Calculate Monday of the week
    const day = target.getDay();
    const diff = day === 0 ? -6 : 1 - day; // Monday = 1
    const monday = new Date(target);
    monday.setDate(target.getDate() + diff);

    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);

    const mondayStr = monday.toISOString().split('T')[0];
    const sundayStr = sunday.toISOString().split('T')[0];

    let query = supabase
      .from('jobs')
      .select('*')
      .gte('scheduled_date', mondayStr)
      .lte('scheduled_date', sundayStr)
      .order('scheduled_date', { ascending: true })
      .order('time_slot', { ascending: true });

    const { assigned_to } = req.query;
    if (assigned_to) {
      query = query.eq('assigned_to', assigned_to);
    }

    const { data, error } = await query;

    if (error) {
      console.error('[Jobs] Week query error:', error);
      return res.status(500).json({ success: false, error: 'Failed to fetch week jobs' });
    }

    res.json({
      success: true,
      week: { start: mondayStr, end: sundayStr },
      data
    });
  } catch (error) {
    console.error('[Jobs] Week error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

// ========================
// RECURRING JOBS
// ========================

/**
 * GET /admin/recurring
 * List all recurring job patterns
 */
async function listRecurring(req, res) {
  try {
    const { data, error } = await supabase
      .from('recurring_jobs')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[Recurring] List error:', error);
      return res.status(500).json({ success: false, error: 'Failed to fetch recurring jobs' });
    }

    res.json({ success: true, data });
  } catch (error) {
    console.error('[Recurring] List error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

/**
 * POST /admin/recurring
 * Create a recurring job pattern
 */
async function createRecurring(req, res) {
  try {
    const {
      customer_name, customer_phone, customer_email,
      address, postcode, service, assigned_to,
      time_slot, estimated_duration, job_value,
      repeat_interval, start_date, end_date, notes
    } = req.body;

    const missing = [];
    if (!customer_name) missing.push('customer_name');
    if (!address) missing.push('address');
    if (!postcode) missing.push('postcode');
    if (!service) missing.push('service');
    if (!repeat_interval) missing.push('repeat_interval');
    if (!start_date) missing.push('start_date');

    if (missing.length > 0) {
      return res.status(400).json({
        success: false,
        error: `Missing required fields: ${missing.join(', ')}`
      });
    }

    const validIntervals = ['weekly', 'fortnightly', '3_weeks', '4_weeks', '6_weeks', '8_weeks', 'monthly'];
    if (!validIntervals.includes(repeat_interval)) {
      return res.status(400).json({
        success: false,
        error: `Invalid repeat_interval. Must be one of: ${validIntervals.join(', ')}`
      });
    }

    const { data, error } = await supabase
      .from('recurring_jobs')
      .insert([{
        customer_name,
        customer_phone: customer_phone || null,
        customer_email: customer_email || null,
        address,
        postcode,
        service,
        assigned_to: assigned_to || null,
        time_slot: time_slot || 'morning',
        estimated_duration: estimated_duration || null,
        job_value: job_value || null,
        repeat_interval,
        start_date,
        end_date: end_date || null,
        notes: notes || null
      }])
      .select();

    if (error) {
      console.error('[Recurring] Create error:', error);
      return res.status(500).json({ success: false, error: 'Failed to create recurring job' });
    }

    console.log(`[Recurring] Created pattern ${data[0].id} for ${customer_name} (${repeat_interval})`);
    res.status(201).json({ success: true, data: data[0] });
  } catch (error) {
    console.error('[Recurring] Create error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

/**
 * PATCH /admin/recurring/:id
 * Update/deactivate a recurring pattern
 */
async function updateRecurring(req, res) {
  try {
    const { id } = req.params;
    const updates = req.body;

    const allowed = [
      'customer_name', 'customer_phone', 'customer_email',
      'address', 'postcode', 'service', 'assigned_to',
      'time_slot', 'estimated_duration', 'job_value',
      'repeat_interval', 'start_date', 'end_date',
      'notes', 'is_active'
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

    const { data, error } = await supabase
      .from('recurring_jobs')
      .update(filtered)
      .eq('id', id)
      .select();

    if (error) {
      console.error('[Recurring] Update error:', error);
      return res.status(500).json({ success: false, error: 'Failed to update recurring job' });
    }

    if (!data || data.length === 0) {
      return res.status(404).json({ success: false, error: 'Recurring job not found' });
    }

    console.log(`[Recurring] Updated pattern ${id}`);
    res.json({ success: true, data: data[0] });
  } catch (error) {
    console.error('[Recurring] Update error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

/**
 * POST /admin/recurring/:id/generate
 * Generate jobs from a recurring pattern for the next X weeks
 */
async function generateFromRecurring(req, res) {
  try {
    const { id } = req.params;
    const { weeks = 4 } = req.body;

    // Fetch the recurring pattern
    const { data: pattern, error: fetchError } = await supabase
      .from('recurring_jobs')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchError || !pattern) {
      return res.status(404).json({ success: false, error: 'Recurring job not found' });
    }

    if (!pattern.is_active) {
      return res.status(400).json({ success: false, error: 'Recurring job is paused' });
    }

    // Calculate interval in days
    const intervalDays = {
      weekly: 7,
      fortnightly: 14,
      '3_weeks': 21,
      '4_weeks': 28,
      '6_weeks': 42,
      '8_weeks': 56,
      monthly: 30
    };

    const days = intervalDays[pattern.repeat_interval] || 7;

    // Get existing jobs for this recurring pattern to avoid duplicates
    const { data: existingJobs } = await supabase
      .from('jobs')
      .select('scheduled_date')
      .eq('recurring_job_id', id);

    const existingDates = new Set((existingJobs || []).map(j => j.scheduled_date));

    // Generate jobs starting from start_date or today, whichever is later
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const startDate = new Date(pattern.start_date + 'T00:00:00');
    let current = startDate > today ? new Date(startDate) : new Date(today);

    // Align to the pattern's cycle from start_date
    if (current > startDate) {
      const daysSinceStart = Math.floor((current - startDate) / (1000 * 60 * 60 * 24));
      const remainder = daysSinceStart % days;
      if (remainder !== 0) {
        current.setDate(current.getDate() + (days - remainder));
      }
    }

    const endLimit = new Date(current);
    endLimit.setDate(endLimit.getDate() + (weeks * 7));

    // Respect end_date if set
    const patternEnd = pattern.end_date ? new Date(pattern.end_date + 'T00:00:00') : null;

    const jobsToCreate = [];

    while (current <= endLimit) {
      if (patternEnd && current > patternEnd) break;

      const dateStr = current.toISOString().split('T')[0];

      if (!existingDates.has(dateStr)) {
        jobsToCreate.push({
          recurring_job_id: id,
          customer_name: pattern.customer_name,
          customer_phone: pattern.customer_phone,
          customer_email: pattern.customer_email,
          address: pattern.address,
          postcode: pattern.postcode,
          service: pattern.service,
          assigned_to: pattern.assigned_to,
          scheduled_date: dateStr,
          time_slot: pattern.time_slot,
          estimated_duration: pattern.estimated_duration,
          job_value: pattern.job_value,
          notes: pattern.notes
        });
      }

      current.setDate(current.getDate() + days);
    }

    if (jobsToCreate.length === 0) {
      return res.json({ success: true, message: 'No new jobs to generate', created: 0 });
    }

    const { data, error } = await supabase
      .from('jobs')
      .insert(jobsToCreate)
      .select();

    if (error) {
      console.error('[Recurring] Generate error:', error);
      return res.status(500).json({ success: false, error: 'Failed to generate jobs' });
    }

    console.log(`[Recurring] Generated ${data.length} jobs from pattern ${id}`);
    res.json({ success: true, created: data.length, data });
  } catch (error) {
    console.error('[Recurring] Generate error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

// ========================
// TEAM MEMBERS
// ========================

/**
 * GET /admin/team
 * List team members
 */
async function listTeam(req, res) {
  try {
    const { data, error } = await supabase
      .from('team_members')
      .select('*')
      .order('name', { ascending: true });

    if (error) {
      console.error('[Team] List error:', error);
      return res.status(500).json({ success: false, error: 'Failed to fetch team members' });
    }

    res.json({ success: true, data });
  } catch (error) {
    console.error('[Team] List error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

/**
 * POST /admin/team
 * Add team member
 */
async function createTeamMember(req, res) {
  try {
    const { name, color } = req.body;

    if (!name) {
      return res.status(400).json({ success: false, error: 'Name is required' });
    }

    const { data, error } = await supabase
      .from('team_members')
      .insert([{
        name,
        color: color || '#a3e635'
      }])
      .select();

    if (error) {
      console.error('[Team] Create error:', error);
      return res.status(500).json({ success: false, error: 'Failed to create team member' });
    }

    console.log(`[Team] Added member: ${name}`);
    res.status(201).json({ success: true, data: data[0] });
  } catch (error) {
    console.error('[Team] Create error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

/**
 * PATCH /admin/team/:id
 * Update/deactivate team member
 */
async function updateTeamMember(req, res) {
  try {
    const { id } = req.params;
    const { name, color, is_active } = req.body;

    const updates = {};
    if (name !== undefined) updates.name = name;
    if (color !== undefined) updates.color = color;
    if (is_active !== undefined) updates.is_active = is_active;

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ success: false, error: 'No valid fields to update' });
    }

    const { data, error } = await supabase
      .from('team_members')
      .update(updates)
      .eq('id', id)
      .select();

    if (error) {
      console.error('[Team] Update error:', error);
      return res.status(500).json({ success: false, error: 'Failed to update team member' });
    }

    if (!data || data.length === 0) {
      return res.status(404).json({ success: false, error: 'Team member not found' });
    }

    console.log(`[Team] Updated member ${id}`);
    res.json({ success: true, data: data[0] });
  } catch (error) {
    console.error('[Team] Update error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

// ========================
// TEAM MEMBER SCHEDULE (Public - UUID acts as access key)
// ========================

/**
 * GET /api/my-schedule/:memberId
 * Get team member profile + their jobs for a date range
 */
async function getMySchedule(req, res) {
  try {
    const { memberId } = req.params;
    const { date, from_date, to_date } = req.query;

    // Verify team member exists
    const { data: member, error: memberError } = await supabase
      .from('team_members')
      .select('*')
      .eq('id', memberId)
      .single();

    if (memberError || !member) {
      return res.status(404).json({ success: false, error: 'Team member not found' });
    }

    // Build jobs query
    let query = supabase
      .from('jobs')
      .select('*')
      .eq('assigned_to', member.name)
      .order('scheduled_date', { ascending: true })
      .order('time_slot', { ascending: true });

    if (date) {
      query = query.eq('scheduled_date', date);
    } else if (from_date && to_date) {
      query = query.gte('scheduled_date', from_date).lte('scheduled_date', to_date);
    } else {
      // Default: today + next 7 days
      const today = new Date();
      const nextWeek = new Date(today);
      nextWeek.setDate(today.getDate() + 7);
      query = query.gte('scheduled_date', today.toISOString().split('T')[0])
                    .lte('scheduled_date', nextWeek.toISOString().split('T')[0]);
    }

    const { data: jobs, error: jobsError } = await query;

    if (jobsError) {
      console.error('[MySchedule] Query error:', jobsError);
      return res.status(500).json({ success: false, error: 'Failed to fetch schedule' });
    }

    res.json({
      success: true,
      member: { id: member.id, name: member.name, color: member.color },
      data: jobs
    });
  } catch (error) {
    console.error('[MySchedule] Error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

/**
 * PATCH /api/my-schedule/:memberId/jobs/:jobId
 * Team member updates their own job (limited fields: status, payment, notes)
 */
async function updateMyJob(req, res) {
  try {
    const { memberId, jobId } = req.params;
    const updates = req.body;

    // Verify team member exists
    const { data: member, error: memberError } = await supabase
      .from('team_members')
      .select('name')
      .eq('id', memberId)
      .single();

    if (memberError || !member) {
      return res.status(404).json({ success: false, error: 'Team member not found' });
    }

    // Verify the job is assigned to this team member
    const { data: job, error: jobError } = await supabase
      .from('jobs')
      .select('assigned_to')
      .eq('id', jobId)
      .single();

    if (jobError || !job) {
      return res.status(404).json({ success: false, error: 'Job not found' });
    }

    if (job.assigned_to !== member.name) {
      return res.status(403).json({ success: false, error: 'This job is not assigned to you' });
    }

    // Only allow limited fields for team members
    const allowed = ['status', 'payment_status', 'payment_method', 'amount_paid', 'notes'];
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
      .from('jobs')
      .update(filtered)
      .eq('id', jobId)
      .select();

    if (error) {
      console.error('[MySchedule] Update error:', error);
      return res.status(500).json({ success: false, error: 'Failed to update job' });
    }

    console.log(`[MySchedule] ${member.name} updated job ${jobId}:`, Object.keys(filtered).join(', '));

    // Refresh customer aggregates if status or payment changed
    if ((filtered.status || filtered.payment_status) && data[0].customer_id) {
      try {
        const customerRoutes = require('./customers');
        customerRoutes.refreshCustomerAggregates(data[0].customer_id);
      } catch (e) {
        console.error('[MySchedule] Customer aggregate refresh failed:', e.message);
      }
    }

    res.json({ success: true, data: data[0] });
  } catch (error) {
    console.error('[MySchedule] Update error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

/**
 * POST /admin/jobs/:id/notify-reschedule
 * Send reschedule notification to customer (opt-in, admin-triggered)
 */
async function notifyReschedule(req, res) {
  try {
    const { id } = req.params;
    const { scheduled_date, time_slot } = req.body;

    // Fetch the job
    const { data: job, error } = await supabase
      .from('jobs')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !job) {
      return res.status(404).json({ success: false, error: 'Job not found' });
    }

    // Format date nicely for the customer
    const dateObj = new Date((scheduled_date || job.scheduled_date) + 'T00:00:00');
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const dayNum = dateObj.getDate();
    const suffix = dayNum === 1 || dayNum === 21 || dayNum === 31 ? 'st' : dayNum === 2 || dayNum === 22 ? 'nd' : dayNum === 3 || dayNum === 23 ? 'rd' : 'th';
    const formattedDate = dayNames[dateObj.getDay()] + ' ' + dayNum + suffix + ' ' + monthNames[dateObj.getMonth()];
    const timeDisplay = time_slot || job.time_slot || '';

    const results = { email: null, whatsapp: null };

    // Send email notification
    try {
      const { sendRescheduleEmail } = require('../services/emailer');
      results.email = await sendRescheduleEmail(job, formattedDate, timeDisplay);
    } catch (e) {
      console.error('[Jobs] Reschedule email failed:', e.message);
      results.email = { success: false, error: e.message };
    }

    // Send WhatsApp notification
    try {
      const { sendRescheduleWhatsApp } = require('../services/whatsapp');
      results.whatsapp = await sendRescheduleWhatsApp(job, formattedDate, timeDisplay);
    } catch (e) {
      console.error('[Jobs] Reschedule WhatsApp failed:', e.message);
      results.whatsapp = { success: false, error: e.message };
    }

    console.log(`[Jobs] Reschedule notification sent for job ${id}: email=${results.email?.success}, whatsapp=${results.whatsapp?.success}`);

    res.json({
      success: true,
      results
    });

  } catch (error) {
    console.error('[Jobs] Notify reschedule error:', error);
    res.status(500).json({ success: false, error: 'Failed to send notification' });
  }
}

module.exports = {
  setSupabaseClient,
  listJobs,
  createJob,
  updateJob,
  deleteJob,
  getWeekJobs,
  listRecurring,
  createRecurring,
  updateRecurring,
  generateFromRecurring,
  listTeam,
  createTeamMember,
  updateTeamMember,
  getMySchedule,
  updateMyJob,
  notifyReschedule,
  getAvailability
};
