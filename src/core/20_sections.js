/* ═══ Cloud2BIM Kern: Querschnitte ═══
   Querschnitt: origin [x,y] (lokal), angle (Achsrichtung, rad), depth (Schnittdicke).
   u = rechts in Blickrichtung, v = Höhe Z.  Welt: P(u,v) = (ox + u·sin a, oy − u·cos a, v) */
C2B.sec = (() => {
  const g2 = C2B.g2;
  let _id = 0;
  const uid = () => 's' + Date.now().toString(36) + (++_id).toString(36);

  function frame(s) {
    const a = s.angle;
    return { o: s.origin, d: [Math.cos(a), Math.sin(a)], u: [Math.sin(a), -Math.cos(a)] };
  }
  function uvToWorld(s, uv) {
    const f = frame(s);
    return [f.o[0] + uv[0] * f.u[0], f.o[1] + uv[0] * f.u[1], uv[1]];
  }
  function worldToUv(s, p) {
    const f = frame(s);
    const rx = p[0] - f.o[0], ry = p[1] - f.o[1];
    return [rx * f.u[0] + ry * f.u[1], p[2]];
  }

  /** Punkte der Schnittscheibe als [u,v]. */
  function extractPoints(cloud, s, cell = 0) {
    const f = frame(s);
    const half = 0.5 * (s.depth || 0.05);
    const { xyz, n } = cloud;
    const out = [];
    const ox = f.o[0], oy = f.o[1], dx = f.d[0], dy = f.d[1], ux = f.u[0], uy = f.u[1];
    for (let i = 0; i < n; i++) {
      const rx = xyz[i * 3] - ox, ry = xyz[i * 3 + 1] - oy;
      const t = rx * dx + ry * dy;
      if (t > half || t < -half) continue;
      out.push([rx * ux + ry * uy, xyz[i * 3 + 2]]);
    }
    return cell > 0 ? C2B.thin.gridThin2D(out, cell) : out;
  }

  function newSection(origin, angle, station = 0, depth = 0.05, name) {
    return { id: uid(), name: name || ('QS ' + station.toFixed(2)), station, origin: [origin[0], origin[1]],
      angle, depth, maxGap: DEFAULT_MAX_GAP, profiles: [] };
  }

  const DEFAULT_MAX_GAP = 0.20;

  /**
   * Teilprofile eines Querschnitts [{ vertices, closed, components }]. Ältere Projekte
   * (ein Profil in s.profile, Bauteile in s.components) werden dabei übernommen.
   */
  function profilesOf(s) {
    if (!s.profiles || 'profile' in s) {
      s.profiles = s.profiles || [];
      if (s.profile && s.profile.vertices && s.profile.vertices.length) s.profiles.push({ vertices: s.profile.vertices, closed: !!s.profile.closed, components: s.components || [] });
      delete s.profile; delete s.components;
    }
    if (!(s.maxGap > 0)) s.maxGap = DEFAULT_MAX_GAP;
    s.profiles.forEach(p => { p.components = p.components || []; });
    return s.profiles;
  }
  const allComponents = s => profilesOf(s).reduce((a, p) => a.concat(p.components || []), []);
  const nVertices = s => profilesOf(s).reduce((a, p) => a + p.vertices.length, 0);

  /** Querschnitte entlang einer Achse (Polylinie): Abstand ODER Anzahl. */
  function generateAlongAxis(axis, { spacing = 0, count = 0, depth = 0.05, includeEnd = true, stationStart = 0, prefix = 'QS' } = {}) {
    const pts = [];
    for (const p of axis) if (!pts.length || Math.hypot(p[0] - pts[pts.length - 1][0], p[1] - pts[pts.length - 1][1]) > 1e-9) pts.push(p);
    if (pts.length < 2) throw new Error('Die Achse braucht einen Start- und einen Endpunkt (verschieden).');
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const L = cum[cum.length - 1];
    let st = [];
    if (count > 0) {
      st = count === 1 ? [L / 2] : Array.from({ length: count }, (_, k) => L * k / (count - 1));
    } else if (spacing > 0) {
      for (let s = 0; s <= L + 1e-9; s += spacing) st.push(Math.min(s, L));
      // Endquerschnitt nur ergänzen, wenn er nicht (fast) auf dem letzten liegt (< 1 cm)
      if (includeEnd && L - st[st.length - 1] > 0.01) st.push(L);
      else if (includeEnd) st[st.length - 1] = L;
    } else throw new Error('Bitte Abstand oder Anzahl angeben.');
    if (st.length > 5000) throw new Error('Zu viele Querschnitte (> 5000).');
    return st.map(s => {
      let k = 0;
      while (k < pts.length - 2 && cum[k + 1] < s) k++;
      const segL = cum[k + 1] - cum[k];
      const t = (s - cum[k]) / segL;
      const p = [pts[k][0] + t * (pts[k + 1][0] - pts[k][0]), pts[k][1] + t * (pts[k + 1][1] - pts[k][1])];
      const ang = Math.atan2(pts[k + 1][1] - pts[k][1], pts[k + 1][0] - pts[k][0]);
      const station = stationStart + s;
      return newSection(p, ang, station, depth, prefix + ' ' + station.toFixed(2));
    });
  }

  // ─────────────────────────────────────────────── Automatischer Vorschlag
  function denoise(P, r, minNb = 2) {
    const map = new Map();
    const key = (ix, iy) => ix * 1048576 + iy;
    P.forEach((p, i) => {
      const k = key(Math.floor(p[0] / r), Math.floor(p[1] / r));
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(i);
    });
    const r2 = r * r;
    const out = P.filter(p => {
      const ix = Math.floor(p[0] / r), iy = Math.floor(p[1] / r);
      let c = 0;
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
        const l = map.get(key(ix + a, iy + b));
        if (!l) continue;
        for (const j of l) { const q = P[j]; if ((q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2 <= r2) c++; }
      }
      return c - 1 >= minNb;
    });
    return out.length >= 3 ? out : P;
  }

  /** Typischer Punktabstand: Median des Abstands zum 3. Nachbarn (Stichprobe). */
  function nnSpacing(P) {
    if (P.length < 3) return 0;
    let mnx = Infinity, mny = Infinity, mxx = -Infinity, mxy = -Infinity;
    for (const p of P) { if (p[0] < mnx) mnx = p[0]; if (p[1] < mny) mny = p[1]; if (p[0] > mxx) mxx = p[0]; if (p[1] > mxy) mxy = p[1]; }
    const cs = Math.max(1e-4, Math.hypot(mxx - mnx, mxy - mny) / Math.sqrt(P.length) / 2);
    const map = new Map(), key = (ix, iy) => ix * 1048576 + iy;
    P.forEach((p, i) => { const k = key(Math.floor(p[0] / cs), Math.floor(p[1] / cs)); if (!map.has(k)) map.set(k, []); map.get(k).push(i); });
    const step = Math.max(1, Math.floor(P.length / 400)), d = [];
    for (let i = 0; i < P.length; i += step) {
      const p = P[i], ix = Math.floor(p[0] / cs), iy = Math.floor(p[1] / cs);
      // Abstand zum k-ten Nachbarn (k = 3): robust auch bei nur 1–2 Punktreihen je Schnitt
      let best = null;
      for (let r = 2; r <= 12 && !best; r += 2) {
        const cand = [];
        for (let a = -r; a <= r; a++) for (let b = -r; b <= r; b++) {
          const l = map.get(key(ix + a, iy + b)); if (!l) continue;
          for (const j of l) if (j !== i) { const q = P[j]; cand.push(Math.hypot(q[0] - p[0], q[1] - p[1])); }
        }
        if (cand.length >= 3) { cand.sort((x, y) => x - y); if (cand[2] <= r * cs) best = cand[2]; }
      }
      if (best) d.push(best);
    }
    d.sort((a, b) => a - b);
    return d.length ? d[d.length >> 1] : 0;
  }

  /** Kleine, abgesetzte Punktgruppen (Leitungen, Geräte, Streupunkte) entfernen. */
  function dropSmallClusters(P, link, minFrac = 0.15) {
    const n = P.length;
    if (n < 10) return P;
    const map = new Map();
    const key = (ix, iy) => ix * 1048576 + iy;
    P.forEach((p, i) => {
      const k = key(Math.floor(p[0] / link), Math.floor(p[1] / link));
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(i);
    });
    const comp = new Int32Array(n).fill(-1);
    const comps = [];
    const l2 = link * link;
    for (let s = 0; s < n; s++) {
      if (comp[s] >= 0) continue;
      const id = comps.length, members = [s];
      comp[s] = id;
      for (let h = 0; h < members.length; h++) {
        const p = P[members[h]];
        const ix = Math.floor(p[0] / link), iy = Math.floor(p[1] / link);
        for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
          const l = map.get(key(ix + a, iy + b));
          if (!l) continue;
          for (const j of l) if (comp[j] < 0 && (P[j][0] - p[0]) ** 2 + (P[j][1] - p[1]) ** 2 <= l2) { comp[j] = id; members.push(j); }
        }
      }
      let mnx = Infinity, mny = Infinity, mxx = -Infinity, mxy = -Infinity;
      for (const j of members) { const q = P[j]; mnx = Math.min(mnx, q[0]); mny = Math.min(mny, q[1]); mxx = Math.max(mxx, q[0]); mxy = Math.max(mxy, q[1]); }
      comps.push({ members, ext: Math.hypot(mxx - mnx, mxy - mny) });
    }
    const maxExt = Math.max(...comps.map(c => c.ext));
    // Kleine Gruppe = Fremdobjekt (Leitung, Gerät) nur, wenn sie das übrige Profil höchstens auf
    // einer Seite berührt. Ein Wandstück zwischen zwei Lücken berührt beide Seiten und bleibt.
    const reach = 2 * link, r2 = reach * reach, cs2 = reach;
    const grid = new Map();
    P.forEach((p, i) => { const k = key(Math.floor(p[0] / cs2), Math.floor(p[1] / cs2)); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(i); });
    const bridges = (c, id) => {
      const contacts = [];
      for (const i of c.members) {
        const p = P[i], ix = Math.floor(p[0] / cs2), iy = Math.floor(p[1] / cs2);
        let hit = false;
        for (let a = -1; a <= 1 && !hit; a++) for (let b = -1; b <= 1 && !hit; b++) {
          const l = grid.get(key(ix + a, iy + b)); if (!l) continue;
          for (const j of l) if (comp[j] !== id && (P[j][0] - p[0]) ** 2 + (P[j][1] - p[1]) ** 2 <= r2) { hit = true; break; }
        }
        if (hit) contacts.push(p);
      }
      if (contacts.length < 2) return false;
      let spread = 0;
      for (let a = 0; a < contacts.length; a += Math.max(1, contacts.length >> 5)) for (let b = a + 1; b < contacts.length; b++)
        spread = Math.max(spread, Math.hypot(contacts[a][0] - contacts[b][0], contacts[a][1] - contacts[b][1]));
      return spread >= 0.6 * c.ext;
    };
    const keep = comps.filter((c, id) => c.ext >= minFrac * maxExt || bridges(c, id));
    const out = [];
    for (const c of keep) for (const j of c.members) out.push(P[j]);
    return out.length >= 5 ? out : P;
  }

  /** Punkte entlang des längsten Pfades im euklidischen Minimal-Spannbaum ordnen. */
  function orderedPath(P, maxGap = Infinity) {
    const n = P.length;
    if (n < 4) return { path: P, length: 0 };
    const coords = new Float64Array(n * 2);
    P.forEach((p, i) => { coords[2 * i] = p[0]; coords[2 * i + 1] = p[1]; });
    let tri;
    try { tri = new Delaunator(coords); } catch (e) { tri = null; }
    if (!tri || !tri.triangles.length) {
      const s = P.slice().sort((a, b) => a[0] - b[0]);
      return { path: s, length: g2.polylineLength(s, false) };
    }
    const E = [];
    const t = tri.triangles;
    for (let i = 0; i < t.length; i++) {
      const a = t[i], b = t[i % 3 === 2 ? i - 2 : i + 1];
      if (a < b) E.push([a, b, Math.hypot(P[a][0] - P[b][0], P[a][1] - P[b][1])]);
      else if (tri.halfedges[i] === -1) E.push([b, a, Math.hypot(P[a][0] - P[b][0], P[a][1] - P[b][1])]);
    }
    E.sort((x, y) => x[2] - y[2]);
    const par = new Int32Array(n).map((_, i) => i);
    const find = x => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
    const adj = Array.from({ length: n }, () => []);
    for (const [a, b, w] of E) {
      if (w > maxGap) break;           // sortiert: alle weiteren Kanten sind länger
      const ra = find(a), rb = find(b);
      if (ra === rb) continue;
      par[ra] = rb;
      adj[a].push([b, w]); adj[b].push([a, w]);
    }
    const far = (src) => {
      const dist = new Float64Array(n).fill(-1), pred = new Int32Array(n).fill(-1);
      dist[src] = 0;
      const st = [src];
      while (st.length) {
        const x = st.pop();
        for (const [y, w] of adj[x]) if (dist[y] < 0) { dist[y] = dist[x] + w; pred[y] = x; st.push(y); }
      }
      let bi = src;
      for (let i = 0; i < n; i++) if (dist[i] > dist[bi]) bi = i;
      return { bi, dist, pred };
    };
    // Start im grössten zusammenhängenden Teil
    const cnt = new Map();
    for (let i = 0; i < n; i++) { const r = find(i); cnt.set(r, (cnt.get(r) || 0) + 1); }
    let bigRoot = 0, bigN = -1;
    cnt.forEach((v, k) => { if (v > bigN) { bigN = v; bigRoot = k; } });
    let start = 0; while (find(start) !== bigRoot) start++;
    const a = far(start).bi;
    const r = far(a);
    const path = [];
    for (let x = r.bi; x !== -1; x = r.pred[x]) path.push(P[x]);
    path.reverse();
    return { path, length: r.dist[r.bi] };
  }

  /** Ecken schärfen: Geraden in die Spannen einpassen und Nachbargeraden schneiden. */
  function refineByLines(path, idx, closed, maxShift) {
    const V = idx.map(i => path[i].slice());
    const spans = [];
    for (let k = 0; k < idx.length - 1; k++) spans.push(path.slice(idx[k], idx[k + 1] + 1));
    if (closed) spans.push(path.slice(idx[idx.length - 1]).concat(path.slice(0, idx[0] + 1)));
    const lines = spans.map(sp => {
      const m = sp.length;
      const tr = m >= 6 ? Math.max(1, Math.floor(0.12 * m)) : 0;
      return g2.fitLine(tr ? sp.slice(tr, m - tr) : sp);
    });
    return cornerFromLines(V, lines, closed, maxShift);
  }

  const MIN_SIN = Math.sin(8 * Math.PI / 180);
  function cornerFromLines(V, lines, closed, maxShift) {
    const ne = lines.length;
    return V.map((v, k) => {
      const pe = closed ? (k - 1 + ne) % ne : (k > 0 ? k - 1 : null);
      const nx = k < ne ? k : null;
      let c;
      if (pe !== null && nx !== null) {
        c = g2.intersectLines(lines[pe], lines[nx], MIN_SIN);
        if (!c) {
          const p1 = g2.projectOnLine(v, lines[pe]), p2 = g2.projectOnLine(v, lines[nx]);
          c = [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2];
        }
      } else if (nx !== null) c = g2.projectOnLine(v, lines[nx]);
      else if (pe !== null) c = g2.projectOnLine(v, lines[pe]);
      else c = v;
      return Math.hypot(c[0] - v[0], c[1] - v[1]) <= maxShift ? c : v.slice();
    });
  }

  function mergeCollinear(V, closed, P, tol) {
    let v = V.slice();
    const base = g2.distancesToPolyline(P, v, closed).dist;
    const near = P.filter((_, i) => base[i] <= tol * 1.5);
    for (;;) {
      if (v.length <= (closed ? 3 : 2)) break;
      let best = -1, bestErr = Infinity;
      const from = closed ? 0 : 1, to = closed ? v.length : v.length - 1;
      for (let k = from; k < to; k++) {
        const cand = v.filter((_, j) => j !== k);
        const d = g2.distancesToPolyline(near, cand, closed).dist;
        let err = 0; for (const x of d) if (x > err) err = x;
        if (err <= tol && err < bestErr) { bestErr = err; best = k; }
      }
      if (best < 0) break;
      v = v.filter((_, j) => j !== best);
    }
    return v;
  }

  /**
   * Kurze Fasen an Ecken entfernen: eine kurze Kante zwischen zwei längeren wird durch den
   * Schnittpunkt der Nachbarkanten ersetzt, wenn die Toleranz eingehalten bleibt.
   */
  function sharpenCorners(V, closed, P, tol) {
    let v = V.slice();
    const near = P.filter((_, i) => g2.distancesToPolyline(P, V, closed).dist[i] <= tol * 1.5);
    const maxErr = cand => { const d = g2.distancesToPolyline(near, cand, closed).dist; let m = 0; for (const x of d) if (x > m) m = x; return m; };
    const minLen = Math.max(3 * tol, 0.05);
    let changed = true;
    while (changed && v.length > (closed ? 3 : 2)) {
      changed = false;
      const n = v.length, ne = g2.edgeCount(n, closed);
      const len = e => Math.hypot(v[(e + 1) % n][0] - v[e][0], v[(e + 1) % n][1] - v[e][1]);
      for (let e = 0; e < ne; e++) {
        const pe = closed ? (e - 1 + ne) % ne : e - 1, nx = closed ? (e + 1) % ne : e + 1;
        if (pe < 0 || nx >= ne || len(e) >= minLen || len(pe) < 2 * len(e) || len(nx) < 2 * len(e)) continue;
        const a = v[pe], b = v[(pe + 1) % n], c = v[(nx + 1) % n], d = v[(e + 1) % n];
        const L1 = { c: a, d: [(b[0] - a[0]) / (len(pe) || 1), (b[1] - a[1]) / (len(pe) || 1)] };
        const L2 = { c: d, d: [(c[0] - d[0]) / (len(nx) || 1), (c[1] - d[1]) / (len(nx) || 1)] };
        const x = g2.intersectLines(L1, L2, Math.sin(20 * Math.PI / 180));
        if (!x || Math.hypot(x[0] - b[0], x[1] - b[1]) > 3 * minLen) continue;
        const i1 = (e + 1) % n;
        const cand = v.map((p, i) => (i === e ? x : p)).filter((_, i) => i !== i1);
        if (maxErr(cand) <= tol) { v = cand; changed = true; break; }
      }
    }
    return v;
  }

  /**
   * Automatischer Profilvorschlag.
   * 1. Raster-Ausdünnung (~ tol/2), isolierte Punkte entfernen
   * 2. Ordnen über den längsten Pfad im Minimal-Spannbaum (Delaunay)
   * 3. Douglas-Peucker mit der zulässigen Abweichung
   * 4. Geradenausgleich je Kante, Ecken = Schnitt der Nachbargeraden
   * 5. Abweichung prüfen (ggf. unterteilen), überflüssige Ecken entfernen
   */
  function autoProfile(uv, tol = 0.02, closedMode = 'auto', maxGap = Infinity) {
    if (uv.length < 5) throw new Error('Zu wenige Punkte im Querschnitt für einen Vorschlag.');
    tol = Math.max(tol, 1e-4);
    let cell = Math.max(tol / 2, 0.002);
    let pts = C2B.thin.gridThin2D(uv, cell);
    if (pts.length > 6000) { cell *= Math.sqrt(pts.length / 6000); pts = C2B.thin.gridThin2D(uv, cell); }
    // Parameter an die Punktdichte anpassen (ausgedünnte Wolken haben oft 1–3 cm Punktabstand)
    const h = nnSpacing(pts);
    pts = denoise(pts, Math.max(3 * cell, 2 * h), 2);
    pts = dropSmallClusters(pts, Math.min(maxGap, Math.max(10 * cell, 5 * h, 0.05)));
    let { path, length } = orderedPath(pts, maxGap);
    let closed;
    if (closedMode === 'auto') {
      const gap = Math.hypot(path[0][0] - path[path.length - 1][0], path[0][1] - path[path.length - 1][1]);
      closed = length > 0 && gap < 0.15 * length && gap <= 1.25 * maxGap;   // Schnittkante des Spannbaums ist <= maxGap
    } else closed = !!closedMode;
    let idx = g2.douglasPeucker(path, tol);
    if (closed && idx.length >= 4) {
      // Ring an einer echten Ecke (schärfster Knick) beginnen lassen, sonst entsteht an der
      // zufälligen Schnittstelle des Spannbaums eine Scheinecke.
      let bestK = -1, bestCos = 2;
      for (let k = 1; k < idx.length - 1; k++) {
        const a = path[idx[k - 1]], b = path[idx[k]], c = path[idx[k + 1]];
        const d1 = [b[0] - a[0], b[1] - a[1]], d2 = [c[0] - b[0], c[1] - b[1]];
        const cos = (d1[0] * d2[0] + d1[1] * d2[1]) / ((Math.hypot(...d1) * Math.hypot(...d2)) || 1);
        if (cos < bestCos) { bestCos = cos; bestK = idx[k]; }
      }
      if (bestK > 0) {
        path = path.slice(bestK).concat(path.slice(0, bestK));
        path.push(path[0]);   // Ring schliessen, damit DP die Schliesskante mit prüft
        idx = g2.douglasPeucker(path, tol);
        path.pop();
        idx = idx.filter(i => i < path.length);
      }
    }
    if (closed && idx.length < 3) closed = false;
    const maxShift = Math.max(3 * tol, 0.05);
    let V = refineByLines(path, idx, closed, maxShift);
    for (let it = 0; it < 6; it++) {
      const { dist, seg } = g2.distancesToPolyline(path, V, closed);
      const worst = new Map();
      for (let i = 0; i < path.length; i++) if (dist[i] > tol * 1.0001) {
        const w = worst.get(seg[i]);
        if (!w || dist[i] > dist[w]) worst.set(seg[i], i);
      }
      if (!worst.size) break;
      idx = [...new Set(idx.concat([...worst.values()]))].sort((a, b) => a - b);
      V = refineByLines(path, idx, closed, maxShift);
    }
    V = mergeCollinear(V, closed, path, tol);
    V = sharpenCorners(V, closed, path, tol);
    if (closed && g2.signedArea(V) < 0) V.reverse();
    return { vertices: V, closed };
  }

  /**
   * Mehrere Teilprofile: Punkte werden nur verbunden, wenn sie höchstens «maxGap»
   * auseinanderliegen (Einzelquerschnitte, z. B. zwei Tunnelröhren). Jede genügend grosse
   * Punktgruppe erhält einen eigenen Vorschlag; kleine Gruppen (Leitungen, Geräte) entfallen.
   */
  function autoProfiles(uv, tol = 0.02, { maxGap = DEFAULT_MAX_GAP, closedMode = 'auto', minFrac = 0.15 } = {}) {
    if (uv.length < 5) throw new Error('Zu wenige Punkte im Querschnitt für einen Vorschlag.');
    const cell = Math.max(tol / 2, 0.002);
    let pts = C2B.thin.gridThin2D(uv, cell);
    const groups = clusters(pts, Math.max(maxGap, cell * 2));
    const maxExt = Math.max(...groups.map(g => g.ext));
    const big = groups.filter(g => g.ext >= minFrac * maxExt && g.members.length >= 10);
    const out = [];
    for (const g of big) {
      const sub = g.members.map(i => pts[i]);
      try {
        const p = autoProfile(sub, tol, closedMode, maxGap);
        if (p.vertices.length >= 2) out.push(Object.assign(p, { components: [] }));
      } catch (e) { /* zu wenige Punkte in dieser Gruppe */ }
    }
    if (!out.length) throw new Error('Kein Profil gefunden (max. Punktabstand evtl. zu klein).');
    // von links nach rechts sortieren
    const cu = p => p.vertices.reduce((a, q) => a + q[0], 0) / p.vertices.length;
    out.sort((a, b) => cu(a) - cu(b));
    return out;
  }

  /** Punktgruppen mit Verbindungsabstand «link» (Einzelverkettung über Rasterzellen). */
  function clusters(P, link) {
    const n = P.length, map = new Map(), key = (ix, iy) => ix * 1048576 + iy;
    P.forEach((p, i) => { const k = key(Math.floor(p[0] / link), Math.floor(p[1] / link)); if (!map.has(k)) map.set(k, []); map.get(k).push(i); });
    const comp = new Int32Array(n).fill(-1), out = [], l2 = link * link;
    for (let s0 = 0; s0 < n; s0++) {
      if (comp[s0] >= 0) continue;
      const members = [s0]; comp[s0] = out.length;
      for (let h = 0; h < members.length; h++) {
        const p = P[members[h]], ix = Math.floor(p[0] / link), iy = Math.floor(p[1] / link);
        for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
          const l = map.get(key(ix + a, iy + b)); if (!l) continue;
          for (const j of l) if (comp[j] < 0 && (P[j][0] - p[0]) ** 2 + (P[j][1] - p[1]) ** 2 <= l2) { comp[j] = out.length; members.push(j); }
        }
      }
      let mnx = Infinity, mny = Infinity, mxx = -Infinity, mxy = -Infinity;
      for (const j of members) { const q = P[j]; mnx = Math.min(mnx, q[0]); mny = Math.min(mny, q[1]); mxx = Math.max(mxx, q[0]); mxy = Math.max(mxy, q[1]); }
      out.push({ members, ext: Math.hypot(mxx - mnx, mxy - mny) });
    }
    return out;
  }

  // ─────────────────────────────────────── Vorlage an neue Punkte anpassen
  /**
   * Bestehendes Profil (gleiche Eckenzahl) an Querschnittspunkte anpassen:
   * Verschiebung (robuste ICP, nur Translation), dann Geradenausgleich je Kante.
   * Die Topologie bleibt erhalten -> konsistente Interpolation zwischen Querschnitten.
   */
  function fitTemplate(template, closed, uv, search = 0.15, align = true, iterations = 3) {
    let V = template.map(p => p.slice());
    if (uv.length < 5 || V.length < 2) return { vertices: V, closed };
    const grid = new Map();
    const cs = search;
    const key = (ix, iy) => ix * 1048576 + iy;
    uv.forEach((p, i) => {
      const k = key(Math.floor(p[0] / cs), Math.floor(p[1] / cs));
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(i);
    });
    const nearest = (x, y, rmax) => {
      const ix = Math.floor(x / cs), iy = Math.floor(y / cs);
      const R = Math.ceil(rmax / cs);
      let best = -1, bd = rmax * rmax;
      for (let a = -R; a <= R; a++) for (let b = -R; b <= R; b++) {
        const l = grid.get(key(ix + a, iy + b));
        if (!l) continue;
        for (const j of l) { const d = (uv[j][0] - x) ** 2 + (uv[j][1] - y) ** 2; if (d < bd) { bd = d; best = j; } }
      }
      return best;
    };
    if (align) {
      const L = g2.polylineLength(V, closed);
      const ns = Math.max(20, Math.min(400, Math.round(L / Math.max(search / 4, 0.01))));
      const S = g2.resample(V, ns, closed);
      let sx = 0, sy = 0;
      for (let it = 0; it < 20; it++) {
        const dx = [], dy = [];
        for (const p of S) {
          const j = nearest(p[0] + sx, p[1] + sy, search * 2);
          if (j >= 0) { dx.push(uv[j][0] - p[0] - sx); dy.push(uv[j][1] - p[1] - sy); }
        }
        if (dx.length < 5) break;
        const med = a => { a.sort((x, y) => x - y); return a[a.length >> 1]; };
        const mx = med(dx), my = med(dy);
        sx += mx; sy += my;
        if (Math.hypot(mx, my) < 1e-4) break;
      }
      V = V.map(p => [p[0] + sx, p[1] + sy]);
    }
    const ne = g2.edgeCount(V.length, closed);
    for (let it = 0; it < iterations; it++) {
      const { dist, seg } = g2.distancesToPolyline(uv, V, closed);
      const E = g2.edges(V, closed);
      const lines = E.map(([a, b], e) => {
        let pts = [];
        for (let i = 0; i < uv.length; i++) if (seg[i] === e && dist[i] <= search) pts.push(uv[i]);
        if (pts.length >= 5) {
          const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy || 1;
          const core = pts.filter(p => { const t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2; return t > 0.08 && t < 0.92; });
          if (core.length >= 4) pts = core;
          return g2.fitLine(pts);
        }
        const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
        return { c: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], d: [(b[0] - a[0]) / L, (b[1] - a[1]) / L] };
      });
      if (lines.length !== ne) break;
      V = cornerFromLines(V, lines, closed, search);
    }
    return { vertices: V, closed };
  }

  /** Alle Teilprofile eines Vorlage-Querschnitts an neue Punkte anpassen (Bauteile werden kopiert). */
  function fitSection(templateSec, uv, search = 0.15) {
    return profilesOf(templateSec).filter(p => p.vertices.length >= 2).map(p =>
      Object.assign(fitTemplate(p.vertices, p.closed, uv, search), { components: JSON.parse(JSON.stringify(p.components || [])) }));
  }

  // ─────────────────────────────────────────────── Bauteil-Vorschlag
  const TYPE_LABEL = { floor: 'Bodenplatte', wall: 'Wand', ceiling: 'Decke' };

  /** Kanten nach Neigung: flach unten = Bodenplatte, flach oben = Decke, sonst Wand. */
  function suggestComponents(V, closed, thickness = {}, angleDeg = 35) {
    const th = Object.assign({ floor: 0.30, wall: 0.30, ceiling: 0.30 }, thickness);
    if (V.length < 2) return [];
    const E = g2.edges(V, closed);
    const vs = V.map(p => p[1]), us = V.map(p => p[0]);
    const vc = (Math.min(...vs) + Math.max(...vs)) / 2, uc = (Math.min(...us) + Math.max(...us)) / 2;
    const cls = E.map(([a, b]) => {
      let ang = Math.abs(Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI);
      ang = Math.min(ang, 180 - ang);
      if (ang <= angleDeg) return (a[1] + b[1]) / 2 < vc ? 'floor' : 'ceiling';
      return 'wall';
    });
    const ne = E.length;
    let start = 0;
    if (closed) for (let e = 0; e < ne; e++) if (cls[e] !== cls[(e - 1 + ne) % ne]) { start = e; break; }
    const groups = [];
    let cur = [start];
    for (let k = 1; k < ne; k++) {
      const e = closed ? (start + k) % ne : k;
      if (cls[e] === cls[cur[cur.length - 1]]) cur.push(e); else { groups.push(cur); cur = [e]; }
    }
    groups.push(cur);
    const comps = groups.map(g => {
      const t = cls[g[0]];
      let name = TYPE_LABEL[t];
      if (t === 'wall') {
        const mu = g.reduce((s, e) => s + (E[e][0][0] + E[e][1][0]) / 2, 0) / g.length;
        name += mu > uc ? ' rechts' : ' links';
      }
      const endV = closed ? (g[g.length - 1] + 1) % V.length : g[g.length - 1] + 1;
      return { name, type: t, start: g[0], end: endV, thickness: th[t], flip: false };
    });
    const cnt = {}, seen = {};
    comps.forEach(c => { cnt[c.name] = (cnt[c.name] || 0) + 1; });
    comps.forEach(c => { if (cnt[c.name] > 1) { seen[c.name] = (seen[c.name] || 0) + 1; c.name += ' ' + seen[c.name]; } });
    return comps;
  }

  /** Kantenliste eines Bauteils (start..end, bei geschlossenem Profil zyklisch). */
  function componentEdges(comp, nV, closed) {
    const ne = g2.edgeCount(nV, closed);
    const out = [];
    if (!ne) return out;
    let e = comp.start;
    for (let guard = 0; guard < ne; guard++) {
      out.push(e);
      const nxt = closed ? (e + 1) % nV : e + 1;
      if (nxt === comp.end) break;
      e = nxt;
      if (!closed && e >= ne) break;
    }
    return out;
  }

  return { frame, uvToWorld, worldToUv, extractPoints, newSection, generateAlongAxis, orderedPath,
    autoProfile, autoProfiles, fitTemplate, suggestComponents, componentEdges, TYPE_LABEL, uid,
    profilesOf, allComponents, nVertices, fitSection, DEFAULT_MAX_GAP,
    _internals: { nnSpacing, denoise, dropSmallClusters } };
})();
