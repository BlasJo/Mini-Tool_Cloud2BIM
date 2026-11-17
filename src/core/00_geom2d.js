/* ═══ Cloud2BIM Kern: 2D-Geometrie (u/v-Ebene der Querschnitte) ═══ */
const C2B = {};

C2B.g2 = (() => {
  const hypot = Math.hypot;

  /** Kanten [a,b] einer Polylinie (geschlossen: letzte Kante zurück zum Anfang). */
  function edges(V, closed) {
    const out = [];
    const n = V.length;
    const m = closed && n >= 3 ? n : n - 1;
    for (let i = 0; i < m; i++) out.push([V[i], V[(i + 1) % n]]);
    return out;
  }

  function edgeCount(n, closed) { return closed && n >= 3 ? n : Math.max(n - 1, 0); }

  function distPointSeg(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const L2 = dx * dx + dy * dy;
    let t = L2 < 1e-18 ? 0 : ((px - ax) * dx + (py - ay) * dy) / L2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    return hypot(px - (ax + t * dx), py - (ay + t * dy));
  }

  /** Abstand und Index der nächsten Kante für jeden Punkt. */
  function distancesToPolyline(P, V, closed) {
    const E = edges(V, closed);
    const n = P.length;
    const dist = new Float64Array(n).fill(Infinity);
    const seg = new Int32Array(n);
    if (!E.length) return { dist, seg };
    for (let i = 0; i < n; i++) {
      const px = P[i][0], py = P[i][1];
      let best = Infinity, bi = 0;
      for (let e = 0; e < E.length; e++) {
        const a = E[e][0], b = E[e][1];
        const d = distPointSeg(px, py, a[0], a[1], b[0], b[1]);
        if (d < best) { best = d; bi = e; }
      }
      dist[i] = best; seg[i] = bi;
    }
    return { dist, seg };
  }

  /** Abweichungsstatistik Profil <-> Punkte. Punkte weiter als «band» gelten als Fremdobjekte. */
  function deviationReport(P, V, closed, tol, band) {
    const ne = edgeCount(V.length, closed);
    const rep = { nPoints: P.length, nUsed: 0, max: null, mean: null, rms: null, p95: null,
      withinTol: null, segMax: new Array(ne).fill(null), segOk: new Array(ne).fill(true) };
    if (!P.length || V.length < 2) return rep;
    band = band || Math.max(5 * tol, 0.10);
    const { dist, seg } = distancesToPolyline(P, V, closed);
    const used = [];
    for (let i = 0; i < P.length; i++) {
      const d = dist[i];
      if (d <= band) {
        used.push(d);
        const s = seg[i];
        if (rep.segMax[s] === null || d > rep.segMax[s]) rep.segMax[s] = d;
      }
    }
    rep.segOk = rep.segMax.map(m => m === null || m <= tol);
    if (!used.length) { rep.withinTol = 0; return rep; }
    used.sort((a, b) => a - b);
    let s = 0, s2 = 0, ok = 0;
    for (const d of used) { s += d; s2 += d * d; if (d <= tol) ok++; }
    rep.nUsed = used.length;
    rep.max = used[used.length - 1];
    rep.mean = s / used.length;
    rep.rms = Math.sqrt(s2 / used.length);
    rep.p95 = used[Math.min(used.length - 1, Math.floor(0.95 * used.length))];
    rep.withinTol = ok / used.length;
    return rep;
  }

  /**
   * Abweichung bei mehreren Teilprofilen: jeder Punkt zählt zum nächstgelegenen Profil.
   * profiles = [{ vertices, closed }]; liefert Gesamtwerte + segOk/segMax je Profil.
   */
  function deviationMulti(P, profiles, tol, band) {
    band = band || Math.max(5 * tol, 0.10);
    const valid = profiles.map(p => p.vertices.length >= 2);
    const per = profiles.map((p, k) => valid[k] ? distancesToPolyline(P, p.vertices, p.closed && p.vertices.length >= 3) : null);
    const segMax = profiles.map(p => new Array(edgeCount(p.vertices.length, p.closed)).fill(null));
    const used = [];
    for (let i = 0; i < P.length; i++) {
      let best = Infinity, bk = -1;
      per.forEach((r, k) => { if (r && r.dist[i] < best) { best = r.dist[i]; bk = k; } });
      if (bk < 0 || best > band) continue;
      used.push(best);
      const s = per[bk].seg[i];
      if (segMax[bk][s] === null || best > segMax[bk][s]) segMax[bk][s] = best;
    }
    const rep = { nPoints: P.length, nUsed: used.length, max: null, mean: null, rms: null, p95: null, withinTol: null,
      segMax, segOk: segMax.map(a => a.map(m => m === null || m <= tol)) };
    if (!valid.some(Boolean)) return rep;
    if (!used.length) { rep.withinTol = 0; return rep; }
    used.sort((a, b) => a - b);
    let s = 0, s2 = 0, ok = 0;
    for (const d of used) { s += d; s2 += d * d; if (d <= tol) ok++; }
    Object.assign(rep, { max: used[used.length - 1], mean: s / used.length, rms: Math.sqrt(s2 / used.length),
      p95: used[Math.min(used.length - 1, Math.floor(0.95 * used.length))], withinTol: ok / used.length });
    return rep;
  }

  /** Douglas-Peucker (iterativ) auf geordneter Punktfolge: Indizes der Stützpunkte. */
  function douglasPeucker(P, tol) {
    const n = P.length;
    if (n <= 2) return [...Array(n).keys()];
    const keep = new Uint8Array(n);
    keep[0] = keep[n - 1] = 1;
    const stack = [[0, n - 1]];
    while (stack.length) {
      const [i, j] = stack.pop();
      if (j <= i + 1) continue;
      const a = P[i], b = P[j];
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const L = hypot(dx, dy);
      let best = -1, bk = -1;
      for (let k = i + 1; k < j; k++) {
        const d = L < 1e-12 ? hypot(P[k][0] - a[0], P[k][1] - a[1])
          : Math.abs(dx * (P[k][1] - a[1]) - dy * (P[k][0] - a[0])) / L;
        if (d > best) { best = d; bk = k; }
      }
      if (best > tol) { keep[bk] = 1; stack.push([i, bk], [bk, j]); }
    }
    const out = [];
    for (let i = 0; i < n; i++) if (keep[i]) out.push(i);
    return out;
  }

  /** Total-Least-Squares-Gerade: { c: Schwerpunkt, d: Einheitsrichtung }. */
  function fitLine(P) {
    const n = P.length;
    let cx = 0, cy = 0;
    for (const p of P) { cx += p[0]; cy += p[1]; }
    cx /= n || 1; cy /= n || 1;
    if (n < 2) return { c: [cx, cy], d: [1, 0] };
    let sxx = 0, sxy = 0, syy = 0;
    for (const p of P) { const x = p[0] - cx, y = p[1] - cy; sxx += x * x; sxy += x * y; syy += y * y; }
    const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    return { c: [cx, cy], d: [Math.cos(ang), Math.sin(ang)] };
  }

  /** Schnittpunkt zweier Geraden (null, falls fast parallel). */
  function intersectLines(L1, L2, minSin = 0.05) {
    const d1 = L1.d, d2 = L2.d;
    const cr = d1[0] * d2[1] - d1[1] * d2[0];
    if (Math.abs(cr) < minSin) return null;
    const wx = L2.c[0] - L1.c[0], wy = L2.c[1] - L1.c[1];
    const t = (wx * d2[1] - wy * d2[0]) / cr;
    return [L1.c[0] + t * d1[0], L1.c[1] + t * d1[1]];
  }

  function projectOnLine(p, L) {
    const t = (p[0] - L.c[0]) * L.d[0] + (p[1] - L.c[1]) * L.d[1];
    return [L.c[0] + t * L.d[0], L.c[1] + t * L.d[1]];
  }

  function signedArea(V) {
    let s = 0;
    for (let i = 0; i < V.length; i++) {
      const a = V[i], b = V[(i + 1) % V.length];
      s += a[0] * b[1] - b[0] * a[1];
    }
    return 0.5 * s;
  }

  function polylineLength(V, closed) {
    let s = 0;
    for (const [a, b] of edges(V, closed)) s += hypot(b[0] - a[0], b[1] - a[1]);
    return s;
  }

  /** Gleichmässig nach Bogenlänge auf n Punkte umtasten. */
  function resample(V, n, closed) {
    const W = closed ? V.concat([V[0]]) : V;
    const cum = [0];
    for (let i = 1; i < W.length; i++) cum.push(cum[i - 1] + hypot(W[i][0] - W[i - 1][0], W[i][1] - W[i - 1][1]));
    const total = cum[cum.length - 1];
    const out = [];
    const steps = closed ? n : n - 1;
    for (let k = 0; k < n; k++) {
      const s = steps > 0 ? total * k / steps : 0;
      let j = 1;
      while (j < cum.length - 1 && cum[j] < s) j++;
      const seg = cum[j] - cum[j - 1];
      const t = seg > 1e-12 ? (s - cum[j - 1]) / seg : 0;
      out.push([W[j - 1][0] + t * (W[j][0] - W[j - 1][0]), W[j - 1][1] + t * (W[j][1] - W[j - 1][1])]);
    }
    return out;
  }

  /** Auf n Punkte erhöhen, bestehende Ecken bleiben; Zusatzpunkte auf die längsten Kanten. */
  function densify(V, n, closed) {
    if (n <= V.length) return V.map(p => p.slice());
    const E = edges(V, closed);
    const len = E.map(([a, b]) => hypot(b[0] - a[0], b[1] - a[1]));
    const extra = new Array(E.length).fill(0);
    for (let k = 0; k < n - V.length; k++) {
      let bi = 0, bv = -1;
      for (let e = 0; e < E.length; e++) { const v = len[e] / (extra[e] + 1); if (v > bv) { bv = v; bi = e; } }
      extra[bi]++;
    }
    const out = [];
    E.forEach(([a, b], e) => {
      out.push(a.slice());
      for (let j = 0; j < extra[e]; j++) {
        const t = (j + 1) / (extra[e] + 1);
        out.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]);
      }
    });
    if (!closed) out.push(V[V.length - 1].slice());
    return out;
  }

  /** Rechts-Normale (dy,-dx) einer Kante, normiert. */
  function rightNormal(a, b) {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const L = hypot(dx, dy) || 1;
    return [dy / L, -dx / L];
  }

  /** Ear-Clipping-Triangulierung eines einfachen Polygons -> Indextripel. */
  function triangulate(P) {
    const n = P.length;
    if (n < 3) return [];
    let idx = [...Array(n).keys()];
    if (signedArea(P) < 0) idx.reverse();
    const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const inside = (p, a, b, c) => {
      const d1 = cross(a, b, p), d2 = cross(b, c, p), d3 = cross(c, a, p);
      return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
    };
    const tris = [];
    let guard = 0;
    while (idx.length > 3 && guard++ < 10 * n * n) {
      let found = false;
      for (let k = 0; k < idx.length; k++) {
        const i0 = idx[(k - 1 + idx.length) % idx.length], i1 = idx[k], i2 = idx[(k + 1) % idx.length];
        const a = P[i0], b = P[i1], c = P[i2];
        if (cross(a, b, c) <= 1e-14) continue;
        let ok = true;
        for (const j of idx) {
          if (j === i0 || j === i1 || j === i2) continue;
          if (inside(P[j], a, b, c)) { ok = false; break; }
        }
        if (!ok) continue;
        tris.push([i0, i1, i2]);
        idx.splice(k, 1);
        found = true;
        break;
      }
      if (!found) break;
    }
    if (idx.length === 3) tris.push(idx.slice());
    else if (idx.length > 3) for (let k = 1; k < idx.length - 1; k++) tris.push([idx[0], idx[k], idx[k + 1]]);
    return tris;
  }

  return { edges, edgeCount, distPointSeg, distancesToPolyline, deviationReport, deviationMulti, douglasPeucker,
    fitLine, intersectLines, projectOnLine, signedArea, polylineLength, resample, densify,
    rightNormal, triangulate };
})();
