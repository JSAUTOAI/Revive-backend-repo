/**
 * Estimation Engine
 *
 * Calculates price estimates for quote requests based on services,
 * property details, and other factors from the form submission.
 *
 * Loads pricing config from database (admin-editable) with file fallback.
 */

const { getPricingConfig } = require('./pricingConfig');
const log = require('./logger').child('Estimator');

const ESTIMATION_VERSION = 'v1.2';

/**
 * Calculate price estimate for a quote
 * @param {Object} quote - The quote object from the database
 * @returns {Promise<Object>} - { min, max, version, confidence }
 */
async function calculateEstimate(quote) {
  const { services, answers } = quote;

  // If no services, return null (can't estimate)
  if (!services || services.length === 0) {
    return {
      min: null,
      max: null,
      version: ESTIMATION_VERSION,
      confidence: 'none'
    };
  }

  // Load config from DB (or file defaults)
  const config = await getPricingConfig();
  const SERVICE_PRICING = config.SERVICE_PRICING;
  const MULTI_SERVICE_DISCOUNT = config.MULTI_SERVICE_DISCOUNT;

  let totalMin = 0;
  let totalMax = 0;
  let confidence = 'medium'; // Start with medium confidence

  // Calculate base price for each service
  services.forEach(service => {
    const pricing = SERVICE_PRICING[service];

    if (!pricing) {
      // Unknown service, use generic pricing
      totalMin += 100;
      totalMax += 300;
      confidence = 'low'; // Lower confidence if unknown service
      return;
    }

    // Determine size from answers (if available)
    const size = determineSize(service, answers);
    const [min, max] = pricing[size] || pricing.default;

    totalMin += min;
    totalMax += max;
  });

  // Apply modifiers based on answers
  const modifiers = calculateModifiers(quote, config.MODIFIERS);

  totalMin *= modifiers.multiplier;
  totalMax *= modifiers.multiplier;

  // Apply multi-service discount if applicable
  if (services.length >= MULTI_SERVICE_DISCOUNT.threshold) {
    totalMin *= MULTI_SERVICE_DISCOUNT.discount;
    totalMax *= MULTI_SERVICE_DISCOUNT.discount;
    confidence = 'high'; // Higher confidence with multiple services (more data)
  }

  // Round to nearest £5
  totalMin = Math.round(totalMin / 5) * 5;
  totalMax = Math.round(totalMax / 5) * 5;

  // Adjust confidence based on data completeness
  if (!answers || Object.keys(answers).length < 5) {
    confidence = 'low'; // Not enough data to be confident
  }

  return {
    min: totalMin,
    max: totalMax,
    version: ESTIMATION_VERSION,
    confidence
  };
}

/**
 * Calculate estimate with specific config (for test preview)
 * @param {Object} mockQuote - Mock quote data
 * @param {Object} config - Pricing config to use
 * @returns {Object} - { min, max, confidence, modifierReasons }
 */
function calculateTestEstimate(mockQuote, config) {
  const { services, size, modifiers: activeModifiers } = mockQuote;
  const SERVICE_PRICING = config.SERVICE_PRICING;
  const MODIFIERS = config.MODIFIERS;
  const MULTI_SERVICE_DISCOUNT = config.MULTI_SERVICE_DISCOUNT;

  let totalMin = 0;
  let totalMax = 0;

  (services || []).forEach(service => {
    const pricing = SERVICE_PRICING[service];
    if (!pricing) return;
    const sizeKey = size || 'medium';
    const [min, max] = pricing[sizeKey] || pricing.default;
    totalMin += min;
    totalMax += max;
  });

  // Apply selected modifiers
  let multiplier = 1.0;
  const reasons = [];
  if (activeModifiers) {
    if (activeModifiers.firstTimeCleaning) { multiplier *= MODIFIERS.firstTimeCleaning; reasons.push('First time cleaning'); }
    if (activeModifiers.heavilySoiled) { multiplier *= MODIFIERS.heavilySoiled; reasons.push('Heavily soiled'); }
    if (activeModifiers.difficultAccess) { multiplier *= MODIFIERS.difficultAccess; reasons.push('Difficult access'); }
    if (activeModifiers.heightWork) { multiplier *= MODIFIERS.heightWork; reasons.push('Height work'); }
    if (activeModifiers.urgent) { multiplier *= MODIFIERS.urgent; reasons.push('Urgent'); }
  }

  totalMin *= multiplier;
  totalMax *= multiplier;

  // Multi-service discount
  if ((services || []).length >= MULTI_SERVICE_DISCOUNT.threshold) {
    totalMin *= MULTI_SERVICE_DISCOUNT.discount;
    totalMax *= MULTI_SERVICE_DISCOUNT.discount;
    reasons.push(`Multi-service discount (${Math.round((1 - MULTI_SERVICE_DISCOUNT.discount) * 100)}% off)`);
  }

  totalMin = Math.round(totalMin / 5) * 5;
  totalMax = Math.round(totalMax / 5) * 5;

  return { min: totalMin, max: totalMax, modifierReasons: reasons };
}

/**
 * Determine size category from answers
 * @param {string} service - Service type
 * @param {Object} answers - Form answers
 * @returns {string} - 'small', 'medium', or 'large'
 */
function determineSize(service, answers) {
  if (!answers) return 'medium'; // Default if no answers

  // Check for explicit size field
  const roughSize = answers.roughSize?.toLowerCase();
  if (roughSize) {
    if (roughSize.includes('small') || roughSize.includes('compact')) return 'small';
    if (roughSize.includes('large') || roughSize.includes('big')) return 'large';
    return 'medium';
  }

  // Infer size from property type
  const propertyType = answers.propertyType?.toLowerCase();
  if (propertyType) {
    // Commercial = large
    if (propertyType.includes('commercial') || propertyType.includes('business')) {
      return 'large';
    }

    // Bungalow/Flat = small to medium
    if (propertyType.includes('bungalow') || propertyType.includes('flat') || propertyType.includes('apartment')) {
      return 'small';
    }

    // Detached = medium to large
    if (propertyType.includes('detached')) {
      return 'large';
    }

    // Semi/Terraced = medium
    if (propertyType.includes('semi') || propertyType.includes('terrace')) {
      return 'medium';
    }
  }

  // Default to medium if can't determine
  return 'medium';
}

/**
 * Calculate pricing modifiers based on quote details
 * @param {Object} quote - The quote object
 * @param {Object} MODIFIERS - Modifier multipliers from config
 * @returns {Object} - { multiplier, reasons }
 */
function calculateModifiers(quote, MODIFIERS) {
  const { answers } = quote;
  let multiplier = 1.0;
  const reasons = [];

  if (!answers) {
    return { multiplier, reasons };
  }

  // First time cleaning modifier
  const lastCleaned = answers.lastCleaned?.toLowerCase();
  if (lastCleaned && (lastCleaned.includes('never') || lastCleaned.includes('years'))) {
    multiplier *= MODIFIERS.firstTimeCleaning;
    reasons.push('First time cleaning');
  }

  // Heavily soiled modifier (check specific details)
  const specificDetails = answers.specificDetails?.toLowerCase() || '';
  if (specificDetails.includes('very dirty') ||
      specificDetails.includes('heavily soiled') ||
      specificDetails.includes('moss') ||
      specificDetails.includes('algae') ||
      specificDetails.includes('stained')) {
    multiplier *= MODIFIERS.heavilySoiled;
    reasons.push('Heavily soiled');
  }

  // Access difficulty modifier
  const accessNotes = answers.accessNotes?.toLowerCase() || '';
  if (accessNotes.includes('difficult') ||
      accessNotes.includes('narrow') ||
      accessNotes.includes('limited access') ||
      accessNotes.includes('hard to reach')) {
    multiplier *= MODIFIERS.difficultAccess;
    reasons.push('Difficult access');
  }

  // Height work modifier
  if (accessNotes.includes('high') ||
      accessNotes.includes('tall') ||
      accessNotes.includes('two stor') ||
      accessNotes.includes('three stor') ||
      specificDetails.includes('high')) {
    multiplier *= MODIFIERS.heightWork;
    reasons.push('Height work required');
  }

  // Urgency modifier
  if (specificDetails.includes('urgent') ||
      specificDetails.includes('asap') ||
      specificDetails.includes('as soon as') ||
      specificDetails.includes('quickly')) {
    multiplier *= MODIFIERS.urgent;
    reasons.push('Urgent request');
  }

  return { multiplier, reasons };
}

/**
 * AI Enhancement Layer
 *
 * Analyses free-text fields (specificDetails, accessNotes) using Claude
 * to detect complexity factors that keyword matching misses.
 *
 * Returns adjustment factors and flags — does NOT replace the rule-based estimate,
 * only refines the confidence and may adjust the range.
 *
 * @param {Object} quote - Quote with answers
 * @param {Object} estimate - Rule-based estimate { min, max, confidence }
 * @returns {Promise<Object>} - { adjustedMin, adjustedMax, confidence, aiFlags, aiNotes }
 */
async function enhanceEstimateWithAI(quote, estimate) {
  const answers = quote.answers || {};
  const specificDetails = answers.specificDetails || '';
  const accessNotes = answers.accessNotes || '';

  // Only run AI if there's meaningful free text to analyse
  if (specificDetails.length < 15 && accessNotes.length < 15) {
    return {
      adjustedMin: estimate.min,
      adjustedMax: estimate.max,
      confidence: estimate.confidence,
      aiFlags: [],
      aiNotes: null,
      aiUsed: false
    };
  }

  try {
    const Anthropic = require('@anthropic-ai/sdk');
    const client = new Anthropic();

    const services = (quote.services || []).join(', ');
    const propertyType = answers.propertyType || 'unknown';
    const roughSize = answers.roughSize || 'unknown';

    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      messages: [{
        role: 'user',
        content: `You are a pricing analyst for an exterior cleaning company. Analyse this quote request and return a JSON object.

Services requested: ${services}
Property type: ${propertyType}
Size: ${roughSize}
Customer notes: "${specificDetails}"
Access notes: "${accessNotes}"
Rule-based estimate: £${estimate.min} – £${estimate.max}

Return ONLY valid JSON with these fields:
{
  "priceAdjustment": number between -0.15 and 0.25 (negative = reduce, positive = increase, 0 = no change),
  "confidence": "low" or "medium" or "high",
  "flags": ["array of short complexity flags detected, e.g. 'steep roof pitch', 'conservation area', 'large moss buildup'"],
  "note": "one sentence summary of key factors affecting price"
}

Be conservative. Only adjust price if the text clearly indicates factors not captured by standard size/service pricing.`
      }]
    });

    const text = response.content[0]?.text || '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      log.warn('AI returned non-JSON response', { quoteId: quote.id });
      return { adjustedMin: estimate.min, adjustedMax: estimate.max, confidence: estimate.confidence, aiFlags: [], aiNotes: null, aiUsed: false };
    }

    const ai = JSON.parse(jsonMatch[0]);
    const adj = Math.max(-0.15, Math.min(0.25, ai.priceAdjustment || 0));

    const adjustedMin = Math.round((estimate.min * (1 + adj)) / 5) * 5;
    const adjustedMax = Math.round((estimate.max * (1 + adj)) / 5) * 5;

    log.info('AI enhancement applied', {
      quoteId: quote.id,
      adjustment: (adj * 100).toFixed(0) + '%',
      flags: ai.flags || [],
      confidence: ai.confidence
    });

    return {
      adjustedMin,
      adjustedMax,
      confidence: ai.confidence || estimate.confidence,
      aiFlags: ai.flags || [],
      aiNotes: ai.note || null,
      aiUsed: true
    };

  } catch (err) {
    log.error('AI enhancement failed, using rule-based estimate', { quoteId: quote.id, error: err.message });
    return {
      adjustedMin: estimate.min,
      adjustedMax: estimate.max,
      confidence: estimate.confidence,
      aiFlags: [],
      aiNotes: null,
      aiUsed: false
    };
  }
}

module.exports = {
  calculateEstimate,
  calculateTestEstimate,
  enhanceEstimateWithAI,
  ESTIMATION_VERSION
};
