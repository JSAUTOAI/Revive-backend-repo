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

// ─── Pipeline-aware follow-up templates ─────────────────────────────

const PIPELINE_FOLLOW_UPS = {
  photos_requested: {
    step1: {
      delayDays: 2,
      subject: 'Quick reminder — we still need your photos!',
      body: (quote) => {
        const BASE_URL = process.env.BASE_URL || 'https://revive-backend-repo-production.up.railway.app';
        return `Hi ${quote.name},\n` +
          `\n` +
          `Just a quick reminder that we're waiting on a few photos to give you a fixed price for your ${formatServices(quote.services)}.\n` +
          `\n` +
          `Your estimated range is £${Number(quote.estimated_value_min).toFixed(0)} – £${Number(quote.estimated_value_max).toFixed(0)}, and once we see the photos we can lock in a final number for you.\n` +
          `\n` +
          `You can upload them here: ${BASE_URL}/upload-photos/${quote.id}\n` +
          `\n` +
          `It only takes a minute — just snap a few pics of the area and upload them. We'll get your price sent through straight away.`;
      }
    },
    step2: {
      delayDays: 5,
      subject: 'Last chance for your fixed price from Revive',
      body: (quote) => {
        const BASE_URL = process.env.BASE_URL || 'https://revive-backend-repo-production.up.railway.app';
        return `Hi ${quote.name},\n` +
          `\n` +
          `We sent through your estimated range of £${Number(quote.estimated_value_min).toFixed(0)} – £${Number(quote.estimated_value_max).toFixed(0)} for ${formatServices(quote.services)} and we'd love to get you a fixed price.\n` +
          `\n` +
          `If you can upload a few photos, we'll get that final figure to you right away: ${BASE_URL}/upload-photos/${quote.id}\n` +
          `\n` +
          `This will be our last reminder — but if you'd like to come back to this later, the link will still work. All the best!`;
      }
    }
  },
  final_price_sent: {
    step1: {
      delayDays: 3,
      subject: 'Have you seen your fixed price from Revive?',
      body: (quote) => {
        const BASE_URL = process.env.BASE_URL || 'https://revive-backend-repo-production.up.railway.app';
        return `Hi ${quote.name},\n` +
          `\n` +
          `Just checking in — we sent your fixed price of £${Number(quote.final_price).toFixed(0)} for ${formatServices(quote.services)} a few days ago.\n` +
          `\n` +
          `If you're happy with it, you can accept and book a slot that suits you here: ${BASE_URL}/final-price/${quote.id}\n` +
          `\n` +
          `Any questions at all? Just reply to this email and we'll be happy to chat it through.`;
      }
    },
    step2: {
      delayDays: 7,
      subject: 'One last check-in about your Revive quote',
      body: (quote) => {
        const BASE_URL = process.env.BASE_URL || 'https://revive-backend-repo-production.up.railway.app';
        return `Hi ${quote.name},\n` +
          `\n` +
          `Your fixed price of £${Number(quote.final_price).toFixed(0)} for ${formatServices(quote.services)} is still waiting for you.\n` +
          `\n` +
          `Accept and book here: ${BASE_URL}/final-price/${quote.id}\n` +
          `\n` +
          `This will be our last follow-up. If you'd like to revisit this in future, the link will still work whenever you're ready.\n` +
          `\n` +
          `All the best!`;
      }
    }
  },
  booking_offered: {
    step1: {
      delayDays: 2,
      subject: 'You haven\'t picked a slot yet — book now!',
      body: (quote) => {
        const BASE_URL = process.env.BASE_URL || 'https://revive-backend-repo-production.up.railway.app';
        return `Hi ${quote.name},\n` +
          `\n` +
          `Great news — you've accepted your price of £${Number(quote.final_price).toFixed(0)} for ${formatServices(quote.services)}!\n` +
          `\n` +
          `You just need to pick a date and time that works for you: ${BASE_URL}/book/${quote.id}\n` +
          `\n` +
          `It only takes a moment — choose a slot and you're done. We'll confirm everything straight away.`;
      }
    },
    step2: {
      delayDays: 5,
      subject: 'Last reminder — book your Revive appointment',
      body: (quote) => {
        const BASE_URL = process.env.BASE_URL || 'https://revive-backend-repo-production.up.railway.app';
        return `Hi ${quote.name},\n` +
          `\n` +
          `Just a final reminder to book your ${formatServices(quote.services)} appointment at £${Number(quote.final_price).toFixed(0)}.\n` +
          `\n` +
          `Choose your slot here: ${BASE_URL}/book/${quote.id}\n` +
          `\n` +
          `This will be our last reminder, but the link will stay active whenever you're ready. All the best!`;
      }
    }
  }
};

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
 * Includes both legacy flow quotes and pipeline-tracked quotes
 */
async function getQuotesDueForFollowUp() {
  const now = new Date().toISOString();

  const { data: quotes, error } = await supabase
    .from('quotes')
    .select('*')
    .in('status', ['new', 'quoted'])
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

  // Filter out fully completed pipeline quotes and accepted estimates
  const eligible = (quotes || []).filter(q => {
    // Skip if customer accepted estimate (legacy flow) and no pipeline
    if (q.customer_accepted_estimate && !q.pipeline_stage) return false;
    // Skip if already booked or completed in pipeline
    if (q.pipeline_stage === 'booked') return false;
    // Skip if customer accepted final price but already booked
    if (q.booked_job_id) return false;
    return true;
  });

  return eligible;
}

/**
 * Process a single quote's follow-up
 * Pipeline-aware: uses different templates based on pipeline_stage
 */
async function processOneFollowUp(quote) {
  const currentStep = quote.follow_up_step || 0;
  const nextStep = currentStep + 1;

  // Determine which template to use based on pipeline stage
  const pipelineStage = quote.pipeline_stage;
  let subject, body;

  if (pipelineStage && PIPELINE_FOLLOW_UPS[pipelineStage]) {
    // Pipeline flow — use stage-specific templates
    const stageTemplates = PIPELINE_FOLLOW_UPS[pipelineStage];
    const templateKey = nextStep === 1 ? 'step1' : 'step2';
    const template = stageTemplates[templateKey];

    if (!template) return;

    subject = template.subject;
    body = template.body(quote);

    log.info(`Sending pipeline follow-up step ${nextStep} (${pipelineStage})`, {
      name: quote.name, quoteId: quote.id
    });
  } else {
    // Legacy flow — use original estimate follow-up templates
    const template = FOLLOW_UP_STEPS.find(t => t.step === nextStep);
    if (!template) return;

    // Belt-and-braces timing check
    const estimatedAt = new Date(quote.estimated_at);
    const daysSinceEstimate = (Date.now() - estimatedAt.getTime()) / (1000 * 60 * 60 * 24);
    if (daysSinceEstimate < template.delayDays) {
      log.debug('Not yet due', { quoteId: quote.id, days: daysSinceEstimate.toFixed(1), required: template.delayDays });
      return;
    }

    subject = template.subject;
    body = template.body(quote);

    log.info(`Sending legacy follow-up step ${nextStep}`, {
      name: quote.name, email: quote.email, quoteId: quote.id
    });
  }

  // Send email
  const emailResult = await sendFollowUpEmail(
    { email: quote.email, name: quote.name },
    subject,
    body
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
    // Schedule next follow-up based on pipeline stage delay or legacy delay
    let nextDelayDays;
    if (pipelineStage && PIPELINE_FOLLOW_UPS[pipelineStage]) {
      const step2 = PIPELINE_FOLLOW_UPS[pipelineStage].step2;
      nextDelayDays = step2 ? step2.delayDays : 5;
    } else {
      const nextTemplate = FOLLOW_UP_STEPS.find(t => t.step === nextStep + 1);
      nextDelayDays = nextTemplate ? nextTemplate.delayDays : 7;
    }
    const baseDate = quote.estimated_at ? new Date(quote.estimated_at) : new Date();
    const nextDate = new Date(baseDate);
    nextDate.setDate(nextDate.getDate() + nextDelayDays);
    updateData.next_follow_up_at = nextDate.toISOString();
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
    log.info(`Step ${nextStep} complete`, { name: quote.name, quoteId: quote.id, stage: pipelineStage || 'legacy' });
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
