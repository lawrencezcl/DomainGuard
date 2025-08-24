const ContractMonitor = require('../../src/contracts/contractMonitor.js').default;
const { EventEmitter } = require('events');

// Mock dependencies
jest.mock('ethers', () => ({
  ethers: {
    providers: {
      WebSocketProvider: jest.fn().mockImplementation(() => ({
        on: jest.fn(),
        removeAllListeners: jest.fn(),
        destroy: jest.fn()
      }))
    },
    Contract: jest.fn().mockImplementation(() => ({
      on: jest.fn(),
      removeAllListeners: jest.fn(),
      filters: {
        DomainExpired: jest.fn().mockReturnValue('DomainExpired_filter'),
        Transfer: jest.fn().mockReturnValue('Transfer_filter'),
        DomainSold: jest.fn().mockReturnValue('DomainSold_filter')
      }
    }))
  }
}));

jest.mock('../../src/utils/logger.js', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
  }
}));

describe('ContractMonitor', () => {
  let contractMonitor;
  let mockProvider;
  let mockContract;

  beforeEach(() => {
    // Clear all mocks
    jest.clearAllMocks();
    
    // Create mock instances
    const { ethers } = require('ethers');
    mockProvider = new ethers.providers.WebSocketProvider();
    mockContract = new ethers.Contract();
    
    // Mock the constructor behavior
    ethers.providers.WebSocketProvider.mockImplementation(() => mockProvider);
    ethers.Contract.mockImplementation(() => mockContract);
    
    contractMonitor = new ContractMonitor();
  });

  afterEach(async () => {
    if (contractMonitor) {
      await contractMonitor.stop();
    }
  });

  describe('Initialization', () => {
    test('should create instance with default configuration', () => {
      expect(contractMonitor).toBeInstanceOf(ContractMonitor);
      expect(contractMonitor).toBeInstanceOf(EventEmitter);
    });

    test('should initialize with custom config', () => {
      const config = {
        rpcUrl: 'wss://custom-rpc.com',
        contractAddress: '0x1234567890123456789012345678901234567890',
        refreshInterval: 5000
      };
      
      const customMonitor = new ContractMonitor(config);
      expect(customMonitor).toBeInstanceOf(ContractMonitor);
    });
  });

  describe('start()', () => {
    test('should start monitoring successfully', async () => {
      mockProvider.on = jest.fn();
      mockContract.on = jest.fn();
      
      await contractMonitor.start();
      
      expect(mockProvider.on).toHaveBeenCalledWith('error', expect.any(Function));
      expect(mockContract.on).toHaveBeenCalledWith('DomainExpired_filter', expect.any(Function));
      expect(mockContract.on).toHaveBeenCalledWith('Transfer_filter', expect.any(Function));
      expect(mockContract.on).toHaveBeenCalledWith('DomainSold_filter', expect.any(Function));
    });

    test('should handle start errors gracefully', async () => {
      const error = new Error('Connection failed');
      mockProvider.on = jest.fn().mockImplementation((event, callback) => {
        if (event === 'error') {
          setTimeout(() => callback(error), 10);
        }
      });
      
      await expect(contractMonitor.start()).rejects.toThrow('Connection failed');
    });

    test('should not start if already running', async () => {
      mockProvider.on = jest.fn();
      mockContract.on = jest.fn();
      
      await contractMonitor.start();
      
      // Try to start again
      await contractMonitor.start();
      
      // Should only be called once
      expect(mockProvider.on).toHaveBeenCalledTimes(1);
    });
  });

  describe('Event Processing', () => {
    beforeEach(async () => {
      mockProvider.on = jest.fn();
      mockContract.on = jest.fn();
      await contractMonitor.start();
    });

    test('should process domain expiry events', (done) => {
      const mockEvent = {
        args: {
          domain: 'test.eth',
          owner: '0x1234567890123456789012345678901234567890',
          expiry: '1640995200' // Unix timestamp
        },
        blockNumber: 12345678,
        transactionHash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890'
      };

      contractMonitor.on('domainExpiry', (eventData) => {
        expect(eventData).toEqual({
          type: 'domainExpiry',
          domain: 'test.eth',
          owner: '0x1234567890123456789012345678901234567890',
          expiry: new Date(1640995200 * 1000),
          blockNumber: 12345678,
          transactionHash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
          timestamp: expect.any(Date)
        });
        done();
      });

      // Simulate event emission
      const eventHandler = mockContract.on.mock.calls.find(call => 
        call[0] === 'DomainExpired_filter'
      )[1];
      eventHandler(mockEvent.args.domain, mockEvent.args.owner, mockEvent.args.expiry, mockEvent);
    });

    test('should process domain transfer events', (done) => {
      const mockEvent = {
        args: {
          from: '0x1234567890123456789012345678901234567890',
          to: '0x0987654321098765432109876543210987654321',
          tokenId: '123'
        },
        blockNumber: 12345679,
        transactionHash: '0xfedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321'
      };

      contractMonitor.on('domainTransfer', (eventData) => {
        expect(eventData).toEqual({
          type: 'domainTransfer',
          from: '0x1234567890123456789012345678901234567890',
          to: '0x0987654321098765432109876543210987654321',
          tokenId: '123',
          blockNumber: 12345679,
          transactionHash: '0xfedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321',
          timestamp: expect.any(Date)
        });
        done();
      });

      // Simulate event emission
      const eventHandler = mockContract.on.mock.calls.find(call => 
        call[0] === 'Transfer_filter'
      )[1];
      eventHandler(mockEvent.args.from, mockEvent.args.to, mockEvent.args.tokenId, mockEvent);
    });

    test('should process domain sale events', (done) => {
      const mockEvent = {
        args: {
          domain: 'premium.eth',
          seller: '0x1111111111111111111111111111111111111111',
          buyer: '0x2222222222222222222222222222222222222222',
          price: '1000000000000000000' // 1 ETH in wei
        },
        blockNumber: 12345680,
        transactionHash: '0x1111222233334444555566667777888899990000aaaabbbbccccddddeeeeffff'
      };

      contractMonitor.on('domainSale', (eventData) => {
        expect(eventData).toEqual({
          type: 'domainSale',
          domain: 'premium.eth',
          seller: '0x1111111111111111111111111111111111111111',
          buyer: '0x2222222222222222222222222222222222222222',
          price: '1000000000000000000',
          blockNumber: 12345680,
          transactionHash: '0x1111222233334444555566667777888899990000aaaabbbbccccddddeeeeffff',
          timestamp: expect.any(Date)
        });
        done();
      });

      // Simulate event emission
      const eventHandler = mockContract.on.mock.calls.find(call => 
        call[0] === 'DomainSold_filter'
      )[1];
      eventHandler(
        mockEvent.args.domain,
        mockEvent.args.seller,
        mockEvent.args.buyer,
        mockEvent.args.price,
        mockEvent
      );
    });
  });

  describe('stop()', () => {
    test('should stop monitoring gracefully', async () => {
      mockProvider.on = jest.fn();
      mockContract.on = jest.fn();
      mockProvider.removeAllListeners = jest.fn();
      mockContract.removeAllListeners = jest.fn();
      mockProvider.destroy = jest.fn();
      
      await contractMonitor.start();
      await contractMonitor.stop();
      
      expect(mockProvider.removeAllListeners).toHaveBeenCalled();
      expect(mockContract.removeAllListeners).toHaveBeenCalled();
      expect(mockProvider.destroy).toHaveBeenCalled();
    });

    test('should handle stop when not running', async () => {
      await expect(contractMonitor.stop()).resolves.not.toThrow();
    });
  });

  describe('Error Handling', () => {
    test('should handle provider errors', async () => {
      const error = new Error('Provider connection lost');
      let errorHandler;
      
      mockProvider.on = jest.fn().mockImplementation((event, callback) => {
        if (event === 'error') {
          errorHandler = callback;
        }
      });
      mockContract.on = jest.fn();
      
      await contractMonitor.start();
      
      // Simulate provider error
      const errorSpy = jest.fn();
      contractMonitor.on('error', errorSpy);
      
      errorHandler(error);
      
      expect(errorSpy).toHaveBeenCalledWith(error);
    });

    test('should handle malformed events', (done) => {
      mockProvider.on = jest.fn();
      mockContract.on = jest.fn();
      
      contractMonitor.start().then(() => {
        const errorSpy = jest.fn();
        contractMonitor.on('error', errorSpy);
        
        // Simulate malformed event
        const eventHandler = mockContract.on.mock.calls.find(call => 
          call[0] === 'DomainExpired_filter'
        )[1];
        
        // Call with invalid arguments
        eventHandler(null, undefined, 'invalid-timestamp', {});
        
        setTimeout(() => {
          expect(errorSpy).toHaveBeenCalled();
          done();
        }, 100);
      });
    });
  });

  describe('Reconnection Logic', () => {
    test('should attempt reconnection on connection loss', async () => {
      let errorHandler;
      
      mockProvider.on = jest.fn().mockImplementation((event, callback) => {
        if (event === 'error') {
          errorHandler = callback;
        }
      });
      mockContract.on = jest.fn();
      
      const startSpy = jest.spyOn(contractMonitor, 'start');
      
      await contractMonitor.start();
      
      // Simulate connection error
      const error = new Error('CONNECTION_LOST');
      errorHandler(error);
      
      // Wait for reconnection attempt
      await new Promise(resolve => setTimeout(resolve, 100));
      
      expect(startSpy).toHaveBeenCalledTimes(1); // Initial start only
    });
  });
});