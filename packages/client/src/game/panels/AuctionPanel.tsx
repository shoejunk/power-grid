import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { MAX_PLANTS_PER_PLAYER, getPlant } from '@pg/shared';

import { net } from '../../net';
import { springSoft } from '../../styles/motion';
import { Avatar, Badge, Button, NumberStepper, Tooltip } from '../../ui';
import { fuelText } from '../format';
import { useMatch } from '../model';
import { PlantCard } from '../parts/PlantCard';
import { Callout, CostRow, PhaseShell, Stat, Waiting, type RuleLine } from './shell';

const AUCTION_RULES: readonly RuleLine[] = [
  { text: 'Each player may acquire at most one plant per round; in round 1 every player must.', rule: '§6' },
  { text: 'Only the four current-market plants may be auctioned — never a future-market plant.', rule: '§6, §14' },
  { text: 'Each eligible player simultaneously passes or submits a secret minimum and maximum bid.', rule: '§6' },
  { text: 'After all decisions arrive, bidding is simulated clockwise without exceeding anyone’s maximum.', rule: '§6' },
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

function NominatePanel({ selectedPlantId, onSelectPlant }: AuctionPanelProps): JSX.Element {
  const { me, legal } = useMatch();
  const money = me?.money ?? 0;
  const options = legal.nominatablePlants;
  const chosen = options.find((o) => o.plantId === selectedPlantId) ?? null;
  const [minBid, setMinBid] = useState(0);
  const [maxBid, setMaxBid] = useState(0);

  useEffect(() => {
    if (chosen) {
      setMinBid(chosen.minimumBid);
      setMaxBid(chosen.minimumBid);
    }
  }, [chosen?.plantId, chosen?.minimumBid, chosen]);

  const uncontested = chosen?.uncontested === true;
  const allowedMaximum = uncontested ? (chosen?.minimumBid ?? 0) : money;
  const canNominate =
    chosen !== null &&
    chosen.affordable &&
    minBid >= chosen.minimumBid &&
    maxBid >= minBid &&
    maxBid <= money;

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
              net.action({ type: 'nominatePlant', plantId: chosen.plantId, bid: minBid, maxBid });
              onSelectPlant(null);
            }}
          >
            {chosen ? 'Submit sealed range' : 'Select a plant'}
          </Button>
        </div>
      }
    >
      <p className="pg-gphase__lead">
        Choose one of the <strong>current market</strong> plants and privately set the first amount
        you are willing to bid and your ceiling. Everyone answers at once; the server then simulates
        the normal clockwise auction immediately.
      </p>

      <div className="pg-gpicker">
        {options.map((option) => (
          <Tooltip
            key={option.plantId}
            placement="left"
            title={`Plant ${option.plantId}`}
            rule={option.affordable ? '§6 Auction Power Plants' : '§6, §14 Legal-action validation'}
            content={
              option.affordable
                ? option.discounted
                  ? 'The discount token is on this plant, so it opens at 1₤ instead of its printed number.'
                  : `Opens at its printed number, ${option.minimumBid}₤. Raising is up to the other bidders.`
                : `The minimum bid is ${option.minimumBid}₤ and you hold ${money}₤, so you cannot open this auction.`
            }
          >
            {/*
             * A wrapper, not the control itself: a disabled <button> receives no
             * pointer events in Chrome, and the rule behind the block has to stay
             * reachable by hover and by keyboard (quality bar U2).
             */}
            <span className="pg-gpicker__slot" tabIndex={option.affordable ? -1 : 0}>
              <button
                type="button"
                className="pg-gpicker__opt"
                data-selected={option.plantId === selectedPlantId}
                disabled={!option.affordable}
                onClick={() => onSelectPlant(option.plantId)}
              >
                <span className="pg-gpicker__num pg-numeral">{option.plantId}</span>
                {/*
                 * What the plant actually DOES. This chooser used to show only
                 * the number and the minimum bid ("6 / min 6₤") — the fuel it
                 * burns and the cities it powers were nowhere on the one
                 * screen where the player is deciding between plants, so they
                 * had to hover each option to compare them.
                 */}
                <span className="pg-gpicker__spec">
                  {fuelText(getPlant(option.plantId))}
                  <span className="pg-gpicker__arrow" aria-hidden="true">
                    ▸
                  </span>
                  <b className="pg-numeral">{getPlant(option.plantId).cities}</b>
                  <span className="pg-gpicker__unit">
                    {getPlant(option.plantId).cities === 1 ? 'city' : 'cities'}
                  </span>
                </span>
                <span className="pg-gpicker__meta">
                  {option.discounted ? <Badge tone="accent">discount 1₤</Badge> : null}
                  <span className="pg-gpicker__min">
                    min <b className="pg-numeral">{option.minimumBid}</b>₤
                  </span>
                </span>
                {!option.affordable ? (
                  <span className="pg-gpicker__block">too expensive</span>
                ) : null}
              </button>
            </span>
          </Tooltip>
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
            <span className="pg-overline">Your sealed bid range</span>
            <NumberStepper
              label="Minimum bid"
              value={minBid}
              min={chosen.minimumBid}
              max={allowedMaximum}
              onChange={(value) => {
                setMinBid(value);
                if (maxBid < value) setMaxBid(value);
              }}
              unit="₤"
              disabled={uncontested}
            />
            <NumberStepper
              label="Maximum bid"
              value={maxBid}
              min={minBid}
              max={allowedMaximum}
              onChange={setMaxBid}
              unit="₤"
              disabled={uncontested}
            />
            <CostRow label="Left at your ceiling" amount={money - maxBid} tone="default" />
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

function AuctionFloor(): JSX.Element {
  const { state, meId, legal, map } = useMatch();
  const auction = state.auction!;
  const bidding = legal.bidding;
  const me = meId ? state.players[meId] : null;
  const floor = bidding?.minimumRaise ?? 0;
  const [minBid, setMinBid] = useState(floor);
  const [maxBid, setMaxBid] = useState(floor);

  useEffect(() => {
    setMinBid(floor);
    setMaxBid(floor);
  }, [auction.plantId, floor]);

  const canSubmit =
    bidding !== null &&
    bidding.canRaise &&
    minBid >= bidding.minimumRaise &&
    maxBid >= minBid &&
    maxBid <= bidding.maximumBid;
  const submittedCount = auction.eligibleBidders.filter(
    (id) => auction.commitments[id] !== undefined,
  ).length;

  return (
    <PhaseShell
      title="Sealed bids"
      subtitle={`Plant ${auction.plantId} · ${map.name}`}
      tone="live"
      rules={AUCTION_RULES}
      actions={
        <Badge tone={bidding ? 'accent' : 'info'} dot>
          {bidding ? 'Your decision' : `${submittedCount}/${auction.eligibleBidders.length} submitted`}
        </Badge>
      }
      footer={
        bidding ? (
          <div className="pg-gactions">
            <Tooltip
              placement="top"
              title="Pass on this plant"
              rule="§6 Auction Power Plants"
              content="This sealed decision takes you out of this auction only. You may still nominate later if you have not acquired a plant."
            >
              <span className="pg-gactions__wrap">
                <Button variant="ghost" onClick={() => net.action({ type: 'passBid' })}>
                  Pass
                </Button>
              </span>
            </Tooltip>
            <Tooltip
              placement="top"
              title={canSubmit ? `Bid from ${minBid}₤ to ${maxBid}₤` : 'Choose a valid range'}
              rule="§6 Auction Power Plants"
              content={
                canSubmit
                  ? 'Your range stays hidden. The server will bid clockwise on your behalf, starting at your minimum and never exceeding your maximum.'
                  : `The plant starts at ${bidding.minimumRaise}₤ and you hold ${me?.money ?? 0}₤.`
              }
            >
              <span className="pg-gactions__wrap">
                <Button
                  variant="primary"
                  disabled={!canSubmit}
                  onClick={() => net.action({ type: 'submitBidRange', minBid, maxBid })}
                >
                  Submit sealed bid
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
          <Stat label="Plant minimum" value={`${bidding?.minimumRaise ?? auction.currentBid + 1}₤`} />
          <Stat label="Decisions received" value={`${submittedCount}/${auction.eligibleBidders.length}`} />
        </div>
      </div>

      {bidding ? (
        <div className="pg-gbidctrl">
          <NumberStepper
            label="Minimum bid"
            value={minBid}
            min={bidding.minimumRaise}
            max={bidding.maximumBid}
            onChange={(value) => {
              setMinBid(value);
              if (maxBid < value) setMaxBid(value);
            }}
            unit="₤"
            disabled={!bidding.canRaise}
          />
          <NumberStepper
            label="Maximum bid"
            value={maxBid}
            min={minBid}
            max={bidding.maximumBid}
            onChange={setMaxBid}
            unit="₤"
            disabled={!bidding.canRaise}
          />
          <CostRow label="Left at your ceiling" amount={(me?.money ?? 0) - maxBid} tone="default" />
        </div>
      ) : (
        <Callout tone="info" title="Your decision is sealed">
          Waiting for the remaining eligible players. The auction resolves as soon as everyone has
          submitted a bid range or passed.
        </Callout>
      )}

      <span className="pg-overline pg-gsectionlabel">Responses</span>
      <div className="pg-gladder" role="list">
        {auction.eligibleBidders.map((id) => {
          const player = state.players[id]!;
          const commitment = auction.commitments[id];
          const mine = id === meId && commitment?.status === 'bid' ? commitment : null;
          return (
            <div
              key={id}
              className="pg-gladder__row"
              role="listitem"
              data-player-color={player.color}
              data-state={commitment ? 'in' : 'toAct'}
            >
              <Avatar name={player.name} color={player.color} size="sm" glow={!commitment} />
              <span className="pg-gladder__name">
                {player.name}
                {id === auction.auctioneerId ? <em>auctioneer</em> : null}
              </span>
              <span className="pg-gladder__bid pg-numeral">
                {mine ? `${mine.minBid}–${mine.maxBid}₤` : 'sealed'}
              </span>
              <span className="pg-gladder__state">{commitment ? 'submitted' : 'deciding'}</span>
            </div>
          );
        })}
      </div>
    </PhaseShell>
  );
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
