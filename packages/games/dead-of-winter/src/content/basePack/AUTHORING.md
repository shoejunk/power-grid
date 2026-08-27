# Authoring the Dead of Winter base content pack

This directory is the **shipping catalog** — the thing the game is actually played with.
`../testPack.ts` is an engine fixture and stays exactly as it is; nothing here may change it.

## Why this exists

`testPack.ts` meets the §2.0 counts but 73 of its 80 crossroads are "Quiet Moment N — Nothing
happens", all 120 location items are `noop` cards named "police-station find 7", and every crisis
and secret objective is a generated placeholder. Acceptance criterion A14 cannot pass while the
active pack is a fixture, and no visual or UX critic can judge a board covered in placeholder text.

## The two hard rules

1. **Original names and text.** This is not a transcription of the retail cards. Invent card names
   and rules text. Aim at the same design space — a snowbound colony, scarce supplies, hard
   choices — without reproducing published card text.
2. **The §18 named cards keep their real names and their exact current definitions.** Roughly
   eighteen cards are named in §18 of `dead-of-winter-gameplay-requirements.md`, and the engine's
   regression suite asserts against them. Copy those definitions **verbatim** out of `testPack.ts`,
   same `id`, same `name`, same behaviour, comments included. If a regression test can't find
   `sv-loretta-clay` with a `4+` threshold in this pack, the erratum stops being covered.

## The contract

- Every file here exports one `const` array and nothing else. `index.ts` assembles them; it is owned
  by the integrator, not by card authors.
- Types come from `../schema.js`, `../effects.js` and `../primitives.js`. Read those three files
  before writing a card — they are documented field by field with the rule each field serves.
- `validate.ts` runs over the assembled pack. Structural errors fail the build; the §2.0 manifest
  counts are warnings and must still come out exact.
- Card ids are stable identifiers. Prefix by family: `sv-` survivors, `it-` items, `cr-` crises,
  `xr-` crossroads, `mo-` main objectives, `so-` secret objectives. Slugs, never numbers, except
  where a family genuinely has no name.

## What "real content" means here

A card earns its place by creating a decision. Concretely:

- **No `noop` `onPlay`** on a card that claims to do something, and no card whose text is
  "Scavenged."
- **Crossroads must actually trigger.** `{ event: 'never' }` is only legal for a card that is
  deliberately inert, and this pack should have none. Spread triggers across the `TriggerEventKind`
  range so the deck fires at varied moments, and give options real trade-offs — an option that is
  strictly better than the other is a wasted card.
- **Symbols must be earned.** A crowbar is a `weapon` and a `tool`; a textbook is `education`. The
  crisis economy (§11.3) and objective contributions (§8.3) both read these, so a deck whose symbol
  spread is uniform makes both systems dull.
- **Text matches effect.** The `text` field is rendered verbatim in the UI. If the text says "kill
  two zombies" the effect kills exactly two. A critic will diff these.

## Cooperative and mature filters

`nonCooperative` and `matureContent` are required booleans on every filterable card (§1: they are
data fields, never inferred). §19.1 strips every `nonCooperative` card in a cooperative game, so
be careful with deck sizes: the starter deck is consumed exactly at the five-seat ceiling (§4.8
deals five each from 25), so **no starter item may be `nonCooperative`.**
