/**
 * Pricing Configuration
 *
 * This file contains all pricing rules for the estimation engine.
 * Update these values as your pricing strategy evolves.
 *
 * All prices in GBP (£)
 */

// Base pricing for each service type
// Structure: { small: [min, max], medium: [min, max], large: [min, max] }
const SERVICE_PRICING = {
  roof: {
    small: [150, 250],      // Small roof (e.g., garage, small bungalow)
    medium: [250, 450],     // Medium roof (e.g., 3-bed semi)
    large: [450, 750],      // Large roof (e.g., 4-bed detached, commercial)
    default: [250, 450]     // If size unknown
  },

  driveway: {
    small: [100, 180],      // Small driveway (single car)
    medium: [180, 300],     // Medium driveway (double car)
    large: [300, 500],      // Large driveway (multiple cars, commercial)
    default: [180, 300]
  },

  gutter: {
    small: [80, 120],       // Small property (bungalow, small semi)
    medium: [120, 180],     // Medium property (3-bed semi)
    large: [180, 280],      // Large property (4-bed detached, 2-story)
    default: [120, 180]
  },

  softwash: {
    small: [200, 350],      // Small area (single wall, conservatory)
    medium: [350, 600],     // Medium area (full house external walls)
    large: [600, 1000],     // Large area (full house + outbuildings)
    default: [350, 600]
  },

  render: {
    small: [250, 400],      // Small render area
    medium: [400, 700],     // Medium render area
    large: [700, 1200],     // Large render area
    default: [400, 700]
  },

  window: {
    small: [60, 100],       // Small property (few windows)
    medium: [100, 160],     // Medium property (standard house)
    large: [160, 250],      // Large property (many windows)
    default: [100, 160]
  },

  solar: {
    small: [100, 150],      // Few panels (< 10)
    medium: [150, 250],     // Medium installation (10-20 panels)
    large: [250, 400],      // Large installation (20+ panels)
    default: [150, 250]
  },

  other: {
    small: [100, 200],      // Small miscellaneous job
    medium: [200, 400],     // Medium miscellaneous job
    large: [400, 700],      // Large miscellaneous job
    default: [200, 400]
  }
};

// Pricing modifiers (multipliers)
const MODIFIERS = {
  // Property condition modifiers
  firstTimeCleaning: 1.2,      // Never cleaned before (add 20%)
  heavilySoiled: 1.15,         // Very dirty condition (add 15%)

  // Access modifiers
  difficultAccess: 1.25,       // Hard to access (add 25%)
  heightWork: 1.3,             // High-level work requiring special equipment (add 30%)

  // Volume discount modifiers
  multipleServices: 0.9,       // 3+ services selected (10% discount on total)

  // Urgency modifiers
  urgent: 1.15                 // Urgent request (add 15%)
};

// Multi-service discounts
// If customer selects X or more services, apply discount
const MULTI_SERVICE_DISCOUNT = {
  threshold: 3,                // Number of services to qualify
  discount: 0.9               // 10% discount (multiply by 0.9)
};

// Lead scoring weights
const LEAD_SCORING = {
  // Financial value weights
  highValueThreshold: 400,    // Jobs above £400 get bonus points
  highValueBonus: 20,

  veryHighValueThreshold: 700, // Jobs above £700 get extra bonus
  veryHighValueBonus: 30,

  // Service quantity
  multipleServicesBonus: 15,  // 2+ services
  manyServicesBonus: 25,      // 3+ services

  // Customer intent signals
  remindersOptIn: 10,         // Wants reminders (high engagement)
  phonePreferred: 10,         // Prefers phone (immediate intent)
  emailPreferred: 5,          // Prefers email (moderate intent)

  // Property signals
  commercialProperty: 15,     // Commercial properties (higher value)

  // Urgency signals
  urgentLanguage: 10,         // Words like "urgent", "asap", "soon" in notes

  // Base score
  baseScore: 50
};

// Qualification thresholds
const QUALIFICATION_THRESHOLDS = {
  hot: 75,        // Score >= 75 = hot lead (immediate follow-up)
  warm: 50,       // Score >= 50 = warm lead (follow-up within 24h)
  cold: 30,       // Score >= 30 = cold lead (follow-up within 3 days)
  // Below 30 = unqualified (low priority)
};

// Conversion likelihood factors
// These affect the probability score (0.00 - 1.00)
const CONVERSION_FACTORS = {
  hotLead: 0.8,              // 80% likelihood for hot leads
  warmLead: 0.5,             // 50% likelihood for warm leads
  coldLead: 0.25,            // 25% likelihood for cold leads
  unqualified: 0.1           // 10% likelihood for unqualified
};

module.exports = {
  SERVICE_PRICING,
  MODIFIERS,
  MULTI_SERVICE_DISCOUNT,
  LEAD_SCORING,
  QUALIFICATION_THRESHOLDS,
  CONVERSION_FACTORS
};
