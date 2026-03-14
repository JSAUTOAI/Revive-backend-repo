/**
 * Structured Logger
 *
 * Winston-based logging with context prefixes and log levels.
 * Replaces ad-hoc console.log/error/warn throughout the codebase.
 *
 * Usage:
 *   const logger = require('./services/logger');
 *   logger.info('Quote submitted', { quoteId, services });
 *   logger.error('Database insert failed', { error: err.message });
 *
 * Or create a child logger with a fixed prefix:
 *   const log = require('./services/logger').child('Email');
 *   log.info('Confirmation sent', { to: email });
 *   // Output: [Email] Confirmation sent { to: 'user@example.com' }
 */

const winston = require('winston');

const LOG_LEVEL = process.env.LOG_LEVEL || 'info';

const logger = winston.createLogger({
  level: LOG_LEVEL,
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.printf(({ timestamp, level, message, prefix, stack, ...meta }) => {
      const pfx = prefix ? `[${prefix}] ` : '';
      const metaStr = Object.keys(meta).length ? ' ' + JSON.stringify(meta) : '';
      const stackStr = stack ? '\n' + stack : '';
      return `${timestamp} ${level.toUpperCase()} ${pfx}${message}${metaStr}${stackStr}`;
    })
  ),
  transports: [
    new winston.transports.Console()
  ]
});

/**
 * Create a child logger with a fixed prefix
 * @param {string} prefix - Module name (e.g. 'Email', 'WhatsApp', 'Estimation')
 */
logger.child = function(prefix) {
  return {
    info: (msg, meta = {}) => logger.info(msg, { prefix, ...meta }),
    warn: (msg, meta = {}) => logger.warn(msg, { prefix, ...meta }),
    error: (msg, meta = {}) => logger.error(msg, { prefix, ...meta }),
    debug: (msg, meta = {}) => logger.debug(msg, { prefix, ...meta })
  };
};

module.exports = logger;
