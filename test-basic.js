// Basic test script to verify core modules can be loaded
// This tests the fundamental structure without external dependencies

console.log('🧪 Testing DomaAlert Bot basic structure...\n');

const tests = [
  {
    name: 'Logger utility',
    test: async () => {
      const { logger } = await import('./src/utils/logger.js');
      logger.info('Logger test successful');
      return true;
    }
  },
  {
    name: 'Database initialization',
    test: async () => {
      const { database } = await import('./src/database/init.js');
      return database !== null;
    }
  },
  {
    name: 'Error handlers',
    test: async () => {
      const { AppError, errorHandler } = await import('./src/middleware/errorHandler.js');
      const error = new AppError('Test error', 400);
      return error.statusCode === 400;
    }
  },
  {
    name: 'Alert service structure',
    test: async () => {
      const { AlertService } = await import('./src/services/alerts/alertService.js');
      const service = new AlertService();
      return service instanceof AlertService;
    }
  },
  {
    name: 'Contract monitor structure',
    test: async () => {
      const { ContractMonitor } = await import('./src/contracts/contractMonitor.js');
      const monitor = new ContractMonitor();
      return monitor instanceof ContractMonitor;
    }
  },
  {
    name: 'Routes loading',
    test: async () => {
      const authRoutes = await import('./src/routes/auth.js');
      const alertRoutes = await import('./src/routes/alerts.js');
      const subscriptionRoutes = await import('./src/routes/subscriptions.js');
      const domainRoutes = await import('./src/routes/domains.js');
      return authRoutes && alertRoutes && subscriptionRoutes && domainRoutes;
    }
  }
];

let passed = 0;
let failed = 0;

for (const test of tests) {
  try {
    const result = await test.test();
    if (result) {
      console.log(`✅ ${test.name}`);
      passed++;
    } else {
      console.log(`❌ ${test.name} - Test returned false`);
      failed++;
    }
  } catch (error) {
    console.log(`❌ ${test.name} - Error: ${error.message}`);
    failed++;
  }
}

console.log(`\n📊 Test Results: ${passed} passed, ${failed} failed`);

if (failed === 0) {
  console.log('🎉 All basic structure tests passed!');
  console.log('\n📋 Next steps:');
  console.log('1. Set up environment variables in .env file');
  console.log('2. Install remaining dependencies as needed');
  console.log('3. Configure Telegram and Twitter API credentials');
  console.log('4. Set up Doma contract addresses');
  console.log('5. Run with "npm run dev" or "node src/index.js"');
} else {
  console.log('⚠️  Some structure tests failed. Please check the implementation.');
  process.exit(1);
}