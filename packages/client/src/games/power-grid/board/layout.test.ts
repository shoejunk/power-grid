import { GERMANY_MAP } from '@game/power-grid';
import { describe, expect, it } from 'vitest';

import { frameAt } from './geometry';
import { buildLayout } from './layout';

// 704×408 is the preview's real 1280-wide match cell; the board intentionally
// solves it on a 1.45× detail canvas before presenting the centered view.
const MATCH_DETAIL = { width: 1021, height: 592 };

describe('board connection layout', () => {
  it('routes terminate at the separated city nodes players can see', () => {
    const layout = buildLayout(GERMANY_MAP, MATCH_DETAIL.width, MATCH_DETAIL.height);

    expect(layout.routes).toHaveLength(GERMANY_MAP.connections.length);
    for (const route of layout.routes) {
      const from = layout.nodeById.get(route.a);
      const to = layout.nodeById.get(route.b);
      const start = route.path.points[0];
      const end = route.path.points.at(-1);

      expect(from).toBeDefined();
      expect(to).toBeDefined();
      expect(start).toEqual(from?.plate);
      expect(end).toEqual(to?.plate);
      expect(from?.anchor).toEqual(from?.plate);
      expect(to?.anchor).toEqual(to?.plate);
    }

    const duisburg = layout.nodeById.get('duisburg');
    const essen = layout.nodeById.get('essen');
    expect(duisburg).toBeDefined();
    expect(essen).toBeDefined();
    const ruhrGap =
      essen!.plate.x - essen!.w / 2 - (duisburg!.plate.x + duisburg!.w / 2);
    expect(ruhrGap).toBeGreaterThanOrEqual(layout.metrics.badgeH * 0.5);
  });

  it('keeps every Germany cost badge and city label collision-free', () => {
    const layout = buildLayout(GERMANY_MAP, MATCH_DETAIL.width, MATCH_DETAIL.height);

    expect(layout.badgeCollisions).toBe(0);
    expect(layout.collisions).toEqual({
      badgeBadge: 0,
      badgeName: 0,
      nameName: 0,
      badgeOutzone: 0,
      nameOutzone: 0,
      total: 0,
    });
  });

  it('points every displaced cost leader to the midpoint of its road', () => {
    const layout = buildLayout(GERMANY_MAP, MATCH_DETAIL.width, MATCH_DETAIL.height);
    const leaders = layout.routes.filter((route) => route.badge.leader);

    expect(leaders.length).toBeGreaterThan(0);
    for (const route of leaders) {
      expect(route.badge.anchor).toEqual(frameAt(route.path, 0.5).point);
    }

    for (const id of ['duesseldorf|essen', 'dortmund|essen', 'duesseldorf|koeln']) {
      const route = layout.routeByPair.get(id);
      expect(route).toBeDefined();
      expect(route?.badge.anchor).toEqual(frameAt(route!.path, 0.5).point);
    }
  });
});
