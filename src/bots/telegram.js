import { Telegraf, Markup } from 'telegraf';
import { logger, logBotAction } from '../utils/logger.js';
import { checkBotRateLimit } from '../middleware/rateLimiter.js';
import { 
  createUser, 
  getUserByTelegramId, 
  updateUser, 
  checkUserLimits,
  getUserStats 
} from '../database/models/user.js';
import { 
  createAlert, 
  getAlertsByUserId, 
  updateAlert, 
  deleteAlert,
  getUserAlertStats 
} from '../database/models/alert.js';

export class TelegramBot {
  constructor() {
    this.bot = null;
    this.isRunning = false;
    this.userSessions = new Map(); // Store user session data
  }

  async initialize() {
    try {
      logger.info('🤖 Initializing Telegram bot...');

      if (!process.env.TELEGRAM_BOT_TOKEN) {
        throw new Error('TELEGRAM_BOT_TOKEN is required');
      }

      this.bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

      // Setup middleware
      this.setupMiddleware();

      // Setup commands
      this.setupCommands();

      // Setup callback handlers
      this.setupCallbacks();

      // Setup message handlers
      this.setupMessageHandlers();

      // Start bot
      await this.bot.launch();
      this.isRunning = true;

      logger.info('✅ Telegram bot initialized and started');
    } catch (error) {
      logger.error('❌ Failed to initialize Telegram bot:', error);
      throw error;
    }
  }

  setupMiddleware() {
    // Rate limiting middleware
    this.bot.use(async (ctx, next) => {
      const userId = ctx.from?.id?.toString();
      if (userId) {
        const rateCheck = await checkBotRateLimit(userId, 'telegram');
        if (!rateCheck.allowed) {
          await ctx.reply(`⏳ ${rateCheck.message}`);
          return;
        }
      }
      return next();
    });

    // User session middleware
    this.bot.use(async (ctx, next) => {
      const userId = ctx.from?.id?.toString();
      if (userId && !this.userSessions.has(userId)) {
        this.userSessions.set(userId, { step: null, data: {} });
      }
      ctx.session = this.userSessions.get(userId);
      return next();
    });

    // Error handling middleware
    this.bot.catch((err, ctx) => {
      logger.error('Telegram bot error:', err);
      logBotAction('telegram', 'error', {
        userId: ctx.from?.id,
        chatId: ctx.chat?.id,
        error: err.message,
        success: false
      });
      
      ctx.reply('❌ Something went wrong. Please try again or contact support.');
    });
  }

  setupCommands() {
    // Start command
    this.bot.command('start', async (ctx) => {
      try {
        const telegramId = ctx.from.id.toString();
        let user = await getUserByTelegramId(telegramId);

        if (!user) {
          // Create new user
          user = await createUser({
            telegramId,
            username: ctx.from.username || ctx.from.first_name || 'TelegramUser'
          });
          
          logger.info('New Telegram user registered', { userId: user.id, telegramId });
        }

        const welcomeMessage = `🎉 Welcome to DomaAlert Bot!

Your 24/7 domain assistant for the Doma Protocol ecosystem.

🔔 **Never miss a domain moment again:**
• Domain expiry alerts (1/3/7 days before)
• High-value sale notifications
• Ownership change tracking
• Auto-actions for renewals & purchases

✨ **Current Status:**
Subscription: ${user.subscriptionTier.toUpperCase()}
Alerts: ${await this.getUserAlertCount(user.id)}

Use the menu below to get started! 👇`;

        await ctx.reply(welcomeMessage, this.getMainMenu());
        
        logBotAction('telegram', 'start', {
          userId: user.id,
          chatId: ctx.chat.id,
          success: true
        });
      } catch (error) {
        logger.error('Error in start command:', error);
        await ctx.reply('❌ Failed to initialize. Please try again.');
      }
    });

    // Help command
    this.bot.command('help', async (ctx) => {
      const helpMessage = `🆘 **DomaAlert Bot Help**

**Main Commands:**
/start - Initialize your account
/alerts - View your active alerts
/status - Check your subscription status
/help - Show this help message

**Quick Actions:**
• Use the menu buttons for easy navigation
• Type domain names to get instant info
• Set up alerts in just a few taps

**Subscription Tiers:**
🆓 **Free** - 5 alerts, daily summaries
💳 **Basic ($5/mo)** - 20 alerts, real-time notifications
⭐ **Premium ($20/mo)** - Unlimited alerts + auto-actions

Need more help? Contact @DomaAlertSupport`;

      await ctx.reply(helpMessage, this.getMainMenu());
    });

    // Alerts command
    this.bot.command('alerts', async (ctx) => {
      await this.showUserAlerts(ctx);
    });

    // Status command
    this.bot.command('status', async (ctx) => {
      await this.showUserStatus(ctx);
    });

    // Monitor command (quick domain monitoring)
    this.bot.command('monitor', async (ctx) => {
      const args = ctx.message.text.split(' ').slice(1);
      if (args.length === 0) {
        await ctx.reply('Usage: /monitor <domain>\nExample: /monitor web3.ape');
        return;
      }

      const domain = args[0].toLowerCase();
      ctx.session.step = 'creating_alert';
      ctx.session.data = { domain, type: 'expiry' };
      
      await this.startAlertCreation(ctx);
    });
  }

  setupCallbacks() {
    // Main menu callbacks
    this.bot.action('main_menu', async (ctx) => {
      await ctx.editMessageText('🏠 **Main Menu**\nChoose an option:', this.getMainMenu());
    });

    this.bot.action('view_alerts', async (ctx) => {
      await this.showUserAlerts(ctx);
    });

    this.bot.action('create_alert', async (ctx) => {
      await this.startAlertCreation(ctx);
    });

    this.bot.action('subscription_info', async (ctx) => {
      await this.showSubscriptionInfo(ctx);
    });

    this.bot.action('user_status', async (ctx) => {
      await this.showUserStatus(ctx);
    });

    // Alert type selection
    this.bot.action(/^alert_type_(.+)$/, async (ctx) => {
      const alertType = ctx.match[1];
      ctx.session.step = 'creating_alert';
      ctx.session.data = { ...ctx.session.data, type: alertType };
      
      await this.handleAlertTypeSelection(ctx, alertType);
    });

    // Alert management
    this.bot.action(/^alert_(\d+)_(.+)$/, async (ctx) => {
      const alertId = parseInt(ctx.match[1]);
      const action = ctx.match[2];
      
      await this.handleAlertAction(ctx, alertId, action);
    });

    // Domain actions from alerts
    this.bot.action(/^domain_(.+)_(.+)$/, async (ctx) => {
      const domain = ctx.match[1];
      const action = ctx.match[2];
      
      await this.handleDomainAction(ctx, domain, action);
    });

    // Subscription actions
    this.bot.action(/^sub_(.+)$/, async (ctx) => {
      const action = ctx.match[1];
      await this.handleSubscriptionAction(ctx, action);
    });

    // Pagination
    this.bot.action(/^page_(.+)_(\d+)$/, async (ctx) => {
      const type = ctx.match[1];
      const page = parseInt(ctx.match[2]);
      
      if (type === 'alerts') {
        await this.showUserAlerts(ctx, page);
      }
    });
  }

  setupMessageHandlers() {
    // Handle text messages based on session state
    this.bot.on('text', async (ctx) => {
      const text = ctx.message.text;
      
      // Handle session-based flows
      if (ctx.session.step) {
        await this.handleSessionMessage(ctx, text);
        return;
      }

      // Check if it's a domain name
      if (this.isDomainName(text)) {
        await this.handleDomainQuery(ctx, text.toLowerCase());
        return;
      }

      // Default response
      await ctx.reply('🤔 I didn\'t understand that. Use the menu below or type /help for assistance.', 
        this.getMainMenu());
    });
  }

  // UI Methods
  getMainMenu() {
    return Markup.inlineKeyboard([
      [Markup.button.callback('🔔 My Alerts', 'view_alerts')],
      [Markup.button.callback('➕ Create Alert', 'create_alert')],
      [Markup.button.callback('📊 Status', 'user_status'), 
       Markup.button.callback('💳 Subscription', 'subscription_info')],
      [Markup.button.callback('🆘 Help', 'help')]
    ]);
  }

  getAlertTypeMenu() {
    return Markup.inlineKeyboard([
      [Markup.button.callback('📅 Domain Expiry', 'alert_type_expiry')],
      [Markup.button.callback('💰 Sale Alerts', 'alert_type_sale')],
      [Markup.button.callback('🔄 Transfer Alerts', 'alert_type_transfer')],
      [Markup.button.callback('🔙 Back', 'main_menu')]
    ]);
  }

  // Alert Management
  async showUserAlerts(ctx, page = 1) {
    try {
      const user = await this.getOrCreateUser(ctx);
      const limit = 5;
      const offset = (page - 1) * limit;
      
      const alerts = await getAlertsByUserId(user.id, { limit, offset });
      const stats = await getUserAlertStats(user.id);

      if (alerts.length === 0) {
        const message = page === 1 ? 
          `📋 **Your Alerts**

You don't have any alerts set up yet.

Alerts help you stay on top of:
• Domain expirations
• Sale opportunities  
• Ownership changes

Click "Create Alert" to get started! 👇` :
          '📋 No more alerts to show.';

        const keyboard = page === 1 ? 
          Markup.inlineKeyboard([
            [Markup.button.callback('➕ Create Alert', 'create_alert')],
            [Markup.button.callback('🔙 Main Menu', 'main_menu')]
          ]) :
          Markup.inlineKeyboard([
            [Markup.button.callback('⬅️ Previous', `page_alerts_${page - 1}`)],
            [Markup.button.callback('🔙 Main Menu', 'main_menu')]
          ]);

        await ctx.editMessageText(message, keyboard);
        return;
      }

      let message = `📋 **Your Alerts** (Page ${page})

📊 **Stats:** ${stats.activeAlerts} active, ${stats.totalTriggers} total triggers

`;

      const keyboard = [];
      
      for (const alert of alerts) {
        const statusEmoji = alert.isActive ? '🟢' : '🔴';
        const typeEmoji = this.getAlertTypeEmoji(alert.type);
        const domain = alert.domain || alert.domainPattern || 'Pattern';
        
        message += `${statusEmoji} ${typeEmoji} **${domain}**\n`;
        message += `   Triggers: ${alert.triggerCount} | Platform: ${alert.platform}\n\n`;
        
        keyboard.push([
          Markup.button.callback(`⚙️ ${domain}`, `alert_${alert.id}_edit`),
          Markup.button.callback(alert.isActive ? '⏸️' : '▶️', `alert_${alert.id}_toggle`),
          Markup.button.callback('🗑️', `alert_${alert.id}_delete`)
        ]);
      }

      // Pagination buttons
      const paginationRow = [];
      if (page > 1) {
        paginationRow.push(Markup.button.callback('⬅️ Previous', `page_alerts_${page - 1}`));
      }
      if (alerts.length === limit) {
        paginationRow.push(Markup.button.callback('Next ➡️', `page_alerts_${page + 1}`));
      }
      
      if (paginationRow.length > 0) {
        keyboard.push(paginationRow);
      }

      keyboard.push([
        Markup.button.callback('➕ Create Alert', 'create_alert'),
        Markup.button.callback('🔙 Main Menu', 'main_menu')
      ]);

      await ctx.editMessageText(message, Markup.inlineKeyboard(keyboard));
    } catch (error) {
      logger.error('Error showing user alerts:', error);
      await ctx.reply('❌ Failed to load alerts. Please try again.');
    }
  }

  async startAlertCreation(ctx) {
    try {
      const user = await this.getOrCreateUser(ctx);
      const limits = await checkUserLimits(user.id);

      if (limits.alerts.available <= 0) {
        await ctx.editMessageText(
          `⚠️ **Alert Limit Reached**

You've reached your limit of ${limits.alerts.limit} alerts.

**Upgrade your subscription to create more alerts:**
• Basic ($5/mo): 20 alerts
• Premium ($20/mo): Unlimited alerts + auto-actions

Would you like to upgrade?`,
          Markup.inlineKeyboard([
            [Markup.button.callback('💳 Upgrade', 'sub_upgrade')],
            [Markup.button.callback('🔙 Back', 'main_menu')]
          ])
        );
        return;
      }

      // If domain already specified in session, skip domain input
      if (ctx.session.data?.domain) {
        await this.handleAlertTypeSelection(ctx, ctx.session.data.type || 'expiry');
        return;
      }

      await ctx.editMessageText(
        `➕ **Create New Alert**

**Step 1 of 3:** Choose alert type

What kind of alert would you like to create?`,
        this.getAlertTypeMenu()
      );
    } catch (error) {
      logger.error('Error starting alert creation:', error);
      await ctx.reply('❌ Failed to start alert creation. Please try again.');
    }
  }

  async handleAlertTypeSelection(ctx, alertType) {
    ctx.session.data.type = alertType;
    
    const typeNames = {
      expiry: 'Domain Expiry',
      sale: 'Sale Alert',
      transfer: 'Transfer Alert'
    };

    await ctx.editMessageText(
      `➕ **Create ${typeNames[alertType]}**

**Step 2 of 3:** Enter domain name

Type the domain you want to monitor (e.g., "web3.ape") or use "*" for patterns (e.g., "*.ape" for all .ape domains):`,
      Markup.inlineKeyboard([[Markup.button.callback('🔙 Back', 'create_alert')]])
    );

    ctx.session.step = 'awaiting_domain';
  }

  async handleSessionMessage(ctx, text) {
    const step = ctx.session.step;
    
    switch (step) {
      case 'awaiting_domain':
        await this.handleDomainInput(ctx, text);
        break;
      case 'awaiting_conditions':
        await this.handleConditionsInput(ctx, text);
        break;
      default:
        ctx.session.step = null;
        await ctx.reply('🤔 I\'m not sure what you\'re trying to do. Please use the menu.', 
          this.getMainMenu());
    }
  }

  async handleDomainInput(ctx, domain) {
    try {
      domain = domain.toLowerCase().trim();
      
      // Validate domain format
      if (!this.isDomainName(domain) && !domain.includes('*')) {
        await ctx.reply('❌ Invalid domain format. Please enter a valid domain (e.g., "web3.ape") or pattern (e.g., "*.ape"):');
        return;
      }

      ctx.session.data.domain = domain.includes('*') ? null : domain;
      ctx.session.data.domainPattern = domain.includes('*') ? domain : null;
      
      // Move to conditions step
      await this.handleConditionsStep(ctx);
    } catch (error) {
      logger.error('Error handling domain input:', error);
      await ctx.reply('❌ Error processing domain. Please try again.');
    }
  }

  async handleConditionsStep(ctx) {
    const alertType = ctx.session.data.type;
    const domain = ctx.session.data.domain || ctx.session.data.domainPattern;
    
    let message = `➕ **Create Alert - Final Step**

**Domain:** ${domain}
**Type:** ${this.getAlertTypeEmoji(alertType)} ${alertType.charAt(0).toUpperCase() + alertType.slice(1)}

**Step 3 of 3:** Configure conditions

`;

    const keyboard = [];

    switch (alertType) {
      case 'expiry':
        message += `Choose when to alert you before domain expiry:`;
        keyboard.push(
          [Markup.button.callback('🚨 1 day before', 'condition_expiry_1')],
          [Markup.button.callback('⚠️ 3 days before', 'condition_expiry_3')],
          [Markup.button.callback('📅 7 days before', 'condition_expiry_7')],
          [Markup.button.callback('🔔 All of the above', 'condition_expiry_all')]
        );
        break;
        
      case 'sale':
        message += `Set price range for sale alerts:`;
        keyboard.push(
          [Markup.button.callback('💰 Any price', 'condition_sale_any')],
          [Markup.button.callback('💎 Under $50', 'condition_sale_50')],
          [Markup.button.callback('🎯 Under $100', 'condition_sale_100')],
          [Markup.button.callback('✏️ Custom range', 'condition_sale_custom')]
        );
        break;
        
      case 'transfer':
        message += `Choose transfer monitoring:`;
        keyboard.push(
          [Markup.button.callback('🔄 All transfers', 'condition_transfer_all')],
          [Markup.button.callback('📥 Only incoming', 'condition_transfer_in')],
          [Markup.button.callback('📤 Only outgoing', 'condition_transfer_out')]
        );
        break;
    }

    keyboard.push([Markup.button.callback('🔙 Back', 'create_alert')]);

    await ctx.editMessageText(message, Markup.inlineKeyboard(keyboard));
    ctx.session.step = 'awaiting_conditions';
  }

  async handleConditionsInput(ctx, input) {
    // This would handle custom condition inputs
    // For now, conditions are set via callback buttons
  }

  // Handle alert actions
  async handleAlertAction(ctx, alertId, action) {
    try {
      const user = await this.getOrCreateUser(ctx);
      
      switch (action) {
        case 'toggle':
          const alert = await getAlertById(alertId);
          if (alert && alert.userId === user.id) {
            await updateAlert(alertId, { isActive: !alert.isActive });
            await ctx.answerCbQuery(alert.isActive ? 'Alert paused' : 'Alert activated');
            await this.showUserAlerts(ctx);
          }
          break;
          
        case 'delete':
          await deleteAlert(alertId);
          await ctx.answerCbQuery('Alert deleted');
          await this.showUserAlerts(ctx);
          break;
          
        case 'edit':
          // Would open edit interface
          await ctx.answerCbQuery('Edit feature coming soon!');
          break;
      }
    } catch (error) {
      logger.error('Error handling alert action:', error);
      await ctx.answerCbQuery('❌ Action failed');
    }
  }

  // Send alert to user
  async sendAlert(alertData) {
    try {
      const { user, message, buttons, urgency } = alertData;
      
      if (!user.telegramId) {
        return;
      }

      // Format message with urgency indicator
      const urgencyEmoji = urgency === 'critical' ? '🚨' : urgency === 'high' ? '⚠️' : '🔔';
      const formattedMessage = `${urgencyEmoji} **DOMAIN ALERT**\n\n${message}`;

      // Create inline keyboard from buttons
      const keyboard = buttons ? 
        Markup.inlineKeyboard(
          buttons.map(btn => [Markup.button.callback(btn.text, `domain_${btn.domain}_${btn.action}`)])
        ) : 
        this.getMainMenu();

      await this.bot.telegram.sendMessage(user.telegramId, formattedMessage, {
        parse_mode: 'Markdown',
        ...keyboard
      });

      logBotAction('telegram', 'alert_sent', {
        userId: user.id,
        chatId: user.telegramId,
        alertType: alertData.type,
        success: true
      });
    } catch (error) {
      logger.error('Failed to send Telegram alert:', error);
      logBotAction('telegram', 'alert_failed', {
        userId: alertData.user?.id,
        chatId: alertData.user?.telegramId,
        error: error.message,
        success: false
      });
    }
  }

  // Helper methods
  async getOrCreateUser(ctx) {
    const telegramId = ctx.from.id.toString();
    let user = await getUserByTelegramId(telegramId);
    
    if (!user) {
      user = await createUser({
        telegramId,
        username: ctx.from.username || ctx.from.first_name || 'TelegramUser'
      });
    }
    
    return user;
  }

  async getUserAlertCount(userId) {
    const stats = await getUserAlertStats(userId);
    return stats.activeAlerts || 0;
  }

  getAlertTypeEmoji(type) {
    const emojis = {
      expiry: '📅',
      sale: '💰',
      transfer: '🔄',
      price: '📈',
      auction: '🏆'
    };
    return emojis[type] || '🔔';
  }

  isDomainName(text) {
    const domainRegex = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/i;
    return domainRegex.test(text) && text.includes('.');
  }

  async handleDomainQuery(ctx, domain) {
    try {
      await ctx.reply(`🔍 Looking up domain "${domain}"...`);
      
      // This would integrate with the domain service to get real info
      const mockInfo = {
        domain,
        owner: '0x1234...5678',
        expiryDays: 45,
        isForSale: false,
        price: null
      };

      const message = `📋 **Domain Info: ${domain}**

👤 **Owner:** ${mockInfo.owner}
📅 **Expires in:** ${mockInfo.expiryDays} days
💰 **For Sale:** ${mockInfo.isForSale ? `Yes - ${mockInfo.price} USDC` : 'No'}

Would you like to set up an alert for this domain?`;

      await ctx.reply(message, Markup.inlineKeyboard([
        [Markup.button.callback('🔔 Set Expiry Alert', 'create_alert')],
        [Markup.button.callback('💰 Set Sale Alert', 'create_alert')],
        [Markup.button.callback('🌐 View on Doma', `domain_${domain}_view`)]
      ]));
    } catch (error) {
      logger.error('Error handling domain query:', error);
      await ctx.reply('❌ Failed to look up domain. Please try again.');
    }
  }

  async showUserStatus(ctx) {
    try {
      const user = await this.getOrCreateUser(ctx);
      const limits = await checkUserLimits(user.id);
      const stats = await getUserStats(user.id);

      const message = `📊 **Your Status**

**Account Info:**
👤 Username: ${user.username}
💳 Subscription: ${user.subscriptionTier.toUpperCase()}
📅 Member since: ${new Date(user.createdAt).toLocaleDateString()}

**Current Usage:**
🔔 Alerts: ${limits.alerts.current}/${limits.alerts.limit}
🏠 Domains: ${limits.domains.current}/${limits.domains.limit}
⚡ Auto-actions: ${limits.autoActions.enabled ? 'Enabled' : 'Disabled'}

**Activity Stats:**
📈 Total triggers: ${stats.alerts.totalTriggers || 0}
🤖 Bot interactions: ${stats.interactions.totalInteractions || 0}
✅ Success rate: ${stats.interactions.successfulInteractions || 0}/${stats.interactions.totalInteractions || 0}`;

      await ctx.editMessageText(message, Markup.inlineKeyboard([
        [Markup.button.callback('💳 Manage Subscription', 'subscription_info')],
        [Markup.button.callback('🔔 View Alerts', 'view_alerts')],
        [Markup.button.callback('🔙 Main Menu', 'main_menu')]
      ]));
    } catch (error) {
      logger.error('Error showing user status:', error);
      await ctx.reply('❌ Failed to load status. Please try again.');
    }
  }

  async showSubscriptionInfo(ctx) {
    try {
      const user = await this.getOrCreateUser(ctx);
      
      const tiers = {
        free: '🆓 **Free Tier**\n• 5 alerts\n• Daily summaries\n• Basic support',
        basic: '💳 **Basic Tier - $5/month**\n• 20 alerts\n• Real-time notifications\n• Multi-chain support',
        premium: '⭐ **Premium Tier - $20/month**\n• Unlimited alerts\n• Auto-actions\n• Priority support\n• Early access to new features'
      };

      const currentTier = user.subscriptionTier;
      const message = `💳 **Subscription Management**

**Current Plan:** ${tiers[currentTier]}

**All Available Tiers:**

${Object.values(tiers).join('\n\n')}

Ready to upgrade and unlock more features?`;

      const keyboard = [];
      
      if (currentTier === 'free') {
        keyboard.push([Markup.button.callback('🚀 Upgrade to Basic', 'sub_upgrade_basic')]);
        keyboard.push([Markup.button.callback('⭐ Upgrade to Premium', 'sub_upgrade_premium')]);
      } else if (currentTier === 'basic') {
        keyboard.push([Markup.button.callback('⭐ Upgrade to Premium', 'sub_upgrade_premium')]);
        keyboard.push([Markup.button.callback('❌ Cancel Subscription', 'sub_cancel')]);
      } else {
        keyboard.push([Markup.button.callback('❌ Cancel Subscription', 'sub_cancel')]);
      }

      keyboard.push([Markup.button.callback('🔙 Main Menu', 'main_menu')]);

      await ctx.editMessageText(message, Markup.inlineKeyboard(keyboard));
    } catch (error) {
      logger.error('Error showing subscription info:', error);
      await ctx.reply('❌ Failed to load subscription info. Please try again.');
    }
  }

  async handleSubscriptionAction(ctx, action) {
    const message = `💳 **Subscription Management**

To manage your subscription, please visit our web dashboard where you can securely process payments via Doma contracts.

🌐 **Web Dashboard:** ${process.env.FRONTEND_URL}/dashboard

**Features:**
• Secure payment processing
• Detailed usage analytics  
• Advanced alert configuration
• Transaction history

Would you like me to send you the dashboard link?`;

    await ctx.editMessageText(message, Markup.inlineKeyboard([
      [Markup.button.url('🌐 Open Dashboard', `${process.env.FRONTEND_URL}/dashboard`)],
      [Markup.button.callback('🔙 Back', 'subscription_info')]
    ]));
  }

  async stop() {
    try {
      logger.info('🛑 Stopping Telegram bot...');
      
      if (this.bot) {
        this.bot.stop('SIGTERM');
      }
      
      this.isRunning = false;
      this.userSessions.clear();
      
      logger.info('✅ Telegram bot stopped');
    } catch (error) {
      logger.error('Error stopping Telegram bot:', error);
      throw error;
    }
  }
}