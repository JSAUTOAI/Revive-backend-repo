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
const { sendEstimateWhatsApp, sendAdminAlertWhatsApp } = require('./whatsapp');
const { updateQuoteInSheets } = require('./googleSheets');

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

    // Update Google Sheets with estimation results (non-blocking)
    updateQuoteInSheets(quoteId, {
      estimated_value_min: estimate.min,
      estimated_value_max: estimate.max,
      lead_score: scoring.score,
      qualification_status: scoring.qualification
    }).catch(err => {
      console.error(`[Estimation Job] Failed to update Google Sheets:`, err);
      // Continue even if Sheets update fails
    });

    // Step 4: Send estimate via both WhatsApp and email, record timestamps
    const timestampUpdates = {};

    try {
      const waResult = await sendEstimateWhatsApp(updatedQuote);
      if (waResult.success) {
        timestampUpdates.whatsapp_sent_at = new Date().toISOString();
        console.log(`[Estimation Job] WhatsApp estimate sent, timestamp recorded`);
      }
    } catch (err) {
      console.error(`[Estimation Job] Failed to send estimate WhatsApp:`, err);
    }

    try {
      const emailResult = await sendEstimateEmail(updatedQuote);
      if (emailResult.success) {
        timestampUpdates.estimate_email_sent_at = new Date().toISOString();
        console.log(`[Estimation Job] Estimate email sent, timestamp recorded`);
      }
    } catch (err) {
      console.error(`[Estimation Job] Failed to send estimate email:`, err);
    }

    if (Object.keys(timestampUpdates).length > 0) {
      await supabase.from('quotes').update(timestampUpdates).eq('id', quoteId);
    }

    // Step 5: Check if should alert admin
    if (shouldAlertAdmin(scoring.score, scoring.qualification)) {
      console.log(`[Estimation Job] 🔥 HOT LEAD DETECTED - Score: ${scoring.score}, Qualification: ${scoring.qualification}`);

      // Send admin alert via email
      sendAdminAlert(updatedQuote).catch(err => {
        console.error(`[Estimation Job] Failed to send admin alert email:`, err);
      });

      // Also send admin alert via WhatsApp if ADMIN_PHONE is set
      if (process.env.ADMIN_PHONE) {
        sendAdminAlertWhatsApp(updatedQuote).catch(err => {
          console.error(`[Estimation Job] Failed to send admin alert WhatsApp:`, err);
        });
      }
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
