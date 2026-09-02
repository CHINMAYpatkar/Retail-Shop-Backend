/**
 * Loads .env.test and refuses to let the suite run against anything that is not
 * an obviously-disposable database.
 *
 * This is not defensive decoration. An earlier round of manual API testing was
 * pointed at the dev database and permanently corrupted real data: it left a
 * stray purchase bill behind and overwrote a raw material's average cost, and
 * neither could be restored because nothing records what those figures were
 * before. The suite below creates, mutates and deletes rows freely, so the same
 * mistake here would be worse and quieter.
 *
 * The rule is a required `_test` suffix on the database name rather than a
 * blacklist of known-dev names. A blacklist has to be right about every name
 * that might ever appear; a suffix has to be right once. Note that a substring
 * check would be actively harmful here - the test database is `RetailShop_test`
 * and the dev one is `RetailShop`, so "does the URL contain the dev name" is
 * true of BOTH and would reject the correct database while a typo that drops
 * the suffix sails through.
 */
import { config as loadEnv } from 'dotenv';
import { existsSync } from 'fs';
import { join } from 'path';

const envPath = join(__dirname, '..', '.env.test');

if (!existsSync(envPath)) {
  throw new Error(
    'No .env.test found. The e2e suite needs its own database; copy .env and point ' +
      'DATABASE_URL at a database whose name ends in _test.',
  );
}

// `quiet` suppresses dotenv's promotional tips, which otherwise print a
// third-party advert above every suite and bury real failure output.
loadEnv({ path: envPath, override: true, quiet: true });

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error('.env.test does not set DATABASE_URL.');
}

/** Database name is the last path segment, minus any query string. */
function databaseNameOf(connectionUrl: string): string {
  const withoutQuery = connectionUrl.split('?')[0];
  return withoutQuery.slice(withoutQuery.lastIndexOf('/') + 1);
}

const dbName = databaseNameOf(url);

if (!dbName.endsWith('_test')) {
  throw new Error(
    `REFUSING TO RUN: .env.test points at database "${dbName}", which does not end in _test.\n` +
      'These specs create and delete rows. Point DATABASE_URL at a disposable database.',
  );
}

// Belt and braces: even a correctly-suffixed name should not be the dev one.
if (dbName === 'RetailShop') {
  throw new Error('REFUSING TO RUN: that is the dev database.');
}

process.env.NODE_ENV = 'test';

/**
 * The suite fires hundreds of requests in a couple of minutes. The real
 * throttle would reject most of them with 429s that say nothing about whether
 * the code is correct, so it is raised here. Rate limiting is exercised in its
 * own spec, which sets its own limit.
 */
process.env.THROTTLE_LIMIT = process.env.E2E_THROTTLE_LIMIT || '100000';
