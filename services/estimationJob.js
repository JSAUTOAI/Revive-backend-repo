/**
 * Estimation Job Runner
 *
 * Handles async processing of quote estimation and lead scoring.
 * Currently uses simple setTimeout (Phase 3).
 * Can be upgraded to Bull/BullMQ queue system later (Phase 6+).
 */

const { calculateEstimate, enhanceEstimateWithAI, ESTIMATION_VERSION } = require('./estimator');
const { calculateLeadScore, shouldAlertAdmin } = require('./scorer');
const { sendEstimateEmail, sendAdminAlert } = require('./emailer');
const { sendEstimateWhatsApp, sendAdminAlertWhatsApp } = require('./whatsapp');
const { updateQuoteInSheets } = require('./googleSheets');
const log = require('./logger').child('Estimation');

/**
 * Process estimation for a quote
 * @param {Object} supabase - Supabase client
 * @param {string} quoteId - Quote UUID
 * @param {Object} quote - Quote data from database
 */
async function processEstimation(supabase, quoteId, quote) {
  try {
    log.info('Starting estimation', { quoteId });

    // Step 1: Calculate price estimate (async - loads config from DB)
    const estimate = await calculateEstimate(quote);

    log.info('Estimate calculated', { quoteId, min: estimate.min, max: estimate.max, confidence: estimate.confidence });

    // Step 1b: AI Enhancement (refines estimate using free-text analysis)
    const aiResult = await enhanceEstimateWithAI(quote, estimate);
    if (aiResult.aiUsed) {
      estimate.min = aiResult.adjustedMin;
      estimate.max = aiResult.adjustedMax;
      estimate.confidence = aiResult.confidence;
      estimate.aiFlags = aiResult.aiFlags;
      estimate.aiNotes = aiResult.aiNotes;
      log.info('AI-enhanced estimate', { quoteId, min: estimate.min, max: estimate.max, flags: aiResult.aiFlags });
    }

    // Step 2: Calculate lead score (async - loads config from DB)
    const scoring = await calculateLeadScore(quote, estimate);

    log.info('Lead scored', { quoteId, score: scoring.score, qualification: scoring.qualification });
    if (scoring.reasons.length > 0) {
      log.debug('Scoring reasons', { quoteId, reasons: scoring.reasons });
    }

    // Step 3: Update database with results
    const { data: updatedQuote, error } = await supabase
      .from('quotes')
      .update({
        estimated_value_min: estimate.min,
        estimated_value_max: estimate.max,
        estimation_engine_version: estimate.version + (estimate.aiFlags ? '+ai' : ''),
        estimated_at: new Date().toISOString(),
        lead_score: scoring.score,
        qualification_status: scoring.qualification,
        conversion_likelihood: scoring.conversionLikelihood
      })
      .eq('id', quoteId)
      .select()
      .single();

    if (error) {
      log.error('Database update failed', { quoteId, error: error.message });
      throw error;
    }

    log.info('Estimation complete', { quoteId });

    // Update Google Sheets with estimation results (non-blocking)
    updateQuoteInSheets(quoteId, {
      estimated_value_min: estimate.min,
      estimated_value_max: estimate.max,
      lead_score: scoring.score,
      qualification_status: scoring.qualification
    }).catch(err => {
      log.error('Google Sheets update failed', { quoteId, error: err.message });
    });

    // Step 4: Send estimate via both WhatsApp and email, record timestamps
    const timestampUpdates = {};

    try {
      const waResult = await sendEstimateWhatsApp(updatedQuote);
      if (waResult.success) {
        timestampUpdates.whatsapp_sent_at = new Date().toISOString();
        log.info('WhatsApp estimate sent', { quoteId });
      }
    } catch (err) {
      log.error('WhatsApp estimate failed', { quoteId, error: err.message });
    }

    try {
      const emailResult = await sendEstimateEmail(updatedQuote);
      if (emailResult.success) {
        timestampUpdates.estimate_email_sent_at = new Date().toISOString();
        log.info('Estimate email sent', { quoteId });
      }
    } catch (err) {
      log.error('Estimate email failed', { quoteId, error: err.message });
    }

    // Set initial follow-up date: 3 days after estimate sent
    timestampUpdates.next_follow_up_at = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();

    if (Object.keys(timestampUpdates).length > 0) {
      await supabase.from('quotes').update(timestampUpdates).eq('id', quoteId);
    }

    // Step 5: Check if should alert admin
    if (shouldAlertAdmin(scoring.score, scoring.qualification)) {
      log.info('Hot lead detected', { quoteId, score: scoring.score, qualification: scoring.qualification });

      // Send admin alert via email
      sendAdminAlert(updatedQuote).catch(err => {
        log.error('Admin alert email failed', { quoteId, error: err.message });
      });

      // Also send admin alert via WhatsApp if ADMIN_PHONE is set
      if (process.env.ADMIN_PHONE) {
        sendAdminAlertWhatsApp(updatedQuote).catch(err => {
          log.error('Admin alert WhatsApp failed', { quoteId, error: err.message });
        });
      }
    }

    return {
      success: true,
      estimate,
      scoring
    };

  } catch (error) {
    log.error('Estimation failed', { quoteId, error: error.message, stack: error.stack });
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Queue estimation job (async, non-blocking)
 * Uses setTimeout for now, can be replaced with proper queue later
 * @param {Object} supabase - Supabase client
 * @param {string} quoteId - Quote UUID
 * @param {Object} quote - Quote data
 */
function queueEstimation(supabase, quoteId, quote) {
  // Process after a short delay (allows response to return to customer first)
  setTimeout(() => {
    processEstimation(supabase, quoteId, quote);
  }, 1000); // 1 second delay

  log.info('Estimation queued', { quoteId });
}

/**
 * Retry any quotes that were submitted but never estimated
 * (e.g. if server restarted mid-estimation)
 * Runs once on server startup.
 * @param {Object} supabaseClient - Supabase client
 */
async function retryMissedEstimations(supabaseClient) {
  const retryLog = require('./logger').child('EstimationRetry');
  try {
    // Find quotes created in the last 7 days that have no estimate
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const { data: missedQuotes, error } = await supabaseClient
      .from('quotes')
      .select('*')
      .is('estimated_at', null)
      .is('deleted_at', null)
      .gte('created_at', sevenDaysAgo)
      .order('created_at', { ascending: true });

    if (error) {
      retryLog.error('Failed to query missed quotes', { error: error.message });
      return;
    }

    if (!missedQuotes || missedQuotes.length === 0) {
      retryLog.info('No missed estimations found');
      return;
    }

    retryLog.info(`Found ${missedQuotes.length} quote(s) without estimates — processing`);

    for (const quote of missedQuotes) {
      retryLog.info('Processing missed quote', { quoteId: quote.id, submitted: quote.created_at });
      await processEstimation(supabaseClient, quote.id, quote);
      // Small delay between retries to avoid hammering external services
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    retryLog.info('All missed estimations processed');
  } catch (error) {
    retryLog.error('Retry failed', { error: error.message });
  }
}

module.exports = {
  processEstimation,
  queueEstimation,
  retryMissedEstimations
};
