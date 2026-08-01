import { useMemo, useState } from 'react';
import type { AreaId } from '@pg/shared';
import { ZONE_AREA_COUNT, isZoneContiguous } from '@pg/shared';

import { net } from '../../net';
import { Badge, Button, Tooltip } from '../../ui';
import { plural } from '../format';
import { useMatch } from '../model';
import { Callout, PhaseShell, Stat, Waiting, type RuleLine } from './shell';

const SETUP_RULES: readonly RuleLine[] = [
  { text: 'Every map has 6 areas of 7 cities; only a contiguous subset is in play.', rule: '§1' },
  { text: 'The zone size is fixed by player count: 3 areas for 2–3, 4 for 4, 5 for 5–6.', rule: '§1' },
  { text: 'Nothing outside the zone may be used all game — not even as a route through.', rule: '§1, §14' },
  { text: 'Reserved starting cities cannot be connected by anyone else during Step 1.', rule: '§2' },
];

export function SetupPanel(): JSX.Element {
  const { state, legal } = useMatch();

  if (legal.zoneRequired) return <ZonePicker />;
  if (legal.startCityChoices.length > 0) return <StartCityPicker />;

  return (
    <PhaseShell title="Setup" subtitle={`§2 · ${state.setupStage}`} rules={SETUP_RULES}>
      <Waiting note="Setup is being resolved. The round begins as soon as the zone and starting cities are set." />
    </PhaseShell>
  );
}

/* ------------------------------------------------------------------ *
 * Playing zone (§1, §2)
 * ------------------------------------------------------------------ */

function ZonePicker(): JSX.Element {
  const { state, map } = useMatch();
  const required = ZONE_AREA_COUNT[state.settings.playerCount] ?? 3;
  const [picked, setPicked] = useState<AreaId[]>([]);

  const contiguous = useMemo(
    () => picked.length !== required || isZoneContiguous(map, picked),
    [map, picked, required],
  );
  const complete = picked.length === required && contiguous;

  const cityCount = map.cities.filter((c) => picked.includes(c.area)).length;

  const toggle = (id: AreaId): void =>
    setPicked((current) =>
      current.includes(id)
        ? current.filter((a) => a !== id)
        : current.length >= required
          ? current
          : [...current, id],
    );

  return (
    <PhaseShell
      title="Choose the playing zone"
      subtitle={`${required} contiguous ${plural(required, 'area')} on ${map.name}`}
      tone="live"
      rules={SETUP_RULES}
      actions={
        <Badge tone="accent" dot>
          Host
        </Badge>
      }
      footer={
        <div className="pg-gactions">
          <Tooltip
            placement="top"
            title="Random zone"
            rule="§1 Board and map data"
            content="Grows a contiguous zone of the required size from the recorded seed, so the setup stays replayable."
          >
            <span className="pg-gactions__wrap">
              <Button variant="ghost" onClick={() => net.action({ type: 'selectZone', areas: [] })}>
                Choose for me
              </Button>
            </span>
          </Tooltip>
          <Tooltip
            placement="top"
            title={complete ? 'Start the game' : 'Zone incomplete'}
            rule="§1 Board and map data"
            content={
              complete
                ? `${cityCount} cities will be in play for the whole game.`
                : !contiguous
                  ? 'The chosen areas must touch each other — a zone has to be contiguous.'
                  : `Pick exactly ${required} areas; ${picked.length} chosen.`
            }
          >
            <span className="pg-gactions__wrap">
              <Button
                variant="primary"
                disabled={!complete}
                onClick={() => net.action({ type: 'selectZone', areas: picked })}
              >
                Confirm zone
              </Button>
            </span>
          </Tooltip>
        </div>
      }
    >
      <div className="pg-gsummary">
        <Stat label="Areas" value={<span className="pg-numeral">{`${picked.length}/${required}`}</span>} />
        <Stat label="Cities in play" value={<span className="pg-numeral">{cityCount}</span>} />
        <Stat label="Players" value={<span className="pg-numeral">{state.settings.playerCount}</span>} />
      </div>

      <div className="pg-gareas">
        {map.areas.map((area) => {
          const selected = picked.includes(area.id);
          const full = !selected && picked.length >= required;
          return (
            <button
              key={area.id}
              type="button"
              className="pg-garea"
              data-selected={selected}
              disabled={full}
              style={{ ['--pg-area' as string]: area.color }}
              onClick={() => toggle(area.id)}
            >
              <span className="pg-garea__swatch" aria-hidden="true" />
              <span className="pg-garea__name">{area.name}</span>
              <span className="pg-garea__count pg-caption">
                {map.cities.filter((c) => c.area === area.id).length} cities
              </span>
            </button>
          );
        })}
      </div>

      {!contiguous ? (
        <Callout tone="danger" title="Not contiguous">
          §1 requires the playing zone to be a run of touching areas. Swap one out until they connect.
        </Callout>
      ) : null}
    </PhaseShell>
  );
}

/* ------------------------------------------------------------------ *
 * Experienced-player starting cities (§2)
 * ------------------------------------------------------------------ */

function StartCityPicker(): JSX.Element {
  const { legal, cityIndex, map } = useMatch();
  const [choice, setChoice] = useState<string | null>(null);

  return (
    <PhaseShell
      title="Reserve your starting city"
      subtitle="§2 · experienced-player setup"
      tone="live"
      rules={SETUP_RULES}
      actions={
        <Badge tone="accent" dot>
          Your pick
        </Badge>
      }
      footer={
        <div className="pg-gactions">
          <Button
            variant="primary"
            disabled={choice === null}
            onClick={() => {
              if (choice) net.action({ type: 'markStartCity', cityId: choice });
            }}
          >
            {choice ? `Reserve ${cityIndex.get(choice)?.name ?? choice}` : 'Pick a city'}
          </Button>
        </div>
      }
    >
      <p className="pg-gphase__lead">
        Your network must begin here. Until you build, no one else may connect it during Step 1.
      </p>
      <div className="pg-gcitylist" role="listbox" aria-label="Starting city">
        {legal.startCityChoices.map((id) => {
          const city = cityIndex.get(id);
          const area = city ? map.areas.find((a) => a.id === city.area) : undefined;
          return (
            <button
              key={id}
              type="button"
              role="option"
              aria-selected={choice === id}
              className="pg-gcitylist__item"
              data-selected={choice === id}
              onClick={() => setChoice(id)}
            >
              <span>{city?.name ?? id}</span>
              <em>{area?.name ?? ''}</em>
            </button>
          );
        })}
      </div>
    </PhaseShell>
  );
}
