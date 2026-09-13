/**
 * The universal decision channel, drawn.
 *
 * Every blocked decision in this game — a crossroads option, a bite response,
 * an overrun casualty, which two survivors you keep during setup, whether to
 * keep searching — arrives as one `PendingChoice`, so there is exactly one
 * dialog for all of them. §10's rule that an unsatisfiable option is "offered
 * as illegal rather than hidden" is the reason illegal options are rendered at
 * all, greyed and carrying their reason.
 *
 * The dialog is dismissible even though the game is blocked on it: a player
 * frequently needs to look at the board before answering, and a modal that
 * refuses to move is worse than a banner that brings it back.
 */

import type { GameState, PendingChoice } from '@game/dead-of-winter';
import { Badge, Button, Modal } from '@tt/ui';
import { useEffect, useState } from 'react';

import { net } from '@/net';

import { crossroadsCard, itemDef, survivorCard, survivorDef } from '../content';
import type { CardPreview } from './CardPreviewDialog';
import { ItemCard, SurvivorCard } from './parts';

export interface ChoiceDialogProps {
  state: GameState;
  choice: PendingChoice;
  open: boolean;
  onClose: () => void;
  onPreview: (preview: CardPreview) => void;
}

const KIND_LABEL: Partial<Record<PendingChoice['kind'], string>> = {
  setupKeepSurvivors: 'Setup — keep two survivors',
  setupChooseLeader: 'Setup — name your group leader',
  searchDecision: 'Search',
  biteResponse: 'Bitten',
  overrunCasualty: 'The colony is overrun',
  chooseNewLeader: 'A new group leader',
  exileRelocate: 'Exiled — relocate',
  exileSwap: 'Exiled — swap',
  lastSurvivorPlacement: 'A new survivor arrives',
  requestResponse: 'Someone is asking for a card',
  handOffConsent: 'Someone is offering you a card',
  attractPlacement: 'Where do the zombies land?',
  effectOption: 'Choose',
  vote: 'Vote',
};

export function ChoiceDialog({ state, choice, open, onClose, onPreview }: ChoiceDialogProps): JSX.Element {
  const [picked, setPicked] = useState<string[]>([]);

  // A new decision must never inherit the previous one's selection.
  useEffect(() => setPicked([]), [choice.id]);

  const min = choice.minPicks ?? 1;
  const max = choice.maxPicks ?? 1;
  const exact = min === max;
  const isSurvivorSetup = choice.kind === 'setupKeepSurvivors';
  const sourceCrossroads =
    choice.data?.['source'] === 'crossroads'
      ? crossroadsCard(choice.data?.['cardId'] as string | undefined ?? null)
      : undefined;
  const contextualItemIid =
    typeof choice.data?.['iid'] === 'string' && itemDef(state, choice.data['iid'])
      ? choice.data['iid']
      : null;

  const toggle = (id: string): void => {
    setPicked((current) => {
      if (current.includes(id)) return current.filter((x) => x !== id);
      if (max === 1) return [id];
      if (current.length >= max) return current;
      return [...current, id];
    });
  };

  const commit = (ids: string[]): void => {
    net.action({ type: 'resolveChoice', choiceId: choice.id, optionIds: ids });
    onClose();
  };

  const ready = picked.length >= min && picked.length <= max;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={KIND_LABEL[choice.kind] ?? 'Decide'}
      description={choice.prompt}
      width={isSurvivorSetup ? '1000px' : '620px'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Look at the board
          </Button>
          {max > 1 || !exact ? (
            <Button variant="primary" disabled={!ready} onClick={() => commit(picked)}>
              Confirm {picked.length > 0 ? `(${picked.length})` : ''}
            </Button>
          ) : null}
        </>
      }
    >
      <p className="tt-caption dow-choice__meta">
        {exact ? `Choose exactly ${min}.` : `Choose between ${min} and ${max}.`}
        {choice.private ? ' Only you can see these.' : null}
      </p>

      {sourceCrossroads ? (
        <div className="dow-choice__source-card">
          <p className="tt-caption">The full Crossroads story and every option are public now.</p>
          <Button
            variant="secondary"
            onClick={() => onPreview({ kind: 'crossroads', card: sourceCrossroads })}
          >
            View full Crossroads card
          </Button>
        </div>
      ) : null}

      {contextualItemIid ? (
        <div className="dow-choice__source-card">
          <ItemCard state={state} iid={contextualItemIid} />
          <Button
            variant="secondary"
            onClick={() => onPreview({ kind: 'item', iid: contextualItemIid })}
          >
            Preview offered card
          </Button>
        </div>
      ) : null}

      <div
        className={`dow-choice__options${isSurvivorSetup ? ' dow-choice__options--survivors' : ''}`}
      >
        {choice.options.map((option) => {
          const selected = picked.includes(option.id);
          const survivor = survivorCard(option.id) ?? survivorDef(state, option.id);
          if (survivor) {
            return (
              <div className="dow-card-choice" key={option.id}>
                <SurvivorCard
                  card={survivor}
                  selected={selected}
                  disabled={!option.legal}
                  onClick={() => (max === 1 && exact ? commit([option.id]) : toggle(option.id))}
                />
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => onPreview({ kind: 'survivor', card: survivor })}
                >
                  Preview
                </Button>
              </div>
            );
          }
          const itemIid = option.id.startsWith('keep:') ? option.id.slice('keep:'.length) : option.id;
          if (itemDef(state, itemIid)) {
            return (
              <div className="dow-card-choice" key={option.id}>
                <ItemCard
                  state={state}
                  iid={itemIid}
                  selected={selected}
                  disabled={!option.legal}
                  onClick={() => (max === 1 && exact ? commit([option.id]) : toggle(option.id))}
                />
                {option.legal ? null : (
                  <Badge tone="warning">{option.reason ?? 'Not available'}</Badge>
                )}
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => onPreview({ kind: 'item', iid: itemIid })}
                >
                  Preview
                </Button>
              </div>
            );
          }
          return (
            <button
              key={option.id}
              type="button"
              className={[
                'dow-choice__option',
                selected ? 'dow-choice__option--selected' : '',
                option.legal ? '' : 'dow-choice__option--illegal',
              ]
                .filter(Boolean)
                .join(' ')}
              disabled={!option.legal}
              aria-pressed={selected}
              onClick={() => (max === 1 && exact ? commit([option.id]) : toggle(option.id))}
            >
              <span className="dow-choice__label">{option.label}</span>
              {option.legal ? null : (
                <Badge tone="warning">{option.reason ?? 'Not available'}</Badge>
              )}
            </button>
          );
        })}
      </div>

      {choice.kind === 'searchDecision' && state.search ? (
        <p className="tt-caption">
          §7.3 — {state.search.drawn.length} card
          {state.search.drawn.length === 1 ? '' : 's'} seen, {state.search.noisePlaced} noise placed.
          Keep one, or draw deeper and make more noise.
        </p>
      ) : null}
    </Modal>
  );
}
