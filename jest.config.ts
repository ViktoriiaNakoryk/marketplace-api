import type { Config } from 'jest';
import { pathsToModuleNameMapper } from 'ts-jest';
import ts from 'typescript';

// Path aliases (e.g. the ones added by `nest g library`) live in tsconfig.json,
// so they are read from there instead of being duplicated here.
const { config: tsconfig } = ts.readConfigFile(
  './tsconfig.json',
  ts.sys.readFile,
);
const paths = tsconfig?.compilerOptions?.paths ?? {};

const base = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
  },
  moduleNameMapper: pathsToModuleNameMapper(paths, { prefix: '<rootDir>/' }),
  testEnvironment: 'node',
};

const withPostgres = {
  globalSetup: '<rootDir>/test/testkit/global-setup.ts',
  globalTeardown: '<rootDir>/test/testkit/global-teardown.ts',
};

const config: Config = {
  reporters: ['default'],
  verbose: true,
  maxWorkers: 1,
  testTimeout: 60_000,
  collectCoverageFrom: [
    'src/**/*.(t|j)s',
    'libs/**/*.(t|j)s',
    'apps/**/*.(t|j)s',
  ],
  coverageDirectory: './coverage',
  projects: [
    { ...base, displayName: 'unit', testMatch: ['<rootDir>/src/**/*.spec.ts'] },
    { ...base, ...withPostgres, displayName: 'integration', testMatch: ['<rootDir>/test/integration/**/*.spec.ts'] },
    { ...base, ...withPostgres, displayName: 'e2e', testMatch: ['<rootDir>/test/e2e/**/*.e2e-spec.ts'] },
    { ...base, displayName: 'contract', testMatch: ['<rootDir>/test/contract/consumer.pact-spec.ts'] },
    { ...base, ...withPostgres, displayName: 'provider', testMatch: ['<rootDir>/test/contract/provider.pact-spec.ts'] },
  ],
};

export default config;
