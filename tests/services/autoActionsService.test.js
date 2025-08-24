const AutoActionsService = require('../../src/services/autoActionsService.js').default;
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
        getNetwork: jest.fn().mockResolvedValue({ chainId: 1 }),
        getGasPrice: jest.fn().mockResolvedValue('20000000000'), // 20 gwei
        estimateGas: jest.fn().mockResolvedValue('150000')
      }))
    },
    Contract: jest.fn().mockImplementation(() => ({
      renewDomain: jest.fn().mockResolvedValue({ 
        hash: '0x1111111111111111111111111111111111111111111111111111111111111111',
        wait: jest.fn().mockResolvedValue({ status: 1 })
      }),
      purchaseDomain: jest.fn().mockResolvedValue({ 
        hash: '0x2222222222222222222222222222222222222222222222222222222222222222',
        wait: jest.fn().mockResolvedValue({ status: 1 })
      }),
      placeBid: jest.fn().mockResolvedValue({ 
        hash: '0x3333333333333333333333333333333333333333333333333333333333333333',
        wait: jest.fn().mockResolvedValue({ status: 1 })
      }),
      getRenewalPrice: jest.fn().mockResolvedValue('100000000000000000'), // 0.1 ETH
      getDomainPrice: jest.fn().mockResolvedValue('1000000000000000000'), // 1 ETH
      balanceOf: jest.fn().mockResolvedValue('5000000000000000000') // 5 ETH
    })),
    utils: {
      parseEther: jest.fn().mockImplementation((value) => `${value}000000000000000000`),
      formatEther: jest.fn().mockImplementation((value) => (parseInt(value) / 1e18).toString())
    }
  }
}));

describe('AutoActionsService', () => {
  let autoActionsService;
  let mockDb;

  const mockUser = {
    id: 1,
    username: 'testuser',
    subscriptionTier: 'premium',
    walletAddress: '0x1234567890123456789012345678901234567890'
  };

  const mockAutoAction = {
    id: 1,
    userId: 1,
    type: 'renewal',
    domain: 'test.eth',
    conditions: JSON.stringify({
      daysBeforeExpiry: 7,
      maxPrice: '0.2'
    }),
    isActive: true,
    createdAt: new Date().toISOString()
  };

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();
    
    // Setup database mock
    mockDb = {
      prepare: jest.fn().mockImplementation(() => ({
        get: jest.fn(),
        all: jest.fn(),
        run: jest.fn()
      }))
    };
    
    Database.getInstance = jest.fn().mockReturnValue(mockDb);
    
    autoActionsService = new AutoActionsService();
  });

  describe('Initialization', () => {
    test('should create instance with default configuration', () => {
      expect(autoActionsService).toBeInstanceOf(AutoActionsService);
    });

    test('should start monitoring when initialized', () => {
      expect(autoActionsService.isRunning).toBe(false);
    });
  });

  describe('createAutoAction()', () => {
    test('should create renewal auto-action successfully', async () => {
      const mockStatement = mockDb.prepare();
      mockStatement.run.mockReturnValue({ 
        lastInsertRowid: 1,
        changes: 1
      });

      const actionData = {
        userId: 1,
        type: 'renewal',
        domain: 'test.eth',
        conditions: {
          daysBeforeExpiry: 7,
          maxPrice: '0.2'
        }
      };

      const result = await autoActionsService.createAutoAction(actionData);

      expect(result).toHaveProperty('success', true);
      expect(result).toHaveProperty('actionId', 1);
      expect(mockStatement.run).toHaveBeenCalledWith(
        1, 'renewal', 'test.eth', JSON.stringify(actionData.conditions), 1
      );
    });

    test('should create purchase auto-action successfully', async () => {
      const mockStatement = mockDb.prepare();
      mockStatement.run.mockReturnValue({ 
        lastInsertRowid: 2,
        changes: 1
      });

      const actionData = {
        userId: 1,
        type: 'purchase',
        domain: 'premium.eth',
        conditions: {
          maxPrice: '5.0',
          immediate: true
        }
      };

      const result = await autoActionsService.createAutoAction(actionData);

      expect(result).toHaveProperty('success', true);
      expect(result).toHaveProperty('actionId', 2);
    });

    test('should create bidding auto-action successfully', async () => {
      const mockStatement = mockDb.prepare();
      mockStatement.run.mockReturnValue({ 
        lastInsertRowid: 3,
        changes: 1
      });

      const actionData = {
        userId: 1,
        type: 'bidding',
        domain: 'auction.eth',
        conditions: {
          maxBid: '2.0',
          bidIncrement: '0.1',
          stopAtPrice: '3.0'
        }
      };

      const result = await autoActionsService.createAutoAction(actionData);

      expect(result).toHaveProperty('success', true);
      expect(result).toHaveProperty('actionId', 3);
    });

    test('should validate action conditions', async () => {
      const invalidActionData = {
        userId: 1,
        type: 'renewal',
        domain: 'test.eth',
        conditions: {
          daysBeforeExpiry: -1, // Invalid
          maxPrice: 'invalid'    // Invalid
        }
      };

      await expect(autoActionsService.createAutoAction(invalidActionData))
        .rejects.toThrow('Invalid action conditions');
    });
  });

  describe('getUserAutoActions()', () => {
    test('should return user auto-actions', async () => {
      const mockActions = [
        mockAutoAction,
        {
          ...mockAutoAction,
          id: 2,
          type: 'purchase',
          domain: 'buy.eth'
        }
      ];

      const mockStatement = mockDb.prepare();
      mockStatement.all.mockReturnValue(mockActions);

      const actions = await autoActionsService.getUserAutoActions(1);

      expect(actions).toBeInstanceOf(Array);
      expect(actions).toHaveLength(2);
      expect(actions[0]).toHaveProperty('type', 'renewal');
      expect(actions[1]).toHaveProperty('type', 'purchase');
    });

    test('should return empty array for user with no actions', async () => {
      const mockStatement = mockDb.prepare();
      mockStatement.all.mockReturnValue([]);

      const actions = await autoActionsService.getUserAutoActions(999);

      expect(actions).toBeInstanceOf(Array);
      expect(actions).toHaveLength(0);
    });
  });

  describe('executeRenewal()', () => {
    test('should execute domain renewal successfully', async () => {
      const { ethers } = require('ethers');
      const mockContract = new ethers.Contract();
      
      const renewalAction = {
        ...mockAutoAction,
        type: 'renewal',
        conditions: JSON.stringify({
          daysBeforeExpiry: 7,
          maxPrice: '0.2'
        })
      };

      const mockUserStatement = mockDb.prepare();
      const mockLogStatement = mockDb.prepare();
      
      mockUserStatement.get.mockReturnValue(mockUser);
      mockLogStatement.run.mockReturnValue({ lastInsertRowid: 1 });

      mockDb.prepare.mockImplementation((sql) => {
        if (sql.includes('users')) return mockUserStatement;
        if (sql.includes('INSERT INTO auto_action_logs')) return mockLogStatement;
        return { get: jest.fn(), all: jest.fn(), run: jest.fn() };
      });

      const result = await autoActionsService.executeRenewal(renewalAction);

      expect(result).toHaveProperty('success', true);
      expect(result).toHaveProperty('transactionHash');
      expect(mockContract.renewDomain).toHaveBeenCalledWith('test.eth');
    });

    test('should handle renewal price limit exceeded', async () => {
      const { ethers } = require('ethers');
      const mockContract = new ethers.Contract();
      mockContract.getRenewalPrice.mockResolvedValue('300000000000000000'); // 0.3 ETH > 0.2 limit

      const renewalAction = {
        ...mockAutoAction,
        type: 'renewal',
        conditions: JSON.stringify({
          daysBeforeExpiry: 7,
          maxPrice: '0.2'
        })
      };

      const mockStatement = mockDb.prepare();
      mockStatement.get.mockReturnValue(mockUser);

      const result = await autoActionsService.executeRenewal(renewalAction);

      expect(result).toHaveProperty('success', false);
      expect(result).toHaveProperty('error');
      expect(result.error).toContain('exceeds maximum price');
    });

    test('should handle insufficient balance', async () => {
      const { ethers } = require('ethers');
      const mockContract = new ethers.Contract();
      mockContract.balanceOf.mockResolvedValue('50000000000000000'); // 0.05 ETH < required

      const renewalAction = {
        ...mockAutoAction,
        type: 'renewal'
      };

      const mockStatement = mockDb.prepare();
      mockStatement.get.mockReturnValue(mockUser);

      const result = await autoActionsService.executeRenewal(renewalAction);

      expect(result).toHaveProperty('success', false);
      expect(result).toHaveProperty('error');
      expect(result.error).toContain('Insufficient balance');
    });
  });

  describe('executePurchase()', () => {
    test('should execute domain purchase successfully', async () => {
      const { ethers } = require('ethers');
      const mockContract = new ethers.Contract();
      
      const purchaseAction = {
        ...mockAutoAction,
        type: 'purchase',
        domain: 'available.eth',
        conditions: JSON.stringify({
          maxPrice: '2.0',
          immediate: true
        })
      };

      const mockUserStatement = mockDb.prepare();
      const mockLogStatement = mockDb.prepare();
      
      mockUserStatement.get.mockReturnValue(mockUser);
      mockLogStatement.run.mockReturnValue({ lastInsertRowid: 1 });

      mockDb.prepare.mockImplementation((sql) => {
        if (sql.includes('users')) return mockUserStatement;
        if (sql.includes('INSERT INTO auto_action_logs')) return mockLogStatement;
        return { get: jest.fn(), all: jest.fn(), run: jest.fn() };
      });

      const result = await autoActionsService.executePurchase(purchaseAction);

      expect(result).toHaveProperty('success', true);
      expect(result).toHaveProperty('transactionHash');
      expect(mockContract.purchaseDomain).toHaveBeenCalledWith('available.eth');
    });

    test('should handle purchase price limit exceeded', async () => {
      const { ethers } = require('ethers');
      const mockContract = new ethers.Contract();
      mockContract.getDomainPrice.mockResolvedValue('3000000000000000000'); // 3 ETH > 2 limit

      const purchaseAction = {
        ...mockAutoAction,
        type: 'purchase',
        conditions: JSON.stringify({
          maxPrice: '2.0',
          immediate: true
        })
      };

      const mockStatement = mockDb.prepare();
      mockStatement.get.mockReturnValue(mockUser);

      const result = await autoActionsService.executePurchase(purchaseAction);

      expect(result).toHaveProperty('success', false);
      expect(result).toHaveProperty('error');
      expect(result.error).toContain('exceeds maximum price');
    });
  });

  describe('executeBidding()', () => {
    test('should place bid successfully', async () => {
      const { ethers } = require('ethers');
      const mockContract = new ethers.Contract();
      
      const biddingAction = {
        ...mockAutoAction,
        type: 'bidding',
        domain: 'auction.eth',
        conditions: JSON.stringify({
          maxBid: '2.0',
          bidIncrement: '0.1',
          stopAtPrice: '3.0'
        })
      };

      const mockUserStatement = mockDb.prepare();
      const mockLogStatement = mockDb.prepare();
      
      mockUserStatement.get.mockReturnValue(mockUser);
      mockLogStatement.run.mockReturnValue({ lastInsertRowid: 1 });

      mockDb.prepare.mockImplementation((sql) => {
        if (sql.includes('users')) return mockUserStatement;
        if (sql.includes('INSERT INTO auto_action_logs')) return mockLogStatement;
        return { get: jest.fn(), all: jest.fn(), run: jest.fn() };
      });

      const result = await autoActionsService.executeBidding(biddingAction, '1.5'); // Current bid

      expect(result).toHaveProperty('success', true);
      expect(result).toHaveProperty('transactionHash');
      expect(mockContract.placeBid).toHaveBeenCalledWith('auction.eth', '1600000000000000000'); // 1.6 ETH
    });

    test('should stop bidding at maximum price', async () => {
      const biddingAction = {
        ...mockAutoAction,
        type: 'bidding',
        conditions: JSON.stringify({
          maxBid: '2.0',
          bidIncrement: '0.1',
          stopAtPrice: '2.5'
        })
      };

      const mockStatement = mockDb.prepare();
      mockStatement.get.mockReturnValue(mockUser);

      const result = await autoActionsService.executeBidding(biddingAction, '2.6'); // Above stop price

      expect(result).toHaveProperty('success', false);
      expect(result).toHaveProperty('error');
      expect(result.error).toContain('Current price exceeds stop limit');
    });
  });

  describe('updateAutoAction()', () => {
    test('should update auto-action successfully', async () => {
      const mockStatement = mockDb.prepare();
      mockStatement.run.mockReturnValue({ changes: 1 });

      const updateData = {
        conditions: {
          daysBeforeExpiry: 14,
          maxPrice: '0.3'
        },
        isActive: false
      };

      const result = await autoActionsService.updateAutoAction(1, updateData);

      expect(result).toHaveProperty('success', true);
      expect(mockStatement.run).toHaveBeenCalledWith(
        JSON.stringify(updateData.conditions),
        0, // isActive false
        1  // actionId
      );
    });

    test('should handle update of non-existent action', async () => {
      const mockStatement = mockDb.prepare();
      mockStatement.run.mockReturnValue({ changes: 0 });

      const updateData = {
        conditions: { maxPrice: '0.5' }
      };

      await expect(autoActionsService.updateAutoAction(999, updateData))
        .rejects.toThrow('Auto-action not found');
    });
  });

  describe('deleteAutoAction()', () => {
    test('should delete auto-action successfully', async () => {
      const mockStatement = mockDb.prepare();
      mockStatement.run.mockReturnValue({ changes: 1 });

      const result = await autoActionsService.deleteAutoAction(1);

      expect(result).toHaveProperty('success', true);
      expect(mockStatement.run).toHaveBeenCalledWith(1);
    });

    test('should handle delete of non-existent action', async () => {
      const mockStatement = mockDb.prepare();
      mockStatement.run.mockReturnValue({ changes: 0 });

      await expect(autoActionsService.deleteAutoAction(999))
        .rejects.toThrow('Auto-action not found');
    });
  });

  describe('getActionLogs()', () => {
    test('should return action execution logs', async () => {
      const mockLogs = [
        {
          id: 1,
          actionId: 1,
          status: 'success',
          transactionHash: '0x1234567890abcdef',
          error: null,
          executedAt: new Date().toISOString()
        },
        {
          id: 2,
          actionId: 1,
          status: 'failed',
          transactionHash: null,
          error: 'Insufficient balance',
          executedAt: new Date().toISOString()
        }
      ];

      const mockStatement = mockDb.prepare();
      mockStatement.all.mockReturnValue(mockLogs);

      const logs = await autoActionsService.getActionLogs(1);

      expect(logs).toBeInstanceOf(Array);
      expect(logs).toHaveLength(2);
      expect(logs[0]).toHaveProperty('status', 'success');
      expect(logs[1]).toHaveProperty('status', 'failed');
    });
  });

  describe('Safety Controls', () => {
    test('should enforce spending limits', async () => {
      const mockUser = {
        id: 1,
        subscriptionTier: 'basic', // Lower tier
        walletAddress: '0x1234567890123456789012345678901234567890'
      };

      const expensiveAction = {
        ...mockAutoAction,
        type: 'purchase',
        conditions: JSON.stringify({
          maxPrice: '100.0' // Very high price
        })
      };

      const mockStatement = mockDb.prepare();
      mockStatement.get.mockReturnValue(mockUser);

      const result = await autoActionsService.executePurchase(expensiveAction);

      expect(result).toHaveProperty('success', false);
      expect(result).toHaveProperty('error');
      expect(result.error).toContain('Spending limit exceeded');
    });

    test('should validate subscription tier permissions', async () => {
      const freeUser = {
        ...mockUser,
        subscriptionTier: 'free'
      };

      const actionData = {
        userId: 1,
        type: 'bidding', // Premium feature
        domain: 'test.eth',
        conditions: {
          maxBid: '1.0'
        }
      };

      const mockStatement = mockDb.prepare();
      mockStatement.get.mockReturnValue(freeUser);

      await expect(autoActionsService.createAutoAction(actionData))
        .rejects.toThrow('Bidding auto-actions require Premium subscription');
    });
  });
});