const SubscriptionService = require('../../src/services/subscriptionService.js').default;
const Database = require('../../src/database/index.js');

// Mock dependencies
jest.mock('../../src/database/index.js');
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
    providers: {
      JsonRpcProvider: jest.fn().mockImplementation(() => ({
        getNetwork: jest.fn().mockResolvedValue({ chainId: 1 })
      }))
    },
    Contract: jest.fn().mockImplementation(() => ({
      transfer: jest.fn().mockResolvedValue({ 
        hash: '0x1234567890abcdef',
        wait: jest.fn().mockResolvedValue({ status: 1 })
      }),
      balanceOf: jest.fn().mockResolvedValue('1000000000000000000000'), // 1000 DOMA
      decimals: jest.fn().mockResolvedValue(18)
    })),
    utils: {
      parseEther: jest.fn().mockImplementation((value) => `${value}000000000000000000`),
      formatEther: jest.fn().mockImplementation((value) => (parseInt(value) / 1e18).toString())
    }
  }
}));

describe('SubscriptionService', () => {
  let subscriptionService;
  let mockDb;

  const mockUser = {
    id: 1,
    username: 'testuser',
    subscriptionTier: 'free',
    subscriptionExpiry: null,
    walletAddress: '0x1234567890123456789012345678901234567890'
  };

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();
    
    // Setup database mock
    mockDb = {
      prepare: jest.fn().mockImplementation((sql) => ({
        get: jest.fn(),
        all: jest.fn(),
        run: jest.fn()
      }))
    };
    
    Database.getInstance = jest.fn().mockReturnValue(mockDb);
    
    subscriptionService = new SubscriptionService();
  });

  describe('Initialization', () => {
    test('should create instance with default configuration', () => {
      expect(subscriptionService).toBeInstanceOf(SubscriptionService);
    });

    test('should initialize subscription tiers correctly', () => {
      const tiers = subscriptionService.getSubscriptionTiers();
      
      expect(tiers).toHaveProperty('free');
      expect(tiers).toHaveProperty('basic');
      expect(tiers).toHaveProperty('premium');
      
      expect(tiers.free.price).toBe(0);
      expect(tiers.basic.price).toBe(5);
      expect(tiers.premium.price).toBe(20);
    });
  });

  describe('getUserSubscription()', () => {
    test('should return user subscription data', async () => {
      const mockStatement = mockDb.prepare();
      mockStatement.get.mockReturnValue({
        ...mockUser,
        subscriptionTier: 'basic',
        subscriptionExpiry: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
      });

      const subscription = await subscriptionService.getUserSubscription(1);

      expect(subscription).toHaveProperty('tier', 'basic');
      expect(subscription).toHaveProperty('expiry');
      expect(subscription).toHaveProperty('status', 'active');
      expect(subscription).toHaveProperty('daysRemaining');
    });

    test('should return null for non-existent user', async () => {
      const mockStatement = mockDb.prepare();
      mockStatement.get.mockReturnValue(null);

      const subscription = await subscriptionService.getUserSubscription(999);

      expect(subscription).toBeNull();
    });

    test('should handle expired subscription', async () => {
      const mockStatement = mockDb.prepare();
      mockStatement.get.mockReturnValue({
        ...mockUser,
        subscriptionTier: 'basic',
        subscriptionExpiry: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
      });

      const subscription = await subscriptionService.getUserSubscription(1);

      expect(subscription.status).toBe('expired');
      expect(subscription.daysRemaining).toBe(0);
    });
  });

  describe('upgradeSubscription()', () => {
    test('should upgrade subscription successfully with payment', async () => {
      const mockUserStatement = mockDb.prepare();
      const mockUpdateStatement = mockDb.prepare();
      const mockInsertStatement = mockDb.prepare();
      
      mockUserStatement.get.mockReturnValue(mockUser);
      mockUpdateStatement.run.mockReturnValue({ changes: 1 });
      mockInsertStatement.run.mockReturnValue({ lastInsertRowid: 1 });

      // Mock multiple prepare calls
      mockDb.prepare.mockImplementation((sql) => {
        if (sql.includes('SELECT')) return mockUserStatement;
        if (sql.includes('UPDATE')) return mockUpdateStatement;
        if (sql.includes('INSERT')) return mockInsertStatement;
        return { get: jest.fn(), all: jest.fn(), run: jest.fn() };
      });

      const result = await subscriptionService.upgradeSubscription(1, 'basic');

      expect(result).toHaveProperty('success', true);
      expect(result).toHaveProperty('tier', 'basic');
      expect(result).toHaveProperty('expiry');
      expect(result).toHaveProperty('transactionHash');
    });

    test('should handle invalid tier upgrade', async () => {
      const mockStatement = mockDb.prepare();
      mockStatement.get.mockReturnValue(mockUser);

      await expect(subscriptionService.upgradeSubscription(1, 'invalid'))
        .rejects.toThrow('Invalid subscription tier: invalid');
    });

    test('should handle downgrade attempts', async () => {
      const mockStatement = mockDb.prepare();
      mockStatement.get.mockReturnValue({
        ...mockUser,
        subscriptionTier: 'premium'
      });

      await expect(subscriptionService.upgradeSubscription(1, 'basic'))
        .rejects.toThrow('Cannot downgrade from premium to basic');
    });

    test('should handle payment failures', async () => {
      const mockUserStatement = mockDb.prepare();
      mockUserStatement.get.mockReturnValue(mockUser);
      
      mockDb.prepare.mockImplementation((sql) => {
        if (sql.includes('SELECT')) return mockUserStatement;
        return { get: jest.fn(), all: jest.fn(), run: jest.fn() };
      });

      // Mock contract payment failure
      const { ethers } = require('ethers');
      const mockContract = new ethers.Contract();
      mockContract.transfer.mockRejectedValue(new Error('Insufficient balance'));

      await expect(subscriptionService.upgradeSubscription(1, 'basic'))
        .rejects.toThrow('Payment failed');
    });
  });

  describe('cancelSubscription()', () => {
    test('should cancel subscription successfully', async () => {
      const mockUserStatement = mockDb.prepare();
      const mockUpdateStatement = mockDb.prepare();
      
      mockUserStatement.get.mockReturnValue({
        ...mockUser,
        subscriptionTier: 'basic',
        subscriptionExpiry: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
      });
      mockUpdateStatement.run.mockReturnValue({ changes: 1 });

      mockDb.prepare.mockImplementation((sql) => {
        if (sql.includes('SELECT')) return mockUserStatement;
        if (sql.includes('UPDATE')) return mockUpdateStatement;
        return { get: jest.fn(), all: jest.fn(), run: jest.fn() };
      });

      const result = await subscriptionService.cancelSubscription(1);

      expect(result).toHaveProperty('success', true);
      expect(result).toHaveProperty('message');
    });

    test('should handle canceling free tier', async () => {
      const mockStatement = mockDb.prepare();
      mockStatement.get.mockReturnValue(mockUser);

      await expect(subscriptionService.cancelSubscription(1))
        .rejects.toThrow('Cannot cancel free tier subscription');
    });
  });

  describe('checkSubscriptionLimits()', () => {
    test('should enforce free tier limits', async () => {
      const limits = await subscriptionService.checkSubscriptionLimits(mockUser, 'alerts');

      expect(limits.allowed).toBe(true);
      expect(limits.limit).toBe(5);
      expect(limits.remaining).toBeLessThanOrEqual(5);
    });

    test('should allow unlimited for premium tier', async () => {
      const premiumUser = { ...mockUser, subscriptionTier: 'premium' };
      const limits = await subscriptionService.checkSubscriptionLimits(premiumUser, 'alerts');

      expect(limits.allowed).toBe(true);
      expect(limits.limit).toBe(-1); // Unlimited
    });

    test('should block when limit exceeded', async () => {
      // Mock current usage above limit
      const mockStatement = mockDb.prepare();
      mockStatement.get.mockReturnValue({ count: 6 }); // Above free limit of 5

      const limits = await subscriptionService.checkSubscriptionLimits(mockUser, 'alerts');

      expect(limits.allowed).toBe(false);
      expect(limits.remaining).toBe(0);
    });
  });

  describe('getSubscriptionHistory()', () => {
    test('should return subscription history', async () => {
      const mockTransactions = [
        {
          id: 1,
          userId: 1,
          tier: 'basic',
          amount: 5,
          transactionHash: '0xabc123',
          status: 'completed',
          createdAt: new Date().toISOString()
        },
        {
          id: 2,
          userId: 1,
          tier: 'premium',
          amount: 20,
          transactionHash: '0xdef456',
          status: 'completed',
          createdAt: new Date().toISOString()
        }
      ];

      const mockStatement = mockDb.prepare();
      mockStatement.all.mockReturnValue(mockTransactions);

      const history = await subscriptionService.getSubscriptionHistory(1);

      expect(history).toBeInstanceOf(Array);
      expect(history).toHaveLength(2);
      expect(history[0]).toHaveProperty('tier', 'basic');
      expect(history[1]).toHaveProperty('tier', 'premium');
    });

    test('should handle empty history', async () => {
      const mockStatement = mockDb.prepare();
      mockStatement.all.mockReturnValue([]);

      const history = await subscriptionService.getSubscriptionHistory(1);

      expect(history).toBeInstanceOf(Array);
      expect(history).toHaveLength(0);
    });
  });

  describe('processSubscriptionRenewal()', () => {
    test('should process automatic renewal', async () => {
      const expiredUser = {
        ...mockUser,
        subscriptionTier: 'basic',
        subscriptionExpiry: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
        autoRenewal: true
      };

      const mockUserStatement = mockDb.prepare();
      const mockUpdateStatement = mockDb.prepare();
      const mockInsertStatement = mockDb.prepare();
      
      mockUserStatement.get.mockReturnValue(expiredUser);
      mockUpdateStatement.run.mockReturnValue({ changes: 1 });
      mockInsertStatement.run.mockReturnValue({ lastInsertRowid: 1 });

      mockDb.prepare.mockImplementation((sql) => {
        if (sql.includes('SELECT')) return mockUserStatement;
        if (sql.includes('UPDATE')) return mockUpdateStatement;
        if (sql.includes('INSERT')) return mockInsertStatement;
        return { get: jest.fn(), all: jest.fn(), run: jest.fn() };
      });

      const result = await subscriptionService.processSubscriptionRenewal(1);

      expect(result).toHaveProperty('renewed', true);
      expect(result).toHaveProperty('newExpiry');
    });

    test('should handle renewal failures', async () => {
      const expiredUser = {
        ...mockUser,
        subscriptionTier: 'basic',
        subscriptionExpiry: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
        autoRenewal: true
      };

      const mockStatement = mockDb.prepare();
      mockStatement.get.mockReturnValue(expiredUser);

      // Mock payment failure
      const { ethers } = require('ethers');
      const mockContract = new ethers.Contract();
      mockContract.transfer.mockRejectedValue(new Error('Insufficient balance'));

      const result = await subscriptionService.processSubscriptionRenewal(1);

      expect(result).toHaveProperty('renewed', false);
      expect(result).toHaveProperty('error');
    });
  });

  describe('validatePayment()', () => {
    test('should validate successful payment', async () => {
      const mockReceipt = {
        status: 1,
        transactionHash: '0x1234567890abcdef',
        blockNumber: 12345678,
        gasUsed: '21000'
      };

      // Mock provider transaction receipt
      const { ethers } = require('ethers');
      const mockProvider = new ethers.providers.JsonRpcProvider();
      mockProvider.getTransactionReceipt = jest.fn().mockResolvedValue(mockReceipt);

      const isValid = await subscriptionService.validatePayment('0x1234567890abcdef');

      expect(isValid).toBe(true);
    });

    test('should handle failed payments', async () => {
      const mockReceipt = {
        status: 0, // Failed transaction
        transactionHash: '0x1234567890abcdef',
        blockNumber: 12345678
      };

      const { ethers } = require('ethers');
      const mockProvider = new ethers.providers.JsonRpcProvider();
      mockProvider.getTransactionReceipt = jest.fn().mockResolvedValue(mockReceipt);

      const isValid = await subscriptionService.validatePayment('0x1234567890abcdef');

      expect(isValid).toBe(false);
    });
  });
});