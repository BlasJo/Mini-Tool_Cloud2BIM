/* ═══ Cloud2BIM Kern: Bauteile (Loft zwischen Querschnitten), Stützen, Drahtmodell ═══ */
C2B.model = (() => {
  const g2 = C2B.g2, sec = C2B.sec;
  const DEFAULT_T = { floor: 0.30, wall: 0.30, ceiling: 0.30 };

  function validSections(sections) {
    return sections.filter(s => sec.profilesOf(s).some(p => p.vertices.length >= 2))
      .slice().sort((a, b) => a.station - b.station);
  }

  /**
   * Bauteilstärken je Querschnitt auflösen. Leere Stärke (null) = linear über die
   * Station zwischen den Nachbarquerschnitten mit Angabe interpoliert (aussen konstant).
   */
  function resolveThicknesses(sections) {
    const S = validSections(sections);
    const out = new Map(S.map(s => [s.id, {}]));
    const names = new Set();
    S.forEach(s => sec.allComponents(s).forEach(c => names.add(c.name)));
    for (const name of names) {
      const known = [];
      let type = 'wall';
      S.forEach(s => {
        const c = sec.allComponents(s).find(c => c.name === name);
        if (c) { type = c.type; if (c.thickness !== null && c.thickness !== '' && isFinite(c.thickness)) known.push([s.station, +c.thickness]); }
      });
      S.forEach(s => {
        const c = sec.allComponents(s).find(c => c.name === name);
        if (!c) return;
        let t;
        if (c.thickness !== null && c.thickness !== '' && isFinite(c.thickness)) t = +c.thickness;
        else if (!known.length) t = DEFAULT_T[type] || 0.3;
        else if (s.station <= known[0][0]) t = known[0][1];
        else if (s.station >= known[known.length - 1][0]) t = known[known.length - 1][1];
        else {
          let k = 0; while (known[k + 1][0] < s.station) k++;
          const [s0, t0] = known[k], [s1, t1] = known[k + 1];
          t = s1 > s0 ? t0 + (t1 - t0) * (s.station - s0) / (s1 - s0) : t0;
        }
        out.get(s.id)[name] = { t, interpolated: !(c.thickness !== null && c.thickness !== '' && isFinite(c.thickness)) };
      });
    }
    return out;
  }

  /**
   * 2D-Ringe aller Bauteile eines Querschnitts. Die Aussenkante wird je Kante um die
   * Bauteilstärke versetzt; an Bauteilgrenzen schneiden sich die Versatzgeraden
   * (Gehrung), damit keine Lücken/Überlappungen entstehen.
   */
  function sectionRings(s, tmap) {
    const out = {};
    sec.profilesOf(s).forEach((P, pi) => {
      if (P.vertices.length < 2) return;
      const r = profileRings(P, tmap);
      Object.keys(r).forEach(k => { r[k].profileIndex = pi; out[k] = r[k]; });
    });
    return out;
  }

  /** Ringe der Bauteile eines Teilprofils { vertices, closed, components }. */
  function profileRings(s, tmap) {
    const V = s.vertices, closed = !!s.closed && V.length >= 3;
    const nV = V.length;
    const E = g2.edges(V, closed);
    const ne = E.length;
    const thick = new Array(ne).fill(null), sign = new Array(ne).fill(1);
    const area = closed ? g2.signedArea(V) : 0;
    let cu = 0, cv = 0; V.forEach(p => { cu += p[0]; cv += p[1]; }); cu /= nV; cv /= nV;
    const comps = (s.components || []).filter(c => tmap && tmap[c.name]);
    comps.forEach(c => {
      const ce = sec.componentEdges(c, nV, closed);
      let sg;
      if (closed) sg = area >= 0 ? 1 : -1;
      else {
        const e = ce[Math.floor(ce.length / 2)];
        const [a, b] = E[e];
        const n = g2.rightNormal(a, b);
        const dot = n[0] * ((a[0] + b[0]) / 2 - cu) + n[1] * ((a[1] + b[1]) / 2 - cv);
        sg = dot >= 0 ? 1 : -1;
      }
      if (c.flip) sg = -sg;
      ce.forEach(e => { thick[e] = tmap[c.name].t; sign[e] = sg; });
    });
    const offLine = e => {
      const [a, b] = E[e];
      const n = g2.rightNormal(a, b), t = thick[e] * sign[e];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      return { c: [a[0] + n[0] * t, a[1] + n[1] * t], d: [(b[0] - a[0]) / L, (b[1] - a[1]) / L] };
    };
    const perp = (k, e) => {
      const [a, b] = E[e];
      const n = g2.rightNormal(a, b), t = thick[e] * sign[e];
      return [V[k][0] + n[0] * t, V[k][1] + n[1] * t];
    };
    const outerPoint = (k, e) => {
      const prevE = closed ? (k - 1 + ne) % ne : k - 1;
      const nextE = closed ? k % ne : k;
      const other = e === nextE ? prevE : nextE;
      if (other < 0 || other >= ne || other === e || thick[other] === null || sign[other] !== sign[e]) return perp(k, e);
      const p = g2.intersectLines(offLine(e), offLine(other), Math.sin(2 * Math.PI / 180));
      const tmax = Math.max(thick[e], thick[other]);
      if (!p || Math.hypot(p[0] - V[k][0], p[1] - V[k][1]) > 4 * tmax) return perp(k, e);
      return p;
    };
    const rings = {};
    comps.forEach(c => {
      const ce = sec.componentEdges(c, nV, closed);
      if (!ce.length) return;
      const vIdx = ce.map(e => e).concat([closed ? (ce[ce.length - 1] + 1) % nV : ce[ce.length - 1] + 1]);
      const inner = vIdx.map(k => V[k].slice());
      const outer = vIdx.map((k, i) => outerPoint(k, i < ce.length ? ce[i] : ce[ce.length - 1]));
      rings[c.name] = { comp: c, inner, outer, t: tmap[c.name].t };
    });
    return rings;
  }

  function ringOf(r, m) {
    const inner = r.inner.length === m ? r.inner : g2.densify(r.inner, m, false);
    const outer = r.outer.length === m ? r.outer : g2.densify(r.outer, m, false);
    return inner.concat(outer.slice().reverse());
  }

  /** Geschlossenes Dreiecksnetz zwischen 2D-Ringen gleicher Punktzahl (Loft). */
  function loftMesh(sectionsRun, rings2d) {
    const m = rings2d[0].length;
    const verts = [], faces = [];
    sectionsRun.forEach((s, j) => rings2d[j].forEach(p => verts.push(sec.uvToWorld(s, p))));
    for (let j = 0; j < rings2d.length - 1; j++) {
      const A = j * m, B = (j + 1) * m;
      for (let i = 0; i < m; i++) {
        const i1 = (i + 1) % m;
        faces.push([A + i, A + i1, B + i1], [A + i, B + i1, B + i]);
      }
    }
    // Deckel
    const capA = g2.triangulate(rings2d[0]);
    const lastO = (rings2d.length - 1) * m;
    const capB = g2.triangulate(rings2d[rings2d.length - 1]);
    capA.forEach(t => faces.push([t[0], t[1], t[2]]));
    capB.forEach(t => faces.push([lastO + t[2], lastO + t[1], lastO + t[0]]));
    // Orientierung nach aussen (positives Volumen)
    let vol = signedVolume(verts, faces);
    if (vol < 0) { faces.forEach(f => f.reverse()); vol = -vol; }
    return { verts, faces, volume: vol, ringSize: m, nRings: rings2d.length };
  }

  function signedVolume(V, F) {
    let s = 0;
    for (const [a, b, c] of F) {
      const p = V[a], q = V[b], r = V[c];
      s += p[0] * (q[1] * r[2] - q[2] * r[1]) - p[1] * (q[0] * r[2] - q[2] * r[0]) + p[2] * (q[0] * r[1] - q[1] * r[0]);
    }
    return s / 6;
  }

  /** Ring so drehen, dass er bestmöglich auf den Vorgänger passt (gleiche Punktzahl). */
  function alignCyclic(prev, cur, closed) {
    if (!closed || prev.length !== cur.length) return cur;
    const n = cur.length;
    let best = 0, bd = Infinity;
    for (let s = 0; s < n; s++) {
      let d = 0;
      for (let i = 0; i < n; i++) { const a = prev[i], b = cur[(i + s) % n]; d += (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2; }
      if (d < bd) { bd = d; best = s; }
    }
    return best ? cur.slice(best).concat(cur.slice(0, best)) : cur;
  }

  /**
   * Volumenkörper aller Bauteile (Bodenplatte, Wände, Decke).
   * split = 'durchgehend' (ein Element je Bauteilname und zusammenhängendem Bereich)
   *       | 'abschnitt'   (ein Element je Querschnitts-Intervall)
   */
  function buildSolids(project, { split = 'durchgehend' } = {}) {
    const S = validSections(project.sections);
    const T = resolveThicknesses(project.sections);
    const per = S.map(s => sectionRings(s, T.get(s.id)));
    const names = [];
    S.forEach(s => sec.allComponents(s).forEach(c => { if (!names.includes(c.name)) names.push(c.name); }));
    const solids = [], warnings = [];
    for (const name of names) {
      // zusammenhängende Läufe von Querschnitten mit diesem Bauteil
      let run = [];
      const flush = () => {
        if (run.length >= 2) {
          const pieces = split === 'abschnitt' ? run.slice(0, -1).map((_, i) => run.slice(i, i + 2)) : [run];
          pieces.forEach((pc, pi) => {
            const m = Math.max(...pc.map(j => per[j][name].inner.length));
            if (pc.some(j => per[j][name].inner.length !== m)) warnings.push(`${name}: unterschiedliche Eckenzahl zwischen ${S[pc[0]].name} und ${S[pc[pc.length - 1]].name} – Ecken wurden ergänzt.`);
            const rings = pc.map(j => ringOf(per[j][name], m));
            const mesh = loftMesh(pc.map(j => S[j]), rings);
            const c = per[pc[0]][name].comp;
            solids.push({ name: pieces.length > 1 ? `${name} [${S[pc[0]].station.toFixed(2)}–${S[pc[pc.length - 1]].station.toFixed(2)}]` : name,
              baseName: name, type: c.type, stations: [S[pc[0]].station, S[pc[pc.length - 1]].station],
              thickness: pc.map(j => per[j][name].t), ...mesh });
          });
        } else if (run.length === 1) warnings.push(`${name}: nur in einem Querschnitt (${S[run[0]].name}) definiert – kein Körper erzeugt.`);
        run = [];
      };
      S.forEach((s, j) => { if (per[j][name]) run.push(j); else flush(); });
      flush();
    }
    return { solids, warnings };
  }

  // ──────────────────────────────────────────────────────── Stützen
  function columnMesh(c, seg = 24) {
    const base = [];
    if (c.shape === 'circle') {
      const r = c.d / 2;
      for (let i = 0; i < seg; i++) { const a = 2 * Math.PI * i / seg; base.push([r * Math.cos(a), r * Math.sin(a)]); }
    } else {
      const bx = c.b / 2, hy = c.h / 2;
      base.push([-bx, -hy], [bx, -hy], [bx, hy], [-bx, hy]);
    }
    const rot = (c.rot || 0) * Math.PI / 180, cs = Math.cos(rot), sn = Math.sin(rot);
    const P = base.map(([x, y]) => [c.x + x * cs - y * sn, c.y + x * sn + y * cs]);
    const n = P.length;
    const verts = P.map(p => [p[0], p[1], c.zBottom]).concat(P.map(p => [p[0], p[1], c.zTop]));
    const faces = [];
    for (let i = 0; i < n; i++) { const j = (i + 1) % n; faces.push([i, j, n + j], [i, n + j, n + i]); }
    for (let i = 1; i < n - 1; i++) { faces.push([0, i + 1, i]); faces.push([n, n + i, n + i + 1]); }
    return { verts, faces, volume: Math.abs(signedVolume(verts, faces)) };
  }

  /** Stütze aus Punkten nahe einem Klick einpassen (Kreis: algebraisch, Rechteck: Hauptachsen). */
  function fitColumn(cloud, x, y, zMid, { radius = 0.6, dz = 0.25, shape = 'auto' } = {}) {
    const P = [];
    const { xyz, n } = cloud;
    const r2 = radius * radius;
    for (let i = 0; i < n; i++) {
      const px = xyz[i * 3], py = xyz[i * 3 + 1], pz = xyz[i * 3 + 2];
      if (Math.abs(pz - zMid) > dz) continue;
      if ((px - x) ** 2 + (py - y) ** 2 <= r2) P.push([px, py]);
    }
    if (P.length < 8) throw new Error('Zu wenige Punkte um den gewählten Ort (' + P.length + '). Radius oder Höhe anpassen.');
    // Kreis (Kasa)
    let sx = 0, sy = 0; P.forEach(p => { sx += p[0]; sy += p[1]; });
    const mx = sx / P.length, my = sy / P.length;
    let Suu = 0, Suv = 0, Svv = 0, Suuu = 0, Svvv = 0, Suvv = 0, Svuu = 0;
    P.forEach(([px, py]) => {
      const u = px - mx, v = py - my;
      Suu += u * u; Suv += u * v; Svv += v * v; Suuu += u * u * u; Svvv += v * v * v; Suvv += u * v * v; Svuu += v * u * u;
    });
    const det = Suu * Svv - Suv * Suv;
    let circle = null;
    if (Math.abs(det) > 1e-12) {
      const b1 = 0.5 * (Suuu + Suvv), b2 = 0.5 * (Svvv + Svuu);
      const uc = (b1 * Svv - b2 * Suv) / det, vc = (Suu * b2 - Suv * b1) / det;
      const R = Math.sqrt(uc * uc + vc * vc + (Suu + Svv) / P.length);
      let res = 0; P.forEach(([px, py]) => { res += (Math.hypot(px - mx - uc, py - my - vc) - R) ** 2; });
      circle = { x: mx + uc, y: my + vc, d: 2 * R, rms: Math.sqrt(res / P.length) };
    }
    // Rechteck: Drehwinkel 0..90° absuchen (Hauptachsen sind bei quadratischen Stützen
    // unbestimmt); je Winkel robuste Ausdehnung und Abstand der Punkte zur nächsten Seite.
    const q = (a, f) => a[Math.min(a.length - 1, Math.max(0, Math.round(f * (a.length - 1))))];
    const rectAt = ang => {
      const ca = Math.cos(ang), sa = Math.sin(ang);
      const us = new Float64Array(P.length), vs = new Float64Array(P.length);
      P.forEach(([px, py], i) => { us[i] = (px - mx) * ca + (py - my) * sa; vs[i] = -(px - mx) * sa + (py - my) * ca; });
      const su = Array.from(us).sort((a, b) => a - b), sv = Array.from(vs).sort((a, b) => a - b);
      const u0 = q(su, 0.01), u1 = q(su, 0.99), v0 = q(sv, 0.01), v1 = q(sv, 0.99);
      const uc = (u0 + u1) / 2, vc = (v0 + v1) / 2, hu = (u1 - u0) / 2, hv = (v1 - v0) / 2;
      let res = 0;
      for (let i = 0; i < P.length; i++) {
        const du = Math.abs(Math.abs(us[i] - uc) - hu), dv = Math.abs(Math.abs(vs[i] - vc) - hv);
        res += Math.min(du, dv) ** 2;
      }
      return { ang, uc, vc, b: 2 * hu, h: 2 * hv, rms: Math.sqrt(res / P.length) };
    };
    let best = null;
    for (let a = 0; a < 90; a += 1) { const r = rectAt(a * Math.PI / 180); if (!best || r.rms < best.rms) best = r; }
    for (let a = -1; a <= 1; a += 0.1) { const r = rectAt(best.ang + a * Math.PI / 180); if (r.rms < best.rms) best = r; }
    const ca = Math.cos(best.ang), sa = Math.sin(best.ang);
    const rect = { x: mx + best.uc * ca - best.vc * sa, y: my + best.uc * sa + best.vc * ca, b: best.b, h: best.h,
      rot: best.ang * 180 / Math.PI, rms: best.rms };
    let use = shape;
    if (shape === 'auto') use = circle && circle.rms < rect.rms ? 'circle' : 'rect';
    return { shape: use, circle, rect, n: P.length };
  }

  /** Höhe einer Stütze aus den Punkten im Grundriss-Umfeld (Perzentile). */
  function columnHeightFromCloud(cloud, x, y, r) {
    const zs = [];
    const { xyz, n } = cloud;
    for (let i = 0; i < n; i++) if ((xyz[i * 3] - x) ** 2 + (xyz[i * 3 + 1] - y) ** 2 <= r * r) zs.push(xyz[i * 3 + 2]);
    if (zs.length < 5) return null;
    zs.sort((a, b) => a - b);
    return { zBottom: zs[Math.floor(0.01 * (zs.length - 1))], zTop: zs[Math.ceil(0.99 * (zs.length - 1))] };
  }

  // ──────────────────────────────────────────────────────── Drahtmodell
  /**
   * Drahtmodell: Querschnittsprofile, Längskanten zwischen entsprechenden Ecken,
   * optional Zwischenprofile (linear interpoliert) und Aussenkanten der Bauteile.
   * Liefert Polylinien { layer, pts: [[x,y,z]...], closed } und ein Flächennetz (Innenfläche).
   */
  function buildWireframe(project, { intermediate = 0, includeComponents = true } = {}) {
    const S = validSections(project.sections);
    const lines = [], warnings = [];
    const meshV = [], meshF = [];
    // Teilprofile benachbarter Querschnitte über den Schwerpunkt zuordnen (z. B. zwei Tunnelröhren)
    const centroid = (s, P) => { let u = 0, v = 0; P.vertices.forEach(q => { u += q[0]; v += q[1]; }); const n = P.vertices.length || 1; return sec.uvToWorld(s, [u / n, v / n]); };
    let prevList = [];
    S.forEach(s => {
      const cur = [];
      sec.profilesOf(s).forEach(P => {
        if (P.vertices.length < 2) return;
        const closed = !!P.closed && P.vertices.length >= 3;
        let V = P.vertices.map(p => p.slice());
        const c = centroid(s, P);
        // nächstes freies Teilprofil im Vorgänger
        let prev = null, bd = Infinity;
        prevList.forEach(q => { if (q.used) return; const d = Math.hypot(q.c[0] - c[0], q.c[1] - c[1], q.c[2] - c[2]); if (d < bd) { bd = d; prev = q; } });
        if (prev && bd > 5 * Math.max(1, Math.abs(s.station - prev.s.station))) prev = null;   // zu weit weg: kein Partner
        if (prev) {
          prev.used = true;
          const m = Math.max(prev.V.length, V.length);
          let A = prev.V, B = V;
          if (prev.closed !== closed) warnings.push(`${prev.s.name} / ${s.name}: offenes und geschlossenes Profil – Längskanten übersprungen.`);
          else {
            if (A.length !== B.length) {
              warnings.push(`${prev.s.name} (${A.length} Ecken) / ${s.name} (${B.length} Ecken): Eckenzahl verschieden – Ecken wurden ergänzt. Tipp: «Profil auf alle» für gleiche Topologie.`);
              A = g2.densify(A, m, closed); B = g2.densify(B, m, closed);
            }
            B = alignCyclic(A, B, closed);
            const A3 = A.map(p => sec.uvToWorld(prev.s, p)), B3 = B.map(p => sec.uvToWorld(s, p));
            for (let i = 0; i < m; i++) lines.push({ layer: 'C2B_Laengskanten', pts: [A3[i], B3[i]], closed: false });
            for (let k = 1; k <= intermediate; k++) {
              const t = k / (intermediate + 1);
              lines.push({ layer: 'C2B_Zwischenprofile', closed, pts: A3.map((a, i) => a.map((x, cc) => x + t * (B3[i][cc] - x))) });
            }
            const base = meshV.length;
            A3.forEach(p => meshV.push(p)); B3.forEach(p => meshV.push(p));
            const ne = closed ? m : m - 1;
            for (let i = 0; i < ne; i++) { const i1 = (i + 1) % m; meshF.push([base + i, base + i1, base + m + i1, base + m + i]); }
            V = B;   // ausgerichtete Reihenfolge weitergeben
          }
        }
        lines.push({ layer: 'C2B_Profile', closed, pts: V.map(p => sec.uvToWorld(s, p)), name: s.name });
        cur.push({ s, V, closed, c, used: false });
      });
      if (cur.length) prevList = cur;
    });
    if (includeComponents) {
      const { solids } = buildSolids(project);
      const T = resolveThicknesses(project.sections);
      S.forEach(s => {
        const rings = sectionRings(s, T.get(s.id));
        Object.values(rings).forEach(r => lines.push({ layer: 'C2B_Bauteile_Aussen', closed: false, pts: r.outer.map(p => sec.uvToWorld(s, p)) }));
      });
      // Längskanten der Aussenseite aus den Volumenkörpern (Ringpunkte der Aussenkontur)
      solids.forEach(so => {
        const m = so.ringSize, half = m / 2;   // Ring = Innenkette (half) + Aussenkette rückwärts (half)
        for (let j = 0; j < so.nRings - 1; j++) for (let i = half; i < m; i++)
          lines.push({ layer: 'C2B_Bauteile_Laengs', closed: false, pts: [so.verts[j * m + i], so.verts[(j + 1) * m + i]] });
      });
    }
    return { lines, mesh: { verts: meshV, quads: meshF }, warnings };
  }

  /**
   * Interpolierte Bauteilquerschnitte zwischen den definierten Querschnitten (für die Anzeige):
   * je Volumenkörper und Intervall «perInterval» Zwischenringe als 3D-Polygone.
   */
  function interpolatedRings(solids, perInterval = 3) {
    const out = [];
    solids.forEach(so => {
      const m = so.ringSize;
      for (let j = 0; j < so.nRings - 1; j++) for (let k = 1; k <= perInterval; k++) {
        const t = k / (perInterval + 1), ring = [];
        for (let i = 0; i < m; i++) {
          const a = so.verts[j * m + i], b = so.verts[(j + 1) * m + i];
          ring.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]), a[2] + t * (b[2] - a[2])]);
        }
        out.push({ type: so.type, name: so.baseName, pts: ring });
      }
    });
    return out;
  }

  return { resolveThicknesses, sectionRings, profileRings, interpolatedRings, buildSolids, loftMesh, signedVolume, columnMesh, fitColumn,
    columnHeightFromCloud, buildWireframe, validSections, alignCyclic, DEFAULT_T };
})();
