/**
 * Jest configuration for Aurora Cloud Functions.
 *
 * Tests split into two tiers:
 *   - tests/unit/       Pure-function tests, no DB access. Fast, always runnable.
 *   - tests/integration/ Exercises real Firestore (admin SDK + emulator).
 *                        Requires the Firestore emulator on 127.0.0.1:8080.
 *
 * Run against the emulator with:
 *   npm run test:emulator          # starts emulator, runs tests, stops
 *   npm run test                   # assumes emulator already running
 */

module.exports = {
  testEnvironment: 'node',
  testMatch: ['<rootDir>/tests/**/*.test.js'],
  setupFiles: ['<rootDir>/tests/setup.js'],
  testTimeout: 15000,
  // Run tests one worker at a time to avoid cross-test Firestore races on the
  // shared emulator. Pure unit tests still complete in milliseconds; the
  // integration tests scope themselves via unique fincaIds so in principle
  // parallel is safe, but serial keeps output deterministic for now.
  maxWorkers: 1,
  collectCoverageFrom: [
    'lib/autopilot*.js',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'text-summary', 'lcov'],
  coverageThreshold: {
    // Report-only: threshold is informational. CI/pre-commit enforcement is
    // wired separately when the team decides to block merges on it.
    'lib/autopilotGuardrails.js':    { statements: 80, branches: 70, functions: 80, lines: 80 },
    'lib/autopilotKillSwitch.js':    { statements: 80, branches: 70, functions: 80, lines: 80 },
    'lib/autopilotReasoning.js':     { statements: 80, branches: 70, functions: 80, lines: 80 },
    'lib/autopilotCompensations.js': { statements: 70, branches: 60, functions: 70, lines: 70 },
    'lib/autopilotActions.js':       { statements: 70, branches: 60, functions: 70, lines: 70 },
  },
};
