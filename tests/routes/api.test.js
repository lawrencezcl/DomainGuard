const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');

// Import routes
const authRoutes = require('../../src/routes/auth.js').default;
const alertsRoutes = require('../../src/routes/alerts.js').default;
const subscriptionsRoutes = require('../../src/routes/subscriptions.js').default;

// Mock dependencies
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

jest.mock('bcrypt', () => ({
  hash: jest.fn().mockResolvedValue('$2b$10$hashedpassword'),
  compare: jest.fn().mockResolvedValue(true)
}));

describe('API Routes', () => {
  let app;
  let mockDb;
  
  const mockUser = {
    id: 1,
    username: 'testuser',
    email: 'test@example.com',
    passwordHash: '$2b$10$hashedpassword',
    subscriptionTier: 'basic',
    subscriptionExpiry: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    createdAt: new Date().toISOString()
  };

  const validToken = jwt.sign(
    { userId: mockUser.id, username: mockUser.username },
    process.env.JWT_SECRET || 'test-secret',
    { expiresIn: '24h' }
  );

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Setup Express app
    app = express();
    app.use(express.json());
    
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
    
    // Mount routes
    app.use('/api/auth', authRoutes);
    app.use('/api/alerts', alertsRoutes);
    app.use('/api/subscriptions', subscriptionsRoutes);
  });

  describe('Authentication Routes', () => {
    describe('POST /api/auth/register', () => {
      test('should register new user successfully', async () => {
        const mockStatement = mockDb.prepare();
        mockStatement.get.mockReturnValue(null); // User doesn't exist
        mockStatement.run.mockReturnValue({ lastInsertRowid: 1 });

        const userData = {
          username: 'newuser',
          email: 'new@example.com',
          password: 'password123'
        };

        const response = await request(app)
          .post('/api/auth/register')
          .send(userData)
          .expect(201);

        expect(response.body).toHaveProperty('success', true);
        expect(response.body).toHaveProperty('token');
        expect(response.body.user).toHaveProperty('username', 'newuser');
      });

      test('should handle duplicate username', async () => {
        const mockStatement = mockDb.prepare();
        mockStatement.get.mockReturnValue(mockUser); // User already exists

        const userData = {
          username: 'testuser',
          email: 'new@example.com',
          password: 'password123'
        };

        const response = await request(app)
          .post('/api/auth/register')
          .send(userData)
          .expect(400);

        expect(response.body).toHaveProperty('success', false);
        expect(response.body.error).toHaveProperty('message', 'Username already exists');
      });

      test('should validate input data', async () => {
        const invalidData = {
          username: 'ab', // Too short
          email: 'invalid-email',
          password: '123' // Too short
        };

        const response = await request(app)
          .post('/api/auth/register')
          .send(invalidData)
          .expect(400);

        expect(response.body).toHaveProperty('success', false);
        expect(response.body.error).toHaveProperty('message');
      });
    });

    describe('POST /api/auth/login', () => {
      test('should login successfully', async () => {
        const mockStatement = mockDb.prepare();
        mockStatement.get.mockReturnValue(mockUser);

        const credentials = {
          username: 'testuser',
          password: 'password123'
        };

        const response = await request(app)
          .post('/api/auth/login')
          .send(credentials)
          .expect(200);

        expect(response.body).toHaveProperty('success', true);
        expect(response.body).toHaveProperty('token');
        expect(response.body.user).toHaveProperty('username', 'testuser');
      });

      test('should handle invalid credentials', async () => {
        const mockStatement = mockDb.prepare();
        mockStatement.get.mockReturnValue(null); // User not found

        const credentials = {
          username: 'nonexistent',
          password: 'password123'
        };

        const response = await request(app)
          .post('/api/auth/login')
          .send(credentials)
          .expect(401);

        expect(response.body).toHaveProperty('success', false);
        expect(response.body.error).toHaveProperty('message', 'Invalid credentials');
      });

      test('should handle wrong password', async () => {
        const bcrypt = require('bcrypt');
        bcrypt.compare.mockResolvedValue(false);

        const mockStatement = mockDb.prepare();
        mockStatement.get.mockReturnValue(mockUser);

        const credentials = {
          username: 'testuser',
          password: 'wrongpassword'
        };

        const response = await request(app)
          .post('/api/auth/login')
          .send(credentials)
          .expect(401);

        expect(response.body).toHaveProperty('success', false);
        expect(response.body.error).toHaveProperty('message', 'Invalid credentials');
      });
    });

    describe('GET /api/auth/me', () => {
      test('should return user profile with valid token', async () => {
        const mockStatement = mockDb.prepare();
        mockStatement.get.mockReturnValue(mockUser);

        const response = await request(app)
          .get('/api/auth/me')
          .set('Authorization', `Bearer ${validToken}`)
          .expect(200);

        expect(response.body).toHaveProperty('success', true);
        expect(response.body.user).toHaveProperty('username', 'testuser');
      });

      test('should handle missing token', async () => {
        const response = await request(app)
          .get('/api/auth/me')
          .expect(401);

        expect(response.body).toHaveProperty('success', false);
        expect(response.body.error).toHaveProperty('message', 'Access token required');
      });

      test('should handle invalid token', async () => {
        const response = await request(app)
          .get('/api/auth/me')
          .set('Authorization', 'Bearer invalid-token')
          .expect(401);

        expect(response.body).toHaveProperty('success', false);
        expect(response.body.error).toHaveProperty('message', 'Invalid token');
      });
    });
  });

  describe('Alerts Routes', () => {
    describe('GET /api/alerts', () => {
      test('should return user alerts', async () => {
        const mockUserStatement = mockDb.prepare();
        const mockAlertsStatement = mockDb.prepare();
        
        mockUserStatement.get.mockReturnValue(mockUser);
        mockAlertsStatement.all.mockReturnValue([
          {
            id: 1,
            domain: 'test.eth',
            type: 'expiry',
            isActive: true,
            createdAt: new Date().toISOString()
          }
        ]);

        mockDb.prepare.mockImplementation((sql) => {
          if (sql.includes('users')) return mockUserStatement;
          if (sql.includes('alerts')) return mockAlertsStatement;
          return { get: jest.fn(), all: jest.fn(), run: jest.fn() };
        });

        const response = await request(app)
          .get('/api/alerts')
          .set('Authorization', `Bearer ${validToken}`)
          .expect(200);

        expect(response.body).toHaveProperty('success', true);
        expect(response.body.data.alerts).toHaveLength(1);
        expect(response.body.data.alerts[0]).toHaveProperty('domain', 'test.eth');
      });

      test('should handle pagination', async () => {
        const mockUserStatement = mockDb.prepare();
        const mockAlertsStatement = mockDb.prepare();
        
        mockUserStatement.get.mockReturnValue(mockUser);
        mockAlertsStatement.all.mockReturnValue([]);

        mockDb.prepare.mockImplementation((sql) => {
          if (sql.includes('users')) return mockUserStatement;
          if (sql.includes('alerts')) return mockAlertsStatement;
          return { get: jest.fn(), all: jest.fn(), run: jest.fn() };
        });

        const response = await request(app)
          .get('/api/alerts?page=2&limit=5')
          .set('Authorization', `Bearer ${validToken}`)
          .expect(200);

        expect(response.body).toHaveProperty('success', true);
        expect(response.body.data).toHaveProperty('pagination');
      });
    });

    describe('POST /api/alerts', () => {
      test('should create new alert', async () => {
        const mockUserStatement = mockDb.prepare();
        const mockCreateStatement = mockDb.prepare();
        
        mockUserStatement.get.mockReturnValue(mockUser);
        mockCreateStatement.run.mockReturnValue({ lastInsertRowid: 1 });

        mockDb.prepare.mockImplementation((sql) => {
          if (sql.includes('users')) return mockUserStatement;
          if (sql.includes('INSERT')) return mockCreateStatement;
          return { get: jest.fn(), all: jest.fn(), run: jest.fn() };
        });

        const alertData = {
          domain: 'new.eth',
          type: 'expiry',
          conditions: {
            daysBeforeExpiry: 7
          }
        };

        const response = await request(app)
          .post('/api/alerts')
          .set('Authorization', `Bearer ${validToken}`)
          .send(alertData)
          .expect(201);

        expect(response.body).toHaveProperty('success', true);
        expect(response.body.data).toHaveProperty('alertId', 1);
      });

      test('should validate alert data', async () => {
        const mockStatement = mockDb.prepare();
        mockStatement.get.mockReturnValue(mockUser);

        const invalidData = {
          domain: 'invalid_domain',
          type: 'invalid_type'
        };

        const response = await request(app)
          .post('/api/alerts')
          .set('Authorization', `Bearer ${validToken}`)
          .send(invalidData)
          .expect(400);

        expect(response.body).toHaveProperty('success', false);
        expect(response.body.error).toHaveProperty('message');
      });

      test('should check subscription limits', async () => {
        const freeUser = { ...mockUser, subscriptionTier: 'free' };
        const mockUserStatement = mockDb.prepare();
        const mockCountStatement = mockDb.prepare();
        
        mockUserStatement.get.mockReturnValue(freeUser);
        mockCountStatement.get.mockReturnValue({ count: 5 }); // At free limit

        mockDb.prepare.mockImplementation((sql) => {
          if (sql.includes('users')) return mockUserStatement;
          if (sql.includes('COUNT')) return mockCountStatement;
          return { get: jest.fn(), all: jest.fn(), run: jest.fn() };
        });

        const alertData = {
          domain: 'new.eth',
          type: 'expiry'
        };

        const response = await request(app)
          .post('/api/alerts')
          .set('Authorization', `Bearer ${validToken}`)
          .send(alertData)
          .expect(403);

        expect(response.body).toHaveProperty('success', false);
        expect(response.body.error).toHaveProperty('message');
      });
    });

    describe('PUT /api/alerts/:id', () => {
      test('should update alert', async () => {
        const mockUserStatement = mockDb.prepare();
        const mockUpdateStatement = mockDb.prepare();
        
        mockUserStatement.get.mockReturnValue(mockUser);
        mockUpdateStatement.run.mockReturnValue({ changes: 1 });

        mockDb.prepare.mockImplementation((sql) => {
          if (sql.includes('users')) return mockUserStatement;
          if (sql.includes('UPDATE')) return mockUpdateStatement;
          return { get: jest.fn(), all: jest.fn(), run: jest.fn() };
        });

        const updateData = {
          conditions: {
            daysBeforeExpiry: 14
          }
        };

        const response = await request(app)
          .put('/api/alerts/1')
          .set('Authorization', `Bearer ${validToken}`)
          .send(updateData)
          .expect(200);

        expect(response.body).toHaveProperty('success', true);
      });

      test('should handle non-existent alert', async () => {
        const mockUserStatement = mockDb.prepare();
        const mockUpdateStatement = mockDb.prepare();
        
        mockUserStatement.get.mockReturnValue(mockUser);
        mockUpdateStatement.run.mockReturnValue({ changes: 0 });

        mockDb.prepare.mockImplementation((sql) => {
          if (sql.includes('users')) return mockUserStatement;
          if (sql.includes('UPDATE')) return mockUpdateStatement;
          return { get: jest.fn(), all: jest.fn(), run: jest.fn() };
        });

        const updateData = {
          conditions: {
            daysBeforeExpiry: 14
          }
        };

        const response = await request(app)
          .put('/api/alerts/999')
          .set('Authorization', `Bearer ${validToken}`)
          .send(updateData)
          .expect(404);

        expect(response.body).toHaveProperty('success', false);
        expect(response.body.error).toHaveProperty('message', 'Alert not found');
      });
    });

    describe('DELETE /api/alerts/:id', () => {
      test('should delete alert', async () => {
        const mockUserStatement = mockDb.prepare();
        const mockDeleteStatement = mockDb.prepare();
        
        mockUserStatement.get.mockReturnValue(mockUser);
        mockDeleteStatement.run.mockReturnValue({ changes: 1 });

        mockDb.prepare.mockImplementation((sql) => {
          if (sql.includes('users')) return mockUserStatement;
          if (sql.includes('DELETE')) return mockDeleteStatement;
          return { get: jest.fn(), all: jest.fn(), run: jest.fn() };
        });

        const response = await request(app)
          .delete('/api/alerts/1')
          .set('Authorization', `Bearer ${validToken}`)
          .expect(200);

        expect(response.body).toHaveProperty('success', true);
      });
    });
  });

  describe('Subscriptions Routes', () => {
    describe('GET /api/subscriptions', () => {
      test('should return subscription status', async () => {
        const mockStatement = mockDb.prepare();
        mockStatement.get.mockReturnValue(mockUser);

        const response = await request(app)
          .get('/api/subscriptions')
          .set('Authorization', `Bearer ${validToken}`)
          .expect(200);

        expect(response.body).toHaveProperty('success', true);
        expect(response.body.data.subscription).toHaveProperty('tier', 'basic');
      });
    });

    describe('POST /api/subscriptions/upgrade', () => {
      test('should initiate subscription upgrade', async () => {
        const mockStatement = mockDb.prepare();
        mockStatement.get.mockReturnValue(mockUser);

        const upgradeData = {
          tier: 'premium'
        };

        const response = await request(app)
          .post('/api/subscriptions/upgrade')
          .set('Authorization', `Bearer ${validToken}`)
          .send(upgradeData)
          .expect(200);

        expect(response.body).toHaveProperty('success', true);
        expect(response.body.data).toHaveProperty('redirectUrl');
      });

      test('should validate tier parameter', async () => {
        const mockStatement = mockDb.prepare();
        mockStatement.get.mockReturnValue(mockUser);

        const invalidData = {
          tier: 'invalid'
        };

        const response = await request(app)
          .post('/api/subscriptions/upgrade')
          .set('Authorization', `Bearer ${validToken}`)
          .send(invalidData)
          .expect(400);

        expect(response.body).toHaveProperty('success', false);
      });
    });
  });

  describe('Error Handling', () => {
    test('should handle database errors', async () => {
      const mockStatement = mockDb.prepare();
      mockStatement.get.mockImplementation(() => {
        throw new Error('Database connection error');
      });

      const response = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${validToken}`)
        .expect(500);

      expect(response.body).toHaveProperty('success', false);
      expect(response.body.error).toHaveProperty('message');
    });

    test('should handle JSON parsing errors', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .set('Content-Type', 'application/json')
        .send('invalid json')
        .expect(400);

      expect(response.body).toHaveProperty('success', false);
    });
  });

  describe('Rate Limiting', () => {
    test('should enforce rate limits on authentication endpoints', async () => {
      const mockStatement = mockDb.prepare();
      mockStatement.get.mockReturnValue(null);

      const credentials = {
        username: 'testuser',
        password: 'password123'
      };

      // Make multiple requests rapidly
      const requests = Array.from({ length: 10 }, () =>
        request(app)
          .post('/api/auth/login')
          .send(credentials)
      );

      const responses = await Promise.all(requests);

      // Some requests should be rate limited
      const rateLimited = responses.some(res => res.status === 429);
      expect(rateLimited).toBe(true);
    });
  });
});