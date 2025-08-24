import sqlite3 from 'sqlite3';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { logger } from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Enable verbose mode for debugging
sqlite3.verbose();

class Database {
  constructor() {
    this.db = null;
    this.isInitialized = false;
  }

  async initialize() {
    try {
      // Ensure data directory exists
      const dataDir = path.dirname(process.env.DB_PATH || './data/domaalert.db');
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }

      // Open database connection
      this.db = new sqlite3.Database(
        process.env.DB_PATH || './data/domaalert.db',
        sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE,
        (err) => {
          if (err) {
            logger.error('Database connection error:', err);
            throw err;
          }
          logger.info('Connected to SQLite database');
        }
      );

      // Enable foreign keys
      await this.run('PRAGMA foreign_keys = ON');
      
      // Enable WAL mode for better concurrency
      await this.run('PRAGMA journal_mode = WAL');
      
      // Set synchronous mode for better performance
      await this.run('PRAGMA synchronous = NORMAL');

      this.isInitialized = true;
      await this.createTables();
      
      logger.info('Database initialized successfully');
    } catch (error) {
      logger.error('Database initialization failed:', error);
      throw error;
    }
  }

  async createTables() {
    const migrations = [
      // Users table
      `CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        telegramId TEXT UNIQUE,
        twitterId TEXT UNIQUE,
        email TEXT UNIQUE,
        username TEXT NOT NULL,
        passwordHash TEXT,
        subscriptionTier TEXT DEFAULT 'free' CHECK(subscriptionTier IN ('free', 'basic', 'premium')),
        subscriptionExpiry DATETIME,
        isActive BOOLEAN DEFAULT 1,
        monthlySpendLimit DECIMAL(10,2) DEFAULT 200.00,
        walletAddress TEXT,
        domaAccountId TEXT,
        preferences TEXT DEFAULT '{}',
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,

      // Alerts table
      `CREATE TABLE IF NOT EXISTS alerts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        userId INTEGER NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('expiry', 'sale', 'transfer', 'price', 'auction')),
        domain TEXT,
        domainPattern TEXT,
        conditions TEXT NOT NULL,
        platform TEXT NOT NULL CHECK(platform IN ('telegram', 'twitter', 'both', 'web')),
        isActive BOOLEAN DEFAULT 1,
        triggerCount INTEGER DEFAULT 0,
        lastTriggered DATETIME,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (userId) REFERENCES users (id) ON DELETE CASCADE
      )`,

      // Alert logs table
      `CREATE TABLE IF NOT EXISTS alert_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        alertId INTEGER NOT NULL,
        userId INTEGER NOT NULL,
        eventType TEXT NOT NULL,
        eventData TEXT NOT NULL,
        status TEXT DEFAULT 'sent' CHECK(status IN ('sent', 'failed', 'pending')),
        platform TEXT NOT NULL,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (alertId) REFERENCES alerts (id) ON DELETE CASCADE,
        FOREIGN KEY (userId) REFERENCES users (id) ON DELETE CASCADE
      )`,

      // Subscriptions table
      `CREATE TABLE IF NOT EXISTS subscriptions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        userId INTEGER NOT NULL,
        tier TEXT NOT NULL CHECK(tier IN ('basic', 'premium')),
        status TEXT DEFAULT 'active' CHECK(status IN ('active', 'cancelled', 'expired', 'suspended')),
        startDate DATETIME DEFAULT CURRENT_TIMESTAMP,
        endDate DATETIME NOT NULL,
        paymentMethod TEXT DEFAULT 'doma_contract',
        transactionHash TEXT,
        autoRenew BOOLEAN DEFAULT 1,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (userId) REFERENCES users (id) ON DELETE CASCADE
      )`,

      // Domain monitoring table
      `CREATE TABLE IF NOT EXISTS domain_monitoring (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        userId INTEGER NOT NULL,
        domain TEXT NOT NULL,
        chain TEXT DEFAULT 'ethereum',
        contractAddress TEXT,
        tokenId TEXT,
        isActive BOOLEAN DEFAULT 1,
        lastChecked DATETIME,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (userId) REFERENCES users (id) ON DELETE CASCADE
      )`,

      // Auto actions table
      `CREATE TABLE IF NOT EXISTS auto_actions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        userId INTEGER NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('renew', 'buy', 'bid')),
        conditions TEXT NOT NULL,
        maxAmount DECIMAL(10,2) NOT NULL,
        isActive BOOLEAN DEFAULT 1,
        executionCount INTEGER DEFAULT 0,
        lastExecuted DATETIME,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (userId) REFERENCES users (id) ON DELETE CASCADE
      )`,

      // Auto action logs table
      `CREATE TABLE IF NOT EXISTS auto_action_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        actionId INTEGER NOT NULL,
        userId INTEGER NOT NULL,
        domain TEXT NOT NULL,
        amount DECIMAL(10,2),
        transactionHash TEXT,
        status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'success', 'failed', 'cancelled')),
        errorMessage TEXT,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (actionId) REFERENCES auto_actions (id) ON DELETE CASCADE,
        FOREIGN KEY (userId) REFERENCES users (id) ON DELETE CASCADE
      )`,

      // Sessions table (for web dashboard)
      `CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        userId INTEGER NOT NULL,
        data TEXT NOT NULL,
        expiresAt DATETIME NOT NULL,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (userId) REFERENCES users (id) ON DELETE CASCADE
      )`,

      // Bot interactions table
      `CREATE TABLE IF NOT EXISTS bot_interactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        userId INTEGER,
        platform TEXT NOT NULL CHECK(platform IN ('telegram', 'twitter')),
        chatId TEXT,
        command TEXT,
        parameters TEXT,
        response TEXT,
        success BOOLEAN DEFAULT 1,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (userId) REFERENCES users (id) ON DELETE SET NULL
      )`,

      // Domain cache table (for performance)
      `CREATE TABLE IF NOT EXISTS domain_cache (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        domain TEXT NOT NULL UNIQUE,
        chain TEXT NOT NULL,
        contractAddress TEXT,
        tokenId TEXT,
        owner TEXT,
        expiryDate DATETIME,
        lastSalePrice DECIMAL(18,8),
        isForSale BOOLEAN DEFAULT 0,
        currentPrice DECIMAL(18,8),
        lastUpdated DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,

      // Transaction logs table
      `CREATE TABLE IF NOT EXISTS transaction_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        userId INTEGER,
        type TEXT NOT NULL CHECK(type IN ('subscription', 'auto_action', 'manual')),
        transactionHash TEXT NOT NULL,
        fromAddress TEXT,
        toAddress TEXT,
        amount DECIMAL(18,8),
        token TEXT DEFAULT 'USDC',
        status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'confirmed', 'failed')),
        blockNumber INTEGER,
        gasUsed INTEGER,
        gasFee DECIMAL(18,8),
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        confirmedAt DATETIME,
        FOREIGN KEY (userId) REFERENCES users (id) ON DELETE SET NULL
      )`
    ];

    for (const migration of migrations) {
      await this.run(migration);
    }

    // Create indexes for better performance
    const indexes = [
      'CREATE INDEX IF NOT EXISTS idx_users_telegram ON users(telegramId)',
      'CREATE INDEX IF NOT EXISTS idx_users_twitter ON users(twitterId)',
      'CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)',
      'CREATE INDEX IF NOT EXISTS idx_alerts_user ON alerts(userId)',
      'CREATE INDEX IF NOT EXISTS idx_alerts_active ON alerts(isActive)',
      'CREATE INDEX IF NOT EXISTS idx_alerts_type ON alerts(type)',
      'CREATE INDEX IF NOT EXISTS idx_domain_monitoring_user ON domain_monitoring(userId)',
      'CREATE INDEX IF NOT EXISTS idx_domain_monitoring_domain ON domain_monitoring(domain)',
      'CREATE INDEX IF NOT EXISTS idx_auto_actions_user ON auto_actions(userId)',
      'CREATE INDEX IF NOT EXISTS idx_auto_actions_active ON auto_actions(isActive)',
      'CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expiresAt)',
      'CREATE INDEX IF NOT EXISTS idx_domain_cache_domain ON domain_cache(domain)',
      'CREATE INDEX IF NOT EXISTS idx_transaction_logs_hash ON transaction_logs(transactionHash)',
      'CREATE INDEX IF NOT EXISTS idx_transaction_logs_user ON transaction_logs(userId)',
      'CREATE INDEX IF NOT EXISTS idx_bot_interactions_platform ON bot_interactions(platform, chatId)'
    ];

    for (const index of indexes) {
      await this.run(index);
    }

    logger.info('Database tables and indexes created successfully');
  }

  // Promisified database methods
  run(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.run(sql, params, function(err) {
        if (err) {
          logger.error('Database run error:', { sql, params, error: err.message });
          reject(err);
        } else {
          resolve({ lastID: this.lastID, changes: this.changes });
        }
      });
    });
  }

  get(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.get(sql, params, (err, row) => {
        if (err) {
          logger.error('Database get error:', { sql, params, error: err.message });
          reject(err);
        } else {
          resolve(row);
        }
      });
    });
  }

  all(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.all(sql, params, (err, rows) => {
        if (err) {
          logger.error('Database all error:', { sql, params, error: err.message });
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });
  }

  // Transaction helper
  async transaction(callback) {
    await this.run('BEGIN TRANSACTION');
    try {
      const result = await callback();
      await this.run('COMMIT');
      return result;
    } catch (error) {
      await this.run('ROLLBACK');
      throw error;
    }
  }

  // Close database connection
  async close() {
    return new Promise((resolve, reject) => {
      if (this.db) {
        this.db.close((err) => {
          if (err) {
            reject(err);
          } else {
            logger.info('Database connection closed');
            resolve();
          }
        });
      } else {
        resolve();
      }
    });
  }
}

// Create global database instance
export const database = new Database();

// Initialize database function
export const initializeDatabase = async () => {
  if (!database.isInitialized) {
    await database.initialize();
  }
  return database;
};

export default database;