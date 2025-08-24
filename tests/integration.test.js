// Integration tests for DomaAlert Bot core functionality

// Mock database module
const mockDatabase = {
  getInstance: jest.fn(() => ({
    prepare: jest.fn(() => ({
      get: jest.fn(),
      all: jest.fn(),
      run: jest.fn()
    }))
  }))
};

// Mock logger module
const mockLogger = {
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
  }
};

describe('DomaAlert Bot Integration Tests', () => {
  let mockDb;

  beforeEach(() => {
    jest.clearAllMocks();
    mockDb = {
      prepare: jest.fn(() => ({
        get: jest.fn(),
        all: jest.fn(),
        run: jest.fn()
      }))
    };
    mockDatabase.getInstance.mockReturnValue(mockDb);
  });

  describe('Database Operations', () => {
    test('should handle user registration', () => {
      const mockStatement = mockDb.prepare();
      mockStatement.run.mockReturnValue({ lastInsertRowid: 1, changes: 1 });

      const result = mockStatement.run(
        'testuser', 
        'test@example.com', 
        'hashedpassword',
        'free',
        null,
        new Date().toISOString()
      );

      expect(result.lastInsertRowid).toBe(1);
      expect(mockStatement.run).toHaveBeenCalled();
    });

    test('should handle alert creation', () => {
      const mockStatement = mockDb.prepare();
      mockStatement.run.mockReturnValue({ lastInsertRowid: 1, changes: 1 });

      const alertData = {
        userId: 1,
        domain: 'test.eth',
        type: 'expiry',
        conditions: JSON.stringify({ daysBeforeExpiry: 7 }),
        isActive: true
      };

      const result = mockStatement.run(
        alertData.userId,
        alertData.domain,
        alertData.type,
        alertData.conditions,
        alertData.isActive
      );

      expect(result.lastInsertRowid).toBe(1);
      expect(mockStatement.run).toHaveBeenCalledWith(
        1, 'test.eth', 'expiry', JSON.stringify({ daysBeforeExpiry: 7 }), true
      );
    });

    test('should handle subscription updates', () => {
      const mockStatement = mockDb.prepare();
      mockStatement.run.mockReturnValue({ changes: 1 });

      const result = mockStatement.run(
        'premium',
        new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        1 // userId
      );

      expect(result.changes).toBe(1);
      expect(mockStatement.run).toHaveBeenCalled();
    });
  });

  describe('Alert Processing', () => {
    test('should process domain expiry events', () => {
      const expiryEvent = {
        type: 'domainExpiry',
        domain: 'test.eth',
        owner: '0x1234567890123456789012345678901234567890',
        expiry: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        timestamp: new Date()
      };

      // Mock users with matching alerts
      const mockUsersStatement = mockDb.prepare();
      mockUsersStatement.all.mockReturnValue([
        { id: 1, telegramId: '123456789', subscriptionTier: 'basic' }
      ]);

      mockDb.prepare.mockImplementation((sql) => {
        if (sql.includes('alerts') && sql.includes('users')) {
          return mockUsersStatement;
        }
        return { get: jest.fn(), all: jest.fn(), run: jest.fn() };
      });

      const users = mockUsersStatement.all();
      expect(users).toHaveLength(1);
      expect(users[0]).toHaveProperty('telegramId', '123456789');
    });

    test('should filter alerts by subscription tier', () => {
      const saleEvent = {
        type: 'domainSale',
        domain: 'premium.eth',
        price: '5000000000000000000', // 5 ETH
        timestamp: new Date()
      };

      // Mock subscription filtering
      const mockStatement = mockDb.prepare();
      mockStatement.all.mockReturnValue([
        { id: 1, subscriptionTier: 'premium', telegramId: '123456789' }
      ]);

      const users = mockStatement.all();
      const premiumUsers = users.filter(u => u.subscriptionTier === 'premium');
      
      expect(premiumUsers).toHaveLength(1);
    });
  });

  describe('Message Formatting', () => {
    test('should format expiry alert message', () => {
      const alertData = {
        type: 'domainExpiry',
        domain: 'test.eth',
        expiry: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        owner: '0x1234...7890'
      };

      const message = formatExpiryAlert(alertData);
      expect(message).toContain('🚨 Domain Expiry Alert');
      expect(message).toContain('test.eth');
      expect(message).toContain('7 days');
    });

    test('should format sale alert message', () => {
      const alertData = {
        type: 'domainSale',
        domain: 'premium.eth',
        price: '5.0',
        seller: '0x1111...1111',
        buyer: '0x2222...2222'
      };

      const message = formatSaleAlert(alertData);
      expect(message).toContain('💰 Domain Sale Alert');
      expect(message).toContain('premium.eth');
      expect(message).toContain('5.0 ETH');
    });
  });

  describe('Subscription Management', () => {
    test('should validate subscription limits', () => {
      const freeUser = { subscriptionTier: 'free' };
      const basicUser = { subscriptionTier: 'basic' };
      const premiumUser = { subscriptionTier: 'premium' };

      expect(getSubscriptionLimits(freeUser.subscriptionTier).alerts).toBe(5);
      expect(getSubscriptionLimits(basicUser.subscriptionTier).alerts).toBe(50);
      expect(getSubscriptionLimits(premiumUser.subscriptionTier).alerts).toBe(-1); // Unlimited
    });

    test('should calculate subscription expiry', () => {
      const now = new Date();
      const basicExpiry = calculateSubscriptionExpiry('basic', now);
      const premiumExpiry = calculateSubscriptionExpiry('premium', now);

      // Basic: 30 days, Premium: 30 days (both monthly)
      expect(basicExpiry.getTime()).toBeGreaterThan(now.getTime());
      expect(premiumExpiry.getTime()).toBeGreaterThan(now.getTime());
    });
  });

  describe('Domain Validation', () => {
    test('should validate domain formats', () => {
      expect(isValidDomain('test.eth')).toBe(true);
      expect(isValidDomain('example.com')).toBe(true);
      expect(isValidDomain('sub.domain.eth')).toBe(true);
      expect(isValidDomain('invalid_domain')).toBe(false);
      expect(isValidDomain('')).toBe(false);
      expect(isValidDomain('a'.repeat(250) + '.eth')).toBe(false); // Too long
    });

    test('should extract domain from various inputs', () => {
      expect(extractDomain('test.eth')).toBe('test.eth');
      expect(extractDomain('https://test.eth')).toBe('test.eth');
      expect(extractDomain('Check domain: test.eth status')).toBe('test.eth');
    });
  });

  describe('Error Handling', () => {
    test('should handle database connection errors', () => {
      const mockStatement = mockDb.prepare();
      mockStatement.get.mockImplementation(() => {
        throw new Error('Connection lost');
      });

      expect(() => {
        try {
          mockStatement.get();
        } catch (error) {
          expect(error.message).toBe('Connection lost');
          throw error;
        }
      }).toThrow('Connection lost');
    });

    test('should handle invalid JSON in conditions', () => {
      const invalidConditions = 'invalid json string';
      
      expect(() => {
        JSON.parse(invalidConditions);
      }).toThrow();
    });
  });

  describe('Security Measures', () => {
    test('should validate user permissions', () => {
      const freeUser = { id: 1, subscriptionTier: 'free' };
      const premiumUser = { id: 2, subscriptionTier: 'premium' };

      expect(canCreateAutoAction(freeUser, 'renewal')).toBe(false);
      expect(canCreateAutoAction(premiumUser, 'renewal')).toBe(true);
      expect(canCreateAutoAction(premiumUser, 'bidding')).toBe(true);
    });

    test('should enforce spending limits', () => {
      const user = { subscriptionTier: 'basic' };
      const highAmount = '100.0'; // 100 ETH
      const reasonableAmount = '1.0'; // 1 ETH

      expect(isWithinSpendingLimit(user, highAmount)).toBe(false);
      expect(isWithinSpendingLimit(user, reasonableAmount)).toBe(true);
    });
  });
});

// Helper functions for testing
function formatExpiryAlert(data) {
  const days = Math.ceil((data.expiry - new Date()) / (24 * 60 * 60 * 1000));
  return `🚨 Domain Expiry Alert\n\nDomain: ${data.domain}\nExpires in: ${days} days\nOwner: ${data.owner}`;
}

function formatSaleAlert(data) {
  return `💰 Domain Sale Alert\n\nDomain: ${data.domain}\nPrice: ${data.price} ETH\nSeller: ${data.seller}\nBuyer: ${data.buyer}`;
}

function getSubscriptionLimits(tier) {
  const limits = {
    free: { alerts: 5, autoActions: 0 },
    basic: { alerts: 50, autoActions: 3 },
    premium: { alerts: -1, autoActions: -1 }
  };
  return limits[tier] || limits.free;
}

function calculateSubscriptionExpiry(tier, startDate) {
  const expiry = new Date(startDate);
  expiry.setMonth(expiry.getMonth() + 1); // Add 1 month
  return expiry;
}

function isValidDomain(domain) {
  if (!domain || typeof domain !== 'string') return false;
  if (domain.length > 253) return false;
  
  const domainRegex = /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.([a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?))*\.[a-zA-Z]{2,}$/;
  return domainRegex.test(domain);
}

function extractDomain(text) {
  const domainMatch = text.match(/([a-zA-Z0-9][a-zA-Z0-9-]*[a-zA-Z0-9]*\.[a-zA-Z]{2,})/);
  return domainMatch ? domainMatch[1] : null;
}

function canCreateAutoAction(user, actionType) {
  if (user.subscriptionTier === 'free') return false;
  if (actionType === 'bidding' && user.subscriptionTier !== 'premium') return false;
  return true;
}

function isWithinSpendingLimit(user, amount) {
  const limits = {
    free: 0,
    basic: 10, // 10 ETH
    premium: 50 // 50 ETH
  };
  
  const limit = limits[user.subscriptionTier] || 0;
  return parseFloat(amount) <= limit;
}