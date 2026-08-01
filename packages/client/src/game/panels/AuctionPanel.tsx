import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useMemo, useState } from 'react';
import type { LogEntry, Player } from '@pg/shared';
import { MAX_PLANTS_PER_PLAYER, getPlant } from '@pg/shared';

import { net } from '../../net';
import { springSnappy, springSoft } from '../../styles/motion';
import { Avatar, Badge, Button, Money, NumberStepper, Tooltip } from '../../ui';
import { useMatch } from '../model';
import { PlantCard } from '../parts/PlantCard';
import { Callout, CostRow, PhaseShell, Stat, Waiting, type RuleLine } from './shell';

const AUCTION_RULES: readonly RuleLine[] = [
  { text: 'Each player may acquire at most one plant per round; in round 1 every player must.', rule: '§6' },
  { text: 'Only the four current-market plants may be auctioned — never a future-market plant.', rule: '§6, §14' },
  { text: 'The minimum opening bid is the plant number, or 1₤ for the plant under the discount token.', rule: '§6' },
  { text: 'Passing on a bid ends that auction for you; passing instead of nominating ends the whole phase for you.', rule: '§6' },
  { text: 'A player may own at most three plants. Acquiring a fourth forces a scrap — never the new plant.', rule: '§6, §14' },
];

export interface AuctionPanelProps {
  selectedPlantId: number | null;
  onSelectPlant: (plantId: number | null) => void;
}

export function AuctionPanel({ selectedPlantId, onSelectPlant }: AuctionPanelProps): JSX.Element {
  const { state, meId, legal } = useMatch();

  if (state.pendingScrap && state.pendingScrap.playerId === meId) {
    return <ScrapChooser />;
  }
  if (state.auction) {
    return <AuctionFloor />;
  }
  if (legal.nominatablePlants.length > 0 || legal.canPassNomination) {
    return <NominatePanel selectedPlantId={selectedPlantId} onSelectPlant={onSelectPlant} />;
  }
  return (
    <PhaseShell
      title="Auction Power Plants"
      subtitle="Phase 2 · player order"
      rules={AUCTION_RULES}
    >
      <Waiting note={waitingNote(state.pendingScrap !== null)} />
      <MyPlantLimit />
    </PhaseShell>
  );
}

function waitingNote(scrapPending: boolean): string {
  return scrapPending
    ? 'A player has just acquired a fourth plant and must scrap one before the phase continues (§6).'
    : 'Choosing a current-market plant to auction, or passing out of the phase (§6).';
}

/* ------------------------------------------------------------------ *
 * Nominating
 * ------------------------------------------------------------------ */

function NominatePanel({
  selectedPlantId,
  onSelectPlant,
}: AuctionPanelProps): JSX.Element {
  const { me, legal } = useMatch();
  const options = legal.nominatablePlants;
  const chosen = options.find((o) => o.plantId === selectedPlantId) ?? null;
  const [bid, setBid] = useState(0);

  useEffect(() => {
    if (chosen) setBid(chosen.minimumBid);
  }, [chosen?.plantId, chosen?.minimumBid, chosen]);

  const money = me?.money ?? 0;
  const uncontested = chosen?.uncontested === true;
  const maxBid = uncontested ? (chosen?.minimumBid ?? 0) : money;
  const canNominate = chosen !== null && chosen.affordable && bid >= chosen.minimumBid && bid <= money;

  const passBlock = legal.canPassNomination
    ? null
    : 'Every player must acquire a power plant during the first round.';

  return (
    <PhaseShell
      title="Your turn to choose"
      subtitle="Phase 2 · put a plant up for auction"
      tone="live"
      rules={AUCTION_RULES}
      actions={
        <Badge tone="accent" dot>
          Acting
        </Badge>
      }
      footer={
        <div className="pg-gactions">
          <Tooltip
            placement="top"
            title={passBlock ? 'Cannot pass' : 'Pass out of Phase 2'}
            rule="§6 Auction Power Plants"
            content={
              passBlock ??
              'Passing instead of nominating puts you out of the auction phase for the rest of this round — you cannot bid on anyone else’s plant afterwards.'
            }
          >
            <span className="pg-gactions__wrap">
              <Button
                variant="ghost"
                disabled={passBlock !== null}
                onClick={() => net.action({ type: 'passNomination' })}
              >
                Pass
              </Button>
            </span>
          </Tooltip>

          <Button
            variant="primary"
            disabled={!canNominate}
            onClick={() => {
              if (!chosen) return;
              net.action({ type: 'nominatePlant', plantId: chosen.plantId, bid });
              onSelectPlant(null);
            }}
          >
            {chosen ? `Open at ${bid}₤` : 'Select a plant'}
          </Button>
        </div>
      }
    >
      <p className="pg-gphase__lead">
        Choose one of the <strong>current market</strong> plants above and set your opening bid. Bidding
        then runs clockwise; the last bidder standing pays and takes the plant.
      </p>

      <div className="pg-gpicker">
        {options.map((option) => (
          <button
            key={option.plantId}
            type="button"
            className="pg-gpicker__opt"
            data-selected={option.plantId === selectedPlantId}
            disabled={!option.affordable}
            onClick={() => onSelectPlant(option.plantId)}
          >
            <span className="pg-gpicker__num pg-numeral">{option.plantId}</span>
            <span className="pg-gpicker__meta">
              {option.discounted ? <Badge tone="accent">discount 1₤</Badge> : null}
              <span className="pg-gpicker__min">
                min <b className="pg-numeral">{option.minimumBid}</b>₤
              </span>
            </span>
            {!option.affordable ? <span className="pg-gpicker__block">too expensive</span> : null}
          </button>
        ))}
      </div>

      {chosen ? (
        <motion.div
          className="pg-gbidbox"
          layout
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={springSoft}
        >
          <PlantCard plantId={chosen.plantId} size="md" discounted={chosen.discounted} />
          <div className="pg-gbidbox__ctrl">
            <span className="pg-overline">Opening bid</span>
            <NumberStepper
              label="Opening bid"
              value={bid}
              min={chosen.minimumBid}
              max={maxBid}
              onChange={setBid}
              unit="₤"
              disabled={uncontested}
            />
            <CostRow label="You would hold" amount={money - bid} tone="default" />
          </div>
        </motion.div>
      ) : null}

      {uncontested ? (
        <Callout tone="info" title="No one else can bid">
          You are the last eligible player, so this plant costs exactly its minimum bid of{' '}
          {chosen?.minimumBid}₤. <em>§6</em>
        </Callout>
      ) : null}

      <MyPlantLimit />
    </PhaseShell>
  );
}

/* ------------------------------------------------------------------ *
 * The auction floor
 * ------------------------------------------------------------------ */

interface LadderEntry {
  player: Player;
  lastBid: number | null;
  state: 'high' | 'in' | 'passed' | 'toAct';
}

function AuctionFloor(): JSX.Element {
  const { state, meId, legal, map } = useMatch();
  const auction = state.auction!;
  const bidding = legal.bidding;
  const me = meId ? state.players[meId] : null;
  const [amount, setAmount] = useState(auction.currentBid + 1);

  useEffect(() => {
    setAmount(auction.currentBid + 1);
  }, [auction.currentBid]);

  const history = useMemo(() => auctionHistory(state.log, auction.plantId), [state.log, auction.plantId]);

  const ladder: LadderEntry[] = state.playerOrder
    .map((id) => state.players[id])
    .filter((p): p is Player => p !== undefined && !p.isTrust)
    .filter((p) => !state.acquiredThisRound.includes(p.id) && !state.passedThisPhase.includes(p.id))
    .map((player) => {
      const still = auction.activeBidders.includes(player.id);
      const lastBid = history.bids.get(player.id) ?? null;
      const entryState: LadderEntry['state'] = !still
        ? 'passed'
        : auction.highBidderId === player.id
          ? 'high'
          : auction.currentBidderId === player.id
            ? 'toAct'
            : 'in';
      return { player, lastBid, state: entryState };
    });

  const canBid = bidding !== null && bidding.canRaise;

  return (
    <PhaseShell
      title="Auction in progress"
      subtitle={`Plant ${auction.plantId} under the hammer · ${map.name}`}
      tone="live"
      rules={AUCTION_RULES}
      actions={
        <Badge tone={bidding ? 'accent' : 'info'} dot>
          {bidding ? 'Your bid' : 'Bidding'}
        </Badge>
      }
      footer={
        bidding ? (
          <div className="pg-gactions">
            <Tooltip
              placement="top"
              title="Pass on this plant"
              rule="§6 Auction Power Plants"
              content="Passing a bid takes you out of this one auction only — you may still nominate a different plant later this phase, as long as you have not yet acquired one."
            >
              <span className="pg-gactions__wrap">
                <Button variant="ghost" onClick={() => net.action({ type: 'passBid' })}>
                  Pass
                </Button>
              </span>
            </Tooltip>
            <Tooltip
              placement="top"
              title={canBid ? `Raise to ${amount}₤` : 'You cannot raise'}
              rule="§6 Auction Power Plants"
              content={
                canBid
                  ? 'Each raise must beat the standing bid. The last bidder left pays their bid to the bank and takes the plant.'
                  : `The standing bid is ${bidding.currentBid}₤ and you hold ${me?.money ?? 0}₤, so you cannot raise.`
              }
            >
              <span className="pg-gactions__wrap">
                <Button
                  variant="primary"
                  disabled={!canBid}
                  onClick={() => net.action({ type: 'bid', amount })}
                >
                  Bid {amount}₤
                </Button>
              </span>
            </Tooltip>
          </div>
        ) : null
      }
    >
      <div className="pg-gfloor">
        <PlantCard plantId={auction.plantId} size="md" discounted={auction.discounted} />
        <div className="pg-gfloor__figures">
          <Stat label="Standing bid" value={<Money value={auction.currentBid} size="lg" />} />
          <Stat
            label="High bidder"
            value={
              auction.highBidderId ? (
                <span className="pg-gfloor__high">
                  {state.players[auction.highBidderId]?.name ?? 'unknown'}
                </span>
              ) : (
                '—'
              )
            }
          />
        </div>
      </div>

      {bidding ? (
        <div className="pg-gbidctrl">
          <NumberStepper
            label="Your bid"
            value={amount}
            min={bidding.minimumRaise}
            max={bidding.maximumBid}
            onChange={setAmount}
            unit="₤"
            disabled={!canBid}
          />
          <div className="pg-gbidctrl__quick">
            {[1, 2, 5].map((delta) => (
              <Button
                key={delta}
                size="sm"
                variant="secondary"
                disabled={!canBid || auction.currentBid + delta > bidding.maximumBid}
                onClick={() => setAmount(auction.currentBid + delta)}
              >
                +{delta}
              </Button>
            ))}
          </div>
          <CostRow label="Left if you win" amount={(me?.money ?? 0) - amount} tone="default" />
        </div>
      ) : null}

      <span className="pg-overline pg-gsectionlabel">Bid ladder</span>
      <div className="pg-gladder" role="list">
        <AnimatePresence initial={false}>
          {ladder.map((entry) => (
            <motion.div
              key={entry.player.id}
              className="pg-gladder__row"
              role="listitem"
              data-player-color={entry.player.color}
              data-state={entry.state}
              layout
              transition={springSnappy}
            >
              <Avatar name={entry.player.name} color={entry.player.color} size="sm" glow={entry.state === 'toAct'} />
              <span className="pg-gladder__name">
                {entry.player.name}
                {entry.player.id === auction.auctioneerId ? <em>auctioneer</em> : null}
              </span>
              <span className="pg-gladder__bid pg-numeral">
                {entry.lastBid !== null ? `${entry.lastBid}₤` : '—'}
              </span>
              <span className="pg-gladder__state">
                {entry.state === 'high'
                  ? 'leading'
                  : entry.state === 'toAct'
                    ? 'to act'
                    : entry.state === 'passed'
                      ? 'passed'
                      : 'in'}
              </span>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {history.lines.length > 0 ? (
        <div className="pg-ghistory">
          {history.lines.slice(-4).map((line, i) => (
            <span key={i} className="pg-ghistory__line">
              {line}
            </span>
          ))}
        </div>
      ) : null}
    </PhaseShell>
  );
}

function auctionHistory(
  log: readonly LogEntry[],
  plantId: number,
): { bids: Map<string, number>; lines: string[] } {
  const bids = new Map<string, number>();
  const lines: string[] = [];
  let start = -1;
  for (let i = log.length - 1; i >= 0; i--) {
    const entry = log[i]!;
    if (entry.data?.event === 'plantNominated' && entry.data.plantId === plantId) {
      start = i;
      break;
    }
  }
  if (start < 0) return { bids, lines };
  for (let i = start; i < log.length; i++) {
    const entry = log[i]!;
    const event = entry.data?.event;
    if (event === 'plantNominated' && typeof entry.playerId === 'string') {
      const bid = entry.data?.bid;
      if (typeof bid === 'number') bids.set(entry.playerId, bid);
      lines.push(entry.message);
    } else if (event === 'bidPlaced' && typeof entry.playerId === 'string') {
      const amount = entry.data?.amount;
      if (typeof amount === 'number') bids.set(entry.playerId, amount);
      lines.push(entry.message);
    } else if (event === 'bidPassed') {
      lines.push(entry.message);
    }
  }
  return { bids, lines };
}

/* ------------------------------------------------------------------ *
 * Scrapping the fourth plant (§6)
 * ------------------------------------------------------------------ */

function ScrapChooser(): JSX.Element {
  const { state, me, legal } = useMatch();
  const pending = state.pendingScrap!;
  const [choice, setChoice] = useState<number | null>(null);

  return (
    <PhaseShell
      title="Scrap a plant"
      subtitle={`You now own ${(me?.plants.length ?? 0)} — the limit is ${MAX_PLANTS_PER_PLAYER}`}
      tone="live"
      rules={AUCTION_RULES}
      actions={
        <Badge tone="warning" dot>
          Required
        </Badge>
      }
      footer={
        <div className="pg-gactions">
          <Button
            variant="danger"
            disabled={choice === null}
            onClick={() => {
              if (choice !== null) net.action({ type: 'scrapPlant', plantId: choice });
            }}
          >
            {choice !== null ? `Scrap plant ${choice}` : 'Choose a plant'}
          </Button>
        </div>
      }
    >
      <Callout tone="warning" title="The new plant cannot be scrapped">
        Plant {pending.newPlantId} was just acquired, so §6 forbids scrapping it. Resources move from the
        scrapped plant onto your remaining plants where they fit; anything that will not fit goes back to
        the supply, never to the market.
      </Callout>

      <div className="pg-gscrap">
        {(me?.plants ?? [])
          .slice()
          .sort((a, b) => a.plantId - b.plantId)
          .map((owned) => {
            const isNew = owned.plantId === pending.newPlantId;
            const allowed = legal.scrappablePlants.includes(owned.plantId);
            return (
              <PlantCard
                key={owned.plantId}
                plantId={owned.plantId}
                size="md"
                owned={owned}
                selected={choice === owned.plantId}
                onSelect={() => setChoice(owned.plantId)}
                disabledReason={
                  allowed
                    ? null
                    : isNew
                      ? 'The newly acquired plant cannot be scrapped.'
                      : 'You do not own that plant.'
                }
                disabledRule="§6 Plant ownership limit"
                badge={
                  isNew ? (
                    <span className="pg-gplant__flag" title="Just acquired">
                      NEW
                    </span>
                  ) : null
                }
              />
            );
          })}
      </div>

      {choice !== null ? (
        <Callout tone="danger" title={`Plant ${choice} leaves the game`}>
          It supplies {getPlant(choice).cities} cities. Scrapped plants are removed from the game entirely
          and never return to the market.
        </Callout>
      ) : null}
    </PhaseShell>
  );
}

/* ------------------------------------------------------------------ *
 * Ownership limit readout
 * ------------------------------------------------------------------ */

function MyPlantLimit(): JSX.Element | null {
  const { me, state, meId } = useMatch();
  if (!me) return null;
  const acquired = meId !== null && state.acquiredThisRound.includes(meId);
  const passed = meId !== null && state.passedThisPhase.includes(meId);

  return (
    <div className="pg-glimit">
      <span className="pg-overline">Your plants</span>
      <div className="pg-glimit__slots">
        {Array.from({ length: MAX_PLANTS_PER_PLAYER }, (_, i) => {
          const owned = me.plants.slice().sort((a, b) => a.plantId - b.plantId)[i];
          return owned ? (
            <PlantCard key={owned.plantId} plantId={owned.plantId} size="xs" owned={owned} />
          ) : (
            <span key={`empty-${i}`} className="pg-glimit__empty" aria-hidden="true" />
          );
        })}
      </div>
      {acquired ? (
        <Badge tone="success" dot>
          Bought this round — you cannot bid again (§6)
        </Badge>
      ) : passed ? (
        <Badge tone="warning" dot>
          Passed — out of this auction phase (§6)
        </Badge>
      ) : null}
    </div>
  );
}
