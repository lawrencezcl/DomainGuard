import { ethers } from 'ethers';
import EventEmitter from 'events';
import cron from 'node-cron';
import { logger } from '../utils/logger.js';
import { getUserById } from '../database/models/user.js';
import { DomainService } from '../contracts/domainService.js';
import { database } from '../database/init.js';

export class AutoActionsService extends EventEmitter {
  constructor(contractMonitor) {
    super();
    this.contractMonitor = contractMonitor;
    this.domainService = new DomainService(contractMonitor);
    this.provider = contractMonitor.provider;
    this.isRunning = false;
    this.activeActions = new Map(); // Track running actions
    this.monthlySpending = new Map(); // Track monthly spending per user
  }

  async initialize() {
    try {
      logger.info('⚡ Initializing auto-actions service...');

      // Setup event listeners for triggers
      this.setupEventListeners();

      // Setup scheduled tasks
      this.setupScheduledTasks();

      this.isRunning = true;
      logger.info('✅ Auto-actions service initialized');
    } catch (error) {
      logger.error('❌ Failed to initialize auto-actions service:', error);
      throw error;
    }
  }

  setupEventListeners() {
    // Listen for domain expiry events
    this.contractMonitor.on('domainExpiry', async (event) => {
      await this.checkAutoRenewal(event);
    });

    // Listen for domain sale events
    this.contractMonitor.on('domainSale', async (event) => {
      await this.checkAutoPurchase(event);
    });

    // Listen for auction events (if implemented)
    this.contractMonitor.on('domainAuction', async (event) => {
      await this.checkAutoBid(event);
    });

    logger.info('✅ Auto-actions event listeners setup');
  }

  setupScheduledTasks() {
    // Reset monthly spending limits on 1st of each month
    cron.schedule('0 0 1 * *', async () => {
      await this.resetMonthlyLimits();
    });

    // Check for stale actions every hour
    cron.schedule('0 * * * *', async () => {
      await this.cleanupStaleActions();
    });

    // Process queued actions every 5 minutes
    cron.schedule('*/5 * * * *', async () => {
      await this.processQueuedActions();
    });

    logger.info('✅ Auto-actions scheduled tasks configured');
  }

  // Auto-Renewal Logic
  async checkAutoRenewal(event) {
    try {
      const { domain, daysUntilExpiry, owner } = event;

      // Find users with auto-renewal enabled for this domain
      const autoActions = await this.getAutoActions({
        type: 'renew',
        domain,
        isActive: true
      });

      for (const action of autoActions) {
        try {
          // Verify user still has premium subscription
          const user = await getUserById(action.userId);
          if (!user || user.subscriptionTier !== 'premium') {
            logger.warn('Auto-renewal skipped - user not premium', { 
              userId: action.userId, 
              domain 
            });
            continue;
          }

          // Check if user owns the domain
          if (user.walletAddress?.toLowerCase() !== owner?.toLowerCase()) {
            logger.warn('Auto-renewal skipped - user does not own domain', {
              userId: action.userId,
              domain,
              userWallet: user.walletAddress,
              domainOwner: owner
            });
            continue;
          }

          // Check conditions
          if (this.shouldExecuteAutoRenewal(action.conditions, event)) {
            await this.executeAutoRenewal(action, event);
          }
        } catch (error) {
          logger.error('Error processing auto-renewal', {
            actionId: action.id,
            domain,
            error: error.message
          });
        }
      }
    } catch (error) {
      logger.error('Error checking auto-renewal:', error);
    }
  }

  shouldExecuteAutoRenewal(conditions, event) {
    // Check days threshold
    if (conditions.daysBeforeExpiry) {
      if (event.daysUntilExpiry > conditions.daysBeforeExpiry) {
        return false;
      }
    }

    // Check minimum urgency
    if (conditions.minUrgency) {
      const urgencyLevels = { low: 0, medium: 1, high: 2, critical: 3 };
      const eventLevel = urgencyLevels[event.urgency] || 0;
      const minLevel = urgencyLevels[conditions.minUrgency] || 0;
      
      if (eventLevel < minLevel) {
        return false;
      }
    }

    return true;
  }

  async executeAutoRenewal(action, event) {
    try {
      const actionKey = `renewal_${action.id}_${event.domain}`;
      
      // Prevent duplicate executions
      if (this.activeActions.has(actionKey)) {
        logger.info('Auto-renewal already in progress', { actionKey });
        return;
      }

      this.activeActions.set(actionKey, { startTime: Date.now(), action, event });

      logger.info('Executing auto-renewal', {
        actionId: action.id,
        userId: action.userId,
        domain: event.domain,
        daysUntilExpiry: event.daysUntilExpiry
      });

      // Check spending limits
      if (!(await this.checkSpendingLimits(action.userId, action.maxAmount))) {
        throw new Error('Monthly spending limit exceeded');
      }

      // Get user wallet signer
      const user = await getUserById(action.userId);
      const signer = await this.getUserSigner(user);

      // Execute renewal
      const renewalDuration = action.conditions.renewalDuration || 365; // Default 1 year
      const result = await this.domainService.renewDomain(
        event.domain, 
        renewalDuration * 24 * 60 * 60, // Convert days to seconds
        signer
      );

      // Update spending tracking
      await this.trackSpending(action.userId, action.maxAmount);

      // Log successful action
      await this.logAutoAction({
        actionId: action.id,
        userId: action.userId,
        type: 'renew',
        domain: event.domain,
        amount: action.maxAmount,
        transactionHash: result.transactionHash,
        status: 'success',
        metadata: {
          daysUntilExpiry: event.daysUntilExpiry,
          renewalDuration,
          gasUsed: result.gasUsed
        }
      });

      // Update execution count
      await this.updateActionExecutionCount(action.id);

      // Emit success event
      this.emit('autoActionExecuted', {
        type: 'renewal',
        userId: action.userId,
        domain: event.domain,
        success: true,
        transactionHash: result.transactionHash
      });

      logger.info('Auto-renewal executed successfully', {
        actionId: action.id,
        domain: event.domain,
        txHash: result.transactionHash
      });

    } catch (error) {
      logger.error('Auto-renewal execution failed', {
        actionId: action.id,
        domain: event.domain,
        error: error.message
      });

      // Log failed action
      await this.logAutoAction({
        actionId: action.id,
        userId: action.userId,
        type: 'renew',
        domain: event.domain,
        amount: 0,
        status: 'failed',
        errorMessage: error.message
      });

      this.emit('autoActionFailed', {
        type: 'renewal',
        userId: action.userId,
        domain: event.domain,
        error: error.message
      });

    } finally {
      this.activeActions.delete(actionKey);
    }
  }

  // Auto-Purchase Logic
  async checkAutoPurchase(event) {
    try {
      if (event.type !== 'listing') {
        return; // Only process new listings
      }

      const { domain, price, seller } = event;
      const priceNum = parseFloat(price);

      // Find users with auto-purchase enabled
      const autoActions = await this.getAutoActions({
        type: 'buy',
        isActive: true
      });

      for (const action of autoActions) {
        try {
          // Verify user has premium subscription
          const user = await getUserById(action.userId);
          if (!user || user.subscriptionTier !== 'premium') {
            continue;
          }

          // Check if this purchase matches user's criteria
          if (this.shouldExecuteAutoPurchase(action, event)) {
            await this.executeAutoPurchase(action, event);
          }
        } catch (error) {
          logger.error('Error processing auto-purchase', {
            actionId: action.id,
            domain,
            error: error.message
          });
        }
      }
    } catch (error) {
      logger.error('Error checking auto-purchase:', error);
    }
  }

  shouldExecuteAutoPurchase(action, event) {
    const conditions = action.conditions;
    const priceNum = parseFloat(event.price);

    // Check price limits
    if (priceNum > action.maxAmount) {
      return false;
    }

    if (conditions.maxPrice && priceNum > conditions.maxPrice) {
      return false;
    }

    if (conditions.minPrice && priceNum < conditions.minPrice) {
      return false;
    }

    // Check domain patterns
    if (conditions.domainPatterns) {
      const matchesPattern = conditions.domainPatterns.some(pattern => {
        const regex = new RegExp(pattern.replace(/\*/g, '.*'), 'i');
        return regex.test(event.domain);
      });
      
      if (!matchesPattern) {
        return false;
      }
    }

    // Check specific domains
    if (conditions.targetDomains) {
      if (!conditions.targetDomains.includes(event.domain)) {
        return false;
      }
    }

    // Check seller exclusions
    if (conditions.excludeSellers) {
      if (conditions.excludeSellers.includes(event.seller?.toLowerCase())) {
        return false;
      }
    }

    return true;
  }

  async executeAutoPurchase(action, event) {
    try {
      const actionKey = `purchase_${action.id}_${event.domain}`;
      
      if (this.activeActions.has(actionKey)) {
        return;
      }

      this.activeActions.set(actionKey, { startTime: Date.now(), action, event });

      logger.info('Executing auto-purchase', {
        actionId: action.id,
        userId: action.userId,
        domain: event.domain,
        price: event.price
      });

      // Check spending limits
      const purchaseAmount = parseFloat(event.price);
      if (!(await this.checkSpendingLimits(action.userId, purchaseAmount))) {
        throw new Error('Monthly spending limit exceeded');
      }

      // Get user signer
      const user = await getUserById(action.userId);
      const signer = await this.getUserSigner(user);

      // Execute purchase
      const result = await this.domainService.buyDomain(event.domain, signer);

      // Update spending tracking
      await this.trackSpending(action.userId, purchaseAmount);

      // Log successful action
      await this.logAutoAction({
        actionId: action.id,
        userId: action.userId,
        type: 'buy',
        domain: event.domain,
        amount: purchaseAmount,
        transactionHash: result.transactionHash,
        status: 'success',
        metadata: {
          seller: event.seller,
          gasUsed: result.gasUsed,
          pricePaid: result.pricePaid
        }
      });

      await this.updateActionExecutionCount(action.id);

      this.emit('autoActionExecuted', {
        type: 'purchase',
        userId: action.userId,
        domain: event.domain,
        success: true,
        transactionHash: result.transactionHash,
        amount: purchaseAmount
      });

      logger.info('Auto-purchase executed successfully', {
        actionId: action.id,
        domain: event.domain,
        price: event.price,
        txHash: result.transactionHash
      });

    } catch (error) {
      logger.error('Auto-purchase execution failed', {
        actionId: action.id,
        domain: event.domain,
        error: error.message
      });

      await this.logAutoAction({
        actionId: action.id,
        userId: action.userId,
        type: 'buy',
        domain: event.domain,
        amount: 0,
        status: 'failed',
        errorMessage: error.message
      });

      this.emit('autoActionFailed', {
        type: 'purchase',
        userId: action.userId,
        domain: event.domain,
        error: error.message
      });

    } finally {
      this.activeActions.delete(actionKey);
    }
  }

  // Auto-Bid Logic (for auctions)
  async checkAutoBid(event) {
    try {
      const { domain, currentBid, auctionEnd } = event;

      // Find users with auto-bid enabled
      const autoActions = await this.getAutoActions({
        type: 'bid',
        isActive: true
      });

      for (const action of autoActions) {
        try {
          const user = await getUserById(action.userId);
          if (!user || user.subscriptionTier !== 'premium') {
            continue;
          }

          if (this.shouldExecuteAutoBid(action, event)) {
            await this.executeAutoBid(action, event);
          }
        } catch (error) {
          logger.error('Error processing auto-bid', {
            actionId: action.id,
            domain,
            error: error.message
          });
        }
      }
    } catch (error) {
      logger.error('Error checking auto-bid:', error);
    }
  }

  // Utility Methods
  async checkSpendingLimits(userId, amount) {
    try {
      const user = await getUserById(userId);
      const monthlyLimit = user.monthlySpendLimit || 200;
      
      const currentMonth = new Date().toISOString().substring(0, 7); // YYYY-MM
      const currentSpending = this.monthlySpending.get(`${userId}_${currentMonth}`) || 0;

      return (currentSpending + amount) <= monthlyLimit;
    } catch (error) {
      logger.error('Error checking spending limits:', error);
      return false;
    }
  }

  async trackSpending(userId, amount) {
    try {
      const currentMonth = new Date().toISOString().substring(0, 7);
      const key = `${userId}_${currentMonth}`;
      const currentSpending = this.monthlySpending.get(key) || 0;
      
      this.monthlySpending.set(key, currentSpending + amount);

      // Also log to database
      await database.run(
        `INSERT INTO transaction_logs (
          userId, type, amount, token, status, createdAt
        ) VALUES (?, ?, ?, ?, ?, ?)`,
        [userId, 'auto_action', amount, 'USDC', 'confirmed', new Date().toISOString()]
      );
    } catch (error) {
      logger.error('Error tracking spending:', error);
    }
  }

  async getUserSigner(user) {
    // This would implement wallet integration
    // For now, return a mock signer
    // In production, this would use:
    // - Hardware wallet integration
    // - Hot wallet with encrypted private keys
    // - Multi-sig wallet integration
    // - Or user-provided signatures via web interface
    
    throw new Error('Wallet integration not implemented - requires user signature');
  }

  async getAutoActions(criteria) {
    try {
      let whereClause = 'WHERE 1=1';
      const params = [];

      if (criteria.type) {
        whereClause += ' AND type = ?';
        params.push(criteria.type);
      }

      if (criteria.domain) {
        whereClause += ' AND (JSON_EXTRACT(conditions, "$.targetDomains") LIKE ? OR JSON_EXTRACT(conditions, "$.domainPatterns") LIKE ?)';
        params.push(`%${criteria.domain}%`, `%${criteria.domain}%`);
      }

      if (criteria.isActive !== undefined) {
        whereClause += ' AND isActive = ?';
        params.push(criteria.isActive ? 1 : 0);
      }

      const actions = await database.all(
        `SELECT aa.*, u.subscriptionTier, u.monthlySpendLimit, u.walletAddress
         FROM auto_actions aa
         JOIN users u ON aa.userId = u.id
         ${whereClause}`,
        params
      );

      return actions.map(action => ({
        ...action,
        conditions: JSON.parse(action.conditions || '{}')
      }));
    } catch (error) {
      logger.error('Error getting auto-actions:', error);
      return [];
    }
  }

  async logAutoAction(actionData) {
    try {
      await database.run(
        `INSERT INTO auto_action_logs (
          actionId, userId, domain, amount, transactionHash, status, errorMessage
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          actionData.actionId,
          actionData.userId,
          actionData.domain,
          actionData.amount,
          actionData.transactionHash,
          actionData.status,
          actionData.errorMessage
        ]
      );

      logger.info('Auto-action logged', {
        actionId: actionData.actionId,
        type: actionData.type,
        status: actionData.status
      });
    } catch (error) {
      logger.error('Failed to log auto-action:', error);
    }
  }

  async updateActionExecutionCount(actionId) {
    try {
      await database.run(
        `UPDATE auto_actions 
         SET executionCount = executionCount + 1, 
             lastExecuted = CURRENT_TIMESTAMP 
         WHERE id = ?`,
        [actionId]
      );
    } catch (error) {
      logger.error('Failed to update action execution count:', error);
    }
  }

  // CRUD Operations for Auto-Actions
  async createAutoAction(userId, actionData) {
    try {
      // Verify user has premium subscription
      const user = await getUserById(userId);
      if (!user || user.subscriptionTier !== 'premium') {
        throw new Error('Premium subscription required for auto-actions');
      }

      const result = await database.run(
        `INSERT INTO auto_actions (
          userId, type, conditions, maxAmount
        ) VALUES (?, ?, ?, ?)`,
        [
          userId,
          actionData.type,
          JSON.stringify(actionData.conditions),
          actionData.maxAmount
        ]
      );

      logger.info('Auto-action created', {
        actionId: result.lastID,
        userId,
        type: actionData.type
      });

      return result.lastID;
    } catch (error) {
      logger.error('Failed to create auto-action:', error);
      throw error;
    }
  }

  async getUserAutoActions(userId) {
    try {
      const actions = await database.all(
        'SELECT * FROM auto_actions WHERE userId = ? ORDER BY createdAt DESC',
        [userId]
      );

      return actions.map(action => ({
        ...action,
        conditions: JSON.parse(action.conditions || '{}')
      }));
    } catch (error) {
      logger.error('Failed to get user auto-actions:', error);
      return [];
    }
  }

  async updateAutoAction(actionId, userId, updateData) {
    try {
      const fields = [];
      const values = [];

      if (updateData.conditions) {
        fields.push('conditions = ?');
        values.push(JSON.stringify(updateData.conditions));
      }

      if (updateData.maxAmount !== undefined) {
        fields.push('maxAmount = ?');
        values.push(updateData.maxAmount);
      }

      if (updateData.isActive !== undefined) {
        fields.push('isActive = ?');
        values.push(updateData.isActive ? 1 : 0);
      }

      if (fields.length === 0) {
        throw new Error('No fields to update');
      }

      fields.push('updatedAt = CURRENT_TIMESTAMP');
      values.push(actionId, userId);

      await database.run(
        `UPDATE auto_actions SET ${fields.join(', ')} 
         WHERE id = ? AND userId = ?`,
        values
      );

      logger.info('Auto-action updated', { actionId, userId });
    } catch (error) {
      logger.error('Failed to update auto-action:', error);
      throw error;
    }
  }

  async deleteAutoAction(actionId, userId) {
    try {
      const result = await database.run(
        'DELETE FROM auto_actions WHERE id = ? AND userId = ?',
        [actionId, userId]
      );

      if (result.changes === 0) {
        throw new Error('Auto-action not found');
      }

      logger.info('Auto-action deleted', { actionId, userId });
    } catch (error) {
      logger.error('Failed to delete auto-action:', error);
      throw error;
    }
  }

  // Cleanup Methods
  async resetMonthlyLimits() {
    try {
      logger.info('🔄 Resetting monthly spending limits...');
      
      // Clear in-memory tracking
      this.monthlySpending.clear();
      
      logger.info('✅ Monthly spending limits reset');
    } catch (error) {
      logger.error('Failed to reset monthly limits:', error);
    }
  }

  async cleanupStaleActions() {
    try {
      const staleThreshold = Date.now() - (60 * 60 * 1000); // 1 hour
      let cleaned = 0;

      for (const [key, action] of this.activeActions.entries()) {
        if (action.startTime < staleThreshold) {
          this.activeActions.delete(key);
          cleaned++;
        }
      }

      if (cleaned > 0) {
        logger.info('Cleaned up stale actions', { count: cleaned });
      }
    } catch (error) {
      logger.error('Failed to cleanup stale actions:', error);
    }
  }

  async processQueuedActions() {
    try {
      // This could process any queued actions that need retry
      // For now, just log that we're checking
      logger.debug('Processing queued actions...');
    } catch (error) {
      logger.error('Failed to process queued actions:', error);
    }
  }

  async stop() {
    try {
      logger.info('🛑 Stopping auto-actions service...');
      
      this.isRunning = false;
      this.activeActions.clear();
      this.monthlySpending.clear();
      this.removeAllListeners();
      
      logger.info('✅ Auto-actions service stopped');
    } catch (error) {
      logger.error('Error stopping auto-actions service:', error);
      throw error;
    }
  }
}