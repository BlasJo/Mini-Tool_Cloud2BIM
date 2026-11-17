// Synthetische Punktwolke: Rechteck-Durchlass (innen 4 x 3 m) mit Voute, entlang einer Achse.
export function rng(seed = 7) { let s = seed; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
export function culvertProfile(w = 4, h = 3, ch = 0.3) {
  // innen, CCW (u rechts, v hoch), Unterkante v = 500
  const z0 = 500, hw = w / 2;
  return [[-hw, z0], [hw, z0], [hw, z0 + h - ch], [hw - ch, z0 + h], [-hw + ch, z0 + h], [-hw, z0 + h - ch]];
}
export function sampleProfile(V, spacing, noise, r) {
  const out = [];
  for (let i = 0; i < V.length; i++) {
    const a = V[i], b = V[(i + 1) % V.length];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = Math.max(2, Math.round(L / spacing));
    for (let k = 0; k < n; k++) {
      const t = k / n;
      out.push([a[0] + t * (b[0] - a[0]) + (r() - .5) * 2 * noise, a[1] + t * (b[1] - a[1]) + (r() - .5) * 2 * noise]);
    }
  }
  return out;
}
