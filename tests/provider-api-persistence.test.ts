import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handleApi, accountDatabase } from '../lib/server/backend';
import { issueDevice } from '../lib/server/accounts';
import { adapters } from '../lib/server/providers';
import { postgresSql } from '../lib/server/storage';

test('connected provider test persists, survives save/retest, and remains account scoped', async () => {
  process.env.SWARM_DATA_DIR = mkdtempSync(join(tmpdir(), 'swarm-provider-persistence-'));
  delete process.env.SWARM_DATABASE_URL;
  delete process.env.DATABASE_URL;
  process.env.CLERK_SECRET_KEY = 'fixture-only';
  const db = accountDatabase();
  const prepare = db.prepare.bind(db);
  // Validate every statement against the production translator as well as SQLite execution.
  db.prepare = sql => { postgresSql(sql); return prepare(sql); };
  const groq = adapters.find(a => a.id === 'groq')!;
  groq.discover = async () => [{ modelId: 'fixture-chat', displayName: 'Fixture', capabilities: ['chat'], freeStatus: 'unknown', contextLength: 8192, maxOutput: 1024 }];
  groq.chat = async () => ({ text: 'OK', promptTokens: 1, completionTokens: 1, finishReason: 'stop', latencyMs: 1, ttftMs: 1, usageEstimated: false });
  const token = await issueDevice(db, 'owner-a', 'test');
  const call = async (method: string, suffix: string, body?: unknown, auth = token) => {
    const response = await handleApi(new Request('https://www.swarmgpt.online/api/providers/groq' + suffix, {
      method, headers: { Authorization: 'Bearer ' + auth, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }), ['providers', 'groq', ...suffix.split('/').filter(Boolean)]);
    assert.equal(response.status, 200);
    return response.json();
  };
  const key = 'gsk_fixture_only_12345678';
  const draft = await call('POST', '/test', { apiKey: key });
  assert.equal(draft.status, 'connected');
  assert.equal(await db.prepare('SELECT data FROM credentials WHERE owner=? AND provider=?').get('owner-a', 'groq'), undefined);
  await call('PUT', '', { apiKey: key });
  assert.equal((await call('POST', '/test', {})).status, 'connected');
  assert.equal((await call('GET', '')).status, 'connected');
  const other = await issueDevice(db, 'owner-b', 'test');
  assert.notEqual((await call('GET', '', undefined, other)).status, 'connected');
  assert(!JSON.stringify(draft).includes(key));
  await call('DELETE', '');
  assert.equal(await db.prepare('SELECT data FROM provider_status WHERE owner=? AND provider=?').get('owner-a', 'groq'), undefined);
  await db.close();
});
