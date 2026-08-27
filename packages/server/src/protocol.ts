/**
 * Wire protocol: parsing and shape-validation of everything arriving from a
 * client. Nothing beyond this module may assume an inbound message is
 * well-formed.
 *
 * Note how little this file now knows. It validates the *envelope* — the
 * discriminator, the name, the join code, the session token, the chat line —
 * and stops. `settings` and `action` travel through as `unknown` and are
 * parsed by the owning game plugin at the moment they reach a table, because
 * only that plugin knows whether `{ type: 'buildCity', cityId: 'essen' }` is a
 * shape it recognises.
 *
 * That split is what makes adding a game a zero-diff change here.
 */

import { isBool, isRecord, isString, sanitiseText, type ClientMessage } from '@tt/core';

export type ParseResult =
  | { ok: true; message: ClientMessage }
  | { ok: false; code: string; message: string };

export const MAX_NAME_LENGTH = 24;
export const MAX_CHAT_LENGTH = 500;
export const MAX_CODE_LENGTH = 12;
export const MAX_TOKEN_LENGTH = 128;
export const MAX_GAME_KEY_LENGTH = 48;
export const MAX_GAME_ID_LENGTH = 80;

const bad = (code: string, message: string): ParseResult => ({ ok: false, code, message });

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

    case 'rejoin': {
      if (!isString(parsed.sessionToken) || parsed.sessionToken.length > MAX_TOKEN_LENGTH) {
        return bad('badMessage', 'rejoin requires a sessionToken.');
      }
      return { ok: true, message: { t: 'rejoin', sessionToken: parsed.sessionToken } };
    }

    case 'resumeGame': {
      if (!isString(parsed.gameId) || parsed.gameId.length > MAX_GAME_ID_LENGTH) {
        return bad('badMessage', 'resumeGame requires a gameId.');
      }
      return { ok: true, message: { t: 'resumeGame', gameId: parsed.gameId } };
    }

    case 'createGame': {
      if (!isString(parsed.gameKey) || parsed.gameKey.length > MAX_GAME_KEY_LENGTH) {
        return bad('badMessage', 'createGame requires a gameKey.');
      }
      if (!isString(parsed.name)) return bad('badMessage', 'createGame requires a name.');
      const name = sanitiseText(parsed.name, MAX_NAME_LENGTH);
      if (name.length === 0) return bad('badMessage', 'Name cannot be empty.');
      /*
       * `settings` is forwarded verbatim. The hub resolves `gameKey` to a
       * plugin and asks it to parse the payload; an unrecognised key is
       * rejected there, where the registry actually lives.
       */
      return {
        ok: true,
        message: { t: 'createGame', gameKey: parsed.gameKey, name, settings: parsed.settings ?? {} },
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

    case 'leaveGame':
      return { ok: true, message: { t: 'leaveGame' } };

    case 'setReady':
      if (!isBool(parsed.ready)) return bad('badMessage', 'setReady requires a boolean.');
      return { ok: true, message: { t: 'setReady', ready: parsed.ready } };

    case 'setName': {
      if (!isString(parsed.name)) return bad('badMessage', 'setName requires a name.');
      const name = sanitiseText(parsed.name, MAX_NAME_LENGTH);
      if (name.length === 0) return bad('badMessage', 'Name cannot be empty.');
      return { ok: true, message: { t: 'setName', name } };
    }

    case 'setColor': {
      // Which colours exist is the game's business; the envelope only insists
      // it is a short string, and the room checks it against the palette.
      if (!isString(parsed.color) || parsed.color.length > 32) {
        return bad('badMessage', 'setColor requires a colour name.');
      }
      return { ok: true, message: { t: 'setColor', color: parsed.color } };
    }

    case 'updateSettings':
      if (!isRecord(parsed.settings)) return bad('badMessage', 'updateSettings requires an object.');
      return { ok: true, message: { t: 'updateSettings', settings: parsed.settings } };

    case 'addBot':
      return { ok: true, message: { t: 'addBot' } };

    case 'removePlayer':
      if (!isString(parsed.playerId)) return bad('badMessage', 'removePlayer requires a playerId.');
      return { ok: true, message: { t: 'removePlayer', playerId: parsed.playerId } };

    case 'startGame':
      return { ok: true, message: { t: 'startGame' } };

    case 'action': {
      if (parsed.action === undefined || parsed.action === null) {
        return bad('badAction', 'action requires a payload.');
      }
      const nonce = parsed.nonce;
      if (nonce !== undefined && (!isString(nonce) || nonce.length > 64)) {
        return bad('badMessage', 'nonce must be a short string.');
      }
      return {
        ok: true,
        message: { t: 'action', action: parsed.action, ...(isString(nonce) ? { nonce } : {}) },
      };
    }

    case 'chat': {
      if (!isString(parsed.text)) return bad('badMessage', 'chat requires text.');
      const text = sanitiseText(parsed.text, MAX_CHAT_LENGTH);
      if (text.length === 0) return bad('badMessage', 'Chat message was empty.');
      return { ok: true, message: { t: 'chat', text } };
    }

    case 'ping':
      return { ok: true, message: { t: 'ping' } };

    default:
      return bad('unknownMessage', `Unknown message type '${t}'.`);
  }
}
