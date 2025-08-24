import Twit from 'twit';
import cron from 'node-cron';
import { logger, logBotAction } from '../utils/logger.js';
import { checkBotRateLimit } from '../middleware/rateLimiter.js';
import { 
  createUser, 
  getUserByTwitterId, 
  updateUser 
} from '../database/models/user.js';
import { 
  createAlert, 
  getAlertsByUserId 
} from '../database/models/alert.js';

export class TwitterBot {
  constructor() {
    this.client = null;
    this.isRunning = false;
    this.mentionStreamRunning = false;
    this.lastProcessedTweetId = null;
    this.dailyOpportunities = [];
  }

  async initialize() {
    try {
      logger.info('🐦 Initializing Twitter bot...');

      if (!this.validateCredentials()) {
        throw new Error('Twitter API credentials are missing or invalid');
      }

      // Initialize Twitter client
      this.client = new Twit({
        consumer_key: process.env.TWITTER_API_KEY,
        consumer_secret: process.env.TWITTER_API_SECRET,
        access_token: process.env.TWITTER_ACCESS_TOKEN,
        access_token_secret: process.env.TWITTER_ACCESS_TOKEN_SECRET,
        timeout_ms: 60 * 1000,
        strictSSL: true
      });

      // Test connection
      await this.testConnection();

      // Setup mention monitoring
      await this.setupMentionMonitoring();

      // Setup scheduled tasks
      this.setupScheduledTasks();

      this.isRunning = true;
      logger.info('✅ Twitter bot initialized successfully');
    } catch (error) {
      logger.error('❌ Failed to initialize Twitter bot:', error);
      throw error;
    }
  }

  validateCredentials() {
    const required = [
      'TWITTER_API_KEY',
      'TWITTER_API_SECRET', 
      'TWITTER_ACCESS_TOKEN',
      'TWITTER_ACCESS_TOKEN_SECRET'
    ];

    return required.every(key => process.env[key]);
  }

  async testConnection() {
    try {
      const result = await this.client.get('account/verify_credentials', {});
      logger.info('Twitter connection verified', { 
        username: result.data.screen_name,
        followers: result.data.followers_count 
      });
      return result.data;
    } catch (error) {
      logger.error('Twitter connection test failed:', error);
      throw new Error('Failed to connect to Twitter API');
    }
  }

  async setupMentionMonitoring() {
    try {
      // Get our bot's user info
      const botInfo = await this.testConnection();
      const botUsername = botInfo.screen_name;

      // Start mention stream
      const stream = this.client.stream('statuses/filter', { 
        track: `@${botUsername}` 
      });

      stream.on('tweet', async (tweet) => {
        await this.handleMention(tweet);
      });

      stream.on('error', (error) => {
        logger.error('Twitter stream error:', error);
        // Attempt to restart stream after delay
        setTimeout(() => {
          if (this.isRunning) {
            this.setupMentionMonitoring();
          }
        }, 30000);
      });

      stream.on('disconnect', (disconnectMessage) => {
        logger.warn('Twitter stream disconnected:', disconnectMessage);
      });

      this.mentionStreamRunning = true;
      logger.info('✅ Twitter mention monitoring started');
    } catch (error) {
      logger.error('Failed to setup mention monitoring:', error);
    }
  }

  async handleMention(tweet) {
    try {
      // Skip retweets and replies to others
      if (tweet.retweeted_status || 
          (tweet.in_reply_to_screen_name && 
           tweet.in_reply_to_screen_name !== tweet.user.screen_name)) {
        return;
      }

      const userId = tweet.user.id_str;
      const username = tweet.user.screen_name;
      const tweetText = tweet.text || tweet.full_text || '';

      // Rate limiting check
      const rateCheck = await checkBotRateLimit(userId, 'twitter');
      if (!rateCheck.allowed) {
        await this.replyToTweet(tweet.id_str, 
          `⏳ Hi @${username}! You're sending commands too quickly. ${rateCheck.message}`);
        return;
      }

      logger.info('Processing Twitter mention', { 
        tweetId: tweet.id_str, 
        username, 
        text: tweetText 
      });

      // Parse command from tweet
      const command = this.parseCommand(tweetText);
      await this.processCommand(tweet, command);

      logBotAction('twitter', 'mention_processed', {
        userId,
        tweetId: tweet.id_str,
        command: command.action,
        success: true
      });
    } catch (error) {
      logger.error('Error handling Twitter mention:', error);
      
      // Try to send error response
      try {
        await this.replyToTweet(tweet.id_str, 
          `❌ Sorry @${tweet.user.screen_name}, something went wrong. Please try again or contact support.`);
      } catch (replyError) {
        logger.error('Failed to send error reply:', replyError);
      }
    }
  }

  parseCommand(text) {
    // Clean the text
    const cleanText = text.toLowerCase()
      .replace(/@domalertbot/g, '')
      .replace(/[^\w\s.]/g, ' ')
      .trim();

    // Extract command and parameters
    const words = cleanText.split(/\s+/).filter(word => word.length > 0);
    
    if (words.length === 0) {
      return { action: 'help', params: [] };
    }

    const action = words[0];
    const params = words.slice(1);

    // Command mapping
    const commandMap = {
      'monitor': 'monitor',
      'watch': 'monitor',
      'track': 'monitor',
      'alert': 'monitor',
      'unmonitor': 'unmonitor',
      'stop': 'unmonitor',
      'status': 'status',
      'alerts': 'alerts',
      'help': 'help',
      'start': 'help',
      'info': 'info',
      'price': 'price'
    };

    return {
      action: commandMap[action] || 'help',
      params,
      original: cleanText
    };
  }

  async processCommand(tweet, command) {
    const username = tweet.user.screen_name;
    const userId = tweet.user.id_str;

    switch (command.action) {
      case 'monitor':
        await this.handleMonitorCommand(tweet, command.params);
        break;
      case 'unmonitor':
        await this.handleUnmonitorCommand(tweet, command.params);
        break;
      case 'status':
        await this.handleStatusCommand(tweet);
        break;
      case 'alerts':
        await this.handleAlertsCommand(tweet);
        break;
      case 'info':
        await this.handleInfoCommand(tweet, command.params);
        break;
      case 'price':
        await this.handlePriceCommand(tweet, command.params);
        break;
      default:
        await this.handleHelpCommand(tweet);
    }
  }

  async handleMonitorCommand(tweet, params) {
    try {
      if (params.length === 0) {
        await this.replyToTweet(tweet.id_str, 
          `Hi @${tweet.user.screen_name}! 👋\n\nUsage: @DomaAlertBot monitor domain.ape\nExample: @DomaAlertBot monitor web3.ape`);
        return;
      }

      const domain = params[0];
      
      // Validate domain
      if (!this.isValidDomain(domain)) {
        await this.replyToTweet(tweet.id_str, 
          `❌ @${tweet.user.screen_name} "${domain}" doesn't look like a valid domain. Please use format like "web3.ape"`);
        return;
      }

      // Get or create user
      const user = await this.getOrCreateUser(tweet.user);
      
      // Check user limits (simplified for Twitter)
      const existingAlerts = await getAlertsByUserId(user.id, { active: true });
      const maxAlerts = user.subscriptionTier === 'free' ? 3 : 
                       user.subscriptionTier === 'basic' ? 10 : 50;

      if (existingAlerts.length >= maxAlerts) {
        await this.replyToTweet(tweet.id_str, 
          `⚠️ @${tweet.user.screen_name} You've reached your alert limit (${maxAlerts}). Upgrade your plan for more alerts! 🚀`);
        return;
      }

      // Create alert
      const alert = await createAlert({
        userId: user.id,
        type: 'expiry',
        domain,
        conditions: { daysThreshold: 7 },
        platform: 'twitter'
      });

      await this.replyToTweet(tweet.id_str, 
        `✅ @${tweet.user.screen_name} Now monitoring "${domain}" for expiry alerts!\n\n🔔 You'll get notified when it's expiring\n📊 Alert #${alert.id} created\n\nNeed more features? Check out our Telegram bot: @DomaAlertBot`);

      // Follow up with DM for more options
      await this.sendDirectMessage(tweet.user.id_str, 
        `🎉 Thanks for using DomaAlert!\n\nYour "${domain}" monitoring is active. For advanced features like:\n• Sale price alerts\n• Custom conditions\n• Auto-renewal\n• Web dashboard\n\nJoin our Telegram bot: @DomaAlertBot\n\nQuestions? Reply to this message!`);

    } catch (error) {
      logger.error('Error handling monitor command:', error);
      await this.replyToTweet(tweet.id_str, 
        `❌ @${tweet.user.screen_name} Failed to set up monitoring. Please try again or contact support.`);
    }
  }

  async handleUnmonitorCommand(tweet, params) {
    try {
      if (params.length === 0) {
        await this.replyToTweet(tweet.id_str, 
          `Hi @${tweet.user.screen_name}! 👋\n\nUsage: @DomaAlertBot stop domain.ape\nOr tweet "status" to see all your alerts`);
        return;
      }

      const domain = params[0];
      const user = await getUserByTwitterId(tweet.user.id_str);
      
      if (!user) {
        await this.replyToTweet(tweet.id_str, 
          `❌ @${tweet.user.screen_name} No alerts found. Try "monitor domain.ape" to create one!`);
        return;
      }

      // Find and deactivate alerts for this domain
      const alerts = await getAlertsByUserId(user.id, { active: true });
      const domainAlerts = alerts.filter(alert => alert.domain === domain);

      if (domainAlerts.length === 0) {
        await this.replyToTweet(tweet.id_str, 
          `❌ @${tweet.user.screen_name} No active alerts found for "${domain}"`);
        return;
      }

      // Deactivate alerts
      for (const alert of domainAlerts) {
        await updateAlert(alert.id, { isActive: false });
      }

      await this.replyToTweet(tweet.id_str, 
        `✅ @${tweet.user.screen_name} Stopped monitoring "${domain}"\n\n📊 ${domainAlerts.length} alert(s) deactivated`);

    } catch (error) {
      logger.error('Error handling unmonitor command:', error);
      await this.replyToTweet(tweet.id_str, 
        `❌ @${tweet.user.screen_name} Failed to stop monitoring. Please try again.`);
    }
  }

  async handleStatusCommand(tweet) {
    try {
      const user = await getUserByTwitterId(tweet.user.id_str);
      
      if (!user) {
        await this.replyToTweet(tweet.id_str, 
          `Hi @${tweet.user.screen_name}! 👋\n\nYou don't have any alerts yet. Try:\n@DomaAlertBot monitor web3.ape`);
        return;
      }

      const alerts = await getAlertsByUserId(user.id, { active: true });
      const totalAlerts = alerts.length;
      const maxAlerts = user.subscriptionTier === 'free' ? 3 : 
                       user.subscriptionTier === 'basic' ? 10 : 50;

      let statusMessage = `📊 @${tweet.user.screen_name} Your DomaAlert Status:\n\n`;
      statusMessage += `🔔 Active Alerts: ${totalAlerts}/${maxAlerts}\n`;
      statusMessage += `💳 Plan: ${user.subscriptionTier.toUpperCase()}\n\n`;

      if (totalAlerts > 0) {
        statusMessage += `📋 Monitoring:\n`;
        alerts.slice(0, 3).forEach((alert, i) => {
          statusMessage += `${i + 1}. ${alert.domain || 'Pattern'} (${alert.type})\n`;
        });
        
        if (totalAlerts > 3) {
          statusMessage += `... and ${totalAlerts - 3} more\n`;
        }
      } else {
        statusMessage += `No active alerts. Try: @DomaAlertBot monitor domain.ape`;
      }

      statusMessage += `\n🚀 Upgrade for more features: @DomaAlertBot (Telegram)`;

      await this.replyToTweet(tweet.id_str, statusMessage);

    } catch (error) {
      logger.error('Error handling status command:', error);
      await this.replyToTweet(tweet.id_str, 
        `❌ @${tweet.user.screen_name} Failed to get status. Please try again.`);
    }
  }

  async handleInfoCommand(tweet, params) {
    if (params.length === 0) {
      await this.replyToTweet(tweet.id_str, 
        `Hi @${tweet.user.screen_name}! 👋\n\nUsage: @DomaAlertBot info domain.ape\nExample: @DomaAlertBot info web3.ape`);
      return;
    }

    const domain = params[0];
    
    // Mock domain info (would integrate with actual domain service)
    const mockInfo = {
      domain,
      owner: '0x1234...5678',
      expiryDays: Math.floor(Math.random() * 365),
      isForSale: Math.random() > 0.7,
      price: Math.random() > 0.5 ? (Math.random() * 100).toFixed(2) : null
    };

    let infoMessage = `🔍 Domain Info: ${domain}\n\n`;
    infoMessage += `👤 Owner: ${mockInfo.owner}\n`;
    infoMessage += `📅 Expires: ${mockInfo.expiryDays} days\n`;
    infoMessage += `💰 For Sale: ${mockInfo.isForSale ? `Yes - $${mockInfo.price}` : 'No'}\n\n`;
    infoMessage += `Want alerts? @DomaAlertBot monitor ${domain}`;

    await this.replyToTweet(tweet.id_str, 
      `@${tweet.user.screen_name} ${infoMessage}`);
  }

  async handleHelpCommand(tweet) {
    const helpMessage = `Hi @${tweet.user.screen_name}! 👋\n\nDomaAlert Bot Commands:\n\n🔔 @DomaAlertBot monitor domain.ape\n⏹️ @DomaAlertBot stop domain.ape\n📊 @DomaAlertBot status\n🔍 @DomaAlertBot info domain.ape\n\n💬 For full features, join our Telegram: @DomaAlertBot\n🌐 Web: domaalert.io`;

    await this.replyToTweet(tweet.id_str, helpMessage);
  }

  async getOrCreateUser(twitterUser) {
    let user = await getUserByTwitterId(twitterUser.id_str);
    
    if (!user) {
      user = await createUser({
        twitterId: twitterUser.id_str,
        username: twitterUser.screen_name || `twitter_${twitterUser.id_str}`
      });
      
      logger.info('New Twitter user registered', { 
        userId: user.id, 
        twitterId: twitterUser.id_str,
        username: twitterUser.screen_name 
      });
    }
    
    return user;
  }

  isValidDomain(domain) {
    const domainRegex = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/i;
    return domainRegex.test(domain) && domain.includes('.');
  }

  async replyToTweet(tweetId, message) {
    try {
      const result = await this.client.post('statuses/update', {
        status: message,
        in_reply_to_status_id: tweetId
      });
      
      logger.info('Twitter reply sent', { 
        originalTweetId: tweetId, 
        replyTweetId: result.data.id_str 
      });
      
      return result.data;
    } catch (error) {
      logger.error('Failed to reply to tweet:', error);
      throw error;
    }
  }

  async sendDirectMessage(userId, message) {
    try {
      const result = await this.client.post('direct_messages/events/new', {
        event: {
          type: 'message_create',
          message_create: {
            target: { recipient_id: userId },
            message_data: { text: message }
          }
        }
      });
      
      logger.info('Twitter DM sent', { userId });
      return result;
    } catch (error) {
      // DMs might not be enabled, log but don't throw
      logger.warn('Failed to send Twitter DM (probably normal):', error.message);
    }
  }

  // Setup scheduled tasks
  setupScheduledTasks() {
    // Daily opportunity thread at 9 AM UTC
    cron.schedule('0 9 * * *', async () => {
      await this.postDailyOpportunities();
    });

    // Weekly engagement tweet
    cron.schedule('0 12 * * 1', async () => {
      await this.postWeeklyEngagement();
    });

    logger.info('✅ Twitter scheduled tasks configured');
  }

  async postDailyOpportunities() {
    try {
      // Generate daily opportunities (mock data)
      const opportunities = [
        { domain: 'web3.ape', price: '45 USDC', type: 'expiring' },
        { domain: 'nft.core', price: '120 USDC', type: 'sale' },
        { domain: 'dao.shib', price: '32 USDC', type: 'undervalued' }
      ];

      let threadMessage = `🚨 #DomaAlert Daily Opportunities\n\n`;
      threadMessage += `💎 TOP DOMAINS TODAY:\n\n`;
      
      opportunities.forEach((opp, i) => {
        threadMessage += `${i + 1}. ${opp.domain} - ${opp.price}\n`;
      });
      
      threadMessage += `\n🔗 Grab them on @domaprotocol\n`;
      threadMessage += `🤖 Get alerts: @DomaAlertBot monitor domain.ape\n\n`;
      threadMessage += `#DomainFi #Web3Domains #DeFi`;

      const result = await this.client.post('statuses/update', {
        status: threadMessage
      });

      logger.info('Daily opportunities posted', { tweetId: result.data.id_str });
      
      // Pin the tweet (if we have permissions)
      try {
        await this.client.post('account/pin_tweet', { 
          tweet_id: result.data.id_str 
        });
      } catch (pinError) {
        logger.warn('Could not pin daily opportunities tweet:', pinError.message);
      }

    } catch (error) {
      logger.error('Failed to post daily opportunities:', error);
    }
  }

  async postWeeklyEngagement() {
    try {
      const engagementTweet = `🎯 Weekly Domain Challenge!\n\n💡 PREDICT: Which 3-character .ape domain will sell for the highest price this week?\n\n🏆 Best prediction gets a shoutout!\n\nReply with your guess 👇\n\n#DomaAlert #DomainPrediction #Web3`;

      await this.client.post('statuses/update', {
        status: engagementTweet
      });

      logger.info('Weekly engagement tweet posted');
    } catch (error) {
      logger.error('Failed to post weekly engagement:', error);
    }
  }

  // Send alert to Twitter user
  async sendAlert(alertData) {
    try {
      const { user, message, domain, type } = alertData;
      
      if (!user.twitterId) {
        return;
      }

      // Format alert for Twitter
      const tweetMessage = `🚨 DOMAIN ALERT @${user.username}\n\n${message}\n\n🔗 Manage on Doma: doma.com\n⚙️ Settings: @DomaAlertBot status\n\n#DomaAlert #DomainFi`;

      // Send as reply or DM based on user preference
      await this.sendDirectMessage(user.twitterId, tweetMessage);

      logBotAction('twitter', 'alert_sent', {
        userId: user.id,
        alertType: type,
        domain,
        success: true
      });

    } catch (error) {
      logger.error('Failed to send Twitter alert:', error);
      logBotAction('twitter', 'alert_failed', {
        userId: alertData.user?.id,
        error: error.message,
        success: false
      });
    }
  }

  async stop() {
    try {
      logger.info('🛑 Stopping Twitter bot...');
      
      this.isRunning = false;
      this.mentionStreamRunning = false;
      
      // Note: Twit streams stop automatically when the process ends
      
      logger.info('✅ Twitter bot stopped');
    } catch (error) {
      logger.error('Error stopping Twitter bot:', error);
      throw error;
    }
  }
}