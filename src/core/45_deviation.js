/* ═══ Cloud2BIM Kern: Abgleich interpoliertes Modell ↔ Punktwolke ═══
   Referenzfläche = interpolierte Innenfläche zwischen den Querschnitten (entsprechende Ecken
   linear verbunden, Bögen aufgelöst) – dieselbe Interpolation wie Volumenkörper und Drahtmodell.
   Für jeden Punkt wird der kürzeste Abstand zu dieser Fläche bestimmt (räumliches Raster). */
C2B.dev = (() => {

  /** Dreiecke der interpolierten Innenfläche als Float64Array (9 Werte je Dreieck). */
  function surfaceTriangles(project) {
    const wf = C2B.model.buildWireframe(project, { intermediate: 0, includeComponents: false });
    const V = wf.mesh.verts, Q = wf.mesh.quads;
    const tris = new Float64Array(Q.length * 18);
    let k = 0;
    const put = i => { const p = V[i]; tris[k++] = p[0]; tris[k++] = p[1]; tris[k++] = p[2]; };
    Q.forEach(([a, b, c, d]) => { put(a); put(b); put(c); put(a); put(c); put(d); });
    return { tris, n: Q.length * 2 };
  }

  /** Räumliches Raster: Dreiecke in alle Zellen, die ihre Hülle (± pad) berühren. */
  function buildIndex(surf, pad, cell = 0) {
    const { tris, n } = surf;
    if (!n) return null;
    let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < n * 9; i += 3) for (let c = 0; c < 3; c++) { const v = tris[i + c]; if (v < mn[c]) mn[c] = v; if (v > mx[c]) mx[c] = v; }
    if (!cell) {   // Zellgrösse aus Ausdehnung und Dreieckszahl
      const vol = (mx[0] - mn[0] + 2 * pad) * (mx[1] - mn[1] + 2 * pad) * (mx[2] - mn[2] + 2 * pad);
      cell = Math.max(0.1, Math.min(2, Math.cbrt(vol / Math.max(1, n) * 4)));
    }
    const o = mn.map(v => v - pad);
    const dims = [0, 1, 2].map(c => Math.max(1, Math.ceil((mx[c] - mn[c] + 2 * pad) / cell)));
    const cells = new Map();
    for (let t = 0; t < n; t++) {
      const b = t * 9;
      const lo = [0, 1, 2].map(c => Math.min(tris[b + c], tris[b + 3 + c], tris[b + 6 + c]) - pad);
      const hi = [0, 1, 2].map(c => Math.max(tris[b + c], tris[b + 3 + c], tris[b + 6 + c]) + pad);
      const i0 = lo.map((v, c) => Math.max(0, Math.floor((v - o[c]) / cell))), i1 = hi.map((v, c) => Math.min(dims[c] - 1, Math.floor((v - o[c]) / cell)));
      for (let x = i0[0]; x <= i1[0]; x++) for (let y = i0[1]; y <= i1[1]; y++) for (let z = i0[2]; z <= i1[2]; z++) {
        const key = (x * dims[1] + y) * dims[2] + z;
        let l = cells.get(key); if (!l) cells.set(key, (l = []));
        l.push(t);
      }
    }
    return { surf, cells, o, dims, cell, pad };
  }

  /** Quadrat des Abstands Punkt–Dreieck (Ericson, «Real-Time Collision Detection»). */
  function dist2PointTri(px, py, pz, T, b) {
    const ax = T[b], ay = T[b + 1], az = T[b + 2], bx = T[b + 3], by = T[b + 4], bz = T[b + 5], cx = T[b + 6], cy = T[b + 7], cz = T[b + 8];
    const abx = bx - ax, aby = by - ay, abz = bz - az, acx = cx - ax, acy = cy - ay, acz = cz - az;
    const apx = px - ax, apy = py - ay, apz = pz - az;
    const d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
    let qx, qy, qz;
    if (d1 <= 0 && d2 <= 0) { qx = ax; qy = ay; qz = az; }
    else {
      const bpx = px - bx, bpy = py - by, bpz = pz - bz;
      const d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
      if (d3 >= 0 && d4 <= d3) { qx = bx; qy = by; qz = bz; }
      else {
        const vc = d1 * d4 - d3 * d2;
        if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); qx = ax + v * abx; qy = ay + v * aby; qz = az + v * abz; }
        else {
          const cpx = px - cx, cpy = py - cy, cpz = pz - cz;
          const d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
          if (d6 >= 0 && d5 <= d6) { qx = cx; qy = cy; qz = cz; }
          else {
            const vb = d5 * d2 - d1 * d6;
            if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); qx = ax + w * acx; qy = ay + w * acy; qz = az + w * acz; }
            else {
              const va = d3 * d6 - d5 * d4;
              if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
                const w = (d4 - d3) / ((d4 - d3) + (d5 - d6)); qx = bx + w * (cx - bx); qy = by + w * (cy - by); qz = bz + w * (cz - bz);
              } else {
                const den = 1 / (va + vb + vc), v = vb * den, w = vc * den;
                qx = ax + abx * v + acx * w; qy = ay + aby * v + acy * w; qz = az + abz * v + acz * w;
              }
            }
          }
        }
      }
    }
    const dx = px - qx, dy = py - qy, dz = pz - qz;
    return dx * dx + dy * dy + dz * dz;
  }

  /**
   * Abstände der Punkte i0..i1 (Punktwolke cloud.xyz) zur Fläche in out (Float32Array).
   * Punkte ohne Fläche innerhalb von «pad» erhalten Infinity.
   */
  function distances(index, cloud, out, i0 = 0, i1 = cloud.n) {
    const { surf, cells, o, dims, cell, pad } = index, T = surf.tris, xyz = cloud.xyz;
    const pad2 = pad * pad;
    for (let i = i0; i < i1; i++) {
      const x = xyz[i * 3], y = xyz[i * 3 + 1], z = xyz[i * 3 + 2];
      const cx = Math.floor((x - o[0]) / cell), cy = Math.floor((y - o[1]) / cell), cz = Math.floor((z - o[2]) / cell);
      if (cx < 0 || cy < 0 || cz < 0 || cx >= dims[0] || cy >= dims[1] || cz >= dims[2]) { out[i] = Infinity; continue; }
      const l = cells.get((cx * dims[1] + cy) * dims[2] + cz);
      if (!l) { out[i] = Infinity; continue; }
      let best = pad2;
      for (let k = 0; k < l.length; k++) { const d = dist2PointTri(x, y, z, T, l[k] * 9); if (d < best) best = d; }
      out[i] = best < pad2 ? Math.sqrt(best) : Infinity;
    }
    return out;
  }

  /** Standard-Farbskala: obere Grenzen in m und Farben; darüber bis zur Suchgrenze «aboveColor». */
  const DEFAULT_SCALE = {
    classes: [{ max: 0.002, color: '#2D8653' }, { max: 0.004, color: '#F0A020' }, { max: 0.010, color: '#D70036' }, { max: 0.020, color: '#8E44AD' }],
    aboveColor: '#1F6FB2', outColor: '#B4B4B9', searchMax: 0.10,
  };

  const hex = h => { const v = parseInt(h.replace('#', ''), 16); return [(v >> 16) & 255, (v >> 8) & 255, v & 255]; };

  /** Klasse je Abstand: 0..k-1 = Stufen, k = über letzter Stufe, k+1 = ausserhalb Suchgrenze. */
  function classify(d, scale) {
    if (!(d <= scale.searchMax)) return scale.classes.length + 1;
    for (let k = 0; k < scale.classes.length; k++) if (d <= scale.classes[k].max) return k;
    return scale.classes.length;
  }

  /** Farben (Uint8 RGB) und Statistik zu den Abständen. */
  function colorize(dist, scale) {
    const n = dist.length, k = scale.classes.length;
    const pal = scale.classes.map(c => hex(c.color)).concat([hex(scale.aboveColor), hex(scale.outColor)]);
    const counts = new Array(k + 2).fill(0);
    const colors = new Uint8Array(n * 3);
    const used = [];
    let s = 0;
    for (let i = 0; i < n; i++) {
      const c = classify(dist[i], scale);
      counts[c]++;
      const p = pal[c]; colors[i * 3] = p[0]; colors[i * 3 + 1] = p[1]; colors[i * 3 + 2] = p[2];
      if (c <= k) { used.push(dist[i]); s += dist[i]; }
    }
    used.sort((a, b) => a - b);
    const q = f => (used.length ? used[Math.min(used.length - 1, Math.floor(f * used.length))] : null);
    return { colors, counts, nUsed: used.length, nOut: counts[k + 1], mean: used.length ? s / used.length : null, median: q(0.5), p95: q(0.95), max: used.length ? used[used.length - 1] : null };
  }

  /** Binäres PLY mit globalen Koordinaten, Farbe und Abstand (m; ausserhalb = -1). */
  function buildPly(cloud, colors, dist) {
    const n = cloud.n, o = cloud.offset;
    const header = `ply\nformat binary_little_endian 1.0\ncomment Cloud2BIM Abweichung Punktwolke zu interpoliertem Modell\nelement vertex ${n}\n` +
      'property double x\nproperty double y\nproperty double z\nproperty uchar red\nproperty uchar green\nproperty uchar blue\nproperty float distance\nend_header\n';
    const hb = new TextEncoder().encode(header), rec = 8 * 3 + 3 + 4;
    const buf = new ArrayBuffer(hb.length + n * rec), u8 = new Uint8Array(buf), dv = new DataView(buf);
    u8.set(hb, 0);
    let p = hb.length;
    for (let i = 0; i < n; i++) {
      dv.setFloat64(p, cloud.xyz[i * 3] + o[0], true); dv.setFloat64(p + 8, cloud.xyz[i * 3 + 1] + o[1], true); dv.setFloat64(p + 16, cloud.xyz[i * 3 + 2] + o[2], true);
      u8[p + 24] = colors[i * 3]; u8[p + 25] = colors[i * 3 + 1]; u8[p + 26] = colors[i * 3 + 2];
      dv.setFloat32(p + 27, isFinite(dist[i]) ? dist[i] : -1, true);
      p += rec;
    }
    return u8;
  }

  return { surfaceTriangles, buildIndex, distances, dist2PointTri, DEFAULT_SCALE, classify, colorize, buildPly, hex };
})();
