/**
 * Lead Scoring Engine
 *
 * Calculates lead quality scores and qualification status
 * based on multiple signals from the quote data.
 *
 * Loads scoring config from database (admin-editable) with file fallback.
 */

const { getPricingConfig } = require('./pricingConfig');

/**
 * Calculate lead score and qualification
 * @param {Object} quote - The quote object
 * @param {Object} estimate - The price estimate { min, max }
 * @returns {Promise<Object>} - { score, qualification, conversionLikelihood, reasons }
 */
async function calculateLeadScore(quote, estimate) {
  const { services, answers, remindersOk, preferredContact } = quote;

  // Load config from DB (or file defaults)
  const config = await getPricingConfig();
  const LEAD_SCORING = config.LEAD_SCORING;
  const QUALIFICATION_THRESHOLDS = config.QUALIFICATION_THRESHOLDS;
  const CONVERSION_FACTORS = config.CONVERSION_FACTORS;

  let score = LEAD_SCORING.baseScore;
  const reasons = [];

  // ==========================================
  // Financial Value Scoring
  // ==========================================
  if (estimate && estimate.max) {
    // Very high value jobs
    if (estimate.max >= LEAD_SCORING.veryHighValueThreshold) {
      score += LEAD_SCORING.veryHighValueBonus;
      reasons.push(`High-value job (£${estimate.max})`);
    }
    // High value jobs
    else if (estimate.max >= LEAD_SCORING.highValueThreshold) {
      score += LEAD_SCORING.highValueBonus;
      reasons.push(`Good-value job (£${estimate.max})`);
    }
  }

  // ==========================================
  // Service Quantity Scoring
  // ==========================================
  if (services && services.length > 0) {
    // Many services (3+)
    if (services.length >= 3) {
      score += LEAD_SCORING.manyServicesBonus;
      reasons.push(`Multiple services (${services.length})`);
    }
    // Multiple services (2)
    else if (services.length >= 2) {
      score += LEAD_SCORING.multipleServicesBonus;
      reasons.push(`Two services selected`);
    }
  }

  // ==========================================
  // Customer Intent Signals
  // ==========================================

  // Opted in to reminders (high engagement)
  if (remindersOk === true) {
    score += LEAD_SCORING.remindersOptIn;
    reasons.push('Opted in to reminders');
  }

  // Preferred contact method
  if (preferredContact) {
    const method = preferredContact.toLowerCase();
    if (method.includes('phone') || method.includes('call')) {
      score += LEAD_SCORING.phonePreferred;
      reasons.push('Prefers phone contact');
    } else if (method.includes('email')) {
      score += LEAD_SCORING.emailPreferred;
      reasons.push('Prefers email contact');
    }
  }

  // ==========================================
  // Property Type Signals
  // ==========================================
  if (answers && answers.propertyType) {
    const propertyType = answers.propertyType.toLowerCase();
    if (propertyType.includes('commercial') || propertyType.includes('business')) {
      score += LEAD_SCORING.commercialProperty;
      reasons.push('Commercial property');
    }
  }

  // ==========================================
  // Urgency Signals
  // ==========================================
  if (answers) {
    const specificDetails = (answers.specificDetails || '').toLowerCase();
    const accessNotes = (answers.accessNotes || '').toLowerCase();
    const combinedText = `${specificDetails} ${accessNotes}`;

    if (combinedText.includes('urgent') ||
        combinedText.includes('asap') ||
        combinedText.includes('as soon as') ||
        combinedText.includes('quickly') ||
        combinedText.includes('immediate')) {
      score += LEAD_SCORING.urgentLanguage;
      reasons.push('Urgent request');
    }
  }

  // ==========================================
  // Cap score at 100
  // ==========================================
  score = Math.min(score, 100);

  // ==========================================
  // Determine Qualification Status
  // ==========================================
  let qualification;
  let conversionLikelihood;

  if (score >= QUALIFICATION_THRESHOLDS.hot) {
    qualification = 'hot';
    conversionLikelihood = CONVERSION_FACTORS.hotLead;
  } else if (score >= QUALIFICATION_THRESHOLDS.warm) {
    qualification = 'warm';
    conversionLikelihood = CONVERSION_FACTORS.warmLead;
  } else if (score >= QUALIFICATION_THRESHOLDS.cold) {
    qualification = 'cold';
    conversionLikelihood = CONVERSION_FACTORS.coldLead;
  } else {
    qualification = 'unqualified';
    conversionLikelihood = CONVERSION_FACTORS.unqualified;
  }

  return {
    score: Math.round(score),
    qualification,
    conversionLikelihood,
    reasons
  };
}

/**
 * Determine if lead should trigger admin alert
 * @param {number} score - Lead score
 * @param {string} qualification - Qualification status
 * @returns {boolean} - True if should alert admin
 */
function shouldAlertAdmin(score, qualification) {
  // Alert for hot leads only (can adjust this logic)
  return qualification === 'hot' && score >= 85;
}

module.exports = {
  calculateLeadScore,
  shouldAlertAdmin
};
