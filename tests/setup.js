// Test setup and global mocks

// Mock environment variables
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-key-for-testing-only';
process.env.DATABASE_URL = ':memory:';
process.env.TELEGRAM_BOT_TOKEN = 'test-telegram-token';
process.env.TWITTER_CONSUMER_KEY = 'test-twitter-key';
process.env.TWITTER_CONSUMER_SECRET = 'test-twitter-secret';
process.env.TWITTER_ACCESS_TOKEN = 'test-twitter-token';
process.env.TWITTER_ACCESS_TOKEN_SECRET = 'test-twitter-token-secret';
process.env.DOMA_RPC_URL = 'wss://test-rpc-url';
process.env.DOMA_CONTRACT_ADDRESS = '0x1234567890123456789012345678901234567890';
process.env.FRONTEND_URL = 'http://localhost:3000';

// Global test utilities
global.createMockUser = () => ({
  id: 1,
  username: 'testuser',
  email: 'test@example.com',
  subscriptionTier: 'basic',
  createdAt: new Date().toISOString()
});

global.createMockAlert = () => ({
  id: 1,
  userId: 1,
  domain: 'test.eth',
  type: 'expiry',
  conditions: JSON.stringify({ daysBeforeExpiry: 7 }),
  isActive: true,
  createdAt: new Date().toISOString()
});

// Mock fetch for web API calls
global.fetch = jest.fn(() =>
  Promise.resolve({
    ok: true,
    json: () => Promise.resolve({}),
    text: () => Promise.resolve(''),
    status: 200
  })
);

// Console override to reduce test noise
const originalConsole = global.console;
global.console = {
  ...originalConsole,
  log: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  warn: originalConsole.warn,
  error: originalConsole.error
};

// Cleanup after each test
afterEach(() => {
  jest.clearAllMocks();
  if (global.fetch.mockClear) {
    global.fetch.mockClear();
  }
});

// Setup global test timeout
jest.setTimeout(10000);