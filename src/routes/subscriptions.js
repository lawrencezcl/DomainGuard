import express from 'express';
import { logger } from '../utils/logger.js';

const router = express.Router();

// Get user subscription status
router.get('/', async (req, res) => {
  try {
    const user = req.user;
    
    res.json({
      success: true,
      data: {
        subscription: {
          tier: user.subscriptionTier,
          expiry: user.subscriptionExpiry,
          status: 'active' // TODO: Implement proper status checking
        }
      }
    });
  } catch (error) {
    logger.error('Get subscription error:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to get subscription info' }
    });
  }
});

// Upgrade subscription (placeholder)
router.post('/upgrade', async (req, res) => {
  try {
    const { tier } = req.body;
    
    // TODO: Implement actual subscription upgrade with Doma contract payment
    res.json({
      success: true,
      data: {
        message: `Subscription upgrade to ${tier} initiated`,
        redirectUrl: `${process.env.FRONTEND_URL}/payment?tier=${tier}`
      }
    });
  } catch (error) {
    logger.error('Subscription upgrade error:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to initiate subscription upgrade' }
    });
  }
});

export default router;