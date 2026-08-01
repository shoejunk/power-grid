import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { LogEntry, ResourceType } from '@pg/shared';

import { springSoft } from '../styles/motion';
import { Panel, Tabs } from '../ui';
import { CATEGORY_LABEL, LOG_FILTERS, RESOURCE_META, matchesFilter, type LogFilter } from './format';
import { playerName, useMatch } from './model';

/**
 * The rules log (§14 "Determinism and auditability", quality bar U7).
 *
 * Every entry the engine writes carries a structured `data` payload, so the log
 * is not just a transcript: automatic transitions — market refills, Step changes,
 * discarded cards, the winner evaluation — are expanded into the numbers that
 * caused them.
 */
export function RulesLog(): JSX.Element {
  const { state } = useMatch();
  const [filter, setFilter] = useState<LogFilter>('all');
  const bodyRef = useRef<HTMLDivElement>(null);

  const entries = useMemo(
    () => state.log.filter((e) => matchesFilter(e.category, filter)).slice(-120),
    [state.log, filter],
  );

  // Follow the tail unless the player has scrolled up to read history.
  useEffect(() => {
    const node = bodyRef.current;
    if (!node) return;
    const nearBottom = node.scrollHeight - node.scrollTop - node.clientHeight < 90;
    if (nearBottom) node.scrollTop = node.scrollHeight;
  }, [entries.length]);

  return (
    <Panel
      padding="tight"
      className="pg-glog"
      title="Rules log"
      subtitle="Every automatic transition, explained"
      actions={<Tabs items={LOG_FILTERS} value={filter} onChange={setFilter} label="Filter the rules log" />}
    >
      <div className="pg-glog__body" ref={bodyRef}>
        <AnimatePresence initial={false}>
          {entries.map((entry) => (
            <motion.div
              key={entry.id}
              className="pg-glog__line"
              data-cat={entry.category}
              layout
              initial={{ opacity: 0, x: -12 }}
              animate={{ opacity: 1, x: 0 }}
              transition={springSoft}
            >
              <span className="pg-glog__stamp pg-numeral" title={`Round ${entry.round}, Step ${entry.step}`}>
                R{entry.round}
              </span>
              <span className="pg-glog__cat">{CATEGORY_LABEL[entry.category]}</span>
              <span className="pg-glog__text">
                {entry.message}
                {detailFor(entry, (id) => playerName(state, id)) ? (
                  <em className="pg-glog__detail">{detailFor(entry, (id) => playerName(state, id))}</em>
                ) : null}
              </span>
            </motion.div>
          ))}
        </AnimatePresence>
        {entries.length === 0 ? (
          <span className="pg-caption">Nothing logged under this filter yet.</span>
        ) : null}
      </div>
    </Panel>
  );
}

/* ------------------------------------------------------------------ *
 * Expansion of the structured payloads
 * ------------------------------------------------------------------ */

const num = (v: unknown): number | null => (typeof v === 'number' ? v : null);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

function bundleText(value: unknown): string {
  if (typeof value !== 'object' || value === null) return '';
  const record = value as Record<string, unknown>;
  const parts: string[] = [];
  for (const key of Object.keys(RESOURCE_META) as ResourceType[]) {
    const n = num(record[key]);
    if (n !== null && n > 0) parts.push(`${RESOURCE_META[key].label} +${n}`);
  }
  return parts.join(', ');
}

/**
 * The second line under a log message: the arithmetic behind an automatic
 * transition, so a player can audit it rather than trust it.
 */
function detailFor(entry: LogEntry, nameOf: (id: string) => string): string | null {
  const data = entry.data;
  if (!data) return null;
  const event = str(data.event);

  switch (event) {
    case 'marketRefilled': {
      const added = bundleText(data.added);
      const shortfall = bundleText(data.shortfall);
      const parts = [`Step ${num(data.step) ?? entry.step} refill for ${num(data.playerCount) ?? '?'} players`];
      if (added) parts.push(added);
      if (shortfall) parts.push(`short of supply: ${shortfall}`);
      if (data.uraniumPhaseOut === true) parts.push('uranium is phased out and never resupplies');
      return `${parts.join(' · ')}. Filled from the most expensive empty space downward (§9.2).`;
    }
    case 'stepChange':
      return `Step ${num(data.from) ?? '?'} → Step ${num(data.to) ?? '?'}. City capacity, building costs and refill values all change (§10).`;
    case 'highestPlantBuried':
      return 'Phase 5 in Steps 1–2 buries the highest future plant under the stack, then draws a replacement (§9.3).';
    case 'lowestPlantRemoved':
      return str(data.reason) === 'stackExhausted'
        ? 'The stack is empty, so each later Phase 5 removes the smallest plant instead of drawing (§9.3).'
        : 'Step 3 removes the smallest current plant each Phase 5 and draws a replacement (§9.3).';
    case 'discountReplacementRemoved':
      return 'A replacement drawn below the discounted plant is removed along with the discount token (§6).';
    case 'discountPlantRemoved':
      return 'An unsold discounted plant leaves the game at the end of Phase 2 and is replaced (§6).';
    case 'auctionResolved':
      return str(data.reason) === 'uncontested'
        ? 'No other eligible bidder remained, so the plant went for exactly the minimum bid (§6).'
        : `Every other bidder passed, so ${nameOf(str(data.winnerId) ?? '')} pays ${num(data.price) ?? 0}₤ (§6).`;
    case 'scrapRequired':
      return 'A player may own at most three plants; the newly acquired plant cannot be the one scrapped (§6).';
    case 'citiesPowered': {
      const capacity = num(data.capacity) ?? 0;
      const supplied = num(data.citiesSupplied) ?? 0;
      const wasted = capacity - supplied;
      const burnt = bundleText(data.consumed).replace(/\+/g, '');
      const base = burnt ? `Burnt ${burnt}. ` : 'Burnt nothing. ';
      return wasted > 0
        ? `${base}${wasted} generation wasted — a plant cannot be run at half capacity (§1).`
        : `${base}Paid from the payment summary for ${supplied} supplied cities (§9.1).`;
    }
    case 'cityConnected':
      return `Route ${num(data.routeCost) ?? 0}₤ + slot ${num(data.slotCost) ?? 0}₤. The route cost is paid again in full for every new city (§8).`;
    case 'endGameTriggered':
      return `Threshold ${num(data.threshold) ?? 0} cities. The next Phase 5 pays nothing — it only evaluates who can supply the most cities (§11).`;
    case 'winnerEvaluation':
      return `Using plants ${(Array.isArray(data.operatePlantIds) ? data.operatePlantIds : []).join(', ') || '—'} and the fuel already on them (§11).`;
    case 'gameOver':
      return 'Most suppliable cities wins, even if someone else triggered the end. Money breaks ties (§11).';
    case 'uraniumPhaseOut':
      return 'Plant 39 was bought, so uranium is never resupplied again on the Germany map (§12).';
    case 'playerOrder':
      return 'Ranked by connected cities, then by highest-numbered owned plant (§4).';
    case 'stackExhausted':
      return 'No replacement is drawn. Each later Phase 5 removes the smallest plant instead (§9.3).';
    case 'step3CardDrawn':
      return 'The stack below the Step 3 card is reshuffled immediately (§10).';
    default:
      return null;
  }
}
