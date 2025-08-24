import { ethers } from 'ethers';
import EventEmitter from 'events';
import cron from 'node-cron';
import { logger } from '../utils/logger.js';
import { updateUser, getUserById } from '../database/models/user.js';
import { database } from '../database/init.js';

// Doma Subscription Contract ABI (simplified for demo)
const DOMA_SUBSCRIPTION_ABI = [
  "event SubscriptionPurchased(address indexed user, uint8 tier, uint256 amount, uint256 duration, uint256 expiryTime)",
  "event SubscriptionRenewed(address indexed user, uint8 tier, uint256 amount, uint256 newExpiryTime)",
  "event SubscriptionCancelled(address indexed user, uint8 tier, uint256 refundAmount)",
  "function purchaseSubscription(uint8 tier, uint256 duration) payable external",
  "function renewSubscription(uint8 tier, uint256 duration) payable external",
  "function cancelSubscription() external",
  "function getSubscriptionInfo(address user) view returns (uint8 tier, uint256 expiryTime, bool isActive)",
  "function getTierPrice(uint8 tier, uint256 duration) view returns (uint256)"
];

export class SubscriptionService extends EventEmitter {
  constructor() {
    super();
    this.provider = null;
    this.subscriptionContract = null;
    this.isRunning = false;
    this.tierPrices = {
      1: ethers.parseEther('5'),   // Basic - $5 USDC
      2: ethers.parseEther('20')   // Premium - $20 USDC
    };
    this.tierNames = {
      0: 'free',
      1: 'basic', 
      2: 'premium'
    };
  }

  async initialize() {
    try {
      logger.info('💳 Initializing subscription service...');

      // Setup provider
      this.provider = new ethers.JsonRpcProvider(process.env.DOMA_TESTNET_RPC_URL);
      
      // Initialize subscription contract
      this.subscriptionContract = new ethers.Contract(
        process.env.DOMA_SUBSCRIPTION_CONTRACT_ADDRESS || process.env.DOMA_PREAUTH_CONTRACT_ADDRESS,
        DOMA_SUBSCRIPTION_ABI,
        this.provider
      );

      // Setup event listeners
      await this.setupEventListeners();

      // Setup scheduled tasks
      this.setupScheduledTasks();

      this.isRunning = true;
      logger.info('✅ Subscription service initialized');
    } catch (error) {
      logger.error('❌ Failed to initialize subscription service:', error);
      throw error;
    }
  }

  async setupEventListeners() {
    try {
      // Subscription purchased
      this.subscriptionContract.on(
        'SubscriptionPurchased', 
        this.handleSubscriptionPurchased.bind(this)
      );

      // Subscription renewed  
      this.subscriptionContract.on(
        'SubscriptionRenewed',
        this.handleSubscriptionRenewed.bind(this)
      );

      // Subscription cancelled
      this.subscriptionContract.on(
        'SubscriptionCancelled',
        this.handleSubscriptionCancelled.bind(this)
      );

      logger.info('✅ Subscription contract event listeners setup');
    } catch (error) {
      logger.error('Failed to setup subscription event listeners:', error);
    }
  }

  setupScheduledTasks() {
    // Check for expiring subscriptions daily at 2 AM
    cron.schedule('0 2 * * *', async () => {
      await this.checkExpiringSubscriptions();
    });

    // Process pending subscription updates every hour
    cron.schedule('0 * * * *', async () => {
      await this.processPendingUpdates();
    });

    logger.info('✅ Subscription scheduled tasks configured');
  }

  // Event Handlers
  async handleSubscriptionPurchased(userAddress, tier, amount, duration, expiryTime, event) {
    try {
      logger.info('Subscription purchased', {
        userAddress,
        tier: Number(tier),
        amount: ethers.formatEther(amount),
        expiryTime: Number(expiryTime),
        txHash: event.transactionHash
      });

      // Find user by wallet address
      const user = await this.findUserByWallet(userAddress);
      if (!user) {
        logger.warn('Subscription purchase for unknown user', { userAddress });
        return;
      }

      // Update user subscription
      await this.updateUserSubscription(user.id, {
        tier: this.tierNames[Number(tier)],
        expiryTime: Number(expiryTime),
        status: 'active',
        transactionHash: event.transactionHash
      });

      // Log subscription record
      await this.logSubscriptionTransaction({
        userId: user.id,
        tier: this.tierNames[Number(tier)],
        type: 'purchase',
        amount: ethers.formatEther(amount),
        duration,
        expiryTime: Number(expiryTime),
        transactionHash: event.transactionHash,
        blockNumber: event.blockNumber
      });

      // Emit event for other services
      this.emit('subscriptionActivated', {
        userId: user.id,
        tier: this.tierNames[Number(tier)],
        expiryTime: Number(expiryTime)
      });

    } catch (error) {
      logger.error('Error handling subscription purchase:', error);
    }
  }

  async handleSubscriptionRenewed(userAddress, tier, amount, newExpiryTime, event) {
    try {
      logger.info('Subscription renewed', {
        userAddress,
        tier: Number(tier),
        amount: ethers.formatEther(amount),
        newExpiryTime: Number(newExpiryTime),
        txHash: event.transactionHash
      });

      const user = await this.findUserByWallet(userAddress);
      if (!user) {
        logger.warn('Subscription renewal for unknown user', { userAddress });
        return;
      }

      // Update user subscription
      await this.updateUserSubscription(user.id, {
        tier: this.tierNames[Number(tier)],
        expiryTime: Number(newExpiryTime),
        status: 'active',
        transactionHash: event.transactionHash
      });

      // Log subscription record
      await this.logSubscriptionTransaction({
        userId: user.id,
        tier: this.tierNames[Number(tier)],
        type: 'renewal',
        amount: ethers.formatEther(amount),
        expiryTime: Number(newExpiryTime),
        transactionHash: event.transactionHash,
        blockNumber: event.blockNumber
      });

      this.emit('subscriptionRenewed', {
        userId: user.id,
        tier: this.tierNames[Number(tier)],
        expiryTime: Number(newExpiryTime)
      });

    } catch (error) {
      logger.error('Error handling subscription renewal:', error);
    }
  }

  async handleSubscriptionCancelled(userAddress, tier, refundAmount, event) {
    try {
      logger.info('Subscription cancelled', {
        userAddress,
        tier: Number(tier),
        refundAmount: ethers.formatEther(refundAmount),
        txHash: event.transactionHash
      });

      const user = await this.findUserByWallet(userAddress);
      if (!user) {
        logger.warn('Subscription cancellation for unknown user', { userAddress });
        return;
      }

      // Update user to free tier
      await this.updateUserSubscription(user.id, {
        tier: 'free',
        expiryTime: null,
        status: 'cancelled',
        transactionHash: event.transactionHash
      });

      // Log cancellation
      await this.logSubscriptionTransaction({
        userId: user.id,
        tier: 'free',
        type: 'cancellation',
        amount: `-${ethers.formatEther(refundAmount)}`,
        transactionHash: event.transactionHash,
        blockNumber: event.blockNumber
      });

      this.emit('subscriptionCancelled', {
        userId: user.id,
        refundAmount: ethers.formatEther(refundAmount)
      });

    } catch (error) {
      logger.error('Error handling subscription cancellation:', error);
    }
  }

  // Subscription Management Methods
  async purchaseSubscription(userId, tier, duration = 30, signer) {
    try {
      const user = await getUserById(userId);
      if (!user || !user.walletAddress) {
        throw new Error('User not found or wallet address not set');
      }

      // Validate tier
      if (!['basic', 'premium'].includes(tier)) {
        throw new Error('Invalid subscription tier');
      }

      const tierNumber = tier === 'basic' ? 1 : 2;
      const durationSeconds = duration * 24 * 60 * 60; // Convert days to seconds

      // Get price from contract
      const price = await this.subscriptionContract.getTierPrice(tierNumber, durationSeconds);

      // Execute purchase transaction
      const contractWithSigner = this.subscriptionContract.connect(signer);
      const tx = await contractWithSigner.purchaseSubscription(tierNumber, durationSeconds, {
        value: price
      });

      logger.info('Subscription purchase transaction sent', {
        userId,
        tier,
        duration,
        price: ethers.formatEther(price),
        txHash: tx.hash
      });

      // Wait for confirmation
      const receipt = await tx.wait();

      // Create pending subscription record
      await this.createPendingSubscription({
        userId,
        tier,
        duration,
        amount: ethers.formatEther(price),
        transactionHash: receipt.hash,
        status: 'pending_confirmation'
      });

      return {
        success: true,
        transactionHash: receipt.hash,
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed.toString(),
        price: ethers.formatEther(price)
      };

    } catch (error) {
      logger.error('Failed to purchase subscription:', error);
      throw error;
    }
  }

  async renewSubscription(userId, duration = 30, signer) {
    try {
      const user = await getUserById(userId);
      if (!user || !user.walletAddress) {
        throw new Error('User not found or wallet address not set');
      }

      if (user.subscriptionTier === 'free') {
        throw new Error('No active subscription to renew');
      }

      const tierNumber = user.subscriptionTier === 'basic' ? 1 : 2;
      const durationSeconds = duration * 24 * 60 * 60;

      // Get price from contract
      const price = await this.subscriptionContract.getTierPrice(tierNumber, durationSeconds);

      // Execute renewal transaction
      const contractWithSigner = this.subscriptionContract.connect(signer);
      const tx = await contractWithSigner.renewSubscription(tierNumber, durationSeconds, {
        value: price
      });

      logger.info('Subscription renewal transaction sent', {
        userId,
        tier: user.subscriptionTier,
        duration,
        price: ethers.formatEther(price),
        txHash: tx.hash
      });

      const receipt = await tx.wait();

      return {
        success: true,
        transactionHash: receipt.hash,
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed.toString(),
        price: ethers.formatEther(price)
      };

    } catch (error) {
      logger.error('Failed to renew subscription:', error);
      throw error;
    }
  }

  async cancelSubscription(userId, signer) {
    try {
      const user = await getUserById(userId);
      if (!user || !user.walletAddress) {
        throw new Error('User not found or wallet address not set');
      }

      if (user.subscriptionTier === 'free') {
        throw new Error('No active subscription to cancel');
      }

      // Execute cancellation transaction
      const contractWithSigner = this.subscriptionContract.connect(signer);
      const tx = await contractWithSigner.cancelSubscription();

      logger.info('Subscription cancellation transaction sent', {
        userId,
        tier: user.subscriptionTier,
        txHash: tx.hash
      });

      const receipt = await tx.wait();

      return {
        success: true,
        transactionHash: receipt.hash,
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed.toString()
      };

    } catch (error) {
      logger.error('Failed to cancel subscription:', error);
      throw error;
    }
  }

  async getSubscriptionStatus(userId) {
    try {
      const user = await getUserById(userId);
      if (!user) {
        throw new Error('User not found');
      }

      // Get current status from database
      const dbStatus = {
        tier: user.subscriptionTier || 'free',
        expiryTime: user.subscriptionExpiry,
        isActive: user.subscriptionTier !== 'free' && 
                  (!user.subscriptionExpiry || new Date(user.subscriptionExpiry) > new Date())
      };

      // If user has wallet, also check on-chain status
      let onChainStatus = null;
      if (user.walletAddress) {
        try {
          const chainResult = await this.subscriptionContract.getSubscriptionInfo(user.walletAddress);
          onChainStatus = {
            tier: this.tierNames[Number(chainResult[0])] || 'free',
            expiryTime: Number(chainResult[1]),
            isActive: chainResult[2]
          };
        } catch (error) {
          logger.warn('Failed to get on-chain subscription status:', error);
        }
      }

      // Get subscription history
      const history = await this.getSubscriptionHistory(userId);

      return {
        current: dbStatus,
        onChain: onChainStatus,
        history: history.slice(0, 10), // Last 10 transactions
        benefits: this.getTierBenefits(dbStatus.tier)
      };

    } catch (error) {
      logger.error('Failed to get subscription status:', error);
      throw error;
    }
  }

  getTierBenefits(tier) {
    const benefits = {
      free: {
        alerts: 5,
        platforms: ['telegram', 'twitter'],
        frequency: 'daily',
        autoActions: false,
        support: 'community',
        features: ['Basic alerts', 'Daily summaries', 'Domain lookup']
      },
      basic: {
        alerts: 20,
        platforms: ['telegram', 'twitter', 'web'],
        frequency: 'realtime',
        autoActions: false,
        support: 'email',
        features: ['Real-time alerts', 'Custom filters', 'Multi-chain support', 'Priority notifications']
      },
      premium: {
        alerts: 999999,
        platforms: ['telegram', 'twitter', 'web'],
        frequency: 'realtime',
        autoActions: true,
        support: '24/7',
        features: ['Unlimited alerts', 'Auto-actions', 'Advanced analytics', 'Priority support', 'Early access', '10% Doma discount']
      }
    };

    return benefits[tier] || benefits.free;
  }

  // Helper Methods
  async findUserByWallet(walletAddress) {
    try {
      const result = await database.get(
        'SELECT * FROM users WHERE LOWER(walletAddress) = LOWER(?)',
        [walletAddress]
      );
      return result;
    } catch (error) {
      logger.error('Failed to find user by wallet:', error);
      return null;
    }
  }

  async updateUserSubscription(userId, subscriptionData) {
    try {
      const updateData = {
        subscriptionTier: subscriptionData.tier,
        subscriptionExpiry: subscriptionData.expiryTime ? 
          new Date(subscriptionData.expiryTime * 1000).toISOString() : null,
        updatedAt: new Date().toISOString()
      };

      await updateUser(userId, updateData);

      // Also update subscriptions table
      await database.run(
        `INSERT INTO subscriptions (
          userId, tier, status, startDate, endDate, transactionHash
        ) VALUES (?, ?, ?, ?, ?, ?)`,
        [
          userId,
          subscriptionData.tier,
          subscriptionData.status || 'active',
          new Date().toISOString(),
          subscriptionData.expiryTime ? new Date(subscriptionData.expiryTime * 1000).toISOString() : null,
          subscriptionData.transactionHash
        ]
      );

      logger.info('User subscription updated', { userId, tier: subscriptionData.tier });
    } catch (error) {
      logger.error('Failed to update user subscription:', error);
      throw error;
    }
  }

  async logSubscriptionTransaction(transactionData) {
    try {
      await database.run(
        `INSERT INTO transaction_logs (
          userId, type, transactionHash, amount, token, status, blockNumber
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          transactionData.userId,
          'subscription',
          transactionData.transactionHash,
          transactionData.amount,
          'USDC',
          'confirmed',
          transactionData.blockNumber
        ]
      );
    } catch (error) {
      logger.error('Failed to log subscription transaction:', error);
    }
  }

  async createPendingSubscription(subscriptionData) {
    try {
      await database.run(
        `INSERT INTO subscriptions (
          userId, tier, status, transactionHash, createdAt
        ) VALUES (?, ?, ?, ?, ?)`,
        [
          subscriptionData.userId,
          subscriptionData.tier,
          subscriptionData.status,
          subscriptionData.transactionHash,
          new Date().toISOString()
        ]
      );
    } catch (error) {
      logger.error('Failed to create pending subscription:', error);
    }
  }

  async getSubscriptionHistory(userId, limit = 20) {
    try {
      const history = await database.all(
        `SELECT * FROM subscriptions 
         WHERE userId = ? 
         ORDER BY createdAt DESC 
         LIMIT ?`,
        [userId, limit]
      );
      return history;
    } catch (error) {
      logger.error('Failed to get subscription history:', error);
      return [];
    }
  }

  async checkExpiringSubscriptions() {
    try {
      logger.info('🔍 Checking for expiring subscriptions...');

      // Find subscriptions expiring in next 3 days
      const threeDaysFromNow = new Date();
      threeDaysFromNow.setDate(threeDaysFromNow.getDate() + 3);

      const expiringUsers = await database.all(
        `SELECT id, username, subscriptionTier, subscriptionExpiry, telegramId, twitterId
         FROM users 
         WHERE subscriptionTier != 'free' 
         AND subscriptionExpiry IS NOT NULL 
         AND subscriptionExpiry <= ? 
         AND subscriptionExpiry > datetime('now')`,
        [threeDaysFromNow.toISOString()]
      );

      for (const user of expiringUsers) {
        await this.notifyExpiringSubscription(user);
      }

      // Find expired subscriptions
      const expiredUsers = await database.all(
        `SELECT id, username, subscriptionTier, subscriptionExpiry
         FROM users 
         WHERE subscriptionTier != 'free' 
         AND subscriptionExpiry IS NOT NULL 
         AND subscriptionExpiry <= datetime('now')`
      );

      for (const user of expiredUsers) {
        await this.handleExpiredSubscription(user);
      }

      logger.info(`✅ Subscription check completed`, {
        expiring: expiringUsers.length,
        expired: expiredUsers.length
      });

    } catch (error) {
      logger.error('Failed to check expiring subscriptions:', error);
    }
  }

  async notifyExpiringSubscription(user) {
    try {
      const expiryDate = new Date(user.subscriptionExpiry);
      const daysUntilExpiry = Math.ceil((expiryDate - new Date()) / (1000 * 60 * 60 * 24));

      this.emit('subscriptionExpiring', {
        userId: user.id,
        tier: user.subscriptionTier,
        daysUntilExpiry,
        expiryDate
      });

      logger.info('Expiring subscription notification sent', {
        userId: user.id,
        daysUntilExpiry
      });

    } catch (error) {
      logger.error('Failed to notify expiring subscription:', error);
    }
  }

  async handleExpiredSubscription(user) {
    try {
      // Downgrade to free tier
      await updateUser(user.id, {
        subscriptionTier: 'free',
        subscriptionExpiry: null
      });

      this.emit('subscriptionExpired', {
        userId: user.id,
        previousTier: user.subscriptionTier
      });

      logger.info('Subscription expired and downgraded', {
        userId: user.id,
        previousTier: user.subscriptionTier
      });

    } catch (error) {
      logger.error('Failed to handle expired subscription:', error);
    }
  }

  async processPendingUpdates() {
    try {
      // Check for pending subscriptions that might have been confirmed
      const pending = await database.all(
        `SELECT * FROM subscriptions 
         WHERE status = 'pending_confirmation' 
         AND createdAt > datetime('now', '-24 hours')`
      );

      for (const subscription of pending) {
        try {
          // Check if transaction was confirmed
          const receipt = await this.provider.getTransactionReceipt(subscription.transactionHash);
          if (receipt && receipt.status === 1) {
            // Mark as confirmed
            await database.run(
              'UPDATE subscriptions SET status = ? WHERE id = ?',
              ['confirmed', subscription.id]
            );
            logger.info('Pending subscription confirmed', { subscriptionId: subscription.id });
          }
        } catch (error) {
          // Transaction might still be pending
          logger.debug('Transaction still pending', { txHash: subscription.transactionHash });
        }
      }

    } catch (error) {
      logger.error('Failed to process pending updates:', error);
    }
  }

  async stop() {
    try {
      logger.info('🛑 Stopping subscription service...');
      
      this.isRunning = false;
      this.removeAllListeners();
      
      logger.info('✅ Subscription service stopped');
    } catch (error) {
      logger.error('Error stopping subscription service:', error);
      throw error;
    }
  }
}