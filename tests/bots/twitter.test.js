const TwitterBot = require('../../src/bots/twitter.js').default;

// Mock dependencies
jest.mock('twit', () => {
  return jest.fn().mockImplementation(() => ({
    get: jest.fn(),
    post: jest.fn(),
    stream: jest.fn()
  }));
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

// Mock ethers for contract interactions
jest.mock('ethers', () => ({
  ethers: {
    Contract: jest.fn().mockImplementation(() => ({
      renewDomain: jest.fn().mockResolvedValue({ 
        hash: '0x1234567890abcdef',
        wait: jest.fn().mockResolvedValue({ status: 1 })
      }),
      getRenewalPrice: jest.fn().mockResolvedValue('100000000000000000') // 0.1 ETH
    })),
    utils: {
      formatEther: jest.fn().mockImplementation((value) => (parseInt(value) / 1e18).toString())
    }
  }
}));

describe('TwitterBot', () => {
  let twitterBot;
  let mockTwitterClient;
  let mockDb;

  const mockUser = {
    id: 1,
    username: 'testuser',
    twitterHandle: '@testuser',
    subscriptionTier: 'premium',
    walletAddress: '0x1234567890123456789012345678901234567890'
  };

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Setup Twitter client mock
    const Twit = require('twit');
    mockTwitterClient = {
      get: jest.fn(),
      post: jest.fn(),
      stream: jest.fn()
    };
    Twit.mockImplementation(() => mockTwitterClient);
    
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
    
    twitterBot = new TwitterBot();
  });

  describe('Initialization', () => {
    test('should create Twitter bot instance', () => {
      expect(twitterBot).toBeInstanceOf(TwitterBot);
      const Twit = require('twit');
      expect(Twit).toHaveBeenCalledWith({
        consumer_key: process.env.TWITTER_CONSUMER_KEY,
        consumer_secret: process.env.TWITTER_CONSUMER_SECRET,
        access_token: process.env.TWITTER_ACCESS_TOKEN,
        access_token_secret: process.env.TWITTER_ACCESS_TOKEN_SECRET
      });
    });
  });

  describe('start()', () => {
    test('should start monitoring mentions', async () => {
      const mockStream = {
        on: jest.fn(),
        start: jest.fn(),
        stop: jest.fn()
      };
      
      mockTwitterClient.stream.mockReturnValue(mockStream);
      
      await twitterBot.start();
      
      expect(mockTwitterClient.stream).toHaveBeenCalledWith('statuses/filter', {
        track: '@DomaAlertBot'
      });
      expect(mockStream.on).toHaveBeenCalledWith('tweet', expect.any(Function));
    });

    test('should handle start errors', async () => {
      mockTwitterClient.stream.mockImplementation(() => {
        throw new Error('Failed to start stream');
      });
      
      await expect(twitterBot.start()).rejects.toThrow('Failed to start stream');
    });
  });

  describe('Mention Handling', () => {
    test('should process valid mention', async () => {
      const mockTweet = {
        id_str: '1234567890',
        user: {
          screen_name: 'testuser',
          id_str: '123456789'
        },
        text: '@DomaAlertBot check test.eth',
        created_at: new Date().toISOString()
      };

      const mockStatement = mockDb.prepare();
      mockStatement.get.mockReturnValue(mockUser);

      mockTwitterClient.post.mockResolvedValue({
        data: { id_str: '0987654321' }
      });

      await twitterBot.handleMention(mockTweet);

      expect(mockTwitterClient.post).toHaveBeenCalledWith(
        'statuses/update',
        expect.objectContaining({
          status: expect.stringContaining('@testuser'),
          in_reply_to_status_id: '1234567890'
        })
      );
    });

    test('should handle unregistered user mentions', async () => {
      const mockTweet = {
        id_str: '1234567890',
        user: {
          screen_name: 'unknown_user',
          id_str: '999999999'
        },
        text: '@DomaAlertBot check test.eth'
      };

      const mockStatement = mockDb.prepare();
      mockStatement.get.mockReturnValue(null); // User not found

      mockTwitterClient.post.mockResolvedValue({
        data: { id_str: '0987654321' }
      });

      await twitterBot.handleMention(mockTweet);

      expect(mockTwitterClient.post).toHaveBeenCalledWith(
        'statuses/update',
        expect.objectContaining({
          status: expect.stringContaining('register first')
        })
      );
    });
  });

  describe('Command Parsing', () => {
    test('should parse check domain command', () => {
      const command = twitterBot.parseCommand('@DomaAlertBot check test.eth');
      
      expect(command).toEqual({
        action: 'check',
        domain: 'test.eth',
        params: {}
      });
    });

    test('should parse renew domain command', () => {
      const command = twitterBot.parseCommand('@DomaAlertBot renew example.eth max:0.2');
      
      expect(command).toEqual({
        action: 'renew',
        domain: 'example.eth',
        params: { max: '0.2' }
      });
    });

    test('should parse alert command', () => {
      const command = twitterBot.parseCommand('@DomaAlertBot alert premium.eth expiry days:7');
      
      expect(command).toEqual({
        action: 'alert',
        domain: 'premium.eth',
        type: 'expiry',
        params: { days: '7' }
      });
    });

    test('should handle invalid commands', () => {
      const command = twitterBot.parseCommand('@DomaAlertBot invalid command');
      
      expect(command).toEqual({
        action: 'help',
        params: {}
      });
    });
  });

  describe('Domain Operations', () => {
    test('should execute domain check', async () => {
      const mockDomainInfo = {
        domain: 'test.eth',
        owner: '0x1234567890123456789012345678901234567890',
        expiry: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000), // 90 days
        available: false
      };

      // Mock domain info retrieval
      twitterBot.getDomainInfo = jest.fn().mockResolvedValue(mockDomainInfo);

      const result = await twitterBot.executeCheckDomain('test.eth');

      expect(result).toContain('test.eth is registered');
      expect(result).toContain('expires in');
    });

    test('should execute domain renewal', async () => {
      const { ethers } = require('ethers');
      const mockContract = new ethers.Contract();
      
      const mockStatement = mockDb.prepare();
      mockStatement.get.mockReturnValue(mockUser);

      const result = await twitterBot.executeAutoRenewal('test.eth', mockUser, { max: '0.2' });

      expect(result).toContain('Renewal initiated');
      expect(mockContract.renewDomain).toHaveBeenCalledWith('test.eth');
    });

    test('should handle renewal price exceeding limit', async () => {
      const { ethers } = require('ethers');
      const mockContract = new ethers.Contract();
      mockContract.getRenewalPrice.mockResolvedValue('500000000000000000'); // 0.5 ETH > 0.2 limit
      
      const mockStatement = mockDb.prepare();
      mockStatement.get.mockReturnValue(mockUser);

      const result = await twitterBot.executeAutoRenewal('test.eth', mockUser, { max: '0.2' });

      expect(result).toContain('exceeds your maximum price');
    });
  });

  describe('Alert Management', () => {
    test('should create expiry alert', async () => {
      const mockStatement = mockDb.prepare();
      mockStatement.run.mockReturnValue({ lastInsertRowid: 1 });

      const result = await twitterBot.createAlert(mockUser, 'test.eth', 'expiry', { days: '7' });

      expect(result).toContain('Alert created');
      expect(mockStatement.run).toHaveBeenCalledWith(
        mockUser.id, 'test.eth', 'expiry', JSON.stringify({ daysBeforeExpiry: 7 }), 1
      );
    });

    test('should handle duplicate alerts', async () => {
      const mockStatement = mockDb.prepare();
      mockStatement.get.mockReturnValue({ id: 1 }); // Existing alert

      const result = await twitterBot.createAlert(mockUser, 'test.eth', 'expiry', { days: '7' });

      expect(result).toContain('already have an alert');
    });
  });

  describe('Daily Opportunities', () => {
    test('should post daily domain opportunities', async () => {
      const mockOpportunities = [
        {
          domain: 'premium1.eth',
          type: 'expiring',
          price: '1.5',
          expiry: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000)
        },
        {
          domain: 'premium2.eth',
          type: 'available',
          price: '2.0',
          length: 7
        }
      ];

      twitterBot.getDomainOpportunities = jest.fn().mockResolvedValue(mockOpportunities);

      mockTwitterClient.post.mockResolvedValue({
        data: { id_str: '1111111111' }
      });

      await twitterBot.postDailyOpportunities();

      expect(mockTwitterClient.post).toHaveBeenCalledWith(
        'statuses/update',
        expect.objectContaining({
          status: expect.stringContaining('🚀 Daily Domain Opportunities')
        })
      );
    });

    test('should handle empty opportunities', async () => {
      twitterBot.getDomainOpportunities = jest.fn().mockResolvedValue([]);

      mockTwitterClient.post.mockResolvedValue({
        data: { id_str: '1111111111' }
      });

      await twitterBot.postDailyOpportunities();

      expect(mockTwitterClient.post).toHaveBeenCalledWith(
        'statuses/update',
        expect.objectContaining({
          status: expect.stringContaining('No special opportunities')
        })
      );
    });
  });

  describe('Response Formatting', () => {
    test('should format domain check response', () => {
      const domainInfo = {
        domain: 'test.eth',
        owner: '0x1234...7890',
        expiry: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        available: false
      };

      const response = twitterBot.formatDomainResponse(domainInfo);

      expect(response).toContain('test.eth');
      expect(response).toContain('registered');
      expect(response).toContain('expires');
    });

    test('should format available domain response', () => {
      const domainInfo = {
        domain: 'available.eth',
        available: true,
        registrationPrice: '0.1'
      };

      const response = twitterBot.formatDomainResponse(domainInfo);

      expect(response).toContain('available.eth');
      expect(response).toContain('available for registration');
      expect(response).toContain('0.1 ETH');
    });

    test('should truncate long responses for Twitter', () => {
      const longText = 'A'.repeat(300); // Longer than Twitter limit
      const truncated = twitterBot.truncateResponse(longText);

      expect(truncated.length).toBeLessThanOrEqual(280);
      expect(truncated).toContain('...');
    });
  });

  describe('Error Handling', () => {
    test('should handle Twitter API errors gracefully', async () => {
      const mockTweet = {
        id_str: '1234567890',
        user: { screen_name: 'testuser' },
        text: '@DomaAlertBot check test.eth'
      };

      mockTwitterClient.post.mockRejectedValue(new Error('Twitter API error'));

      await expect(twitterBot.handleMention(mockTweet)).resolves.not.toThrow();
    });

    test('should handle database errors in mention processing', async () => {
      const mockTweet = {
        id_str: '1234567890',
        user: { screen_name: 'testuser' },
        text: '@DomaAlertBot check test.eth'
      };

      const mockStatement = mockDb.prepare();
      mockStatement.get.mockImplementation(() => {
        throw new Error('Database error');
      });

      await expect(twitterBot.handleMention(mockTweet)).resolves.not.toThrow();
    });
  });

  describe('Rate Limiting', () => {
    test('should respect Twitter rate limits', async () => {
      const mockTweets = Array.from({ length: 5 }, (_, i) => ({
        id_str: `${1234567890 + i}`,
        user: { screen_name: 'testuser' },
        text: '@DomaAlertBot check test.eth'
      }));

      const mockStatement = mockDb.prepare();
      mockStatement.get.mockReturnValue(mockUser);

      mockTwitterClient.post.mockResolvedValue({
        data: { id_str: '0987654321' }
      });

      // Process multiple tweets rapidly
      await Promise.all(mockTweets.map(tweet => twitterBot.handleMention(tweet)));

      // Should have processed all tweets (rate limiting is internal)
      expect(mockTwitterClient.post).toHaveBeenCalledTimes(5);
    });
  });

  describe('Scheduled Tasks', () => {
    test('should schedule daily opportunities', () => {
      // Mock cron scheduler
      twitterBot.scheduleDaily = jest.fn();
      
      twitterBot.setupScheduledTasks();
      
      expect(twitterBot.scheduleDaily).toHaveBeenCalledWith(
        expect.any(Function),
        { hour: 9, minute: 0 } // 9 AM UTC
      );
    });
  });

  describe('stop()', () => {
    test('should stop Twitter stream gracefully', async () => {
      const mockStream = {
        on: jest.fn(),
        start: jest.fn(),
        stop: jest.fn()
      };
      
      mockTwitterClient.stream.mockReturnValue(mockStream);
      
      await twitterBot.start();
      await twitterBot.stop();
      
      expect(mockStream.stop).toHaveBeenCalled();
    });

    test('should handle stop errors', async () => {
      const mockStream = {
        on: jest.fn(),
        start: jest.fn(),
        stop: jest.fn().mockImplementation(() => {
          throw new Error('Failed to stop');
        })
      };
      
      mockTwitterClient.stream.mockReturnValue(mockStream);
      twitterBot.stream = mockStream;
      
      await expect(twitterBot.stop()).rejects.toThrow('Failed to stop');
    });
  });
});