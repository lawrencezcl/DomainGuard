import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import { createServer } from 'http';
import WebSocket from 'ws';

// Load environment variables
dotenv.config();

// Import services
import { logger } from './utils/logger.js';
import { initializeDatabase } from './database/init.js';
import { TelegramBot } from './bots/telegram.js';
import { TwitterBot } from './bots/twitter.js';
import { AlertService } from './services/alerts/alertService.js';
import { ContractMonitor } from './contracts/contractMonitor.js';
import { SubscriptionService } from './services/subscriptionService.js';

// Import routes
import authRoutes from './routes/auth.js';
import alertRoutes from './routes/alerts.js';
import subscriptionRoutes from './routes/subscriptions.js';
import domainRoutes from './routes/domains.js';

// Import middleware
import { errorHandler } from './middleware/errorHandler.js';
import { rateLimiter } from './middleware/rateLimiter.js';
import { authMiddleware } from './middleware/auth.js';

class DomaAlertBot {
  constructor() {
    this.app = express();
    this.server = null;
    this.wss = null;
    this.services = {};
  }

  async initialize() {
    try {
      logger.info('🚀 Starting DomaAlert Bot...');

      // Initialize database
      await this.initializeDatabase();

      // Setup Express app
      this.setupExpress();

      // Initialize services
      await this.initializeServices();

      // Setup WebSocket server
      this.setupWebSocket();

      // Start server
      await this.startServer();

      logger.info('✅ DomaAlert Bot started successfully!');
    } catch (error) {
      logger.error('❌ Failed to start DomaAlert Bot:', error);
      process.exit(1);
    }
  }

  async initializeDatabase() {
    logger.info('📦 Initializing database...');
    await initializeDatabase();
    logger.info('✅ Database initialized');
  }

  setupExpress() {
    logger.info('🔧 Setting up Express server...');

    // Security middleware
    this.app.use(helmet());
    this.app.use(cors({
      origin: process.env.FRONTEND_URL || 'http://localhost:3001',
      credentials: true
    }));

    // Body parsing
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true }));

    // Rate limiting
    this.app.use(rateLimiter);

    // Health check endpoint
    this.app.get('/health', (req, res) => {
      res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        version: process.env.npm_package_version || '1.0.0',
        services: {
          telegram: this.services.telegramBot?.isRunning || false,
          twitter: this.services.twitterBot?.isRunning || false,
          alerts: this.services.alertService?.isRunning || false,
          contracts: this.services.contractMonitor?.isRunning || false
        }
      });
    });

    // API routes
    this.app.use('/api/auth', authRoutes);
    this.app.use('/api/alerts', authMiddleware, alertRoutes);
    this.app.use('/api/subscriptions', authMiddleware, subscriptionRoutes);
    this.app.use('/api/domains', authMiddleware, domainRoutes);

    // Error handling
    this.app.use(errorHandler);

    // 404 handler
    this.app.use('*', (req, res) => {
      res.status(404).json({ error: 'Endpoint not found' });
    });

    logger.info('✅ Express server configured');
  }

  async initializeServices() {
    logger.info('🔧 Initializing services...');

    try {
      // Initialize Telegram bot
      this.services.telegramBot = new TelegramBot();
      await this.services.telegramBot.initialize();

      // Initialize Twitter bot
      this.services.twitterBot = new TwitterBot();
      await this.services.twitterBot.initialize();

      // Initialize Alert Service
      this.services.alertService = new AlertService();
      await this.services.alertService.initialize();

      // Initialize Contract Monitor
      this.services.contractMonitor = new ContractMonitor();
      await this.services.contractMonitor.initialize();

      // Initialize Subscription Service
      this.services.subscriptionService = new SubscriptionService();
      await this.services.subscriptionService.initialize();

      // Connect services
      this.connectServices();

      logger.info('✅ All services initialized');
    } catch (error) {
      logger.error('❌ Failed to initialize services:', error);
      throw error;
    }
  }

  connectServices() {
    logger.info('🔗 Connecting services...');

    // Connect contract monitor to alert service
    this.services.contractMonitor.on('domainExpiry', (event) => {
      this.services.alertService.processExpiryEvent(event);
    });

    this.services.contractMonitor.on('domainSale', (event) => {
      this.services.alertService.processSaleEvent(event);
    });

    this.services.contractMonitor.on('domainTransfer', (event) => {
      this.services.alertService.processTransferEvent(event);
    });

    // Connect alert service to bots
    this.services.alertService.on('alert', async (alert) => {
      try {
        if (alert.platform === 'telegram' || alert.platform === 'both') {
          await this.services.telegramBot.sendAlert(alert);
        }
        if (alert.platform === 'twitter' || alert.platform === 'both') {
          await this.services.twitterBot.sendAlert(alert);
        }
      } catch (error) {
        logger.error('Failed to send alert:', error);
      }
    });

    logger.info('✅ Services connected');
  }

  setupWebSocket() {
    logger.info('🔧 Setting up WebSocket server...');

    this.server = createServer(this.app);
    this.wss = new WebSocket.Server({ server: this.server });

    this.wss.on('connection', (ws, req) => {
      logger.info(`WebSocket client connected from ${req.socket.remoteAddress}`);

      ws.on('message', (message) => {
        try {
          const data = JSON.parse(message);
          this.handleWebSocketMessage(ws, data);
        } catch (error) {
          logger.error('Invalid WebSocket message:', error);
          ws.send(JSON.stringify({ error: 'Invalid message format' }));
        }
      });

      ws.on('close', () => {
        logger.info('WebSocket client disconnected');
      });

      // Send welcome message
      ws.send(JSON.stringify({
        type: 'welcome',
        message: 'Connected to DomaAlert Bot WebSocket',
        timestamp: new Date().toISOString()
      }));
    });

    // Broadcast alerts via WebSocket
    this.services.alertService?.on('alert', (alert) => {
      this.wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify({
            type: 'alert',
            data: alert,
            timestamp: new Date().toISOString()
          }));
        }
      });
    });

    logger.info('✅ WebSocket server configured');
  }

  handleWebSocketMessage(ws, data) {
    switch (data.type) {
      case 'ping':
        ws.send(JSON.stringify({ type: 'pong', timestamp: new Date().toISOString() }));
        break;
      case 'subscribe':
        // Handle subscription to specific alert types
        ws.alertFilters = data.filters || {};
        ws.send(JSON.stringify({ type: 'subscribed', filters: ws.alertFilters }));
        break;
      default:
        ws.send(JSON.stringify({ error: 'Unknown message type' }));
    }
  }

  async startServer() {
    const port = process.env.PORT || 3000;
    const host = process.env.HOST || 'localhost';

    return new Promise((resolve, reject) => {
      this.server.listen(port, host, (error) => {
        if (error) {
          reject(error);
        } else {
          logger.info(`🌐 Server running on http://${host}:${port}`);
          resolve();
        }
      });
    });
  }

  async shutdown() {
    logger.info('🛑 Shutting down DomaAlert Bot...');

    try {
      // Stop services
      if (this.services.contractMonitor) {
        await this.services.contractMonitor.stop();
      }
      if (this.services.alertService) {
        await this.services.alertService.stop();
      }
      if (this.services.telegramBot) {
        await this.services.telegramBot.stop();
      }
      if (this.services.twitterBot) {
        await this.services.twitterBot.stop();
      }

      // Close WebSocket server
      if (this.wss) {
        this.wss.close();
      }

      // Close HTTP server
      if (this.server) {
        this.server.close();
      }

      logger.info('✅ DomaAlert Bot shut down successfully');
    } catch (error) {
      logger.error('❌ Error during shutdown:', error);
    }
  }
}

// Create and start the application
const app = new DomaAlertBot();

// Graceful shutdown handlers
process.on('SIGINT', async () => {
  logger.info('Received SIGINT signal');
  await app.shutdown();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger.info('Received SIGTERM signal');
  await app.shutdown();
  process.exit(0);
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Start the application
app.initialize().catch((error) => {
  logger.error('Failed to initialize application:', error);
  process.exit(1);
});

export default app;