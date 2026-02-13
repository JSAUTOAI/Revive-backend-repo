/**
 * Estimation Job Runner
 *
 * Handles async processing of quote estimation and lead scoring.
 * Currently uses simple setTimeout (Phase 3).
 * Can be upgraded to Bull/BullMQ queue system later (Phase 6+).
 */

const { calculateEstimate, ESTIMATION_VERSION } = require('./estimator');
const { calculateLeadScore, shouldAlertAdmin } = require('./scorer');
const { sendEstimateEmail, sendAdminAlert } = require('./emailer');

/**
 * Process estimation for a quote
 * @param {Object} supabase - Supabase client
 * @param {string} quoteId - Quote UUID
 * @param {Object} quote - Quote data from database
 */
async function processEstimation(supabase, quoteId, quote) {
  try {
    console.log(`[Estimation Job] Starting for quote ${quoteId}`);

    // Step 1: Calculate price estimate
    const estimate = calculateEstimate(quote);

    console.log(`[Estimation Job] Estimate calculated: £${estimate.min}-£${estimate.max} (${estimate.confidence} confidence)`);

    // Step 2: Calculate lead score
    const scoring = calculateLeadScore(quote, estimate);

    console.log(`[Estimation Job] Lead score: ${scoring.score}/100 (${scoring.qualification})`);
    if (scoring.reasons.length > 0) {
      console.log(`[Estimation Job] Scoring reasons: ${scoring.reasons.join(', ')}`);
    }

    // Step 3: Update database with results
    const { data: updatedQuote, error } = await supabase
      .from('quotes')
      .update({
        estimated_value_min: estimate.min,
        estimated_value_max: estimate.max,
        estimation_engine_version: estimate.version,
        estimated_at: new Date().toISOString(),
        lead_score: scoring.score,
        qualification_status: scoring.qualification,
        conversion_likelihood: scoring.conversionLikelihood
      })
      .eq('id', quoteId)
      .select()
      .single();

    if (error) {
      console.error(`[Estimation Job] Database update failed:`, error);
      throw error;
    }

    console.log(`[Estimation Job] ✅ Complete for quote ${quoteId}`);

    // Step 4: Send estimate email to customer (non-blocking)
    sendEstimateEmail(updatedQuote).catch(err => {
      console.error(`[Estimation Job] Failed to send estimate email:`, err);
    });

    // Step 5: Check if should alert admin
    if (shouldAlertAdmin(scoring.score, scoring.qualification)) {
      console.log(`[Estimation Job] 🔥 HOT LEAD DETECTED - Score: ${scoring.score}, Qualification: ${scoring.qualification}`);

      // Send admin alert email (non-blocking)
      sendAdminAlert(updatedQuote).catch(err => {
        console.error(`[Estimation Job] Failed to send admin alert:`, err);
      });
    }

    return {
      success: true,
      estimate,
      scoring
    };

  } catch (error) {
    console.error(`[Estimation Job] Error processing quote ${quoteId}:`, error);
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

  console.log(`[Estimation Job] Queued for quote ${quoteId}`);
}

module.exports = {
  processEstimation,
  queueEstimation
};
