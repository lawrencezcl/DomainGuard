import express from 'express';
import { alertRateLimiter } from '../middleware/rateLimiter.js';
import { 
  createAlert, 
  getAlertsByUserId, 
  getAlertById,
  updateAlert, 
  deleteAlert,
  getUserAlertStats 
} from '../database/models/alert.js';
import { checkUserLimits } from '../database/models/user.js';
import { logger } from '../utils/logger.js';

const router = express.Router();

// Get user's alerts
router.get('/', async (req, res) => {
  try {
    const userId = req.user.id;
    const { page = 1, limit = 10, type, active } = req.query;
    
    const offset = (page - 1) * limit;
    const alerts = await getAlertsByUserId(userId, {
      limit: parseInt(limit),
      offset,
      type,
      active: active !== undefined ? active === 'true' : undefined
    });

    res.json({
      success: true,
      data: { alerts },
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        hasMore: alerts.length === parseInt(limit)
      }
    });
  } catch (error) {
    logger.error('Get alerts error:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to get alerts' }
    });
  }
});

// Get alert statistics
router.get('/stats', async (req, res) => {
  try {
    const userId = req.user.id;
    const stats = await getUserAlertStats(userId);
    
    res.json({
      success: true,
      data: { stats }
    });
  } catch (error) {
    logger.error('Get alert stats error:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to get alert statistics' }
    });
  }
});

// Get specific alert
router.get('/:id', async (req, res) => {
  try {
    const alertId = parseInt(req.params.id);
    const userId = req.user.id;
    
    const alert = await getAlertById(alertId);
    
    if (!alert || alert.userId !== userId) {
      return res.status(404).json({
        success: false,
        error: { message: 'Alert not found' }
      });
    }

    res.json({
      success: true,
      data: { alert }
    });
  } catch (error) {
    logger.error('Get alert error:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to get alert' }
    });
  }
});

// Create new alert
router.post('/', alertRateLimiter, async (req, res) => {
  try {
    const userId = req.user.id;
    const { type, domain, domainPattern, conditions, platform } = req.body;

    // Check user limits
    const limits = await checkUserLimits(userId);
    if (limits.alerts.available <= 0) {
      return res.status(403).json({
        success: false,
        error: { 
          message: 'Alert limit reached',
          limits: limits.alerts
        }
      });
    }

    // Validate input
    if (!type || !platform) {
      return res.status(400).json({
        success: false,
        error: { message: 'Type and platform are required' }
      });
    }

    if (!domain && !domainPattern) {
      return res.status(400).json({
        success: false,
        error: { message: 'Either domain or domainPattern is required' }
      });
    }

    // Create alert
    const alert = await createAlert({
      userId,
      type,
      domain,
      domainPattern,
      conditions: conditions || {},
      platform
    });

    res.status(201).json({
      success: true,
      data: { alert }
    });

    logger.info('Alert created', { alertId: alert.id, userId, type });
  } catch (error) {
    logger.error('Create alert error:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to create alert' }
    });
  }
});

// Update alert
router.put('/:id', async (req, res) => {
  try {
    const alertId = parseInt(req.params.id);
    const userId = req.user.id;
    const updateData = req.body;

    // Check if alert exists and belongs to user
    const existingAlert = await getAlertById(alertId);
    if (!existingAlert || existingAlert.userId !== userId) {
      return res.status(404).json({
        success: false,
        error: { message: 'Alert not found' }
      });
    }

    // Update alert
    const alert = await updateAlert(alertId, updateData);

    res.json({
      success: true,
      data: { alert }
    });

    logger.info('Alert updated', { alertId, userId });
  } catch (error) {
    logger.error('Update alert error:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to update alert' }
    });
  }
});

// Delete alert
router.delete('/:id', async (req, res) => {
  try {
    const alertId = parseInt(req.params.id);
    const userId = req.user.id;

    // Check if alert exists and belongs to user
    const existingAlert = await getAlertById(alertId);
    if (!existingAlert || existingAlert.userId !== userId) {
      return res.status(404).json({
        success: false,
        error: { message: 'Alert not found' }
      });
    }

    // Delete alert
    await deleteAlert(alertId);

    res.json({
      success: true,
      data: { message: 'Alert deleted successfully' }
    });

    logger.info('Alert deleted', { alertId, userId });
  } catch (error) {
    logger.error('Delete alert error:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to delete alert' }
    });
  }
});

// Toggle alert active status
router.patch('/:id/toggle', async (req, res) => {
  try {
    const alertId = parseInt(req.params.id);
    const userId = req.user.id;

    // Check if alert exists and belongs to user
    const existingAlert = await getAlertById(alertId);
    if (!existingAlert || existingAlert.userId !== userId) {
      return res.status(404).json({
        success: false,
        error: { message: 'Alert not found' }
      });
    }

    // Toggle active status
    const alert = await updateAlert(alertId, { isActive: !existingAlert.isActive });

    res.json({
      success: true,
      data: { alert }
    });

    logger.info('Alert toggled', { alertId, userId, isActive: alert.isActive });
  } catch (error) {
    logger.error('Toggle alert error:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to toggle alert' }
    });
  }
});

export default router;