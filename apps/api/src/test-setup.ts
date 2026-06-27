/**
 * Global test setup — silences logger output during tests
 * to keep test output clean. Individual tests can re-enable
 * logging if needed.
 */
import { Logger } from '@nestjs/common';

// Silence NestJS logger in tests
Logger.overrideLogger(false);
