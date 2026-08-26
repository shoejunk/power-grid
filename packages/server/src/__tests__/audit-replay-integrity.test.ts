import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Seat } from '@tt/core';
import { silentLogger } from '../logger.js';
import { JsonFileGameStore } from '../persistence/jsonStore.js';
import type { GameAuditEvent, GameAuditEventInput, PersistedGame } from '../persistence/types.js';
import { boot, makeDataDir, removeDataDir, stubRegistry } from './helpers.js';
import { STUB_GAME_KEY, stubGame, type StubAction, type StubSettings } from './stubGame.js';

const HOST_ID = 'host-integrity';
const GUEST_ID = 'guest-integrity';
const START_AT = 1_700_000_000_100;
const ACTION_AT = 1_700_000_000_200;
const settings: StubSettings = { tableSize: 2, variant: 'plain', seed: 'INTEGRITY-SEED' };

interface JsonSnapshot {
  version: 1 | 2;
  games: PersistedGame[];
  sessions: [];
  auditEvents?: Record<string, GameAuditEvent[]>;
}

function makeSeats(): Seat[] {
  return [
    {
      playerId: HOST_ID,
      name: 'Ada',
      color: 'alpha',
      isBot: false,
      ready: true,
      joinedAt: START_AT,
    },
    {
      playerId: GUEST_ID,
      name: 'Grace',
      color: 'beta',
      isBot: false,
      ready: true,
      joinedAt: START_AT + 1,
    },
  ];
}

function makeStartedRecord(suffix: string): PersistedGame {
  const gameId = `integrity-${suffix}`;
  const code = `INT${suffix.toUpperCase()}`;
  const seats = makeSeats();
  const initialState = stubGame.createGame(
    {
      gameId,
      code,
      hostId: HOST_ID,
      seed: `${code}-${START_AT}`,
      now: START_AT,
    },
    settings,
    seats.map(({ playerId, name, color, isBot }) => ({ playerId, name, color, isBot })),
  );
  const action: StubAction = { type: 'claim', itemId: 3, cost: 3 };
  const state = stubGame.applyAction(initialState, HOST_ID, action, ACTION_AT);
  const now = Date.now();

  return {
    gameId,
    gameKey: STUB_GAME_KEY,
    code,
    hostId: HOST_ID,
    settings,
    seats,
    state,
    auditSequence: 2,
    started: true,
    chat: [],
    createdAt: now,
    updatedAt: now,
  };
}

function startEvent(record: PersistedGame, at = START_AT): Extract<GameAuditEvent, { type: 'start' }> {
  return {
    sequence: 1,
    type: 'start',
    at,
    hostId: record.hostId,
    settings: structuredClone(record.settings),
    seats: structuredClone(record.seats),
  };
}

function actionEvent(
  record: PersistedGame,
  sequence = 2,
  action: unknown = { type: 'claim', itemId: 3, cost: 3 },
): Extract<GameAuditEvent, { type: 'action' }> {
  return { sequence, type: 'action', at: ACTION_AT, playerId: HOST_ID, action };
}

function writeJsonSnapshot(
  dataDir: string,
  games: PersistedGame[],
  auditEvents?: Record<string, GameAuditEvent[]>,
): string {
  const snapshot: JsonSnapshot = { version: 1, games, sessions: [] };
  if (auditEvents !== undefined) snapshot.auditEvents = auditEvents;
  const filePath = path.join(dataDir, 'test.json');
  fs.writeFileSync(filePath, JSON.stringify(snapshot), 'utf8');
  return filePath;
}

describe('generic audit and replay persistence integrity', () => {
  let dataDir: string | undefined;

  afterEach(() => {
    if (dataDir) removeDataDir(dataDir);
    dataDir = undefined;
  });

  it('round-trips a JSON started snapshot and its contiguous audit watermark', () => {
    dataDir = makeDataDir();
    const record = makeStartedRecord('json');
    const inputs: GameAuditEventInput[] = [
      startEvent(record),
      actionEvent(record),
    ].map(({ sequence: _sequence, ...event }) => event as GameAuditEventInput);
    const filePath = path.join(dataDir, 'audit.json');

    const first = new JsonFileGameStore(filePath);
    first.saveGameWithAudit(record, inputs);
    first.close();

    const reopened = new JsonFileGameStore(filePath);
    try {
      const [roundTripped] = reopened.loadGames();
      const events = reopened.loadAuditEvents(record.gameId);

      expect(roundTripped).toEqual(record);
      expect(roundTripped?.started).toBe(true);
      expect(roundTripped?.auditSequence).toBe(2);
      expect(events).toEqual([startEvent(record), actionEvent(record)]);
      expect(events.map((event) => event.sequence)).toEqual([1, 2]);
      expect(events.every((event, index) => event.sequence === index + 1)).toBe(true);
    } finally {
      reopened.close();
    }
  });

  it('loads an old started snapshot with no watermark or audit events through boot', async () => {
    dataDir = makeDataDir();
    const record = makeStartedRecord('legacy');
    const { auditSequence: _auditSequence, ...legacyRecord } = record;
    writeJsonSnapshot(dataDir, [legacyRecord]);

    const server = await boot({
      dataDir,
      storeKind: 'json',
      registry: stubRegistry(),
      logger: silentLogger,
    });
    try {
      const room = server.hub.roomByCode(record.code);

      expect(server.store.kind).toBe('json');
      expect(room).toBeDefined();
      expect(room?.started).toBe(true);
      expect(room?.state).toEqual(record.state);
      expect(server.store.loadAuditEvents(record.gameId)).toEqual([]);
      expect(server.store.loadGames()).toEqual([legacyRecord]);
    } finally {
      await server.close();
    }
  });

  it('fails closed on a snapshot watermark mismatch while retaining its durable row', async () => {
    dataDir = makeDataDir();
    const record = makeStartedRecord('watermark');
    const events = [startEvent(record)];
    writeJsonSnapshot(dataDir, [record], { [record.gameId]: events });

    const server = await boot({
      dataDir,
      storeKind: 'json',
      registry: stubRegistry(),
      logger: silentLogger,
    });
    try {
      expect(server.hub.roomByCode(record.code)).toBeUndefined();
      expect(server.hub.roomCount).toBe(0);
      expect(server.store.loadGames()).toEqual([record]);
      expect(server.store.loadAuditEvents(record.gameId)).toEqual(events);
    } finally {
      await server.close();
    }
  });

  it.each([
    {
      name: 'a malformed action',
      events: [
        startEvent(makeStartedRecord('malformed')),
        actionEvent(makeStartedRecord('malformed'), 2, { type: 'not-a-stub-action' }),
      ],
      suffix: 'malformed',
    },
    {
      name: 'an incomplete sequence',
      events: [
        startEvent(makeStartedRecord('incomplete')),
        actionEvent(makeStartedRecord('incomplete'), 3),
      ],
      suffix: 'incomplete',
    },
  ])('fails closed on $name while preserving the durable game row', async ({ events, suffix }) => {
    dataDir = makeDataDir();
    const record = makeStartedRecord(suffix);
    writeJsonSnapshot(dataDir, [record], { [record.gameId]: events });

    const server = await boot({
      dataDir,
      storeKind: 'json',
      registry: stubRegistry(),
      logger: silentLogger,
    });
    try {
      expect(server.hub.roomByCode(record.code)).toBeUndefined();
      expect(server.hub.roomCount).toBe(0);
      expect(server.store.loadGames()).toEqual([record]);
      expect(server.store.loadAuditEvents(record.gameId)).toEqual(events);
    } finally {
      await server.close();
    }
  });
});
