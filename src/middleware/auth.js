import jwt from 'jsonwebtoken';
import { logger } from '../utils/logger.js';
import { authError, forbiddenError } from './errorHandler.js';
import { getUserById } from '../database/models/user.js';

// Generate JWT token
export const generateToken = (payload, expiresIn = '7d') => {
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn });
};

// Verify JWT token
export const verifyToken = (token) => {
  try {
    return jwt.verify(token, process.env.JWT_SECRET);
  } catch (error) {
    throw authError('Invalid or expired token');
  }
};

// Main authentication middleware
export const authMiddleware = async (req, res, next) => {
  try {
    // Get token from header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw authError('Authorization token required');
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix
    
    // Verify token
    const decoded = verifyToken(token);
    
    // Get user from database
    const user = await getUserById(decoded.id);
    if (!user) {
      throw authError('User not found');
    }

    // Check if user is active
    if (!user.isActive) {
      throw forbiddenError('Account is deactivated');
    }

    // Attach user to request
    req.user = user;
    req.token = token;

    next();
  } catch (error) {
    logger.warn('Authentication failed', {
      ip: req.ip,
      url: req.url,
      error: error.message,
      token: req.headers.authorization?.substring(0, 20) + '...'
    });
    next(error);
  }
};

// Optional authentication middleware (doesn't throw error if no token)
export const optionalAuthMiddleware = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      const decoded = verifyToken(token);
      const user = await getUserById(decoded.id);
      
      if (user && user.isActive) {
        req.user = user;
        req.token = token;
      }
    }
    next();
  } catch (error) {
    // Don't throw error for optional auth
    next();
  }
};

// Admin only middleware
export const adminMiddleware = (req, res, next) => {
  if (!req.user) {
    throw authError('Authentication required');
  }
  
  if (req.user.role !== 'admin') {
    throw forbiddenError('Admin access required');
  }
  
  next();
};

// Subscription tier middleware
export const subscriptionMiddleware = (requiredTier) => {
  return (req, res, next) => {
    if (!req.user) {
      throw authError('Authentication required');
    }

    const tierLevels = { free: 0, basic: 1, premium: 2 };
    const userLevel = tierLevels[req.user.subscriptionTier] || 0;
    const requiredLevel = tierLevels[requiredTier] || 0;

    if (userLevel < requiredLevel) {
      throw forbiddenError(`${requiredTier} subscription required`);
    }

    next();
  };
};

// Bot authentication (for webhook endpoints)
export const botAuthMiddleware = (req, res, next) => {
  const signature = req.headers['x-bot-signature'];
  const timestamp = req.headers['x-bot-timestamp'];
  
  if (!signature || !timestamp) {
    throw authError('Bot authentication required');
  }

  // Check timestamp (prevent replay attacks)
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - parseInt(timestamp)) > 300) { // 5 minutes
    throw authError('Request timestamp invalid');
  }

  // Verify signature
  const crypto = await import('crypto');
  const expectedSignature = crypto
    .createHmac('sha256', process.env.WEBHOOK_SECRET)
    .update(timestamp + JSON.stringify(req.body))
    .digest('hex');

  if (signature !== expectedSignature) {
    throw authError('Invalid bot signature');
  }

  next();
};

// Rate limit by user
export const userRateLimitMiddleware = (pointsPerUser = 10, duration = 3600) => {
  const userLimiters = new Map();
  
  return async (req, res, next) => {
    if (!req.user) {
      return next();
    }

    const userId = req.user.id;
    
    if (!userLimiters.has(userId)) {
      const { RateLimiterMemory } = await import('rate-limiter-flexible');
      userLimiters.set(userId, new RateLimiterMemory({
        points: pointsPerUser,
        duration,
        blockDuration: duration
      }));
    }

    const limiter = userLimiters.get(userId);
    
    try {
      await limiter.consume(userId);
      next();
    } catch (rateLimiterRes) {
      const remainingTime = Math.round(rateLimiterRes.msBeforeNext / 1000);
      
      logger.warn('User rate limit exceeded', {
        userId,
        remainingTime,
        url: req.url
      });

      res.set('Retry-After', remainingTime);
      throw rateLimitError(`Too many requests. Try again in ${remainingTime} seconds.`);
    }
  };
};

// Request validation middleware
export const validateRequest = (schema) => {
  return (req, res, next) => {
    const { error } = schema.validate(req.body);
    if (error) {
      throw validationError(error.details[0].message);
    }
    next();
  };
};

// IP whitelist middleware (for admin endpoints)
export const ipWhitelistMiddleware = (allowedIPs = []) => {
  return (req, res, next) => {
    const clientIP = req.ip || req.connection.remoteAddress;
    
    if (allowedIPs.length > 0 && !allowedIPs.includes(clientIP)) {
      logger.warn('IP not whitelisted', { clientIP, url: req.url });
      throw forbiddenError('Access denied from this IP');
    }
    
    next();
  };
};