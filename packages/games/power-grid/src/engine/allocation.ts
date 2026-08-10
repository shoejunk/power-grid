/**
 * Resource ↔ plant assignment feasibility.
 *
 * Two rules make this a bipartite matching problem rather than simple
 * arithmetic (§1, §7):
 *
 *  - "A hybrid plant accepts coal and/or oil in any combination that totals its
 *    fuel requirement. Its storage limit is twice the requirement across both
 *    resource types, not twice per type."
 *  - "A player may rearrange stored tokens among compatible plants at any time,
 *    as long as all resulting storage limits are respected."
 *
 * So a purchase is legal iff the player's *entire* pool of tokens can be laid
 * out across their plants, and a plant set can be operated iff every plant in
 * it can be saturated from the shared pool. Both are max-flow questions on a
 * tiny graph (4 resource types × ≤3 plants), solved exactly with Edmonds–Karp.
 */

import type { ResourceBundle, ResourceType } from '../types.js';
import { RESOURCE_TYPES, emptyResources } from '../types.js';

export interface PlantSlot {
  /** Accepted resource types; empty means ecological (accepts nothing). */
  accepts: ResourceType[];
  /** Upper bound of tokens this slot may receive. */
  cap: number;
}

export interface AssignResult {
  /** Total tokens placed. */
  flow: number;
  /** alloc[slotIndex][typeIndex] — tokens of that type on that plant. */
  alloc: number[][];
}

/** Maximum number of pool tokens that can be laid out over `slots`. */
export function maxFlowAssign(pool: ResourceBundle, slots: readonly PlantSlot[]): AssignResult {
  const T = RESOURCE_TYPES.length; // 4
  const S = slots.length;
  const n = 1 + T + S + 1;
  const src = 0;
  const sink = n - 1;
  const typeNode = (t: number) => 1 + t;
  const slotNode = (s: number) => 1 + T + s;

  const cap: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let t = 0; t < T; t++) {
    cap[src]![typeNode(t)] = pool[RESOURCE_TYPES[t]!] ?? 0;
  }
  for (let s = 0; s < S; s++) {
    const slot = slots[s]!;
    for (let t = 0; t < T; t++) {
      if (slot.accepts.includes(RESOURCE_TYPES[t]!)) {
        cap[typeNode(t)]![slotNode(s)] = slot.cap;
      }
    }
    cap[slotNode(s)]![sink] = slot.cap;
  }

  let flow = 0;
  for (;;) {
    // BFS for an augmenting path (deterministic: nodes scanned in index order).
    const prev = new Array<number>(n).fill(-1);
    prev[src] = src;
    const queue = [src];
    while (queue.length > 0 && prev[sink] === -1) {
      const u = queue.shift()!;
      for (let v = 0; v < n; v++) {
        if (prev[v] === -1 && cap[u]![v]! > 0) {
          prev[v] = u;
          queue.push(v);
        }
      }
    }
    if (prev[sink] === -1) break;
    let bottleneck = Infinity;
    for (let v = sink; v !== src; v = prev[v]!) {
      bottleneck = Math.min(bottleneck, cap[prev[v]!]![v]!);
    }
    for (let v = sink; v !== src; v = prev[v]!) {
      const u = prev[v]!;
      cap[u]![v]! -= bottleneck;
      cap[v]![u]! += bottleneck;
    }
    flow += bottleneck;
  }

  const alloc: number[][] = Array.from({ length: S }, () => new Array<number>(T).fill(0));
  for (let s = 0; s < S; s++) {
    for (let t = 0; t < T; t++) {
      if (slots[s]!.accepts.includes(RESOURCE_TYPES[t]!)) {
        // residual on the reverse edge = flow pushed forward
        alloc[s]![t] = cap[slotNode(s)]![typeNode(t)]!;
      }
    }
  }
  return { flow, alloc };
}

export function bundleTotal(b: ResourceBundle): number {
  return RESOURCE_TYPES.reduce((sum, t) => sum + (b[t] ?? 0), 0);
}

export function addBundle(a: ResourceBundle, b: ResourceBundle): ResourceBundle {
  const out = emptyResources();
  for (const t of RESOURCE_TYPES) out[t] = (a[t] ?? 0) + (b[t] ?? 0);
  return out;
}

/** Converts an alloc matrix row into a `ResourceBundle`. */
export function rowToBundle(row: readonly number[]): ResourceBundle {
  const out = emptyResources();
  RESOURCE_TYPES.forEach((t, i) => {
    out[t] = row[i] ?? 0;
  });
  return out;
}

/** True when every token in `pool` fits on `slots` simultaneously. §1, §7. */
export function poolFits(pool: ResourceBundle, slots: readonly PlantSlot[]): boolean {
  const total = bundleTotal(pool);
  if (total === 0) return true;
  return maxFlowAssign(pool, slots).flow === total;
}

/** True when every slot can be filled to its cap from `pool` (exact operation). §9.1. */
export function slotsSaturated(pool: ResourceBundle, slots: readonly PlantSlot[]): boolean {
  const need = slots.reduce((s, x) => s + x.cap, 0);
  if (need === 0) return true;
  return maxFlowAssign(pool, slots).flow === need;
}
