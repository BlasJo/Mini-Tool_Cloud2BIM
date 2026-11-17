/* ═══ Cloud2BIM Kern: Kreisbögen in Profilen ═══
   Ein Teilprofil kann zu jeder Kante i (Ecke i → Ecke i+1) einen Bogenpunkt mids[i] = [u,v]
   haben (Punkt auf dem Bogen, etwa in der Mitte): Bogen durch Anfang, Bogenpunkt und Ende.
   Für alle Berechnungen (Abweichung, Bauteile, Loft, Drahtmodell, IFC) wird das Profil mit
   einer festen Segmentzahl je Bogen in eine Polylinie aufgelöst («expand»), damit benachbarte
   Querschnitte gleich viele Punkte haben. */
C2B.arc = (() => {
  const g2 = C2B.g2;
  const SEG = 48;   // Segmente je Bogen (Sehnenfehler r = 2 m, Halbkreis: ~1 mm)

  /** Kreis durch a, m, b: { c, r, t0, sweep } (sweep vorzeichenbehaftet, über m) oder null. */
  function param(a, m, b) {
    const ax = a[0], ay = a[1], bx = b[0], by = b[1], mx = m[0], my = m[1];
    const d = 2 * (ax * (my - by) + mx * (by - ay) + bx * (ay - my));
    if (Math.abs(d) < 1e-12) return null;
    const a2 = ax * ax + ay * ay, m2 = mx * mx + my * my, b2 = bx * bx + by * by;
    const cx = (a2 * (my - by) + m2 * (by - ay) + b2 * (ay - my)) / d;
    const cy = (a2 * (bx - mx) + m2 * (ax - bx) + b2 * (mx - ax)) / d;
    const r = Math.hypot(ax - cx, ay - cy);
    if (r > 1e5) return null;
    const ta = Math.atan2(ay - cy, ax - cx), tm = Math.atan2(my - cy, mx - cx), tb = Math.atan2(by - cy, bx - cx);
    const norm = x => { while (x < 0) x += 2 * Math.PI; while (x >= 2 * Math.PI) x -= 2 * Math.PI; return x; };
    const ccwB = norm(tb - ta), ccwM = norm(tm - ta);
    const sweep = ccwM <= ccwB ? ccwB : ccwB - 2 * Math.PI;   // Richtung so, dass m auf dem Bogen liegt
    return { c: [cx, cy], r, t0: ta, sweep };
  }

  const point = (p, f) => [p.c[0] + p.r * Math.cos(p.t0 + f * p.sweep), p.c[1] + p.r * Math.sin(p.t0 + f * p.sweep)];

  /** Zwischenpunkte des Bogens (ohne a und b). */
  function points(a, m, b, nSeg = SEG) {
    const p = param(a, m, b);
    if (!p) return [];
    const out = [];
    for (let k = 1; k < nSeg; k++) out.push(point(p, k / nSeg));
    return out;
  }

  const hasArcs = P => !!(P.mids && P.mids.some(Boolean));

  /** mids-Liste auf die Eckenzahl abgleichen. */
  function sync(P) {
    if (!P.mids) return P;
    const n = P.vertices.length;
    if (P.mids.length > n) P.mids.length = n;
    while (P.mids.length < n) P.mids.push(null);
    const ne = g2.edgeCount(n, P.closed);
    for (let i = ne; i < n; i++) P.mids[i] = null;
    if (!P.mids.some(Boolean)) delete P.mids;
    return P;
  }

  /**
   * Profil mit aufgelösten Bögen. Liefert { vertices, closed, components (Ecken neu nummeriert),
   * edgeMap (aufgelöste Kante -> ursprüngliche Kante), vMap (ursprüngliche Ecke -> neue Ecke) }.
   */
  function expand(P, nSeg = SEG) {
    const V = P.vertices, n = V.length, closed = !!P.closed && n >= 3;
    if (!hasArcs(P)) {
      const ne = g2.edgeCount(n, closed);
      return { vertices: V, closed, components: P.components || [], edgeMap: Array.from({ length: ne }, (_, i) => i), vMap: Array.from({ length: n }, (_, i) => i), src: P };
    }
    const out = [], vMap = [], edgeMap = [];
    const ne = g2.edgeCount(n, closed);
    for (let i = 0; i < n; i++) {
      vMap.push(out.length);
      out.push(V[i]);
      if (i < ne && P.mids[i]) {
        const ip = points(V[i], P.mids[i], V[(i + 1) % n], nSeg);
        ip.forEach(q => { edgeMap.push(i); out.push(q); });
      }
      if (i < ne) edgeMap.push(i);
    }
    const N = out.length;
    const comps = (P.components || []).map(c => Object.assign({}, c, { start: vMap[c.start] % N, end: c.end === n ? N : vMap[c.end % n] }));
    return { vertices: out, closed, components: comps, edgeMap, vMap, src: P };
  }

  /** Bogenpunkt aus Pfeilhöhe s (senkrecht zur Sehne a→b, positiv = links). */
  function midFromSagitta(a, b, s) {
    const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1;
    return [(a[0] + b[0]) / 2 - dy / L * s, (a[1] + b[1]) / 2 + dx / L * s];
  }
  function sagittaOf(a, m, b) {
    const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1;
    return ((m[0] - (a[0] + b[0]) / 2) * -dy + (m[1] - (a[1] + b[1]) / 2) * dx) / L;
  }

  /**
   * Pfeilhöhe so bestimmen, dass der Bogen a→b die Punkte am besten trifft
   * (gekappter quadratischer Fehler; grobe Suche + Goldener Schnitt).
   * s0 = Startwert, range = Suchbereich um s0 (Vorgabe: halbe Sehnenlänge).
   */
  function fitSagitta(a, b, uv, s0 = 0, range = null) {
    const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy);
    if (L < 1e-6) return s0;
    const R = range || L / 2;
    // Kandidaten: Punkte, deren Projektion auf die Sehne innerhalb liegt und nicht zu weit weg sind
    const cand = uv.filter(p => {
      const t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (L * L);
      const off = Math.abs((p[0] - a[0]) * -dy + (p[1] - a[1]) * dx) / L;
      return t > 0.03 && t < 0.97 && off <= Math.abs(s0) + R;
    });
    if (cand.length < 5) return s0;
    const cap = Math.max(0.03, L / 100), cap2 = cap * cap;
    // Stichprobe pseudo-zufällig (eine feste Schrittweite kann mit der Punktreihenfolge interferieren)
    let seed = 12345;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    const sample = cand.length > 600 ? cand.filter(() => rnd() < 600 / cand.length) : cand;
    const cost = s => {
      const m = midFromSagitta(a, b, s);
      const poly = [a].concat(points(a, m, b, 24)).concat([b]);
      // gekappter quadratischer Fehler: weit entfernte Punkte (Boden, Einbauten) zählen nur konstant
      const d = g2.distancesToPolyline(sample, poly, false).dist;
      let sum = 0; for (const x of d) sum += Math.min(x * x, cap2);
      return sum / d.length;
    };
    const lo = Math.max(-L * 0.999 / 2 * 2, s0 - R), hi = Math.min(L * 0.999 / 2 * 2, s0 + R);
    let best = s0, bc = cost(s0);
    const steps = 60;
    for (let k = 0; k <= steps; k++) { const s = lo + (hi - lo) * k / steps; const c = cost(s); if (c < bc) { bc = c; best = s; } }
    let x0 = best - (hi - lo) / steps, x1 = best + (hi - lo) / steps;
    const gr = (Math.sqrt(5) - 1) / 2;
    for (let it = 0; it < 30; it++) {
      const c1 = x1 - gr * (x1 - x0), c2 = x0 + gr * (x1 - x0);
      if (cost(c1) < cost(c2)) x1 = c2; else x0 = c1;
    }
    const s = (x0 + x1) / 2;
    return cost(s) < bc ? s : best;
  }

  /** Bogen a-m-b bei Punkt q (wird auf den Kreis gelegt) teilen: { p, m1, m2 }. */
  function split(a, m, b, q) {
    const pr = param(a, m, b);
    if (!pr) return null;
    let t = Math.atan2(q[1] - pr.c[1], q[0] - pr.c[0]) - pr.t0;
    // Anteil f entlang des Bogens bestimmen
    const twoPi = 2 * Math.PI;
    let f = pr.sweep >= 0 ? ((t % twoPi) + twoPi) % twoPi / pr.sweep : -(((-t % twoPi) + twoPi) % twoPi) / pr.sweep;
    f = Math.max(0.02, Math.min(0.98, f));
    return { p: point(pr, f), m1: point(pr, f / 2), m2: point(pr, (1 + f) / 2) };
  }

  return { SEG, param, point, points, hasArcs, sync, expand, midFromSagitta, sagittaOf, fitSagitta, split };
})();
