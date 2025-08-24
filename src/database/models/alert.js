import { database } from '../init.js';
import { logger } from '../../utils/logger.js';

// Create a new alert
export const createAlert = async (alertData) => {
  try {
    const {
      userId,
      type,
      domain,
      domainPattern,
      conditions,
      platform
    } = alertData;

    // Validate alert type
    const validTypes = ['expiry', 'sale', 'transfer', 'price', 'auction'];
    if (!validTypes.includes(type)) {
      throw new Error(`Invalid alert type: ${type}`);
    }

    // Validate platform
    const validPlatforms = ['telegram', 'twitter', 'both', 'web'];
    if (!validPlatforms.includes(platform)) {
      throw new Error(`Invalid platform: ${platform}`);
    }

    // Serialize conditions
    const conditionsJson = JSON.stringify(conditions);

    const result = await database.run(
      `INSERT INTO alerts (
        userId, type, domain, domainPattern, conditions, platform
      ) VALUES (?, ?, ?, ?, ?, ?)`,
      [userId, type, domain, domainPattern, conditionsJson, platform]
    );

    const alert = await getAlertById(result.lastID);
    logger.info('Alert created successfully', { 
      alertId: alert.id, 
      userId: alert.userId, 
      type: alert.type 
    });
    
    return alert;
  } catch (error) {
    logger.error('Failed to create alert:', error);
    throw error;
  }
};

// Get alert by ID
export const getAlertById = async (id) => {
  try {
    const alert = await database.get('SELECT * FROM alerts WHERE id = ?', [id]);
    if (alert) {
      alert.conditions = JSON.parse(alert.conditions || '{}');
    }
    return alert;
  } catch (error) {
    logger.error('Failed to get alert by ID:', error);
    throw error;
  }
};

// Get alerts by user ID
export const getAlertsByUserId = async (userId, options = {}) => {
  try {
    const { active, type, platform, limit, offset } = options;
    
    let whereClause = 'WHERE userId = ?';
    const params = [userId];

    if (active !== undefined) {
      whereClause += ' AND isActive = ?';
      params.push(active ? 1 : 0);
    }

    if (type) {
      whereClause += ' AND type = ?';
      params.push(type);
    }

    if (platform) {
      whereClause += ' AND (platform = ? OR platform = "both")';
      params.push(platform);
    }

    let limitClause = '';
    if (limit) {
      limitClause = ` LIMIT ${limit}`;
      if (offset) {
        limitClause += ` OFFSET ${offset}`;
      }
    }

    const alerts = await database.all(
      `SELECT * FROM alerts ${whereClause} ORDER BY createdAt DESC${limitClause}`,
      params
    );

    return alerts.map(alert => ({
      ...alert,
      conditions: JSON.parse(alert.conditions || '{}')
    }));
  } catch (error) {
    logger.error('Failed to get alerts by user ID:', error);
    throw error;
  }
};

// Update alert
export const updateAlert = async (id, updateData) => {
  try {
    const allowedFields = ['type', 'domain', 'domainPattern', 'conditions', 'platform', 'isActive'];
    
    const fields = [];
    const values = [];

    for (const [key, value] of Object.entries(updateData)) {
      if (allowedFields.includes(key)) {
        fields.push(`${key} = ?`);
        if (key === 'conditions' && typeof value === 'object') {
          values.push(JSON.stringify(value));
        } else {
          values.push(value);
        }
      }
    }

    if (fields.length === 0) {
      throw new Error('No valid fields to update');
    }

    fields.push('updatedAt = CURRENT_TIMESTAMP');
    values.push(id);

    await database.run(
      `UPDATE alerts SET ${fields.join(', ')} WHERE id = ?`,
      values
    );

    const updatedAlert = await getAlertById(id);
    logger.info('Alert updated successfully', { 
      alertId: id, 
      fields: Object.keys(updateData) 
    });
    
    return updatedAlert;
  } catch (error) {
    logger.error('Failed to update alert:', error);
    throw error;
  }
};

// Delete alert
export const deleteAlert = async (id) => {
  try {
    const result = await database.run('DELETE FROM alerts WHERE id = ?', [id]);
    
    if (result.changes === 0) {
      throw new Error('Alert not found');
    }

    logger.info('Alert deleted successfully', { alertId: id });
    return true;
  } catch (error) {
    logger.error('Failed to delete alert:', error);
    throw error;
  }
};

// Increment alert trigger count
export const incrementTriggerCount = async (id) => {
  try {
    await database.run(
      `UPDATE alerts SET 
        triggerCount = triggerCount + 1,
        lastTriggered = CURRENT_TIMESTAMP,
        updatedAt = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [id]
    );

    logger.info('Alert trigger count incremented', { alertId: id });
  } catch (error) {
    logger.error('Failed to increment trigger count:', error);
    throw error;
  }
};

// Get alerts by domain
export const getAlertsByDomain = async (domain, type = null) => {
  try {
    let whereClause = 'WHERE isActive = 1 AND (domain = ? OR domainPattern = ?)';
    const params = [domain, domain];

    if (type) {
      whereClause += ' AND type = ?';
      params.push(type);
    }

    const alerts = await database.all(
      `SELECT * FROM alerts ${whereClause}`,
      params
    );

    return alerts.map(alert => ({
      ...alert,
      conditions: JSON.parse(alert.conditions || '{}')
    }));
  } catch (error) {
    logger.error('Failed to get alerts by domain:', error);
    throw error;
  }
};

// Get alerts by pattern matching
export const getAlertsByPattern = async (domain, type = null) => {
  try {
    let whereClause = 'WHERE isActive = 1 AND domainPattern IS NOT NULL';
    const params = [];

    if (type) {
      whereClause += ' AND type = ?';
      params.push(type);
    }

    const alerts = await database.all(
      `SELECT * FROM alerts ${whereClause}`,
      params
    );

    // Filter alerts where domain matches the pattern
    const matchingAlerts = alerts.filter(alert => {
      if (!alert.domainPattern) return false;
      
      try {
        // Convert SQL LIKE pattern to RegExp
        const pattern = alert.domainPattern
          .replace(/%/g, '.*')
          .replace(/_/g, '.');
        const regex = new RegExp(`^${pattern}$`, 'i');
        return regex.test(domain);
      } catch (error) {
        logger.warn('Invalid domain pattern', { 
          alertId: alert.id, 
          pattern: alert.domainPattern 
        });
        return false;
      }
    });

    return matchingAlerts.map(alert => ({
      ...alert,
      conditions: JSON.parse(alert.conditions || '{}')
    }));
  } catch (error) {
    logger.error('Failed to get alerts by pattern:', error);
    throw error;
  }
};

// Get alerts ready for checking
export const getActiveAlerts = async (type = null, platform = null) => {
  try {
    let whereClause = 'WHERE isActive = 1';
    const params = [];

    if (type) {
      whereClause += ' AND type = ?';
      params.push(type);
    }

    if (platform) {
      whereClause += ' AND (platform = ? OR platform = "both")';
      params.push(platform);
    }

    const alerts = await database.all(
      `SELECT a.*, u.subscriptionTier, u.telegramId, u.twitterId, u.preferences
       FROM alerts a 
       JOIN users u ON a.userId = u.id 
       ${whereClause} AND u.isActive = 1
       ORDER BY a.createdAt ASC`,
      params
    );

    return alerts.map(alert => ({
      ...alert,
      conditions: JSON.parse(alert.conditions || '{}'),
      preferences: JSON.parse(alert.preferences || '{}')
    }));
  } catch (error) {
    logger.error('Failed to get active alerts:', error);
    throw error;
  }
};

// Log alert event
export const logAlert = async (alertData) => {
  try {
    const {
      alertId,
      userId,
      eventType,
      eventData,
      status = 'sent',
      platform
    } = alertData;

    const eventDataJson = JSON.stringify(eventData);

    const result = await database.run(
      `INSERT INTO alert_logs (
        alertId, userId, eventType, eventData, status, platform
      ) VALUES (?, ?, ?, ?, ?, ?)`,
      [alertId, userId, eventType, eventDataJson, status, platform]
    );

    logger.info('Alert logged successfully', { 
      logId: result.lastID,
      alertId,
      eventType,
      status 
    });
    
    return result.lastID;
  } catch (error) {
    logger.error('Failed to log alert:', error);
    throw error;
  }
};

// Get alert logs
export const getAlertLogs = async (alertId, options = {}) => {
  try {
    const { limit = 50, offset = 0, status } = options;
    
    let whereClause = 'WHERE alertId = ?';
    const params = [alertId];

    if (status) {
      whereClause += ' AND status = ?';
      params.push(status);
    }

    const logs = await database.all(
      `SELECT * FROM alert_logs ${whereClause} 
       ORDER BY createdAt DESC 
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    return logs.map(log => ({
      ...log,
      eventData: JSON.parse(log.eventData || '{}')
    }));
  } catch (error) {
    logger.error('Failed to get alert logs:', error);
    throw error;
  }
};

// Get user alert statistics
export const getUserAlertStats = async (userId) => {
  try {
    const [alertStats, logStats] = await Promise.all([
      database.get(`
        SELECT 
          COUNT(*) as totalAlerts,
          COUNT(CASE WHEN isActive = 1 THEN 1 END) as activeAlerts,
          COUNT(CASE WHEN type = 'expiry' THEN 1 END) as expiryAlerts,
          COUNT(CASE WHEN type = 'sale' THEN 1 END) as saleAlerts,
          COUNT(CASE WHEN type = 'transfer' THEN 1 END) as transferAlerts,
          SUM(triggerCount) as totalTriggers
        FROM alerts WHERE userId = ?
      `, [userId]),
      
      database.get(`
        SELECT 
          COUNT(*) as totalLogs,
          COUNT(CASE WHEN status = 'sent' THEN 1 END) as sentAlerts,
          COUNT(CASE WHEN status = 'failed' THEN 1 END) as failedAlerts,
          COUNT(CASE WHEN platform = 'telegram' THEN 1 END) as telegramAlerts,
          COUNT(CASE WHEN platform = 'twitter' THEN 1 END) as twitterAlerts
        FROM alert_logs WHERE userId = ?
      `, [userId])
    ]);

    return {
      ...alertStats,
      ...logStats,
      successRate: logStats.totalLogs > 0 ? 
        ((logStats.sentAlerts / logStats.totalLogs) * 100).toFixed(2) : 0
    };
  } catch (error) {
    logger.error('Failed to get user alert stats:', error);
    throw error;
  }
};

// Cleanup old alert logs
export const cleanupAlertLogs = async (daysToKeep = 30) => {
  try {
    const result = await database.run(
      'DELETE FROM alert_logs WHERE createdAt < datetime("now", "-" || ? || " days")',
      [daysToKeep]
    );

    logger.info('Alert logs cleanup completed', { deletedCount: result.changes });
    return result.changes;
  } catch (error) {
    logger.error('Failed to cleanup alert logs:', error);
    throw error;
  }
};