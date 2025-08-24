import { RateLimiterMemory } from 'rate-limiter-flexible';
import { logger } from '../utils/logger.js';
import { rateLimitError } from './errorHandler.js';

// Main API rate limiter
const apiLimiter = new RateLimiterMemory({
  keyGenerator: (req) => req.ip || req.connection.remoteAddress,
  points: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100, // Number of requests
  duration: parseInt(process.env.RATE_LIMIT_WINDOW) || 900, // Per 15 minutes
  blockDuration: 900, // Block for 15 minutes if exceeded
});

// Auth endpoints limiter (more restrictive)
const authLimiter = new RateLimiterMemory({
  keyGenerator: (req) => req.ip || req.connection.remoteAddress,
  points: 5, // 5 attempts
  duration: 900, // Per 15 minutes
  blockDuration: 3600, // Block for 1 hour if exceeded
});

// Alert creation limiter
const alertLimiter = new RateLimiterMemory({
  keyGenerator: (req) => req.user?.id || req.ip,
  points: 10, // 10 alerts
  duration: 3600, // Per hour
  blockDuration: 3600, // Block for 1 hour if exceeded
});

// Bot command limiter
const botLimiter = new RateLimiterMemory({
  keyGenerator: (userId, platform) => `${platform}:${userId}`,
  points: 30, // 30 commands
  duration: 3600, // Per hour
  blockDuration: 1800, // Block for 30 minutes if exceeded
});

// Generic rate limiter middleware
export const createRateLimiter = (limiter, errorMessage) => {
  return async (req, res, next) => {
    try {
      await limiter.consume(req.ip || req.connection.remoteAddress);
      next();
    } catch (rateLimiterRes) {
      const remainingTime = Math.round(rateLimiterRes.msBeforeNext / 1000);
      
      logger.warn('Rate limit exceeded', {
        ip: req.ip,
        url: req.url,
        method: req.method,
        remainingTime,
        userId: req.user?.id
      });

      res.set({
        'Retry-After': remainingTime,
        'X-RateLimit-Limit': limiter.points,
        'X-RateLimit-Remaining': rateLimiterRes.remainingPoints || 0,
        'X-RateLimit-Reset': new Date(Date.now() + rateLimiterRes.msBeforeNext)
      });

      throw rateLimitError(`${errorMessage} Try again in ${remainingTime} seconds.`);
    }
  };
};

// Main API rate limiter
export const rateLimiter = createRateLimiter(
  apiLimiter,
  'Too many requests from this IP.'
);

// Auth rate limiter
export const authRateLimiter = createRateLimiter(
  authLimiter,
  'Too many authentication attempts.'
);

// Alert creation rate limiter
export const alertRateLimiter = async (req, res, next) => {
  try {
    const key = req.user?.id || req.ip;
    await alertLimiter.consume(key);
    next();
  } catch (rateLimiterRes) {
    const remainingTime = Math.round(rateLimiterRes.msBeforeNext / 1000);
    
    logger.warn('Alert creation rate limit exceeded', {
      userId: req.user?.id,
      ip: req.ip,
      remainingTime
    });

    res.set({
      'Retry-After': remainingTime,
      'X-RateLimit-Limit': alertLimiter.points,
      'X-RateLimit-Remaining': rateLimiterRes.remainingPoints || 0,
      'X-RateLimit-Reset': new Date(Date.now() + rateLimiterRes.msBeforeNext)
    });

    throw rateLimitError(`Too many alerts created. Try again in ${remainingTime} seconds.`);
  }
};

// Bot command rate limiter
export const checkBotRateLimit = async (userId, platform) => {
  try {
    const key = `${platform}:${userId}`;
    await botLimiter.consume(key);
    return { allowed: true };
  } catch (rateLimiterRes) {
    const remainingTime = Math.round(rateLimiterRes.msBeforeNext / 1000);
    
    logger.warn('Bot command rate limit exceeded', {
      userId,
      platform,
      remainingTime
    });

    return {
      allowed: false,
      remainingTime,
      message: `Too many commands. Please wait ${remainingTime} seconds before trying again.`
    };
  }
};

// Reset rate limit for a key (admin function)
export const resetRateLimit = async (key, limiterType = 'api') => {
  try {
    let limiter;
    switch (limiterType) {
      case 'auth':
        limiter = authLimiter;
        break;
      case 'alert':
        limiter = alertLimiter;
        break;
      case 'bot':
        limiter = botLimiter;
        break;
      default:
        limiter = apiLimiter;
    }
    
    await limiter.delete(key);
    logger.info(`Rate limit reset for key: ${key}, type: ${limiterType}`);
    return true;
  } catch (error) {
    logger.error('Failed to reset rate limit', { key, limiterType, error: error.message });
    return false;
  }
};

// Get rate limit status
export const getRateLimitStatus = async (key, limiterType = 'api') => {
  try {
    let limiter;
    switch (limiterType) {
      case 'auth':
        limiter = authLimiter;
        break;
      case 'alert':
        limiter = alertLimiter;
        break;
      case 'bot':
        limiter = botLimiter;
        break;
      default:
        limiter = apiLimiter;
    }
    
    const rateLimiterRes = await limiter.get(key);
    
    if (rateLimiterRes) {
      return {
        limit: limiter.points,
        remaining: rateLimiterRes.remainingPoints,
        resetTime: new Date(Date.now() + rateLimiterRes.msBeforeNext),
        blocked: rateLimiterRes.remainingPoints <= 0
      };
    } else {
      return {
        limit: limiter.points,
        remaining: limiter.points,
        resetTime: null,
        blocked: false
      };
    }
  } catch (error) {
    logger.error('Failed to get rate limit status', { key, limiterType, error: error.message });
    return null;
  }
};