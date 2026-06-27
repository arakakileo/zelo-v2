/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.test.ts'],
  // Auto-mock PrismaService so tests don't need a real DB.
  // Individual tests override mock return values via jest.mocked().
  setupFilesAfterEnv: ['<rootDir>/src/test-setup.ts'],
  collectCoverageFrom: [
    'src/**/*.service.ts',
    'src/**/*.guard.ts',
    '!src/**/*.module.ts',
  ],
};
