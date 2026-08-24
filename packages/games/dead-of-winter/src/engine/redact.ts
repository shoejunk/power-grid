/**
 * Per-recipient views — §3, and the security-critical half of the plugin.
 *
 * This is the only thing standing between a hidden-objective game and a player
 * reading the answer out of a WebSocket frame, so it is built by *construction*:
 * the view starts from a clone and then every secret-bearing container is
 * replaced wholesale with a public projection. Replacement rather than deletion
 * matters because a deletion pass can only remove the fields somebody
 * remembered to name, while a replacement pass fails loudly — the view simply
 * has no card ids in it — when a new secret is added.
 *
 * The single most important consequence: `state.items` is a registry mapping
 * instance ids to card ids. Masking a hand without also filtering that registry
 * would leak every card in the game. The rule below is therefore "an item
 * instance appears in the view only if the viewer is allowed to know what it
 * is", and every hidden zone is rewritten to opaque placeholders whose *count*
 * is the public fact §3 says it is.
 */

import { NON_COLONY_LOCATIONS } from '../content/primitives.js';
import type { GameState, ItemInstance, PendingChoice, PlayerId } from '../types.js';

/**
 * A placeholder instance id.
 *
 * Distinct per slot so a UI can key on it, and carrying no information beyond
 * position — which §3 already makes public, since "card counts in every deck
 * and player hand are public".
 */
const mask = (prefix: string, n: number): string[] =>
  Array.from({ length: n }, (_, i) => `hidden:${prefix}:${i}`);

export function redactStateFor(state: GameState, viewerId: PlayerId | null): GameState {
  /*
   * The audit projection. `redactStateFor(state, null)` is documented by the
   * platform as "a spectator or an audit projection" — but a spectator must not
   * see secrets, so the null case is treated as a spectator and the *audit*
   * view is simply the unredacted state, which the server already holds.
   */
  const view: GameState = JSON.parse(JSON.stringify(state)) as GameState;
  const gameOver = state.phase === 'gameOver';

  /*
   * §22 keeps the seed and cursor in authoritative state so a match can be
   * replayed. Neither may ever reach a client: together they predict every
   * future shuffle, die and random theft.
   */
  view.seed = '';
  // The setup payload retains the same replay seed; redact that duplicate too.
  view.settings.seed = '';
  view.rngCursor = 0;

  /** Instances the viewer is entitled to identify. */
  const visible = new Set<string>();

  /* -- public zones ------------------------------------------------ */

  // §8.1/§11.2: the waste pile is played cards, face up and ordered.
  for (const iid of state.colony.waste) visible.add(iid);
  // §3: "Main-objective contributions are face up and public."
  for (const iid of state.mainObjective.contributions) visible.add(iid);
  // Cards already removed from the game were seen on the way out.
  for (const iid of state.decks.removedFromGame.items) visible.add(iid);
  // §21: "Show every survivor's ... equipment" — equipment is on the board.
  for (const survivor of Object.values(state.survivors)) {
    for (const iid of survivor.equipped) visible.add(iid);
  }

  /* -- the viewer's own private zones ------------------------------ */

  if (viewerId && state.players[viewerId]) {
    for (const iid of state.players[viewerId]!.hand) visible.add(iid);
  }
  // §3: "Search results are private to the searching player."
  if (viewerId && state.search?.playerId === viewerId) {
    for (const iid of state.search.drawn) visible.add(iid);
  }

  /* -- players ----------------------------------------------------- */

  for (const id of state.seating) {
    const source = state.players[id]!;
    const target = view.players[id]!;
    const isSelf = id === viewerId;

    // §3: "Card identities in a player's hand are private", counts are not.
    if (!isSelf) target.hand = mask(`hand:${id}`, source.hand.length);

    /*
     * §3/§16: a secret objective is private, and §16 reveals everything only
     * once the game is over. §14.1's forced reveal is carried by
     * `revealedObjectiveIds`, which stays public.
     */
    if (!isSelf && !gameOver) {
      target.secretObjectiveIds = source.secretObjectiveIds.map((cardId) =>
        source.revealedObjectiveIds.includes(cardId) ? cardId : 'hidden:objective',
      );
      target.exiledObjectiveId = source.exiledObjectiveId ? 'hidden:objective' : null;
    }
  }

  /* -- decks: order and identity are knowledge nobody has ---------- */

  view.decks.starterItems = mask('starter', state.decks.starterItems.length);
  view.decks.survivors = mask('survivorDeck', state.decks.survivors.length);
  view.decks.crossroads = mask('crossroads', state.decks.crossroads.length);
  view.decks.crisis = mask('crisisDeck', state.decks.crisis.length);
  view.decks.exiledObjectives = mask('exiled', state.decks.exiledObjectives.length);
  // §4: cards returned to the box are returned "unseen".
  view.decks.returnedToBox = {
    items: mask('box:items', state.decks.returnedToBox.items.length),
    survivors: mask('box:survivors', state.decks.returnedToBox.survivors.length),
    objectives: mask('box:objectives', state.decks.returnedToBox.objectives.length),
  };
  for (const loc of NON_COLONY_LOCATIONS) {
    view.locations[loc]!.deck = mask(`deck:${loc}`, state.locations[loc]!.deck.length);
  }

  /* -- crisis contributions ---------------------------------------- */

  /*
   * §3/§8.2: "Crisis-contribution identities and symbols remain hidden until
   * the crisis is resolved", while the number each player contributed is
   * public. Even the viewer's own contributions are masked: they are face down
   * on the table, and revealing them in the frame would let a client display
   * something the physical game does not.
   */
  view.crisis.contributions = state.crisis.contributions.map((c, i) => ({
    playerId: c.playerId,
    iid: `hidden:crisis:${i}`,
  }));

  /* -- the item registry ------------------------------------------- */

  const items: Record<string, ItemInstance> = {};
  for (const iid of visible) {
    const instance = state.items[iid];
    if (instance) items[iid] = JSON.parse(JSON.stringify(instance)) as ItemInstance;
  }
  view.items = items;

  /* -- crossroads --------------------------------------------------- */

  /*
   * §3: "The crossroads card drawn for a turn is visible only to the player who
   * drew it until it triggers." The holder is public — everyone can see who is
   * holding a card — but the identity is not.
   */
  if (view.turn && state.turn) {
    const maySee = viewerId === state.turn.crossroadsHolderId || state.turn.crossroadsTriggered;
    if (!maySee && state.turn.crossroadsCardId) view.turn.crossroadsCardId = 'hidden:crossroads';
  }

  /* -- searches in progress ---------------------------------------- */

  if (view.search && state.search && state.search.playerId !== viewerId) {
    view.search.drawn = mask('search', state.search.drawn.length);
  }

  /* -- pending choices ---------------------------------------------- */

  view.pendingChoices = state.pendingChoices.map((choice) =>
    redactChoice(choice, viewerId),
  );

  /* -- votes -------------------------------------------------------- */

  if (view.vote && state.vote) {
    // §15: commitments are simultaneous and no vote is visible until every one
    // is in. `committed` carries the progress §21 asks the UI to show.
    const complete = state.vote.electorate.every((id) => state.vote!.votes[id] !== undefined);
    if (!complete) {
      view.vote.votes = {};
      if (viewerId && state.vote.votes[viewerId] !== undefined) {
        view.vote.votes[viewerId] = state.vote.votes[viewerId]!;
      }
    }
  }

  /* -- effect stack -------------------------------------------------- */

  /*
   * Frames can carry card ids in their queued effects and dice results in their
   * vars. The client only needs to know that something is resolving — §21 asks
   * for the current step and chooser, not the machinery — so the queue is
   * reduced to its length.
   */
  view.effectStack = state.effectStack.map((frame) => ({
    id: frame.id,
    queue: [],
    vars: {},
    ctx: {
      sourceCardId: null,
      sourceInstanceId: null,
      controllerId: frame.ctx.controllerId,
      sourceSurvivorId: frame.ctx.sourceSurvivorId,
    },
  }));

  /* -- log ----------------------------------------------------------- */

  // §3: "Public logs must not leak hidden card identities." An entry with an
  // audience is private to it; the full entry survives in authoritative state.
  view.log = state.log.filter((e) => !e.audience || (viewerId !== null && e.audience.includes(viewerId)));

  return view;
}

/**
 * A choice as its non-owner may see it.
 *
 * Non-private choices stay legible so the table can see what everyone is
 * waiting for (§21: "Show the exact phase/step and current chooser"); a private
 * one keeps only its shape, because its option labels *are* the secret — a
 * search result or a hand.
 */
function redactChoice(choice: PendingChoice, viewerId: PlayerId | null): PendingChoice {
  const mine = choice.playerId === null || choice.playerId === viewerId;
  if (mine || !choice.private) {
    const copy: PendingChoice = JSON.parse(JSON.stringify(choice)) as PendingChoice;
    if (!mine) {
      // Outcomes describe what each option would do, which can name cards.
      delete copy.outcomes;
      if (!copy.private) return copy;
    }
    return copy;
  }
  return {
    id: choice.id,
    kind: choice.kind,
    playerId: choice.playerId,
    prompt: 'Waiting for a private decision.',
    options: choice.options.map((_, i) => ({ id: `hidden:${i}`, label: '?', legal: true })),
    ...(choice.minPicks !== undefined ? { minPicks: choice.minPicks } : {}),
    ...(choice.maxPicks !== undefined ? { maxPicks: choice.maxPicks } : {}),
    private: true,
  };
}
