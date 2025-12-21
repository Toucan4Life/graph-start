"use strict";

type Solution = number[];

// Bitmask helpers for color domains (four colors -> bits 0..3)
const ALL_COLORS_MASK = 0b1111;
function bitCount(x: number): number {
  // count set bits in 4-bit number
  x = x & ALL_COLORS_MASK;
  let c = 0;
  while (x) {
    x &= x - 1;
    c++;
  }
  return c;
}
function forEachColor(mask: number, fn: (color: number) => void) {
  for (let c = 0; c < 4; c++) {
    if (mask & (1 << c)) fn(c);
  }
}

/**
 * DSATUR + MRV backtracking 4-coloring.
 * - Returns a single solution if stopAtOne is true.
 * - Enumerates all solutions otherwise.
 */
function gen4col(
  vertices: number[][],
  stopAtOne: boolean
): Solution[] | Solution {
  const n = vertices.length;
  const neighbors = vertices;
  const colors = new Array<number>(n).fill(-1);
  const domains = new Array<number>(n).fill(ALL_COLORS_MASK);
  const degrees = neighbors.map((ns) => ns.length);

  const solutions: Solution[] = [];

  // Select next vertex by MRV (fewest domain choices), then by saturation degree, then by degree
  function pickNextVertex(): number {
    let best = -1;
    let bestDomainSize = Infinity;
    let bestSaturation = -1;
    let bestDegree = -1;

    for (let i = 0; i < n; i++) {
      if (colors[i] !== -1) continue;
      const domainSize = bitCount(domains[i]);
      if (domainSize === 0) continue; // dead vertex; will prune soon

      // compute saturation: distinct neighbor colors
      let satMask = 0;
      for (const nb of neighbors[i]) {
        const c = colors[nb];
        if (c !== -1) satMask |= 1 << c;
      }
      const sat = bitCount(satMask);

      if (
        domainSize < bestDomainSize ||
        (domainSize === bestDomainSize &&
          (sat > bestSaturation ||
            (sat === bestSaturation && degrees[i] > bestDegree)))
      ) {
        best = i;
        bestDomainSize = domainSize;
        bestSaturation = sat;
        bestDegree = degrees[i];
      }
    }
    return best;
  }

  type Change = { v: number; prevDomain: number };

  function search(): boolean {
    // check completion
    let uncoloredLeft = 0;
    for (let i = 0; i < n; i++) if (colors[i] === -1) uncoloredLeft++;
    if (uncoloredLeft === 0) {
      solutions.push(colors.slice());
      return stopAtOne ? true : false; // true -> stop propagation
    }

    const v = pickNextVertex();
    if (v === -1) return false; // no valid next vertex

    const allowed = domains[v];
    if (allowed === 0) return false;

    // Try each allowed color
    let foundOne = false;
    forEachColor(allowed, (color) => {
      if (foundOne && stopAtOne) return; // skip more if we already found one and only need one

      const changes: Change[] = [];
      const prevDomainV = domains[v];
      colors[v] = color;
      domains[v] = 1 << color;

      let prune = false;
      for (const nb of neighbors[v]) {
        if (colors[nb] !== -1) continue;
        const prev = domains[nb];
        if (prev & (1 << color)) {
          const next = prev & ~(1 << color);
          domains[nb] = next;
          changes.push({ v: nb, prevDomain: prev });
          if (next === 0) {
            prune = true;
            break;
          }
        }
      }

      if (!prune) {
        const stop = search();
        if (stop) {
          foundOne = true;
        }
      }

      // undo
      colors[v] = -1;
      domains[v] = prevDomainV;
      for (let i = changes.length - 1; i >= 0; i--) {
        const { v: u, prevDomain } = changes[i];
        domains[u] = prevDomain;
      }
    });

    return foundOne && stopAtOne;
  }

  const stop = search();
  if (stop && solutions.length) return solutions[0];
  return solutions;
}

export { gen4col, Solution };
