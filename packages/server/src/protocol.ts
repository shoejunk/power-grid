/**
 * Wire protocol: parsing and shape-validation of everything arriving from a
 * client. Nothing beyond this module is allowed to assume an inbound message
 * is well-formed — requirement 6, "never trust the client".
 *
 * The canonical union lives in `@pg/shared` (`ClientMessage` / `ServerMessage`).
 * Two server-side additions are declared here because the lobby requires them
 * (colour picking with no duplicates, renaming) and the shared union does not
 * yet carry them; they are additive, so a client that never sends them still
 * works.
 */

import {
  emptyResources,
  PLAYER_COLORS,
  RESOURCE_TYPES,
  type ClientMessage,
  type ResourceBundle,
  type GameAction,
  type GameSettings,
  type MapId,
  type PlayerColor,
  type ResourceType,
} from '@pg/shared';

/* ------------------------------------------------------------------ *
 * Inbound
 * ------------------------------------------------------------------ */

export type ClientMessageExtra =
  | { t: 'setColor'; color: PlayerColor }
  | { t: 'setName'; name: string };

export type AnyClientMessage = ClientMessage | ClientMessageExtra;

export type ParseResult =
  | { ok: true; message: AnyClientMessage }
  | { ok: false; code: string; message: string };

const MAX_NAME_LENGTH = 24;
const MAX_CHAT_LENGTH = 500;
const MAX_CODE_LENGTH = 12;
const MAX_TOKEN_LENGTH = 128;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const isString = (v: unknown): v is string => typeof v === 'string';
const isBool = (v: unknown): v is boolean => typeof v === 'boolean';
const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isInt = (v: unknown): v is number => isFiniteNumber(v) && Number.isInteger(v);

const bad = (code: string, message: string): ParseResult => ({ ok: false, code, message });

/** Trims and clamps free text so a client cannot smuggle in a novel. */
export function sanitiseText(value: string, max: number): string {
  // Strip control characters (including newlines) — names and chat are single-line.
  return value.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

export function isPlayerColor(v: unknown): v is PlayerColor {
  return isString(v) && (PLAYER_COLORS as readonly string[]).includes(v);
}

function parseSettingsPatch(v: unknown): Partial<GameSettings> | null {
  if (!isRecord(v)) return null;
  const out: Partial<GameSettings> = {};
  if ('mapId' in v) {
    if (v.mapId !== 'germany' && v.mapId !== 'usa') return null;
    out.mapId = v.mapId as MapId;
  }
  if ('playerCount' in v) {
    if (!isInt(v.playerCount) || v.playerCount < 2 || v.playerCount > 6) return null;
    out.playerCount = v.playerCount;
  }
  if ('experiencedStart' in v) {
    if (!isBool(v.experiencedStart)) return null;
    out.experiencedStart = v.experiencedStart;
  }
  if ('againstTheTrust' in v) {
    if (!isBool(v.againstTheTrust)) return null;
    out.againstTheTrust = v.againstTheTrust;
  }
  if ('seed' in v && v.seed !== undefined) {
    if (!isString(v.seed) || v.seed.length > 64) return null;
    out.seed = v.seed;
  }
  return out;
}

/**
 * Structural check of a `GameAction`. This validates *shape only* — whether
 * the move is legal is the rules engine's job, never the server's.
 */
function parseAction(v: unknown): GameAction | null {
  if (!isRecord(v) || !isString(v.type)) return null;
  switch (v.type) {
    case 'selectZone':
      return Array.isArray(v.areas) && v.areas.every(isString) && v.areas.length <= 6
        ? { type: 'selectZone', areas: v.areas as string[] }
        : null;
    case 'markStartCity':
      return isString(v.cityId) ? { type: 'markStartCity', cityId: v.cityId } : null;
    case 'placeTrustHouse':
      return isString(v.cityId) ? { type: 'placeTrustHouse', cityId: v.cityId } : null;
    case 'startGame':
      return { type: 'startGame' };
    case 'nominatePlant':
      return isInt(v.plantId) && isInt(v.bid) && v.bid >= 0
        ? { type: 'nominatePlant', plantId: v.plantId, bid: v.bid }
        : null;
    case 'passNomination':
      return { type: 'passNomination' };
    case 'bid':
      return isInt(v.amount) && v.amount >= 0 ? { type: 'bid', amount: v.amount } : null;
    case 'passBid':
      return { type: 'passBid' };
    case 'scrapPlant':
      return isInt(v.plantId) ? { type: 'scrapPlant', plantId: v.plantId } : null;
    case 'buyResources': {
      if (!Array.isArray(v.purchases)) return null;
      const purchases: { resource: ResourceType; count: number }[] = [];
      for (const p of v.purchases) {
        if (!isRecord(p) || !isInt(p.count) || p.count < 0) return null;
        if (p.resource !== 'coal' && p.resource !== 'oil' && p.resource !== 'garbage' && p.resource !== 'uranium') {
          return null;
        }
        purchases.push({ resource: p.resource, count: p.count });
      }
      return { type: 'buyResources', purchases };
    }
    case 'redistributeResources': {
      if (!Array.isArray(v.assignment)) return null;
      const assignment: { plantId: number; stored: ResourceBundle }[] = [];
      for (const a of v.assignment) {
        if (!isRecord(a) || !isInt(a.plantId) || !isRecord(a.stored)) return null;
        const stored = emptyResources();
        for (const key of RESOURCE_TYPES) {
          const n = a.stored[key];
          if (!isInt(n) || n < 0) return null;
          stored[key] = n;
        }
        assignment.push({ plantId: a.plantId, stored });
      }
      return { type: 'redistributeResources', assignment };
    }
    case 'passResources':
      return { type: 'passResources' };
    case 'buildCity':
      return isString(v.cityId) ? { type: 'buildCity', cityId: v.cityId } : null;
    case 'passBuilding':
      return { type: 'passBuilding' };
    case 'powerCities': {
      const d = v.decision;
      if (!isRecord(d)) return null;
      if (!Array.isArray(d.operatePlantIds) || !d.operatePlantIds.every(isInt)) return null;
      if (!isInt(d.citiesSupplied) || d.citiesSupplied < 0) return null;
      return {
        type: 'powerCities',
        decision: {
          operatePlantIds: d.operatePlantIds as number[],
          citiesSupplied: d.citiesSupplied,
        },
      };
    }
    case 'undoLastBuild':
      return { type: 'undoLastBuild' };
    default:
      return null;
  }
}

/** Parses a raw frame. Never throws. */
export function parseClientMessage(raw: string): ParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return bad('badJson', 'Message was not valid JSON.');
  }
  if (!isRecord(parsed)) return bad('badMessage', 'Message must be a JSON object.');
  const t = parsed.t;
  if (!isString(t)) return bad('badMessage', "Message is missing a string 't' discriminator.");

  switch (t) {
    case 'hello': {
      const token = parsed.sessionToken;
      if (token !== undefined && (!isString(token) || token.length > MAX_TOKEN_LENGTH)) {
        return bad('badMessage', 'sessionToken must be a short string.');
      }
      return { ok: true, message: { t: 'hello', ...(isString(token) ? { sessionToken: token } : {}) } };
    }
    case 'createGame': {
      if (!isString(parsed.name)) return bad('badMessage', 'createGame requires a name.');
      const name = sanitiseText(parsed.name, MAX_NAME_LENGTH);
      if (name.length === 0) return bad('badMessage', 'Name cannot be empty.');
      const settings = parseSettingsPatch(parsed.settings);
      if (!settings) return bad('badMessage', 'createGame settings are invalid.');
      return {
        ok: true,
        message: {
          t: 'createGame',
          name,
          settings: {
            mapId: settings.mapId ?? 'germany',
            playerCount: settings.playerCount ?? 4,
            experiencedStart: settings.experiencedStart ?? false,
            againstTheTrust: settings.againstTheTrust ?? false,
            ...(settings.seed !== undefined ? { seed: settings.seed } : {}),
          },
        },
      };
    }
    case 'joinGame': {
      if (!isString(parsed.code) || !isString(parsed.name)) {
        return bad('badMessage', 'joinGame requires a code and a name.');
      }
      const code = sanitiseText(parsed.code, MAX_CODE_LENGTH).toUpperCase();
      const name = sanitiseText(parsed.name, MAX_NAME_LENGTH);
      if (code.length === 0) return bad('badMessage', 'Join code cannot be empty.');
      if (name.length === 0) return bad('badMessage', 'Name cannot be empty.');
      return { ok: true, message: { t: 'joinGame', code, name } };
    }
    case 'rejoin': {
      if (!isString(parsed.sessionToken) || parsed.sessionToken.length > MAX_TOKEN_LENGTH) {
        return bad('badMessage', 'rejoin requires a sessionToken.');
      }
      return { ok: true, message: { t: 'rejoin', sessionToken: parsed.sessionToken } };
    }
    case 'leaveGame':
      return { ok: true, message: { t: 'leaveGame' } };
    case 'setReady':
      if (!isBool(parsed.ready)) return bad('badMessage', 'setReady requires a boolean.');
      return { ok: true, message: { t: 'setReady', ready: parsed.ready } };
    case 'updateSettings': {
      const settings = parseSettingsPatch(parsed.settings);
      if (!settings) return bad('badMessage', 'updateSettings payload is invalid.');
      return { ok: true, message: { t: 'updateSettings', settings } };
    }
    case 'addBot':
      return { ok: true, message: { t: 'addBot' } };
    case 'removePlayer':
      if (!isString(parsed.playerId)) return bad('badMessage', 'removePlayer requires a playerId.');
      return { ok: true, message: { t: 'removePlayer', playerId: parsed.playerId } };
    case 'startGame':
      return { ok: true, message: { t: 'startGame' } };
    case 'action': {
      const action = parseAction(parsed.action);
      if (!action) return bad('badAction', 'Action payload is malformed.');
      const nonce = parsed.nonce;
      if (nonce !== undefined && (!isString(nonce) || nonce.length > 64)) {
        return bad('badMessage', 'nonce must be a short string.');
      }
      return { ok: true, message: { t: 'action', action, ...(isString(nonce) ? { nonce } : {}) } };
    }
    case 'chat': {
      if (!isString(parsed.text)) return bad('badMessage', 'chat requires text.');
      const text = sanitiseText(parsed.text, MAX_CHAT_LENGTH);
      if (text.length === 0) return bad('badMessage', 'Chat message was empty.');
      return { ok: true, message: { t: 'chat', text } };
    }
    case 'ping':
      return { ok: true, message: { t: 'ping' } };
    /* --- server-side additions --- */
    case 'setColor':
      if (!isPlayerColor(parsed.color)) return bad('badMessage', 'Unknown colour.');
      return { ok: true, message: { t: 'setColor', color: parsed.color } };
    case 'setName': {
      if (!isString(parsed.name)) return bad('badMessage', 'setName requires a name.');
      const name = sanitiseText(parsed.name, MAX_NAME_LENGTH);
      if (name.length === 0) return bad('badMessage', 'Name cannot be empty.');
      return { ok: true, message: { t: 'setName', name } };
    }
    default:
      return bad('unknownMessage', `Unknown message type '${t}'.`);
  }
}
