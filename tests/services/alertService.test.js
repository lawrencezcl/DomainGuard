import { jest } from '@jest/globals';
import { AlertService } from '../src/services/alerts/alertService.js';

// Mock dependencies
jest.mock('../src/database/models/alert.js');
jest.mock('../src/database/models/user.js');
jest.mock('../src/utils/logger.js');

describe('AlertService', () => {
  let alertService;

  beforeEach(() => {
    alertService = new AlertService();
    jest.clearAllMocks();
  });

  afterEach(() => {
    if (alertService.isRunning) {
      alertService.stop();
    }
  });

  describe('initialization', () => {
    test('should initialize successfully', async () => {
      await alertService.initialize();
      expect(alertService.isRunning).toBe(true);
    });

    test('should setup periodic checks', async () => {
      const setupSpy = jest.spyOn(alertService, 'setupPeriodicChecks');
      await alertService.initialize();
      expect(setupSpy).toHaveBeenCalled();
    });
  });

  describe('processExpiryEvent', () => {
    const mockEvent = {
      domain: 'test.ape',
      daysUntilExpiry: 3,
      urgency: 'high',
      owner: '0x123...',
      blockData: {
        transactionHash: '0xabc...',
        blockNumber: 12345
      }
    };

    test('should process expiry event successfully', async () => {
      const mockAlerts = [
        {
          id: 1,
          userId: 1,
          type: 'expiry',
          domain: 'test.ape',
          platform: 'telegram',
          conditions: { daysThreshold: 7 }
        }
      ];

      // Mock database calls
      const { getAlertsByDomain, getAlertsByPattern } = await import('../src/database/models/alert.js');
      getAlertsByDomain.mockResolvedValue(mockAlerts);
      getAlertsByPattern.mockResolvedValue([]);

      const sendAlertSpy = jest.spyOn(alertService, 'sendAlert').mockResolvedValue();
      const shouldTriggerSpy = jest.spyOn(alertService, 'shouldTriggerExpiryAlert').mockReturnValue(true);

      await alertService.processExpiryEvent(mockEvent);

      expect(sendAlertSpy).toHaveBeenCalledWith({
        type: 'expiry',
        alertId: 1,
        userId: 1,
        domain: 'test.ape',
        daysUntilExpiry: 3,
        urgency: 'high',
        platform: 'telegram',
        data: mockEvent
      });
    });

    test('should not process duplicate events', async () => {
      const eventId = `${mockEvent.blockData.transactionHash}-expiry`;
      alertService.processedEvents.add(eventId);

      const { getAlertsByDomain } = await import('../src/database/models/alert.js');
      const getAlertsSpy = jest.spyOn(getAlertsByDomain, 'mockResolvedValue');

      await alertService.processExpiryEvent(mockEvent);

      expect(getAlertsSpy).not.toHaveBeenCalled();
    });
  });

  describe('shouldTriggerExpiryAlert', () => {
    test('should trigger for alerts within days threshold', () => {
      const alert = {
        conditions: { daysThreshold: 7 }
      };
      const event = { daysUntilExpiry: 3, urgency: 'high' };

      const result = alertService.shouldTriggerExpiryAlert(alert.conditions, event);
      expect(result).toBe(true);
    });

    test('should not trigger for alerts outside days threshold', () => {
      const alert = {
        conditions: { daysThreshold: 3 }
      };
      const event = { daysUntilExpiry: 5, urgency: 'low' };

      const result = alertService.shouldTriggerExpiryAlert(alert.conditions, event);
      expect(result).toBe(false);
    });

    test('should respect minimum urgency level', () => {
      const alert = {
        conditions: { minUrgency: 'high' }
      };
      const event = { daysUntilExpiry: 1, urgency: 'medium' };

      const result = alertService.shouldTriggerExpiryAlert(alert.conditions, event);
      expect(result).toBe(false);
    });
  });

  describe('formatAlertMessage', () => {
    test('should format expiry message correctly', () => {
      const alertData = {
        type: 'expiry',
        domain: 'test.ape',
        daysUntilExpiry: 3,
        urgency: 'high'
      };

      const message = alertService.formatAlertMessage(alertData);
      expect(message).toContain('test.ape');
      expect(message).toContain('3 days');
    });

    test('should format critical expiry message for 1 day', () => {
      const alertData = {
        type: 'expiry',
        domain: 'test.ape',
        daysUntilExpiry: 1,
        urgency: 'critical'
      };

      const message = alertService.formatAlertMessage(alertData);
      expect(message).toContain('URGENT');
      expect(message).toContain('1 day');
    });

    test('should format expired domain message', () => {
      const alertData = {
        type: 'expiry',
        domain: 'test.ape',
        daysUntilExpiry: 0,
        urgency: 'critical'
      };

      const message = alertService.formatAlertMessage(alertData);
      expect(message).toContain('EXPIRED');
    });
  });

  describe('sendAlert', () => {
    test('should emit alert event', async () => {
      const mockUser = { 
        id: 1, 
        username: 'testuser', 
        isActive: true, 
        subscriptionTier: 'basic' 
      };

      const { getUserById } = await import('../src/database/models/user.js');
      getUserById.mockResolvedValue(mockUser);

      const checkFrequencySpy = jest.spyOn(alertService, 'checkAlertFrequency').mockReturnValue(true);
      const emitSpy = jest.spyOn(alertService, 'emit');

      const alertData = {
        type: 'expiry',
        alertId: 1,
        userId: 1,
        domain: 'test.ape',
        platform: 'telegram'
      };

      await alertService.sendAlert(alertData);

      expect(emitSpy).toHaveBeenCalledWith('alert', expect.objectContaining({
        ...alertData,
        user: mockUser
      }));
    });

    test('should not send alert for inactive user', async () => {
      const mockUser = { 
        id: 1, 
        username: 'testuser', 
        isActive: false 
      };

      const { getUserById } = await import('../src/database/models/user.js');
      getUserById.mockResolvedValue(mockUser);

      const emitSpy = jest.spyOn(alertService, 'emit');

      const alertData = {
        type: 'expiry',
        alertId: 1,
        userId: 1,
        domain: 'test.ape',
        platform: 'telegram'
      };

      await alertService.sendAlert(alertData);

      expect(emitSpy).not.toHaveBeenCalled();
    });
  });

  describe('checkAlertFrequency', () => {
    test('should allow critical alerts for free users', () => {
      const user = { subscriptionTier: 'free' };
      const alertData = { urgency: 'critical' };

      const result = alertService.checkAlertFrequency(user, alertData);
      expect(result).toBe(true);
    });

    test('should block non-critical alerts for free users', () => {
      const user = { subscriptionTier: 'free' };
      const alertData = { urgency: 'medium' };

      const result = alertService.checkAlertFrequency(user, alertData);
      expect(result).toBe(false);
    });

    test('should allow all alerts for paid users', () => {
      const user = { subscriptionTier: 'basic' };
      const alertData = { urgency: 'low' };

      const result = alertService.checkAlertFrequency(user, alertData);
      expect(result).toBe(true);
    });
  });

  describe('stop', () => {
    test('should stop service and cleanup', async () => {
      await alertService.initialize();
      expect(alertService.isRunning).toBe(true);

      await alertService.stop();
      expect(alertService.isRunning).toBe(false);
    });
  });
});