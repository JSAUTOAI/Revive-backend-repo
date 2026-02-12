/**
 * Estimation Engine
 *
 * Calculates price estimates for quote requests based on services,
 * property details, and other factors from the form submission.
 */

const { SERVICE_PRICING, MODIFIERS, MULTI_SERVICE_DISCOUNT } = require('../config/pricing');

const ESTIMATION_VERSION = 'v1.0';

/**
 * Calculate price estimate for a quote
 * @param {Object} quote - The quote object from the database
 * @returns {Object} - { min, max, version, confidence }
 */
function calculateEstimate(quote) {
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
  const modifiers = calculateModifiers(quote);

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
 * @returns {Object} - { multiplier, reasons }
 */
function calculateModifiers(quote) {
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

module.exports = {
  calculateEstimate,
  ESTIMATION_VERSION
};
