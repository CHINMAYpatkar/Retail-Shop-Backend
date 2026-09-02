/**
 * Unit-test configuration: fast, pure, no database and no Nest container.
 *
 * Only `*.spec.ts` under `src/` is picked up here. End-to-end specs live in
 * `test/` under `*.e2e-spec.ts` and run from `test/jest-e2e.json`, because they
 * need a real database and must not run in parallel against it.
 */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  transform: { '^.+\\.(t|j)s$': 'ts-jest' },
  collectCoverageFrom: ['**/*.(t|j)s', '!**/*.spec.ts', '!**/*.module.ts', '!main.ts'],
  coverageDirectory: '../coverage',
  testEnvironment: 'node',
};
