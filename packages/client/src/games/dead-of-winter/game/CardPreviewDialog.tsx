import type {
  CrisisCardDefinition,
  CrossroadsCardDefinition,
  GameState,
  MainObjectiveDefinition,
  MainObjectiveSide,
  SecretObjectiveDefinition,
  SurvivorCardDefinition,
} from '@game/dead-of-winter';
import { Button, Modal } from '@tt/ui';

import { itemDef } from '../content';
import { CrisisCard, CrossroadsCard, ItemCard, ObjectiveCard, SurvivorCard } from './parts';

export type CardPreview =
  | { kind: 'item'; iid: string }
  | { kind: 'survivor'; card: SurvivorCardDefinition }
  | { kind: 'crisis'; card: CrisisCardDefinition }
  | { kind: 'crossroads'; card: CrossroadsCardDefinition }
  | {
      kind: 'mainObjective';
      card: MainObjectiveDefinition;
      side: MainObjectiveSide;
      sideLabel: string;
    }
  | { kind: 'secretObjective'; card: SecretObjectiveDefinition };

function title(state: GameState, preview: CardPreview): string {
  if (preview.kind === 'item') return itemDef(state, preview.iid)?.name ?? 'Face-down card';
  return preview.card.name;
}

function card(state: GameState, preview: CardPreview): JSX.Element {
  switch (preview.kind) {
    case 'item':
      return <ItemCard state={state} iid={preview.iid} />;
    case 'survivor':
      return <SurvivorCard card={preview.card} />;
    case 'crisis':
      return <CrisisCard card={preview.card} />;
    case 'crossroads':
      return <CrossroadsCard card={preview.card} />;
    case 'mainObjective':
      return (
        <ObjectiveCard
          variant="main"
          card={preview.card}
          side={preview.side}
          sideLabel={preview.sideLabel}
        />
      );
    case 'secretObjective':
      return <ObjectiveCard variant="secret" card={preview.card} />;
  }
}

export function CardPreviewDialog({
  state,
  preview,
  onClose,
}: {
  state: GameState;
  preview: CardPreview | null;
  onClose: () => void;
}): JSX.Element {
  return (
    <Modal
      open={preview !== null}
      onClose={onClose}
      title={preview ? title(state, preview) : 'Card preview'}
      description="Large card preview"
      width="560px"
      footer={
        <Button variant="primary" onClick={onClose}>
          Close preview
        </Button>
      }
    >
      <div className="dow-card-preview">{preview ? card(state, preview) : null}</div>
    </Modal>
  );
}
