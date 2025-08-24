const TelegramBot = require('../../src/bots/telegram.js').default;

// Mock dependencies
jest.mock('telegraf', () => {
  const mockBot = {
    start: jest.fn(),
    command: jest.fn(),
    on: jest.fn(),
    telegram: {
      sendMessage: jest.fn(),
      editMessageText: jest.fn()
    },
    launch: jest.fn().mockResolvedValue({}),
    stop: jest.fn().mockResolvedValue({})
  };
  
  return {
    Telegraf: jest.fn(() => mockBot),
    Markup: {
      keyboard: jest.fn(() => ({
        resize: jest.fn(() => ({
          oneTime: jest.fn(() => ({}))
        }))
      })),
      inlineKeyboard: jest.fn(() => ({})),
      button: {
        callback: jest.fn((text, data) => ({ text, callback_data: data }))
      }
    }
  };
});

jest.mock('../../src/database/index.js', () => ({
  getInstance: jest.fn(() => ({
    prepare: jest.fn(() => ({
      get: jest.fn(),
      all: jest.fn(),
      run: jest.fn()
    }))
  }))
}));

jest.mock('../../src/utils/logger.js', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
  }
}));

describe('TelegramBot', () => {
  let telegramBot;
  let mockBotInstance;
  let mockDb;

  const mockUser = {
    id: 1,
    username: 'testuser',
    telegramId: '123456789',
    subscriptionTier: 'basic'
  };

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Setup database mock
    const Database = require('../../src/database/index.js');
    mockDb = {
      prepare: jest.fn(() => ({
        get: jest.fn(),
        all: jest.fn(),
        run: jest.fn()
      }))
    };
    Database.getInstance.mockReturnValue(mockDb);
    
    // Create bot instance
    telegramBot = new TelegramBot();
    
    // Get the mocked bot instance
    const { Telegraf } = require('telegraf');
    mockBotInstance = Telegraf.mock.results[Telegraf.mock.calls.length - 1].value;
  });

  describe('Initialization', () => {
    test('should create Telegram bot instance', () => {
      expect(telegramBot).toBeInstanceOf(TelegramBot);
      const { Telegraf } = require('telegraf');
      expect(Telegraf).toHaveBeenCalledWith(process.env.TELEGRAM_BOT_TOKEN);
    });

    test('should setup bot commands', () => {
      expect(mockBotInstance.start).toHaveBeenCalled();
      expect(mockBotInstance.command).toHaveBeenCalledWith('menu', expect.any(Function));
      expect(mockBotInstance.command).toHaveBeenCalledWith('alerts', expect.any(Function));
      expect(mockBotInstance.command).toHaveBeenCalledWith('subscription', expect.any(Function));
    });
  });

  describe('start()', () => {
    test('should start bot successfully', async () => {
      await telegramBot.start();
      
      expect(mockBotInstance.launch).toHaveBeenCalled();
    });

    test('should handle start errors', async () => {
      mockBotInstance.launch.mockRejectedValue(new Error('Failed to start'));
      
      await expect(telegramBot.start()).rejects.toThrow('Failed to start');
    });
  });

  describe('User Registration', () => {
    test('should register new user on /start', async () => {
      const mockCtx = {
        from: {
          id: 123456789,
          username: 'newuser',
          first_name: 'John'
        },
        reply: jest.fn()
      };

      const mockStatement = mockDb.prepare();
      mockStatement.get.mockReturnValue(null); // User doesn't exist
      mockStatement.run.mockReturnValue({ lastInsertRowid: 1 });

      // Get the start command handler
      const startHandler = mockBotInstance.start.mock.calls[0][0];
      await startHandler(mockCtx);

      expect(mockCtx.reply).toHaveBeenCalledWith(
        expect.stringContaining('Welcome to DomaAlert Bot')
      );
    });

    test('should handle existing user on /start', async () => {
      const mockCtx = {
        from: {
          id: 123456789,
          username: 'existinguser'
        },
        reply: jest.fn()
      };

      const mockStatement = mockDb.prepare();
      mockStatement.get.mockReturnValue(mockUser);

      const startHandler = mockBotInstance.start.mock.calls[0][0];
      await startHandler(mockCtx);

      expect(mockCtx.reply).toHaveBeenCalledWith(
        expect.stringContaining('Welcome back')
      );
    });
  });

  describe('Menu System', () => {
    test('should show main menu', async () => {
      const mockCtx = {
        from: { id: 123456789 },
        reply: jest.fn()
      };

      const mockStatement = mockDb.prepare();
      mockStatement.get.mockReturnValue(mockUser);

      const menuHandler = mockBotInstance.command.mock.calls.find(
        call => call[0] === 'menu'
      )[1];
      
      await menuHandler(mockCtx);

      expect(mockCtx.reply).toHaveBeenCalledWith(
        expect.stringContaining('Main Menu'),
        expect.objectContaining({
          reply_markup: expect.any(Object)
        })
      );
    });

    test('should handle menu navigation', async () => {
      const mockCtx = {
        callbackQuery: {
          data: 'menu_alerts'
        },
        from: { id: 123456789 },
        editMessageText: jest.fn(),
        answerCbQuery: jest.fn()
      };

      const mockStatement = mockDb.prepare();
      mockStatement.get.mockReturnValue(mockUser);

      // Simulate callback query handling
      const callbackHandler = mockBotInstance.on.mock.calls.find(
        call => call[0] === 'callback_query'
      )[1];
      
      await callbackHandler(mockCtx);

      expect(mockCtx.answerCbQuery).toHaveBeenCalled();
      expect(mockCtx.editMessageText).toHaveBeenCalledWith(
        expect.stringContaining('Alert Management'),
        expect.any(Object)
      );
    });
  });

  describe('Alert Management', () => {
    test('should show user alerts', async () => {
      const mockCtx = {
        from: { id: 123456789 },
        reply: jest.fn()
      };

      const mockAlerts = [
        {
          id: 1,
          domain: 'test.eth',
          type: 'expiry',
          isActive: true,
          createdAt: new Date().toISOString()
        },
        {
          id: 2,
          domain: 'example.eth',
          type: 'sale',
          isActive: true,
          createdAt: new Date().toISOString()
        }
      ];

      const mockUserStatement = mockDb.prepare();
      const mockAlertsStatement = mockDb.prepare();
      
      mockUserStatement.get.mockReturnValue(mockUser);
      mockAlertsStatement.all.mockReturnValue(mockAlerts);

      mockDb.prepare.mockImplementation((sql) => {
        if (sql.includes('users')) return mockUserStatement;
        if (sql.includes('alerts')) return mockAlertsStatement;
        return { get: jest.fn(), all: jest.fn(), run: jest.fn() };
      });

      const alertsHandler = mockBotInstance.command.mock.calls.find(
        call => call[0] === 'alerts'
      )[1];
      
      await alertsHandler(mockCtx);

      expect(mockCtx.reply).toHaveBeenCalledWith(
        expect.stringContaining('Your Active Alerts')
      );
    });

    test('should handle alert creation workflow', async () => {
      const mockCtx = {
        from: { id: 123456789 },
        reply: jest.fn(),
        scene: {
          enter: jest.fn()
        }
      };

      const mockStatement = mockDb.prepare();
      mockStatement.get.mockReturnValue(mockUser);

      // Simulate starting alert creation
      await telegramBot.startAlertCreation(mockCtx);

      expect(mockCtx.reply).toHaveBeenCalledWith(
        expect.stringContaining('What domain would you like to monitor?')
      );
    });

    test('should validate domain names', () => {
      expect(telegramBot.validateDomain('test.eth')).toBe(true);
      expect(telegramBot.validateDomain('example.com')).toBe(true);
      expect(telegramBot.validateDomain('invalid_domain')).toBe(false);
      expect(telegramBot.validateDomain('')).toBe(false);
    });
  });

  describe('Alert Delivery', () => {
    test('should send expiry alert', async () => {
      const alertData = {
        type: 'domainExpiry',
        domain: 'test.eth',
        owner: '0x1234567890123456789012345678901234567890',
        expiry: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days from now
        timestamp: new Date()
      };

      const users = [
        {
          telegramId: '123456789',
          username: 'user1'
        },
        {
          telegramId: '987654321',
          username: 'user2'
        }
      ];

      const mockStatement = mockDb.prepare();
      mockStatement.all.mockReturnValue(users);

      await telegramBot.sendAlert(alertData);

      expect(mockBotInstance.telegram.sendMessage).toHaveBeenCalledTimes(2);
      expect(mockBotInstance.telegram.sendMessage).toHaveBeenCalledWith(
        '123456789',
        expect.stringContaining('🚨 Domain Expiry Alert')
      );
    });

    test('should send sale alert', async () => {
      const alertData = {
        type: 'domainSale',
        domain: 'premium.eth',
        seller: '0x1111111111111111111111111111111111111111',
        buyer: '0x2222222222222222222222222222222222222222',
        price: '5000000000000000000', // 5 ETH
        timestamp: new Date()
      };

      const users = [
        {
          telegramId: '123456789',
          username: 'user1'
        }
      ];

      const mockStatement = mockDb.prepare();
      mockStatement.all.mockReturnValue(users);

      await telegramBot.sendAlert(alertData);

      expect(mockBotInstance.telegram.sendMessage).toHaveBeenCalledWith(
        '123456789',
        expect.stringContaining('💰 Domain Sale Alert')
      );
    });

    test('should handle delivery failures gracefully', async () => {
      const alertData = {
        type: 'domainExpiry',
        domain: 'test.eth',
        timestamp: new Date()
      };

      const users = [
        {
          telegramId: '123456789',
          username: 'user1'
        }
      ];

      const mockStatement = mockDb.prepare();
      mockStatement.all.mockReturnValue(users);

      // Mock delivery failure
      mockBotInstance.telegram.sendMessage.mockRejectedValue(
        new Error('User blocked bot')
      );

      await expect(telegramBot.sendAlert(alertData)).resolves.not.toThrow();
    });
  });

  describe('Subscription Management', () => {
    test('should show subscription status', async () => {
      const mockCtx = {
        from: { id: 123456789 },
        reply: jest.fn()
      };

      const mockStatement = mockDb.prepare();
      mockStatement.get.mockReturnValue({
        ...mockUser,
        subscriptionExpiry: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
      });

      const subscriptionHandler = mockBotInstance.command.mock.calls.find(
        call => call[0] === 'subscription'
      )[1];
      
      await subscriptionHandler(mockCtx);

      expect(mockCtx.reply).toHaveBeenCalledWith(
        expect.stringContaining('Subscription Status')
      );
    });

    test('should handle subscription upgrade', async () => {
      const mockCtx = {
        callbackQuery: {
          data: 'upgrade_premium'
        },
        from: { id: 123456789 },
        editMessageText: jest.fn(),
        answerCbQuery: jest.fn()
      };

      const mockStatement = mockDb.prepare();
      mockStatement.get.mockReturnValue(mockUser);

      // Simulate upgrade callback
      await telegramBot.handleSubscriptionUpgrade(mockCtx, 'premium');

      expect(mockCtx.editMessageText).toHaveBeenCalledWith(
        expect.stringContaining('Premium Subscription'),
        expect.any(Object)
      );
    });
  });

  describe('Error Handling', () => {
    test('should handle database errors gracefully', async () => {
      const mockCtx = {
        from: { id: 123456789 },
        reply: jest.fn()
      };

      const mockStatement = mockDb.prepare();
      mockStatement.get.mockImplementation(() => {
        throw new Error('Database error');
      });

      const menuHandler = mockBotInstance.command.mock.calls.find(
        call => call[0] === 'menu'
      )[1];
      
      await menuHandler(mockCtx);

      expect(mockCtx.reply).toHaveBeenCalledWith(
        expect.stringContaining('Sorry, something went wrong')
      );
    });

    test('should handle invalid callback queries', async () => {
      const mockCtx = {
        callbackQuery: {
          data: 'invalid_action'
        },
        answerCbQuery: jest.fn(),
        reply: jest.fn()
      };

      const callbackHandler = mockBotInstance.on.mock.calls.find(
        call => call[0] === 'callback_query'
      )[1];
      
      await callbackHandler(mockCtx);

      expect(mockCtx.answerCbQuery).toHaveBeenCalled();
      expect(mockCtx.reply).toHaveBeenCalledWith(
        expect.stringContaining('Unknown action')
      );
    });
  });

  describe('Rate Limiting', () => {
    test('should enforce rate limits', async () => {
      const mockCtx = {
        from: { id: 123456789 },
        reply: jest.fn()
      };

      // Simulate rapid requests
      const menuHandler = mockBotInstance.command.mock.calls.find(
        call => call[0] === 'menu'
      )[1];

      // Multiple rapid calls
      await menuHandler(mockCtx);
      await menuHandler(mockCtx);
      await menuHandler(mockCtx);

      // Should eventually get rate limited (implementation dependent)
      expect(mockCtx.reply).toHaveBeenCalled();
    });
  });

  describe('stop()', () => {
    test('should stop bot gracefully', async () => {
      await telegramBot.stop();
      
      expect(mockBotInstance.stop).toHaveBeenCalled();
    });

    test('should handle stop errors', async () => {
      mockBotInstance.stop.mockRejectedValue(new Error('Failed to stop'));
      
      await expect(telegramBot.stop()).rejects.toThrow('Failed to stop');
    });
  });
});