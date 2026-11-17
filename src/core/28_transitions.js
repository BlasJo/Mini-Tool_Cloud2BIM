/* ═══ Cloud2BIM Kern: Übergangsquerschnitte ═══
   Ein Übergang (s.kind = 'transition') ist ein Querschnitt mit eigener Tiefe entlang der Achse
   (s.trans = { depth, align: 'center'|'forward'|'backward' }). Seine Teilprofile beschreiben die
   Fläche: role 'outer' = Fläche, role 'hole' = Aussparung. Daraus entsteht ein Prisma (z. B.
   Stirnwand, wo zwei Röhren in eine übergehen). Die Interpolation der normalen Querschnitte
   läuft nicht durch einen Übergang: Bauteile enden an seiner Stirnfläche (Verschnitt). */
C2B.trans = (() => {
  const g2 = C2B.g2, sec = C2B.sec;
  const EPS = 1e-6;

  const isTrans = s => !!s && s.kind === 'transition';

  function newTransition(origin, angle, station, { depth = 0.5, align = 'center', name, sliceDepth = 0.05 } = {}) {
    const s = sec.newSection(origin, angle, station, sliceDepth, name || ('Übergang ' + station.toFixed(2)));
    s.kind = 'transition';
    s.trans = { depth, align };
    return s;
  }

  /** Stationsbereich [von, bis] des Übergangsvolumens. */
  function range(T) {
    const d = Math.max(0.001, (T.trans && T.trans.depth) || 0.5), st = T.station, a = (T.trans && T.trans.align) || 'center';
    return a === 'forward' ? [st, st + d] : a === 'backward' ? [st - d, st] : [st - d / 2, st + d / 2];
  }

  function list(sections) {
    return sections.filter(isTrans).map(T => ({ T, r: range(T) })).sort((a, b) => a.r[0] - b.r[0]);
  }

  /** Querschnitt (oder Übergang) entlang seiner eigenen Achsrichtung um ds verschoben (virtueller Rahmen). */
  function shifted(s, ds) {
    const f = sec.frame(s);
    return { origin: [s.origin[0] + f.d[0] * ds, s.origin[1] + f.d[1] * ds], angle: s.angle, station: s.station + ds, name: s.name };
  }

  /**
   * Schnitt-Logik für die Interpolation normaler Querschnitte.
   * normals: normale Querschnitte mit Profil, nach Station sortiert.
   */
  function cutter(sections, normals) {
    const TR = list(sections);
    const st = normals.map(s => s.station);
    const between = (a, b) => st.some(x => x > a + EPS && x < b - EPS);
    return {
      any: TR.length > 0,
      transitions: TR,
      /** Liegt zwischen zwei Stationen ein Übergang? */
      blocked(s1, s2) { return TR.some(({ r }) => r[1] > s1 + EPS && r[0] < s2 - EPS); },
      /** Stirnfläche (Station) eines Übergangs direkt vor s (kein anderer normaler Querschnitt dazwischen). */
      faceBefore(s) {
        let best = null;
        TR.forEach(t => { if (t.r[0] <= s + EPS && !between(t.r[1], s) && (!best || t.r[1] > best.face)) best = { T: t.T, face: t.r[1] }; });
        return best;
      },
      /** Stirnfläche eines Übergangs direkt nach s. */
      faceAfter(s) {
        let best = null;
        TR.forEach(t => { if (t.r[1] >= s - EPS && !between(s, t.r[0]) && (!best || t.r[0] < best.face)) best = { T: t.T, face: t.r[0] }; });
        return best;
      },
    };
  }

  /** Flächen des Übergangs: [{ outer: [[u,v]...], holes: [[[u,v]...]] }] (Bögen aufgelöst). */
  function areas(T) {
    const P = sec.profilesOf(T).filter(p => p.vertices.length >= 3);
    const ring = p => { const v = C2B.arc.expand(Object.assign({}, p, { closed: true })).vertices; return v; };
    const outs = P.filter(p => p.role !== 'hole').map(p => { let v = ring(p); if (g2.signedArea(v) < 0) v = v.slice().reverse(); return { outer: v, holes: [] }; });
    P.filter(p => p.role === 'hole').forEach(p => {
      let v = ring(p); if (g2.signedArea(v) > 0) v = v.slice().reverse();
      const c = v.reduce((a, q) => [a[0] + q[0] / v.length, a[1] + q[1] / v.length], [0, 0]);
      const o = outs.find(o => C2B.planes.pointInPoly(c[0], c[1], o.outer));
      if (o) o.holes.push(v);
    });
    // Berührende Ringe (Aussparung liegt auf dem Rand): Ecken gegenseitig in die Kanten einfügen,
    // damit Deckel und Mantel dieselben Ecken haben (geschlossener Körper ohne T-Stösse)
    outs.forEach(o => {
      const rings = [o.outer].concat(o.holes);
      for (let a = 0; a < rings.length; a++) for (let b = 0; b < rings.length; b++) {
        if (a === b) continue;
        rings[b].forEach(q => {
          const R = rings[a];
          for (let i = 0; i < R.length; i++) {
            const p0 = R[i], p1 = R[(i + 1) % R.length];
            if (Math.hypot(q[0] - p0[0], q[1] - p0[1]) < 1e-7 || Math.hypot(q[0] - p1[0], q[1] - p1[1]) < 1e-7) break;
            if (g2.distPointSeg(q[0], q[1], p0[0], p0[1], p1[0], p1[1]) < 1e-7) { R.splice(i + 1, 0, q.slice()); break; }
          }
        });
      }
      o.outer = rings[0]; o.holes = rings.slice(1);
    });
    return outs;
  }

  function areaOf(T) {
    return areas(T).reduce((s, a) => s + Math.abs(g2.signedArea(a.outer)) - a.holes.reduce((h, x) => h + Math.abs(g2.signedArea(x)), 0), 0);
  }

  /** Prisma aus allen Flächen des Übergangs: { verts, faces, volume } oder null. */
  function prismMesh(T) {
    const A = areas(T);
    if (!A.length) return null;
    const [sa, sb] = range(T);
    const Fa = shifted(T, sa - T.station), Fb = shifted(T, sb - T.station);
    const verts = [], faces = [];
    A.forEach(ar => {
      const tri = g2.triangulateHoles(ar.outer, ar.holes);
      const n = tri.pts.length, base = verts.length;
      tri.pts.forEach(p => verts.push(sec.uvToWorld(Fa, p)));
      tri.pts.forEach(p => verts.push(sec.uvToWorld(Fb, p)));
      const f0 = faces.length;
      tri.tris.forEach(([i, j, k]) => { faces.push([base + i, base + j, base + k]); faces.push([base + n + k, base + n + j, base + n + i]); });
      let off = 0;
      // Kantenstücke, die zwei Ringe gemeinsam haben (Aussparung auf dem Rand), erhalten keinen Mantel
      const pk = p => Math.round(p[0] * 1e6) + ',' + Math.round(p[1] * 1e6);
      const segCount = new Map();
      [ar.outer].concat(ar.holes).forEach(r => r.forEach((p, i) => { const k = [pk(p), pk(r[(i + 1) % r.length])].sort().join('|'); segCount.set(k, (segCount.get(k) || 0) + 1); }));
      [ar.outer].concat(ar.holes).forEach(r => {
        const m = r.length;
        for (let i = 0; i < m; i++) {
          const i1 = (i + 1) % m, a = base + off + i, b = base + off + i1;
          if (segCount.get([pk(r[i]), pk(r[i1])].sort().join('|')) > 1) continue;
          faces.push([a, b + n, b], [a, a + n, b + n]);   // gleiche Umlaufrichtung wie die Deckel
        }
        off += m;
      });
      // Orientation je Fläche prüfen (positives Volumen)
      const sub = faces.slice(f0);
      if (C2B.model.signedVolume(verts, sub) < 0) for (let k = f0; k < faces.length; k++) faces[k].reverse();
    });
    // gleiche Positionen verschweissen, entartete Dreiecke und deckungsgleiche Gegenflächen entfernen
    const key = p => p.map(x => Math.round(x * 1e6)).join(',');
    const map = new Map(), V2 = [], remap = verts.map(p => { const k = key(p); if (!map.has(k)) { map.set(k, V2.length); V2.push(p); } return map.get(k); });
    let F2 = faces.map(f => f.map(i => remap[i])).filter(f => f[0] !== f[1] && f[1] !== f[2] && f[0] !== f[2]);
    const fk = f => f.slice().sort((a, b) => a - b).join('_');
    const cnt = new Map(); F2.forEach(f => cnt.set(fk(f), (cnt.get(fk(f)) || 0) + 1));
    F2 = F2.filter(f => cnt.get(fk(f)) % 2 === 1);
    return { verts: V2, faces: F2, volume: Math.abs(C2B.model.signedVolume(V2, F2)) };
  }

  /** 3D-Polygone der beiden Stirnflächen (für Drahtmodell und Abgleich). */
  function facePolys(T) {
    const [sa, sb] = range(T);
    const out = [];
    [sa, sb].forEach(st => {
      const F = shifted(T, st - T.station);
      areas(T).forEach(ar => out.push({ outer: ar.outer.map(p => sec.uvToWorld(F, p)), holes: ar.holes.map(h => h.map(p => sec.uvToWorld(F, p))), uv: ar, frame: F }));
    });
    return out;
  }

  /** Normale Nachbarquerschnitte mit Profil (links = davor, rechts = danach). */
  function neighbors(sections, T) {
    const N = sections.filter(s => !isTrans(s) && sec.profilesOf(s).some(p => p.vertices.length >= 2)).sort((a, b) => a.station - b.station);
    const [sa, sb] = range(T);
    let left = null, right = null;
    N.forEach(s => { if (s.station <= sb && (!left || s.station > left.station) && s.station <= T.station) left = s; });
    N.forEach(s => { if (s.station >= sa && (!right || s.station < right.station) && s.station > T.station) right = s; });
    return { left, right };
  }

  /** u/v eines Punkts aus Querschnitt S im Rahmen des Übergangs T. */
  const toT = (T, S, uv) => sec.worldToUv(T, sec.uvToWorld(S, uv));

  /** Profil (inkl. Bögen) eines Nachbarn in den Rahmen des Übergangs übertragen. */
  function profileInT(T, S, P) {
    return { vertices: P.vertices.map(p => toT(T, S, p)), closed: !!P.closed, mids: P.mids ? P.mids.map(m => (m ? toT(T, S, m) : null)) : undefined, components: [] };
  }

  /** Überlagerung für den Editor: Profile und Bauteilringe beider Nachbarn im Rahmen von T. */
  function overlay(sections, T, tmap) {
    const nb = neighbors(sections, T);
    const side = (S, key) => {
      if (!S) return null;
      const profiles = sec.profilesOf(S).filter(p => p.vertices.length >= 2).map(P => profileInT(T, S, P));
      const rings = Object.values(C2B.model.sectionRings(S, (tmap && tmap.get(S.id)) || {})).map(r => r.inner.concat(r.outer.slice().reverse()).map(p => toT(T, S, p)));
      return { key, sec: S, profiles, rings };
    };
    return [side(nb.left, 'left'), side(nb.right, 'right')].filter(Boolean);
  }

  /**
   * Fläche vorschlagen: geschlossene Profile der Seite mit dem grössten Einzelprofil = Fläche,
   * geschlossene Profile der anderen Seite, die darin liegen = Aussparungen.
   * (Zwei Röhren → eine Röhre: Stirnwand = grosse Röhre minus die beiden Öffnungen.)
   */
  function suggestArea(sections, T) {
    const ov = overlay(sections, T, null);
    if (ov.length < 2) throw new Error('Für den Vorschlag braucht es links und rechts je einen normalen Querschnitt mit Profil.');
    const closed = o => o.profiles.filter(p => p.closed && p.vertices.length >= 3);
    const maxA = o => Math.max(0, ...closed(o).map(p => Math.abs(g2.signedArea(C2B.arc.expand(p).vertices))));
    const [big, small] = maxA(ov[0]) >= maxA(ov[1]) ? [ov[0], ov[1]] : [ov[1], ov[0]];
    const outs = closed(big);
    if (!outs.length) throw new Error('Kein geschlossenes Profil auf der Seite «' + big.sec.name + '».');
    const out = outs.map(p => Object.assign(p, { role: 'outer' }));
    closed(small).forEach(p => {
      const v = C2B.arc.expand(p).vertices;
      const c = v.reduce((a, q) => [a[0] + q[0] / v.length, a[1] + q[1] / v.length], [0, 0]);
      if (outs.some(o => C2B.planes.pointInPoly(c[0], c[1], C2B.arc.expand(o).vertices))) out.push(Object.assign(p, { role: 'hole' }));
    });
    return out;
  }

  return { isTrans, newTransition, range, list, shifted, cutter, areas, areaOf, prismMesh, facePolys, neighbors, overlay, suggestArea, toT };
})();
