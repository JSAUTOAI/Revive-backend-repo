/**
 * Pricing Config Loader
 *
 * Central module for loading pricing configuration.
 * Checks database first (admin-editable), falls back to file defaults.
 * Uses in-memory caching (5-minute TTL) to avoid DB queries on every estimate.
 */

const fileDefaults = require('../config/pricing');

let supabase;

function setSupabaseClient(client) {
  supabase = client;
}

// In-memory cache
let cachedConfig = null;
let cacheTimestamp = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Get the active pricing configuration
 * Priority: DB settings → file defaults
 * @returns {Promise<Object>} Full pricing config
 */
async function getPricingConfig() {
  // Check cache first
  if (cachedConfig && (Date.now() - cacheTimestamp) < CACHE_TTL) {
    return cachedConfig;
  }

  // Try loading from database
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('settings')
        .select('value, updated_at')
        .eq('key', 'pricing_config')
        .single();

      if (!error && data && data.value) {
        // Merge with file defaults to ensure all keys exist
        const config = mergeWithDefaults(data.value);
        cachedConfig = config;
        cacheTimestamp = Date.now();
        return config;
      }
    } catch (err) {
      console.error('[PricingConfig] DB load failed, using file defaults:', err.message);
    }
  }

  // Fall back to file defaults
  const config = {
    SERVICE_PRICING: fileDefaults.SERVICE_PRICING,
    MODIFIERS: fileDefaults.MODIFIERS,
    MULTI_SERVICE_DISCOUNT: fileDefaults.MULTI_SERVICE_DISCOUNT,
    LEAD_SCORING: fileDefaults.LEAD_SCORING,
    QUALIFICATION_THRESHOLDS: fileDefaults.QUALIFICATION_THRESHOLDS,
    CONVERSION_FACTORS: fileDefaults.CONVERSION_FACTORS
  };
  cachedConfig = config;
  cacheTimestamp = Date.now();
  return config;
}

/**
 * Merge DB config with file defaults to ensure all keys exist
 * This protects against missing keys if new config fields are added
 */
function mergeWithDefaults(dbConfig) {
  return {
    SERVICE_PRICING: dbConfig.SERVICE_PRICING || fileDefaults.SERVICE_PRICING,
    MODIFIERS: { ...fileDefaults.MODIFIERS, ...(dbConfig.MODIFIERS || {}) },
    MULTI_SERVICE_DISCOUNT: { ...fileDefaults.MULTI_SERVICE_DISCOUNT, ...(dbConfig.MULTI_SERVICE_DISCOUNT || {}) },
    LEAD_SCORING: { ...fileDefaults.LEAD_SCORING, ...(dbConfig.LEAD_SCORING || {}) },
    QUALIFICATION_THRESHOLDS: { ...fileDefaults.QUALIFICATION_THRESHOLDS, ...(dbConfig.QUALIFICATION_THRESHOLDS || {}) },
    CONVERSION_FACTORS: { ...fileDefaults.CONVERSION_FACTORS, ...(dbConfig.CONVERSION_FACTORS || {}) }
  };
}

/**
 * Save pricing config to database
 * @param {Object} config - Full pricing config object
 * @returns {Promise<Object>} { success: boolean }
 */
async function savePricingConfig(config) {
  if (!supabase) throw new Error('Supabase client not initialised');

  const { error } = await supabase
    .from('settings')
    .upsert({
      key: 'pricing_config',
      value: config,
      updated_at: new Date().toISOString()
    }, { onConflict: 'key' });

  if (error) throw error;

  // Invalidate cache so next call loads fresh
  cachedConfig = null;
  cacheTimestamp = 0;

  return { success: true };
}

/**
 * Reset pricing config to file defaults
 * @returns {Promise<Object>} { success: boolean }
 */
async function resetPricingConfig() {
  if (!supabase) throw new Error('Supabase client not initialised');

  await supabase
    .from('settings')
    .delete()
    .eq('key', 'pricing_config');

  // Invalidate cache
  cachedConfig = null;
  cacheTimestamp = 0;

  return { success: true };
}

/**
 * Get file defaults (for reset and comparison)
 */
function getFileDefaults() {
  return {
    SERVICE_PRICING: fileDefaults.SERVICE_PRICING,
    MODIFIERS: fileDefaults.MODIFIERS,
    MULTI_SERVICE_DISCOUNT: fileDefaults.MULTI_SERVICE_DISCOUNT,
    LEAD_SCORING: fileDefaults.LEAD_SCORING,
    QUALIFICATION_THRESHOLDS: fileDefaults.QUALIFICATION_THRESHOLDS,
    CONVERSION_FACTORS: fileDefaults.CONVERSION_FACTORS
  };
}

/**
 * Log a pricing change to history
 * @param {string} section - Which section changed
 * @param {Object} oldValue - Previous value
 * @param {Object} newValue - New value
 * @param {string} description - Human-readable description
 */
async function logPricingChange(section, oldValue, newValue, description) {
  if (!supabase) return;

  try {
    await supabase.from('pricing_history').insert({
      changed_section: section,
      old_value: oldValue,
      new_value: newValue,
      description: description
    });
  } catch (err) {
    console.error('[PricingConfig] Failed to log pricing change:', err.message);
  }
}

/**
 * Get pricing change history
 * @param {number} limit - Max records to return
 * @returns {Promise<Array>}
 */
async function getPricingHistory(limit) {
  if (!supabase) return [];

  const { data, error } = await supabase
    .from('pricing_history')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit || 20);

  if (error) {
    console.error('[PricingConfig] Failed to load pricing history:', error.message);
    return [];
  }

  return data || [];
}

module.exports = {
  setSupabaseClient,
  getPricingConfig,
  savePricingConfig,
  resetPricingConfig,
  getFileDefaults,
  logPricingChange,
  getPricingHistory
};
