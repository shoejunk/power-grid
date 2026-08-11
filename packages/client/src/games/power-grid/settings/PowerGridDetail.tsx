import { Panel } from '@tt/ui';

import { MAP_PRESENTATION, MapThumbnail } from '../data/maps';
import { PHASES } from '../data/rules';

/**
 * The "what is this game" panels on `/g/power-grid`.
 *
 * The portal shell already renders the descriptor — name, tagline, blurb, seat
 * range, play time — because it has those for every title. This is the layer
 * underneath it: the things only Power Grid can say about itself, and the
 * reason a player picks this card over the other one.
 */
export function PowerGridDetail(): JSX.Element {
  return (
    <>
      <Panel tone="glass" title="The round" subtitle="Five phases, in strict order" ticks>
        <ol className="pg-phaselist">
          {PHASES.map((phase) => (
            <li key={phase.key} className="pg-phaselist__item">
              <span className="pg-phaselist__index tt-numeral">
                {String(phase.index).padStart(2, '0')}
              </span>
              <span className="pg-phaselist__body">
                <span className="pg-phaselist__name">{phase.name}</span>
                <span className="pg-phaselist__summary">{phase.summary}</span>
              </span>
            </li>
          ))}
        </ol>
      </Panel>

      <Panel tone="glass" title="Maps" subtitle="42 cities across 6 areas">
        <div className="pg-menu__maps">
          {Object.values(MAP_PRESENTATION).map((map) => {
            /* The USA board is implemented and tested in the rules engine but
               its art is not finished, so it is shown as forthcoming rather
               than hidden — players can see what is coming. */
            const available = map.id === 'germany';
            return (
              <div key={map.id} className="pg-menu__map" data-unavailable={!available}>
                {/* Fixed letterbox rather than the map's own aspect ratio: a
                    portrait Germany next to a landscape USA would make the two
                    rows different heights and break the list rhythm. */}
                <div className="pg-menu__mapart">
                  <MapThumbnail mapId={map.id} />
                </div>
                <div>
                  <div className="pg-menu__map-name">{map.name}</div>
                  <div className="pg-menu__map-meta">
                    {map.cityCount} cities &middot; {map.areaCount} areas
                  </div>
                  <div className="pg-menu__map-rule">
                    {available ? map.specialRules[0]?.title : 'Coming soon'}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </Panel>

      <Panel tone="glass" title="Variants" subtitle="Ship-ready optional rules">
        <ul className="pg-menu__variants">
          <li>
            <span className="pg-menu__variant-name">Experienced start</span>
            <span className="pg-menu__variant-note">
              Mark shared starting cities before anyone builds.
            </span>
          </li>
          {/* Implemented and tested in the rules engine; its faction UI is not
              finished, so it is listed as forthcoming rather than hidden. */}
          <li data-unavailable="true">
            <span className="pg-menu__variant-name">Against the Trust</span>
            <span className="pg-menu__variant-note">
              Two-player mode with an automated blocking faction. Coming soon.
            </span>
          </li>
        </ul>
      </Panel>
    </>
  );
}
