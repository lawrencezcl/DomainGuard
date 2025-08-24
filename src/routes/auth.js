import express from 'express';
import { authRateLimiter } from '../middleware/rateLimiter.js';
import { generateToken } from '../middleware/auth.js';
import { 
  createUser, 
  getUserByEmail, 
  getUserByTelegramId,
  getUserByTwitterId,
  verifyUserPassword 
} from '../database/models/user.js';
import { logger } from '../utils/logger.js';

const router = express.Router();

// Register new user
router.post('/register', authRateLimiter, async (req, res) => {
  try {
    const { username, email, password, telegramId, twitterId, walletAddress } = req.body;

    // Check if user already exists
    const existingUser = email ? await getUserByEmail(email) : 
                        telegramId ? await getUserByTelegramId(telegramId) :
                        twitterId ? await getUserByTwitterId(twitterId) : null;

    if (existingUser) {
      return res.status(409).json({
        success: false,
        error: { message: 'User already exists' }
      });
    }

    // Create new user
    const user = await createUser({
      username,
      email,
      password,
      telegramId,
      twitterId,
      walletAddress
    });

    // Generate token
    const token = generateToken({ id: user.id, username: user.username });

    // Remove sensitive data
    delete user.passwordHash;

    res.status(201).json({
      success: true,
      data: {
        user,
        token
      }
    });

    logger.info('User registered successfully', { userId: user.id, username });
  } catch (error) {
    logger.error('Registration error:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Registration failed' }
    });
  }
});

// Login user
router.post('/login', authRateLimiter, async (req, res) => {
  try {
    const { email, password, telegramId, twitterId } = req.body;

    // Find user
    const user = email ? await getUserByEmail(email) :
                 telegramId ? await getUserByTelegramId(telegramId) :
                 twitterId ? await getUserByTwitterId(twitterId) : null;

    if (!user) {
      return res.status(401).json({
        success: false,
        error: { message: 'Invalid credentials' }
      });
    }

    // Verify password (if provided)
    if (password && !await verifyUserPassword(user.id, password)) {
      return res.status(401).json({
        success: false,
        error: { message: 'Invalid credentials' }
      });
    }

    // Generate token
    const token = generateToken({ id: user.id, username: user.username });

    // Remove sensitive data
    delete user.passwordHash;

    res.json({
      success: true,
      data: {
        user,
        token
      }
    });

    logger.info('User logged in successfully', { userId: user.id });
  } catch (error) {
    logger.error('Login error:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Login failed' }
    });
  }
});

// Get current user info
router.get('/me', async (req, res) => {
  try {
    // User is attached by auth middleware
    const user = req.user;
    
    // Remove sensitive data
    delete user.passwordHash;

    res.json({
      success: true,
      data: { user }
    });
  } catch (error) {
    logger.error('Get user error:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to get user info' }
    });
  }
});

// Refresh token
router.post('/refresh', async (req, res) => {
  try {
    const { token } = req.body;
    
    if (!token) {
      return res.status(400).json({
        success: false,
        error: { message: 'Token required' }
      });
    }

    // Verify and decode token
    const decoded = verifyToken(token);
    
    // Generate new token
    const newToken = generateToken({ id: decoded.id, username: decoded.username });

    res.json({
      success: true,
      data: { token: newToken }
    });
  } catch (error) {
    logger.error('Token refresh error:', error);
    res.status(401).json({
      success: false,
      error: { message: 'Invalid token' }
    });
  }
});

export default router;