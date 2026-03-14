/**
 * Follow-Up Scheduler
 *
 * Automated 2-step follow-up sequence for leads who haven't responded to estimates.
 * Step 1: 3 days after estimate sent — friendly check-in
 * Step 2: 7 days after estimate sent — final follow-up, then stop
 *
 * Runs hourly via node-cron. Only follows up on 'new' status quotes that
 * have been estimated but not accepted or manually handled.
 */

const cron = require('node-cron');
const { sendFollowUpEmail } = require('./emailer');
const log = require('./logger').child('FollowUp');

let supabase;

function setSupabaseClient(client) {
  supabase = client;
}

// ─── Follow-up message templates ────────────────────────────────────

const FOLLOW_UP_STEPS = [
  {
    step: 1,
    delayDays: 3,
    subject: 'Still interested? Your quote from Revive is waiting',
    body: (quote) =>
      `Hi ${quote.name},\n` +
      `\n` +
      `Just a quick note to check whether you've had a chance to look over the estimate we sent through for your ${formatServices(quote.services)}.\n` +
      `\n` +
      `Your estimated price range was £${Number(quote.estimated_value_min).toFixed(0)} – £${Number(quote.estimated_value_max).toFixed(0)}, and we'd love to get this booked in for you.\n` +
      `\n` +
      `If you have any questions at all, or if anything about the quote wasn't clear, just reply to this email or give us a ring. We're always happy to chat it through.\n` +
      `\n` +
      `No pressure at all — we just didn't want you to miss out.`
  },
  {
    step: 2,
    delayDays: 7,
    subject: 'One last check-in from Revive',
    body: (quote) =>
      `Hi ${quote.name},\n` +
      `\n` +
      `We sent your estimate through about a week ago and wanted to touch base one last time.\n` +
      `\n` +
      `Your ${formatServices(quote.services)} estimate was £${Number(quote.estimated_value_min).toFixed(0)} – £${Number(quote.estimated_value_max).toFixed(0)}.\n` +
      `\n` +
      `We completely understand if now isn't the right time — but if you'd still like to go ahead, we'd be happy to get you booked in at a time that suits.\n` +
      `\n` +
      `This will be our last follow-up, so if you'd like to revisit this in future, just drop us a line whenever you're ready.\n` +
      `\n` +
      `Wishing you all the best either way.`
  }
];

function formatServices(services) {
  if (!services || services.length === 0) return 'exterior cleaning';
  const names = {
    roof: 'roof cleaning',
    driveway: 'driveway cleaning',
    patio: 'patio cleaning',
    gutter: 'gutter cleaning',
    softwash: 'soft washing',
    render: 'render cleaning',
    decking: 'decking cleaning',
    fence: 'fence cleaning',
    conservatory: 'conservatory cleaning',
    solar: 'solar panel cleaning',
    cladding: 'cladding cleaning'
  };
  const formatted = services.map(s => names[s] || s);
  if (formatted.length === 1) return formatted[0];
  return formatted.slice(0, -1).join(', ') + ' and ' + formatted[formatted.length - 1];
}

// ─── Core logic ─────────────────────────────────────────────────────

/**
 * Find quotes that are due for a follow-up right now
 */
async function getQuotesDueForFollowUp() {
  const now = new Date().toISOString();

  const { data: quotes, error } = await supabase
    .from('quotes')
    .select('*')
    .eq('status', 'new')
    .not('estimated_at', 'is', null)
    .lt('follow_up_step', 2)
    .neq('qualification_status', 'unqualified')
    .lte('next_follow_up_at', now)
    .order('next_follow_up_at', { ascending: true })
    .limit(50);

  if (error) {
    log.error('Query error', { error: error.message });
    return [];
  }

  // Filter out accepted quotes (can't do complex OR in supabase-js easily)
  const eligible = (quotes || []).filter(q =>
    !q.customer_accepted_estimate
  );

  return eligible;
}

/**
 * Process a single quote's follow-up
 */
async function processOneFollowUp(quote) {
  const currentStep = quote.follow_up_step || 0;
  const nextStep = currentStep + 1;

  const template = FOLLOW_UP_STEPS.find(t => t.step === nextStep);
  if (!template) return;

  // Belt-and-braces timing check
  const estimatedAt = new Date(quote.estimated_at);
  const daysSinceEstimate = (Date.now() - estimatedAt.getTime()) / (1000 * 60 * 60 * 24);
  if (daysSinceEstimate < template.delayDays) {
    log.debug('Not yet due', { quoteId: quote.id, days: daysSinceEstimate.toFixed(1), required: template.delayDays });
    return;
  }

  log.info(`Sending step ${nextStep}`, { name: quote.name, email: quote.email, quoteId: quote.id });

  // Send email
  const emailResult = await sendFollowUpEmail(
    { email: quote.email, name: quote.name },
    template.subject,
    template.body(quote)
  );

  if (!emailResult.success) {
    log.error('Email failed', { quoteId: quote.id, error: emailResult.error });
    return; // Don't advance step — will retry next hour
  }

  // WhatsApp follow-up
  if (quote.phone) {
    try {
      const { sendFollowUpWhatsApp } = require('./whatsapp');
      await sendFollowUpWhatsApp(quote, nextStep);
    } catch (err) {
      log.warn('WhatsApp follow-up failed', { quoteId: quote.id, error: err.message });
    }
  }

  // Update database
  const now = new Date().toISOString();
  const updateData = {
    follow_up_step: nextStep,
    last_contact_at: now
  };

  if (nextStep < 2) {
    // Schedule next follow-up
    const nextTemplate = FOLLOW_UP_STEPS.find(t => t.step === nextStep + 1);
    if (nextTemplate) {
      const nextDate = new Date(quote.estimated_at);
      nextDate.setDate(nextDate.getDate() + nextTemplate.delayDays);
      updateData.next_follow_up_at = nextDate.toISOString();
    }
  } else {
    // Sequence complete
    updateData.next_follow_up_at = null;
  }

  const { error } = await supabase
    .from('quotes')
    .update(updateData)
    .eq('id', quote.id);

  if (error) {
    log.error('DB update failed', { quoteId: quote.id, error: error.message });
  } else {
    log.info(`Step ${nextStep} complete`, { name: quote.name, quoteId: quote.id });
  }
}

/**
 * Main follow-up run — called by cron every hour
 */
async function processFollowUps() {
  log.info('Running follow-up check');

  const quotes = await getQuotesDueForFollowUp();

  if (quotes.length === 0) {
    log.info('No quotes due for follow-up');
    return;
  }

  log.info(`Found ${quotes.length} quote(s) due for follow-up`);

  for (const quote of quotes) {
    try {
      await processOneFollowUp(quote);
    } catch (err) {
      log.error('Error processing quote', { quoteId: quote.id, error: err.message });
    }
  }

  log.info('Follow-up run complete');
}

// ─── Scheduler ──────────────────────────────────────────────────────

function startScheduler() {
  // Run every hour at minute 0
  cron.schedule('0 * * * *', () => {
    processFollowUps().catch(err => {
      log.error('Unhandled error in follow-up run', { error: err.message });
    });
  });

  log.info('Scheduler started — running every hour');
}

module.exports = {
  setSupabaseClient,
  startScheduler,
  processFollowUps
};
