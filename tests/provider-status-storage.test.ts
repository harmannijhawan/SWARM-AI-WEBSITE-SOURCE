import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { postgresSql } from '../lib/server/storage';

test('Postgres persists provider test results with an owner-scoped upsert', () => {
  assert.equal(
    postgresSql('INSERT OR REPLACE INTO provider_status(owner,provider,data) VALUES(?,?,?)'),
    'INSERT INTO swarm_provider_status(owner,provider,data) VALUES($1,$2,$3) ON CONFLICT(owner,provider) DO UPDATE SET data=excluded.data',
  );
  assert.equal(postgresSql('SELECT data FROM provider_status WHERE owner=? AND provider=?'),
    'SELECT data FROM swarm_provider_status WHERE owner=$1 AND provider=$2');
  assert.equal(postgresSql('DELETE FROM provider_status WHERE owner=? AND provider=?'),
    'DELETE FROM swarm_provider_status WHERE owner=$1 AND provider=$2');
});

test('every backend table is registered for PostgreSQL namespace translation', () => {
  for (const file of ['backend.ts', 'accounts.ts', 'entitlements.ts']) {
    const source = readFileSync(new URL('../lib/server/' + file, import.meta.url), 'utf8');
    for (const match of source.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)) {
      const name = match[1];
      assert.equal(postgresSql(`SELECT * FROM ${name}`), `SELECT * FROM swarm_${name}`, `${file}: ${name}`);
    }
  }
});
