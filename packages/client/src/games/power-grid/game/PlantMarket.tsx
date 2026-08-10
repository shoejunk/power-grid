import { AnimatePresence, motion } from 'framer-motion';
import type { NominatablePlant } from '@pg/shared';

import { springSoft } from '../styles/motion';
import { Badge, Hint, Panel } from '../ui';
import { useMatch } from './model';
import { PlantCard } from './parts/PlantCard';

export interface PlantMarketProps {
  /** Plants the active player may nominate right now, from `legalActions()`. §6. */
  nominatable?: readonly NominatablePlant[];
  selectedPlantId?: number | null;
  onSelect?: (plantId: number) => void;
  /** Plant currently under the hammer, highlighted while bidding runs. */
  auctionPlantId?: number | null;
  /** My money, so an unaffordable minimum bid can state the actual shortfall. */
  money?: number;
}

/**
 * The plant market — always on screen, in the same place, in every phase
 * (quality bar V10).
 *
 * §6 splits the market in two: only the four plants of the *current* market may
 * be auctioned; the future market is visible but not biddable. Step 3 collapses
 * the two rows into one six-plant current market with no future row (§10), and
 * the panel says so rather than silently changing shape.
 */
export function PlantMarket({
  nominatable,
  selectedPlantId = null,
  onSelect,
  auctionPlantId = null,
  money = 0,
}: PlantMarketProps): JSX.Element {
  const { state } = useMatch();
  const market = state.plantMarket;
  const step3 = state.step === 3;
  const byId = new Map((nominatable ?? []).map((n) => [n.plantId, n]));
  const selectable = nominatable !== undefined && onSelect !== undefined;

  const reasonFor = (plantId: number): { reason: string | null; rule?: string } => {
    if (!selectable) return { reason: null };
    const option = byId.get(plantId);
    if (!option) {
      return {
        reason: 'The Step 3 card is not a power plant and cannot be auctioned.',
        rule: '§10 Game Steps and transitions',
      };
    }
    if (!option.affordable) {
      return {
        reason: `The minimum bid is ${option.minimumBid}₤ and you have ${money}₤.`,
        rule: '§6 Auction Power Plants',
      };
    }
    return { reason: null };
  };

  return (
    <Panel
      padding="tight"
      className="pg-gcard pg-gcard--plants"
      title="Plant market"
      subtitle={step3 ? 'Step 3 — all six are biddable' : 'Four current, four future'}
      actions={
        <div className="pg-grow">
          <Badge tone="neutral" title="Cards left in the face-down supply stack">
            stack {market.stack.length}
          </Badge>
          <Hint
            placement="left"
            title="Plant market"
            rule="§6, §9.3, §10"
            content="Plants are always sorted by number. In Steps 1 and 2 the four lowest form the current market and only those may be auctioned; the rest are the future market and are shown for planning only. In Step 3 all six plants are current and there is no future market."
          />
        </div>
      }
    >
      <div className="pg-gmarketrow">
        <span className="pg-gmarketrow__tag tt-overline">
          Current
          <em>biddable</em>
        </span>
        <div className="pg-gplantrow">
          <AnimatePresence initial={false} mode="popLayout">
            {market.current.map((plantId) => {
              const option = byId.get(plantId);
              const { reason, rule } = reasonFor(plantId);
              return (
                <motion.div
                  key={plantId}
                  layout
                  initial={{ opacity: 0, scale: 0.8, y: -10 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.8, y: 10 }}
                  transition={springSoft}
                >
                  <PlantCard
                    plantId={plantId}
                    size="sm"
                    discounted={market.discountPlantId === plantId}
                    minimumBid={option?.minimumBid}
                    selected={selectedPlantId === plantId || auctionPlantId === plantId}
                    {...(selectable ? { onSelect: () => onSelect?.(plantId) } : {})}
                    disabledReason={reason}
                    {...(rule ? { disabledRule: rule } : {})}
                  />
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      </div>

      <div className="pg-gmarketrow pg-gmarketrow--future">
        <span className="pg-gmarketrow__tag tt-overline">
          Future
          <em>not biddable</em>
        </span>
        <div className="pg-gplantrow">
          {step3 ? (
            <span className="pg-gnote tt-caption">
              Step 3 removed the future market — every plant on the board is up for auction.
            </span>
          ) : market.future.length === 0 ? (
            <span className="pg-gnote tt-caption">The stack is exhausted; no future plants remain.</span>
          ) : (
            <AnimatePresence initial={false} mode="popLayout">
              {market.future.map((plantId) => (
                <motion.div
                  key={plantId}
                  layout
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  transition={springSoft}
                >
                  <PlantCard plantId={plantId} size="sm" muted />
                </motion.div>
              ))}
            </AnimatePresence>
          )}
        </div>
      </div>
    </Panel>
  );
}
