/* ═══ Cloud2BIM Kern: Ausschneiden (Regionen, Masken) und Ebenen ═══
   Region (Grundriss): { id, poly: [[x,y],...] lokal, zMin|null, zMax|null, mode: 'keep'|'remove' }
   Maske (Querschnitt): { poly: [[u,v],...] } – Punkte darin zählen für diesen Querschnitt nicht
   Ebene: { id, name, n: [nx,ny,nz] (Einheitsnormale), c (n·X = c), p0, e1, e2 (Ebenenbasis),
            ext: [amin, amax, bmin, bmax] (Ausdehnung der Inlier in der Basis), rms, nInl, kind } */
C2B.planes = (() => {
  const g2 = C2B.g2, sec = C2B.sec;

  function pointInPoly(x, y, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / ((yj - yi) || 1e-30) + xi) inside = !inside;
    }
    return inside;
  }

  function polyBBox(poly) {
    let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
    poly.forEach(p => { a = Math.min(a, p[0]); b = Math.min(b, p[1]); c = Math.max(c, p[0]); d = Math.max(d, p[1]); });
    return [a, b, c, d];
  }

  /** Liegt der Punkt in der Region (Grundrisspolygon und optionaler Höhenbereich)? */
  function inRegion(r, x, y, z, bb) {
    if (r.zMin !== null && r.zMin !== undefined && z < r.zMin) return false;
    if (r.zMax !== null && r.zMax !== undefined && z > r.zMax) return false;
    if (bb && (x < bb[0] || y < bb[1] || x > bb[2] || y > bb[3])) return false;
    return pointInPoly(x, y, r.poly);
  }

  /**
   * Ausschnitt-Regionen der Reihe nach anwenden. «keep»: nur Punkte innerhalb behalten,
   * «remove»: Punkte innerhalb entfernen. Liefert eine neue Punktwolke (Teilmenge).
   */
  function applyRegions(cloud, regions) {
    if (!regions || !regions.length) return cloud;
    const bbs = regions.map(r => polyBBox(r.poly));
    const idx = [];
    const { xyz, n } = cloud;
    for (let i = 0; i < n; i++) {
      const x = xyz[i * 3], y = xyz[i * 3 + 1], z = xyz[i * 3 + 2];
      let ok = true;
      for (let k = 0; k < regions.length && ok; k++) {
        const inside = inRegion(regions[k], x, y, z, bbs[k]);
        ok = regions[k].mode === 'keep' ? inside : !inside;
      }
      if (ok) idx.push(i);
    }
    return C2B.thin.subset(cloud, idx);
  }

  /** Querschnittspunkte ohne die Punkte innerhalb der Masken. */
  function applyMasks(uv, masks) {
    if (!masks || !masks.length) return uv;
    const bbs = masks.map(m => polyBBox(m.poly));
    return uv.filter(p => !masks.some((m, k) => p[0] >= bbs[k][0] && p[0] <= bbs[k][2] && p[1] >= bbs[k][1] && p[1] <= bbs[k][3] && pointInPoly(p[0], p[1], m.poly)));
  }

  /** Punkte (global lokal xyz) einer Grundriss-Region sammeln. */
  function collectRegion(cloud, poly, zMin = null, zMax = null, maxPts = 200000) {
    const r = { poly, zMin, zMax }, bb = polyBBox(poly);
    const out = [];
    const { xyz, n } = cloud;
    for (let i = 0; i < n; i++) {
      const x = xyz[i * 3], y = xyz[i * 3 + 1], z = xyz[i * 3 + 2];
      if (inRegion(r, x, y, z, bb)) out.push([x, y, z]);
    }
    if (out.length > maxPts) {   // gleichmässig ausdünnen
      const step = out.length / maxPts, s = [];
      for (let k = 0; k < maxPts; k++) s.push(out[Math.floor(k * step)]);
      return s;
    }
    return out;
  }

  // ── 3×3-Eigenwerte (Jacobi) für die Ausgleichsebene
  function eigSym3(A) {
    const a = A.map(r => r.slice()), V = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    for (let sweep = 0; sweep < 50; sweep++) {
      let off = Math.abs(a[0][1]) + Math.abs(a[0][2]) + Math.abs(a[1][2]);
      if (off < 1e-14) break;
      for (const [p, q] of [[0, 1], [0, 2], [1, 2]]) {
        if (Math.abs(a[p][q]) < 1e-18) continue;
        const th = 0.5 * Math.atan2(2 * a[p][q], a[q][q] - a[p][p]);
        const c = Math.cos(th), s = Math.sin(th);
        for (let k = 0; k < 3; k++) { const akp = a[k][p], akq = a[k][q]; a[k][p] = c * akp - s * akq; a[k][q] = s * akp + c * akq; }
        for (let k = 0; k < 3; k++) { const apk = a[p][k], aqk = a[q][k]; a[p][k] = c * apk - s * aqk; a[q][k] = s * apk + c * aqk; }
        for (let k = 0; k < 3; k++) { const vkp = V[k][p], vkq = V[k][q]; V[k][p] = c * vkp - s * vkq; V[k][q] = s * vkp + c * vkq; }
      }
    }
    const vals = [a[0][0], a[1][1], a[2][2]];
    const vecs = [0, 1, 2].map(j => [V[0][j], V[1][j], V[2][j]]);
    const ord = [0, 1, 2].sort((i, j) => vals[i] - vals[j]);
    return { vals: ord.map(i => vals[i]), vecs: ord.map(i => vecs[i]) };
  }

  function lsqPlane(P) {
    const n = P.length;
    const c = [0, 0, 0];
    P.forEach(p => { c[0] += p[0]; c[1] += p[1]; c[2] += p[2]; });
    c[0] /= n; c[1] /= n; c[2] /= n;
    const C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    P.forEach(p => { const d = [p[0] - c[0], p[1] - c[1], p[2] - c[2]]; for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) C[i][j] += d[i] * d[j]; });
    const e = eigSym3(C);
    return { p0: c, n: e.vecs[0], e1: e.vecs[2], e2: e.vecs[1] };
  }

  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const norm = a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

  /**
   * Ebene robust einpassen: RANSAC (Schwelle «tol») und anschliessend Ausgleich über die Inlier.
   * kind: 'auto' | 'horizontal' | 'vertical' (beschränkt die Normalenrichtung auf ±maxTiltDeg).
   */
  function fitPlane(P, { tol = 0.01, kind = 'auto', iterations = 400, maxTiltDeg = 10, seed = 1 } = {}) {
    if (P.length < 10) throw new Error('Zu wenige Punkte in der Region (' + P.length + ').');
    let s = seed >>> 0 || 1;
    const rnd = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
    const cosT = Math.cos(maxTiltDeg * Math.PI / 180);
    const allowed = nn => kind === 'horizontal' ? Math.abs(nn[2]) >= cosT : kind === 'vertical' ? Math.abs(nn[2]) <= 1 - cosT : true;
    const sample = P.length > 20000 ? Array.from({ length: 20000 }, () => P[Math.floor(rnd() * P.length)]) : P;
    let best = null, bestCnt = -1;
    for (let it = 0; it < iterations; it++) {
      const a = sample[Math.floor(rnd() * sample.length)], b = sample[Math.floor(rnd() * sample.length)], c = sample[Math.floor(rnd() * sample.length)];
      const nn0 = cross([b[0] - a[0], b[1] - a[1], b[2] - a[2]], [c[0] - a[0], c[1] - a[1], c[2] - a[2]]);
      if (Math.hypot(...nn0) < 1e-9) continue;
      const nn = norm(nn0);
      if (!allowed(nn)) continue;
      const d = dot(nn, a);
      let cnt = 0;
      for (const p of sample) if (Math.abs(dot(nn, p) - d) <= tol) cnt++;
      if (cnt > bestCnt) { bestCnt = cnt; best = { n: nn, d }; }
    }
    if (!best) throw new Error('Keine Ebene der gewünschten Lage gefunden.');
    let inl = P.filter(p => Math.abs(dot(best.n, p) - best.d) <= tol);
    let pl = lsqPlane(inl);
    for (let k = 0; k < 2; k++) {   // Inlier mit Ausgleichsebene neu bestimmen
      const c = dot(pl.n, pl.p0);
      const inl2 = P.filter(p => Math.abs(dot(pl.n, p) - c) <= tol);
      if (inl2.length < 3) break;
      inl = inl2; pl = lsqPlane(inl);
    }
    let n = pl.n;
    if (n[2] < -1e-9 || (Math.abs(n[2]) < 1e-9 && (n[0] < 0 || (n[0] === 0 && n[1] < 0)))) n = n.map(x => -x);
    // Ebenenbasis: steile Ebenen e1 = waagrecht entlang der Fläche; flache Ebenen e1 = Hauptrichtung
    // der Inlier (Umriss folgt der Fläche statt den Koordinatenachsen)
    let e1;
    if (Math.abs(n[2]) < 0.9) e1 = norm(cross([0, 0, 1], n));
    else { const d = pl.e1, k = dot(d, n); e1 = norm([d[0] - k * n[0], d[1] - k * n[1], d[2] - k * n[2]]); }
    const e2 = norm(cross(n, e1));
    const c = dot(n, pl.p0);
    let amin = Infinity, amax = -Infinity, bmin = Infinity, bmax = -Infinity, ss = 0;
    inl.forEach(p => {
      const d = [p[0] - pl.p0[0], p[1] - pl.p0[1], p[2] - pl.p0[2]];
      const a = dot(d, e1), b = dot(d, e2);
      amin = Math.min(amin, a); amax = Math.max(amax, a); bmin = Math.min(bmin, b); bmax = Math.max(bmax, b);
      ss += (dot(n, p) - c) ** 2;
    });
    const tilt = Math.acos(Math.min(1, Math.abs(n[2]))) * 180 / Math.PI;
    return { n, c, p0: pl.p0, e1, e2, ext: [amin, amax, bmin, bmax], rms: Math.sqrt(ss / inl.length), nInl: inl.length, nAll: P.length,
      kind: tilt < 20 ? 'horizontal' : tilt > 70 ? 'vertical' : 'geneigt', tilt };
  }

  /** Eckpunkte der Ebenen-Fläche (Rechteck der Inlier-Ausdehnung) in Weltkoordinaten. */
  function planeCorners(pl) {
    const [a0, a1, b0, b1] = pl.ext;
    return [[a0, b0], [a1, b0], [a1, b1], [a0, b1]].map(([a, b]) => [0, 1, 2].map(k => pl.p0[k] + a * pl.e1[k] + b * pl.e2[k]));
  }

  /**
   * Schnittlinie einer Ebene mit einem Querschnitt in u/v, beschnitten auf die Ebenen-Fläche.
   * Liefert { a: [u,v], b: [u,v], line: {c,d} } oder null.
   */
  function sectionLine(pl, s, margin = 0.25) {
    const f = sec.frame(s);
    const U = [f.u[0], f.u[1], 0], O = [f.o[0], f.o[1], 0];
    const A = dot(pl.n, U), B = pl.n[2], R = pl.c - dot(pl.n, O);
    const L = Math.hypot(A, B);
    if (L < 0.05) return null;   // Ebene (fast) parallel zum Querschnitt
    const c = [A * R / (L * L), B * R / (L * L)], d = [-B / L, A / L];
    // Linie -> Ebenenbasis, auf [amin..amax] x [bmin..bmax] beschneiden (Liang-Barsky)
    const toAB = uv => { const w = sec.uvToWorld(s, uv); const q = [w[0] - pl.p0[0], w[1] - pl.p0[1], w[2] - pl.p0[2]]; return [dot(q, pl.e1), dot(q, pl.e2)]; };
    const p0 = toAB(c), p1 = toAB([c[0] + d[0], c[1] + d[1]]);
    const da = p1[0] - p0[0], db = p1[1] - p0[1];
    let t0 = -1e6, t1 = 1e6;
    const [a0, a1, b0, b1] = pl.ext;
    const clip = (p, q) => { if (Math.abs(p) < 1e-12) return q >= 0; const t = q / p; if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t; } else { if (t < t0) return false; if (t < t1) t1 = t; } return true; };
    if (!clip(-da, p0[0] - (a0 - margin)) || !clip(da, (a1 + margin) - p0[0]) || !clip(-db, p0[1] - (b0 - margin)) || !clip(db, (b1 + margin) - p0[1])) return null;
    if (t1 - t0 < 1e-3) return null;
    return { a: [c[0] + t0 * d[0], c[1] + t0 * d[1]], b: [c[0] + t1 * d[0], c[1] + t1 * d[1]], line: { c, d } };
  }

  /**
   * Ebenen in ein Teilprofil übernehmen: jede Kante, die (fast) parallel zu einer Ebenen-Schnittlinie
   * und nahe daran liegt, erhält deren Gerade; Ecken = Schnitt der Nachbargeraden.
   * Liefert { vertices, applied: [{ edge, plane }] }.
   */
  function applyToProfile(profile, lines, { maxAngleDeg = 8, maxDist = 0.15 } = {}) {
    const V = profile.vertices, closed = !!profile.closed && V.length >= 3;
    if (V.length < 2 || !lines.length) return { vertices: V.map(p => p.slice()), applied: [] };
    const E = g2.edges(V, closed);
    const cosMax = Math.cos(maxAngleDeg * Math.PI / 180);
    const applied = [];
    const edgeLines = E.map(([a, b], e) => {
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, d = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
      const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      let best = null, bd = maxDist;
      lines.forEach(pl => {
        const ld = pl.line.d;
        if (Math.abs(d[0] * ld[0] + d[1] * ld[1]) < cosMax) return;
        const dist = Math.abs((m[0] - pl.line.c[0]) * -ld[1] + (m[1] - pl.line.c[1]) * ld[0]);
        // Kantenmitte muss im Bereich der Schnittlinie liegen
        const t = (m[0] - pl.a[0]) * ld[0] + (m[1] - pl.a[1]) * ld[0 + 1];
        const len = (pl.b[0] - pl.a[0]) * ld[0] + (pl.b[1] - pl.a[1]) * ld[1];
        if (t < -0.1 * L || t > len + 0.1 * L) return;
        if (dist < bd) { bd = dist; best = pl; }
      });
      if (best) { applied.push({ edge: e, plane: best.plane }); return { c: best.line.c, d: best.line.d, fixed: true }; }
      return { c: a, d, fixed: false };
    });
    if (!applied.length) return { vertices: V.map(p => p.slice()), applied };
    const ne = E.length, minSin = Math.sin(5 * Math.PI / 180);
    const out = V.map((v, k) => {
      const pe = closed ? (k - 1 + ne) % ne : (k > 0 ? k - 1 : null);
      const nx = k < ne ? k : null;
      const L1 = pe !== null ? edgeLines[pe] : null, L2 = nx !== null ? edgeLines[nx] : null;
      if (!(L1 && L1.fixed) && !(L2 && L2.fixed)) return v.slice();
      if (L1 && L2) {
        const x = g2.intersectLines(L1, L2, minSin);
        if (x && Math.hypot(x[0] - v[0], x[1] - v[1]) <= 3 * maxDist) return x;
        return g2.projectOnLine(v, L1.fixed ? L1 : L2);
      }
      return g2.projectOnLine(v, (L1 || L2));
    });
    return { vertices: out, applied };
  }

  /** Alle Ebenen-Schnittlinien eines Querschnitts. */
  function sectionLines(planes, s) {
    const out = [];
    (planes || []).forEach(pl => { const l = sectionLine(pl, s); if (l) out.push(Object.assign(l, { plane: pl })); });
    return out;
  }

  return { pointInPoly, applyRegions, applyMasks, collectRegion, fitPlane, planeCorners, sectionLine, sectionLines, applyToProfile, eigSym3 };
})();
