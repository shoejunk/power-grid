import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { expect, it } from 'vitest';
import { SqliteGameStore } from '../persistence/sqliteStore.js';
import { makeDataDir, removeDataDir } from './helpers.js';

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite');

it('streams SQLite checkpoints lazily and releases a partially read cursor', () => {
  const dir = makeDataDir();
  const file = path.join(dir, 'stream.db');
  const store = new SqliteGameStore(file);
  try {
    store.appendAuditEvent('stream', { type: 'start', at: 1, hostId: 'host', settings: {}, seats: [] });
    store.appendAuditEvent('stream', { type: 'action', at: 2, playerId: 'host', action: {} });
    const db = new DatabaseSync(file);
    db.prepare("UPDATE audit_events SET beforeState = 'invalid json' WHERE sequence = 2").run();
    db.close();
    expect(store.countAuditEvents('stream')).toBe(2);
    expect(store.countAuditEvents('missing')).toBe(0);
    // The first read must not parse any later checkpoint.
    for (const event of store.iterateAuditEvents('stream')) {
      expect(event.type).toBe('start');
      break;
    }
    expect(() => [...store.iterateAuditEvents('stream')]).toThrow();
    // Both early exit and parse failure must close the SQLite cursor.
    store.appendAuditEvent('stream', { type: 'hostChange', at: 3, hostId: 'next' });
    expect(store.countAuditEvents('stream')).toBe(3);
  } finally {
    store.close();
    removeDataDir(dir);
  }
});
