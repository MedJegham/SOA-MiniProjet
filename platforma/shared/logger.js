/**
 * Shared logger utility using Winston
 * Used by all microservices for consistent structured logging
 */

const winston = require('winston');

/**
 * Creates a named logger instance for a given service
 * @param {string} serviceName - Name of the service (e.g. 'auth-service')
 * @returns {winston.Logger}
 */
const createLogger = (serviceName) => {
  return winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.errors({ stack: true }),
      winston.format.printf(({ timestamp, level, message, stack }) => {
        const base = `[${timestamp}] [${serviceName}] ${level.toUpperCase()}: ${message}`;
        return stack ? `${base}\n${stack}` : base;
      })
    ),
    transports: [
      new winston.transports.Console(),
    ],
  });
};

module.exports = { createLogger };
