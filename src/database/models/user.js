import bcrypt from 'bcryptjs';
import { database } from '../init.js';
import { logger } from '../../utils/logger.js';

// Create a new user
export const createUser = async (userData) => {
  try {
    const {
      telegramId,
      twitterId,
      email,
      username,
      password,
      walletAddress,
      domaAccountId
    } = userData;

    // Hash password if provided
    let passwordHash = null;
    if (password) {
      passwordHash = await bcrypt.hash(password, 12);
    }

    const preferences = JSON.stringify({
      notifications: {
        telegram: true,
        twitter: false,
        email: false
      },
      alertFrequency: 'realtime',
      timezone: 'UTC',
      language: 'en'
    });

    const result = await database.run(
      `INSERT INTO users (
        telegramId, twitterId, email, username, passwordHash, 
        walletAddress, domaAccountId, preferences
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [telegramId, twitterId, email, username, passwordHash, walletAddress, domaAccountId, preferences]
    );

    const user = await getUserById(result.lastID);
    logger.info('User created successfully', { userId: user.id, username: user.username });
    
    return user;
  } catch (error) {
    logger.error('Failed to create user:', error);
    throw error;
  }
};

// Get user by ID
export const getUserById = async (id) => {
  try {
    const user = await database.get('SELECT * FROM users WHERE id = ?', [id]);
    if (user) {
      user.preferences = JSON.parse(user.preferences || '{}');
    }
    return user;
  } catch (error) {
    logger.error('Failed to get user by ID:', error);
    throw error;
  }
};

// Get user by Telegram ID
export const getUserByTelegramId = async (telegramId) => {
  try {
    const user = await database.get('SELECT * FROM users WHERE telegramId = ?', [telegramId]);
    if (user) {
      user.preferences = JSON.parse(user.preferences || '{}');
    }
    return user;
  } catch (error) {
    logger.error('Failed to get user by Telegram ID:', error);
    throw error;
  }
};

// Get user by Twitter ID
export const getUserByTwitterId = async (twitterId) => {
  try {
    const user = await database.get('SELECT * FROM users WHERE twitterId = ?', [twitterId]);
    if (user) {
      user.preferences = JSON.parse(user.preferences || '{}');
    }
    return user;
  } catch (error) {
    logger.error('Failed to get user by Twitter ID:', error);
    throw error;
  }
};

// Get user by email
export const getUserByEmail = async (email) => {
  try {
    const user = await database.get('SELECT * FROM users WHERE email = ?', [email]);
    if (user) {
      user.preferences = JSON.parse(user.preferences || '{}');
    }
    return user;
  } catch (error) {
    logger.error('Failed to get user by email:', error);
    throw error;
  }
};

// Update user
export const updateUser = async (id, updateData) => {
  try {
    const allowedFields = [
      'username', 'email', 'subscriptionTier', 'subscriptionExpiry',
      'isActive', 'monthlySpendLimit', 'walletAddress', 'domaAccountId', 'preferences'
    ];

    const fields = [];
    const values = [];

    for (const [key, value] of Object.entries(updateData)) {
      if (allowedFields.includes(key)) {
        fields.push(`${key} = ?`);
        if (key === 'preferences' && typeof value === 'object') {
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
      `UPDATE users SET ${fields.join(', ')} WHERE id = ?`,
      values
    );

    const updatedUser = await getUserById(id);
    logger.info('User updated successfully', { userId: id, fields: Object.keys(updateData) });
    
    return updatedUser;
  } catch (error) {
    logger.error('Failed to update user:', error);
    throw error;
  }
};

// Update user password
export const updateUserPassword = async (id, newPassword) => {
  try {
    const passwordHash = await bcrypt.hash(newPassword, 12);
    
    await database.run(
      'UPDATE users SET passwordHash = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?',
      [passwordHash, id]
    );

    logger.info('User password updated', { userId: id });
    return true;
  } catch (error) {
    logger.error('Failed to update user password:', error);
    throw error;
  }
};

// Verify user password
export const verifyUserPassword = async (id, password) => {
  try {
    const user = await database.get('SELECT passwordHash FROM users WHERE id = ?', [id]);
    if (!user || !user.passwordHash) {
      return false;
    }

    return await bcrypt.compare(password, user.passwordHash);
  } catch (error) {
    logger.error('Failed to verify user password:', error);
    throw error;
  }
};

// Delete user (soft delete)
export const deleteUser = async (id) => {
  try {
    await database.run(
      'UPDATE users SET isActive = 0, updatedAt = CURRENT_TIMESTAMP WHERE id = ?',
      [id]
    );

    logger.info('User soft deleted', { userId: id });
    return true;
  } catch (error) {
    logger.error('Failed to delete user:', error);
    throw error;
  }
};

// Get user subscription info
export const getUserSubscription = async (userId) => {
  try {
    return await database.get(
      `SELECT s.*, u.subscriptionTier, u.subscriptionExpiry 
       FROM subscriptions s 
       JOIN users u ON s.userId = u.id 
       WHERE s.userId = ? AND s.status = 'active' 
       ORDER BY s.endDate DESC LIMIT 1`,
      [userId]
    );
  } catch (error) {
    logger.error('Failed to get user subscription:', error);
    throw error;
  }
};

// Check user subscription limits
export const checkUserLimits = async (userId) => {
  try {
    const user = await getUserById(userId);
    if (!user) {
      throw new Error('User not found');
    }

    // Get current alert count
    const alertCount = await database.get(
      'SELECT COUNT(*) as count FROM alerts WHERE userId = ? AND isActive = 1',
      [userId]
    );

    // Get current domain monitoring count
    const domainCount = await database.get(
      'SELECT COUNT(*) as count FROM domain_monitoring WHERE userId = ? AND isActive = 1',
      [userId]
    );

    // Define limits based on subscription tier
    const limits = {
      free: { alerts: 5, domains: 5, autoActions: 0 },
      basic: { alerts: 20, domains: 20, autoActions: 0 },
      premium: { alerts: 999999, domains: 999999, autoActions: 999999 }
    };

    const userLimits = limits[user.subscriptionTier] || limits.free;

    return {
      tier: user.subscriptionTier,
      alerts: {
        current: alertCount.count,
        limit: userLimits.alerts,
        available: Math.max(0, userLimits.alerts - alertCount.count)
      },
      domains: {
        current: domainCount.count,
        limit: userLimits.domains,
        available: Math.max(0, userLimits.domains - domainCount.count)
      },
      autoActions: {
        limit: userLimits.autoActions,
        enabled: user.subscriptionTier === 'premium'
      }
    };
  } catch (error) {
    logger.error('Failed to check user limits:', error);
    throw error;
  }
};

// Get user stats
export const getUserStats = async (userId) => {
  try {
    const [alertStats, actionStats, interactionStats] = await Promise.all([
      database.get(`
        SELECT 
          COUNT(*) as totalAlerts,
          SUM(triggerCount) as totalTriggers,
          COUNT(CASE WHEN isActive = 1 THEN 1 END) as activeAlerts
        FROM alerts WHERE userId = ?
      `, [userId]),
      
      database.get(`
        SELECT 
          COUNT(*) as totalActions,
          SUM(executionCount) as totalExecutions,
          COUNT(CASE WHEN isActive = 1 THEN 1 END) as activeActions
        FROM auto_actions WHERE userId = ?
      `, [userId]),
      
      database.get(`
        SELECT 
          COUNT(*) as totalInteractions,
          COUNT(CASE WHEN success = 1 THEN 1 END) as successfulInteractions
        FROM bot_interactions WHERE userId = ?
      `, [userId])
    ]);

    return {
      alerts: alertStats,
      actions: actionStats,
      interactions: interactionStats,
      joinDate: (await getUserById(userId))?.createdAt
    };
  } catch (error) {
    logger.error('Failed to get user stats:', error);
    throw error;
  }
};

// List users with pagination
export const listUsers = async (options = {}) => {
  try {
    const { page = 1, limit = 50, tier, active, search } = options;
    const offset = (page - 1) * limit;

    let whereClause = 'WHERE 1=1';
    const params = [];

    if (tier) {
      whereClause += ' AND subscriptionTier = ?';
      params.push(tier);
    }

    if (active !== undefined) {
      whereClause += ' AND isActive = ?';
      params.push(active ? 1 : 0);
    }

    if (search) {
      whereClause += ' AND (username LIKE ? OR email LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }

    const users = await database.all(
      `SELECT id, username, email, subscriptionTier, isActive, createdAt 
       FROM users ${whereClause} 
       ORDER BY createdAt DESC 
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    const total = await database.get(
      `SELECT COUNT(*) as count FROM users ${whereClause}`,
      params
    );

    return {
      users,
      pagination: {
        page,
        limit,
        total: total.count,
        pages: Math.ceil(total.count / limit)
      }
    };
  } catch (error) {
    logger.error('Failed to list users:', error);
    throw error;
  }
};