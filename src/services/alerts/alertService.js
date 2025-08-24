import EventEmitter from 'events';
import cron from 'node-cron';
import { logger, logAlert } from '../../utils/logger.js';
import { 
  getActiveAlerts, 
  getAlertsByDomain, 
  getAlertsByPattern,
  incrementTriggerCount,
  logAlert as logAlertToDb
} from '../../database/models/alert.js';
import { getUserById } from '../../database/models/user.js';

export class AlertService extends EventEmitter {
  constructor() {
    super();
    this.isRunning = false;
    this.scheduledTasks = new Map();
    this.processedEvents = new Set(); // Prevent duplicate processing
  }

  async initialize() {
    try {
      logger.info('🔔 Initializing alert service...');

      // Setup periodic alert checks
      this.setupPeriodicChecks();

      this.isRunning = true;
      logger.info('✅ Alert service initialized successfully');
    } catch (error) {
      logger.error('❌ Failed to initialize alert service:', error);
      throw error;
    }
  }

  setupPeriodicChecks() {
    // Check for expiring domains every hour
    const expiryCheck = cron.schedule('0 * * * *', async () => {
      await this.checkExpiringDomains();
    }, { scheduled: false });

    // Check for price opportunities every 15 minutes
    const priceCheck = cron.schedule('*/15 * * * *', async () => {
      await this.checkPriceOpportunities();
    }, { scheduled: false });

    // Daily summary for free users
    const dailySummary = cron.schedule('0 9 * * *', async () => {
      await this.sendDailySummaries();
    }, { scheduled: false });

    this.scheduledTasks.set('expiryCheck', expiryCheck);
    this.scheduledTasks.set('priceCheck', priceCheck);
    this.scheduledTasks.set('dailySummary', dailySummary);

    // Start all scheduled tasks
    expiryCheck.start();
    priceCheck.start();
    dailySummary.start();

    logger.info('✅ Periodic alert checks scheduled');
  }

  // Process contract events
  async processExpiryEvent(event) {
    try {
      const eventId = `${event.blockData.transactionHash}-expiry`;
      if (this.processedEvents.has(eventId)) {
        return; // Already processed
      }

      logger.info('📅 Processing expiry event', { domain: event.domain, daysUntil: event.daysUntilExpiry });

      // Find matching alerts
      const directAlerts = await getAlertsByDomain(event.domain, 'expiry');
      const patternAlerts = await getAlertsByPattern(event.domain, 'expiry');
      const allAlerts = [...directAlerts, ...patternAlerts];

      for (const alert of allAlerts) {
        try {
          // Check if this alert should trigger based on conditions
          if (this.shouldTriggerExpiryAlert(alert, event)) {
            await this.sendAlert({
              type: 'expiry',
              alertId: alert.id,
              userId: alert.userId,
              domain: event.domain,
              daysUntilExpiry: event.daysUntilExpiry,
              urgency: event.urgency,
              platform: alert.platform,
              data: event
            });

            // Update trigger count
            await incrementTriggerCount(alert.id);
          }
        } catch (error) {
          logger.error('Failed to process expiry alert', { alertId: alert.id, error: error.message });
        }
      }

      this.processedEvents.add(eventId);
      
      // Clean old processed events (keep last 1000)
      if (this.processedEvents.size > 1000) {
        const entries = Array.from(this.processedEvents);
        entries.slice(0, -900).forEach(entry => this.processedEvents.delete(entry));
      }
    } catch (error) {
      logger.error('Failed to process expiry event:', error);
    }
  }

  async processSaleEvent(event) {
    try {
      const eventId = `${event.blockData.transactionHash}-sale-${event.type}`;
      if (this.processedEvents.has(eventId)) {
        return; // Already processed
      }

      logger.info('💰 Processing sale event', { 
        domain: event.domain, 
        type: event.type, 
        price: event.price 
      });

      // Find matching alerts
      const directAlerts = await getAlertsByDomain(event.domain, 'sale');
      const patternAlerts = await getAlertsByPattern(event.domain, 'sale');
      const allAlerts = [...directAlerts, ...patternAlerts];

      for (const alert of allAlerts) {
        try {
          // Check if this alert should trigger based on conditions
          if (this.shouldTriggerSaleAlert(alert, event)) {
            await this.sendAlert({
              type: 'sale',
              alertId: alert.id,
              userId: alert.userId,
              domain: event.domain,
              saleType: event.type,
              price: event.price,
              platform: alert.platform,
              data: event
            });

            // Update trigger count
            await incrementTriggerCount(alert.id);
          }
        } catch (error) {
          logger.error('Failed to process sale alert', { alertId: alert.id, error: error.message });
        }
      }

      this.processedEvents.add(eventId);
    } catch (error) {
      logger.error('Failed to process sale event:', error);
    }
  }

  async processTransferEvent(event) {
    try {
      const eventId = `${event.blockData.transactionHash}-transfer`;
      if (this.processedEvents.has(eventId)) {
        return; // Already processed
      }

      logger.info('🔄 Processing transfer event', { 
        domain: event.domain, 
        from: event.from, 
        to: event.to 
      });

      // Find matching alerts
      const directAlerts = await getAlertsByDomain(event.domain, 'transfer');
      const patternAlerts = await getAlertsByPattern(event.domain, 'transfer');
      const allAlerts = [...directAlerts, ...patternAlerts];

      for (const alert of allAlerts) {
        try {
          // Check if this alert should trigger based on conditions
          if (this.shouldTriggerTransferAlert(alert, event)) {
            await this.sendAlert({
              type: 'transfer',
              alertId: alert.id,
              userId: alert.userId,
              domain: event.domain,
              from: event.from,
              to: event.to,
              platform: alert.platform,
              data: event
            });

            // Update trigger count
            await incrementTriggerCount(alert.id);
          }
        } catch (error) {
          logger.error('Failed to process transfer alert', { alertId: alert.id, error: error.message });
        }
      }

      this.processedEvents.add(eventId);
    } catch (error) {
      logger.error('Failed to process transfer event:', error);
    }
  }

  // Alert condition checking
  shouldTriggerExpiryAlert(alert, event) {
    const conditions = alert.conditions;
    
    // Check days threshold
    if (conditions.daysThreshold) {
      if (event.daysUntilExpiry > conditions.daysThreshold) {
        return false;
      }
    }

    // Check minimum urgency level
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

  shouldTriggerSaleAlert(alert, event) {
    const conditions = alert.conditions;
    
    // Check price range
    if (conditions.maxPrice && parseFloat(event.price) > conditions.maxPrice) {
      return false;
    }
    
    if (conditions.minPrice && parseFloat(event.price) < conditions.minPrice) {
      return false;
    }

    // Check sale type
    if (conditions.saleTypes && !conditions.saleTypes.includes(event.type)) {
      return false;
    }

    // Check domain patterns (if specified)
    if (conditions.domainPatterns) {
      const matchesPattern = conditions.domainPatterns.some(pattern => {
        const regex = new RegExp(pattern.replace(/\*/g, '.*'), 'i');
        return regex.test(event.domain);
      });
      
      if (!matchesPattern) {
        return false;
      }
    }

    return true;
  }

  shouldTriggerTransferAlert(alert, event) {
    const conditions = alert.conditions;
    
    // Check if user is involved in transfer
    if (conditions.onlyUserInvolved) {
      const user = alert.user; // Assuming user data is included
      if (user && user.walletAddress) {
        const userAddress = user.walletAddress.toLowerCase();
        if (event.from.toLowerCase() !== userAddress && event.to.toLowerCase() !== userAddress) {
          return false;
        }
      }
    }

    // Check transfer direction
    if (conditions.direction) {
      if (conditions.direction === 'incoming' && event.to.toLowerCase() !== alert.user?.walletAddress?.toLowerCase()) {
        return false;
      }
      if (conditions.direction === 'outgoing' && event.from.toLowerCase() !== alert.user?.walletAddress?.toLowerCase()) {
        return false;
      }
    }

    return true;
  }

  // Send alert to user
  async sendAlert(alertData) {
    try {
      // Get user information
      const user = await getUserById(alertData.userId);
      if (!user || !user.isActive) {
        logger.warn('Alert not sent - user inactive', { userId: alertData.userId });
        return;
      }

      // Check subscription limits for frequency
      if (!this.checkAlertFrequency(user, alertData)) {
        logger.info('Alert skipped due to frequency limits', { 
          userId: alertData.userId, 
          tier: user.subscriptionTier 
        });
        return;
      }

      // Format alert message
      const message = this.formatAlertMessage(alertData);
      const buttons = this.generateAlertButtons(alertData);

      // Emit alert event for bots to handle
      this.emit('alert', {
        ...alertData,
        user,
        message,
        buttons,
        timestamp: new Date().toISOString()
      });

      // Log alert to database
      await logAlertToDb({
        alertId: alertData.alertId,
        userId: alertData.userId,
        eventType: alertData.type,
        eventData: alertData.data,
        status: 'sent',
        platform: alertData.platform
      });

      logAlert(alertData, 'sent', { platform: alertData.platform });
    } catch (error) {
      logger.error('Failed to send alert:', error);
      
      // Log failed alert
      try {
        await logAlertToDb({
          alertId: alertData.alertId,
          userId: alertData.userId,
          eventType: alertData.type,
          eventData: alertData.data,
          status: 'failed',
          platform: alertData.platform
        });
      } catch (logError) {
        logger.error('Failed to log failed alert:', logError);
      }
    }
  }

  // Check alert frequency based on subscription tier
  checkAlertFrequency(user, alertData) {
    if (user.subscriptionTier === 'free') {
      // Free users get daily batches only for non-critical alerts
      if (alertData.urgency !== 'critical') {
        return false; // Will be included in daily summary
      }
    }
    
    // Basic and Premium users get real-time alerts
    return true;
  }

  // Format alert message based on type and platform
  formatAlertMessage(alertData) {
    const { type, domain, platform } = alertData;
    
    switch (type) {
      case 'expiry':
        return this.formatExpiryMessage(alertData);
      case 'sale':
        return this.formatSaleMessage(alertData);
      case 'transfer':
        return this.formatTransferMessage(alertData);
      default:
        return `Alert for domain ${domain}`;
    }
  }

  formatExpiryMessage(alertData) {
    const { domain, daysUntilExpiry, urgency } = alertData;
    const urgencyEmoji = {
      critical: '🚨',
      high: '⚠️',
      medium: '📅',
      low: '📋'
    };

    if (daysUntilExpiry <= 0) {
      return `${urgencyEmoji.critical} EXPIRED: Domain "${domain}" has expired!`;
    } else if (daysUntilExpiry === 1) {
      return `${urgencyEmoji.critical} URGENT: Domain "${domain}" expires in 1 day!`;
    } else {
      return `${urgencyEmoji[urgency]} Domain "${domain}" expires in ${daysUntilExpiry} days`;
    }
  }

  formatSaleMessage(alertData) {
    const { domain, saleType, price } = alertData;
    
    switch (saleType) {
      case 'listing':
        return `🏷️ NEW LISTING: "${domain}" listed for ${price} USDC`;
      case 'sale':
        return `💰 SOLD: "${domain}" sold for ${price} USDC`;
      case 'priceChange':
        return `📈 PRICE CHANGE: "${domain}" repriced to ${price} USDC`;
      default:
        return `🔔 Sale activity for "${domain}": ${price} USDC`;
    }
  }

  formatTransferMessage(alertData) {
    const { domain, from, to } = alertData;
    
    return `🔄 TRANSFER: Domain "${domain}" transferred from ${from.slice(0, 6)}... to ${to.slice(0, 6)}...`;
  }

  // Generate action buttons for alerts
  generateAlertButtons(alertData) {
    const { type, domain } = alertData;
    const buttons = [];

    switch (type) {
      case 'expiry':
        buttons.push(
          { text: 'Renew Now', action: 'renew', domain },
          { text: 'Set Reminder', action: 'remind', domain },
          { text: 'View Details', action: 'details', domain }
        );
        break;
      case 'sale':
        if (alertData.saleType === 'listing') {
          buttons.push(
            { text: 'Buy Now', action: 'buy', domain, price: alertData.price },
            { text: 'View on Doma', action: 'view', domain },
            { text: 'Set Price Alert', action: 'priceAlert', domain }
          );
        }
        break;
      case 'transfer':
        buttons.push(
          { text: 'View Transaction', action: 'viewTx', txHash: alertData.data.blockData.transactionHash },
          { text: 'View Domain', action: 'view', domain }
        );
        break;
    }

    return buttons;
  }

  // Periodic check for expiring domains
  async checkExpiringDomains() {
    try {
      logger.info('🔍 Checking for expiring domains...');
      
      const alerts = await getActiveAlerts('expiry');
      let checkedCount = 0;
      let triggeredCount = 0;

      for (const alert of alerts) {
        try {
          if (alert.domain) {
            // Check specific domain
            const domainInfo = await this.checkDomainExpiry(alert.domain);
            if (domainInfo && this.shouldTriggerExpiryAlert(alert, domainInfo)) {
              await this.sendAlert({
                type: 'expiry',
                alertId: alert.id,
                userId: alert.userId,
                domain: alert.domain,
                daysUntilExpiry: domainInfo.daysUntilExpiry,
                urgency: domainInfo.urgency,
                platform: alert.platform,
                data: domainInfo
              });
              triggeredCount++;
            }
            checkedCount++;
          }
        } catch (error) {
          logger.error('Error checking domain expiry', { 
            alertId: alert.id, 
            domain: alert.domain, 
            error: error.message 
          });
        }
      }

      logger.info('✅ Expiry check completed', { checkedCount, triggeredCount });
    } catch (error) {
      logger.error('Failed to check expiring domains:', error);
    }
  }

  // Helper method to check single domain expiry
  async checkDomainExpiry(domain) {
    // This would integrate with the contract monitor or domain service
    // For now, return mock data
    return null; // Will be implemented when integrating with ContractMonitor
  }

  // Check for price opportunities
  async checkPriceOpportunities() {
    try {
      logger.info('🔍 Checking for price opportunities...');
      
      const alerts = await getActiveAlerts('sale');
      // Implementation would check current market prices against user criteria
      
      logger.info('✅ Price opportunity check completed');
    } catch (error) {
      logger.error('Failed to check price opportunities:', error);
    }
  }

  // Send daily summaries to free users
  async sendDailySummaries() {
    try {
      logger.info('📊 Sending daily summaries...');
      
      // Get free tier users
      const freeUsers = await getUsersByTier('free');
      
      for (const user of freeUsers) {
        try {
          const summary = await this.generateDailySummary(user.id);
          if (summary.hasContent) {
            this.emit('alert', {
              type: 'dailySummary',
              userId: user.id,
              user,
              message: summary.message,
              data: summary.data,
              platform: 'both', // Send to all platforms
              timestamp: new Date().toISOString()
            });
          }
        } catch (error) {
          logger.error('Failed to send daily summary', { userId: user.id, error: error.message });
        }
      }
      
      logger.info('✅ Daily summaries sent');
    } catch (error) {
      logger.error('Failed to send daily summaries:', error);
    }
  }

  // Generate daily summary for user
  async generateDailySummary(userId) {
    // Implementation would aggregate daily domain activities
    return {
      hasContent: false,
      message: '',
      data: {}
    };
  }

  // Stop the alert service
  async stop() {
    try {
      logger.info('🛑 Stopping alert service...');

      // Stop all scheduled tasks
      for (const [name, task] of this.scheduledTasks) {
        task.destroy();
        logger.info(`Stopped scheduled task: ${name}`);
      }

      this.scheduledTasks.clear();
      this.isRunning = false;
      this.removeAllListeners();

      logger.info('✅ Alert service stopped');
    } catch (error) {
      logger.error('Error stopping alert service:', error);
      throw error;
    }
  }
}

// Helper function to get users by tier (would be in user model)
async function getUsersByTier(tier) {
  // This would be implemented in the user model
  return [];
}