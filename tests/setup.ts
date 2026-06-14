// Jest global setup for tests
import 'dotenv/config';

// Provide minimal env to keep app happy during tests
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.PORT = process.env.PORT || '0';
process.env.ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS || 'http://localhost:8080';

// Mock SigoAuthService to avoid external auth calls in middleware
jest.mock('@/services/sigoAuthService', () => ({
  __esModule: true,
  default: {
    // Simulate the static method used in middleware
    getAuthHeaders: jest.fn().mockResolvedValue({
      Authorization: 'Bearer test-token',
      'Partner-Id': 'TEST-PARTNER',
    }),
  },
}));

export {};

