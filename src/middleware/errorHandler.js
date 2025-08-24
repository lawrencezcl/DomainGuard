import { logger } from '../utils/logger.js';

export class AppError extends Error {
  constructor(message, statusCode = 500, isOperational = true) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    this.timestamp = new Date().toISOString();
    
    Error.captureStackTrace(this, this.constructor);
  }
}

export const errorHandler = (error, req, res, next) => {
  let { statusCode = 500, message } = error;

  // Log the error
  logger.error('Request Error', {
    message: error.message,
    stack: error.stack,
    statusCode,
    url: req.url,
    method: req.method,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    userId: req.user?.id
  });

  // Handle specific error types
  if (error.name === 'ValidationError') {
    statusCode = 400;
    message = 'Validation failed';
  } else if (error.name === 'UnauthorizedError' || error.name === 'JsonWebTokenError') {
    statusCode = 401;
    message = 'Unauthorized';
  } else if (error.name === 'CastError') {
    statusCode = 400;
    message = 'Invalid data format';
  } else if (error.code === 'LIMIT_FILE_SIZE') {
    statusCode = 400;
    message = 'File too large';
  } else if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
    statusCode = 503;
    message = 'Service temporarily unavailable';
  }

  // Don't leak error details in production
  if (process.env.NODE_ENV === 'production' && statusCode === 500) {
    message = 'Internal server error';
  }

  // Send error response
  res.status(statusCode).json({
    success: false,
    error: {
      message,
      ...(process.env.NODE_ENV === 'development' && {
        stack: error.stack,
        details: error
      })
    },
    timestamp: new Date().toISOString(),
    requestId: req.id || 'unknown'
  });
};

// Async error wrapper
export const asyncHandler = (fn) => {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

// 404 handler
export const notFoundHandler = (req, res) => {
  res.status(404).json({
    success: false,
    error: {
      message: `Route ${req.method} ${req.url} not found`
    },
    timestamp: new Date().toISOString()
  });
};

// Validation error helper
export const validationError = (message, field = null) => {
  const error = new AppError(message, 400);
  if (field) {
    error.field = field;
  }
  return error;
};

// Authorization error helper
export const authError = (message = 'Unauthorized') => {
  return new AppError(message, 401);
};

// Forbidden error helper
export const forbiddenError = (message = 'Forbidden') => {
  return new AppError(message, 403);
};

// Not found error helper
export const notFoundError = (message = 'Resource not found') => {
  return new AppError(message, 404);
};

// Conflict error helper
export const conflictError = (message = 'Resource conflict') => {
  return new AppError(message, 409);
};

// Rate limit error helper
export const rateLimitError = (message = 'Too many requests') => {
  return new AppError(message, 429);
};

// Service unavailable error helper
export const serviceUnavailableError = (message = 'Service temporarily unavailable') => {
  return new AppError(message, 503);
};