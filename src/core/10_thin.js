/* ═══ Cloud2BIM Kern: Punktwolke, Ausdünnen (3D-Voxel, 2D-Raster), Ausreisser ═══
   Punktwolke = { n, xyz: Float32Array(3n) lokal, rgb: Uint8Array(3n)|null, offset: [x,y,z] (global = lokal + offset) } */
C2B.thin = (() => {

  /** Offene Hashtabelle für ganzzahlige Zellen (ix,iy,iz) -> Slot-Nummer. */
  class CellHash {
    constructor(cap = 1 << 16) { this._alloc(cap); this.size = 0; }
    _alloc(cap) {
      this.cap = cap; this.mask = cap - 1;
      this.kx = new Int32Array(cap); this.ky = new Int32Array(cap); this.kz = new Int32Array(cap);
      this.val = new Int32Array(cap).fill(-1);
    }
    _h(x, y, z) { return (Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791)) & this.mask; }
    /** Slot suchen; liefert Wert oder -1 und merkt sich die Position für set(). */
    get(x, y, z) {
      let h = this._h(x, y, z);
      while (this.val[h] !== -1) {
        if (this.kx[h] === x && this.ky[h] === y && this.kz[h] === z) { this._pos = h; return this.val[h]; }
        h = (h + 1) & this.mask;
      }
      this._pos = h; return -1;
    }
    /** Nach get() == -1: neuen Eintrag an der gemerkten Position anlegen. */
    insert(x, y, z, v) {
      if ((this.size + 1) * 2 > this.cap) { this._grow(); this.get(x, y, z); }
      const h = this._pos;
      this.kx[h] = x; this.ky[h] = y; this.kz[h] = z; this.val[h] = v; this.size++;
    }
    setAt(v) { this.val[this._pos] = v; }
    _grow() {
      const { kx, ky, kz, val, cap } = this;
      this._alloc(cap * 2);
      for (let i = 0; i < cap; i++) if (val[i] !== -1) {
        this.get(kx[i], ky[i], kz[i]);
        const h = this._pos; this.kx[h] = kx[i]; this.ky[h] = ky[i]; this.kz[h] = kz[i]; this.val[h] = val[i];
      }
    }
  }

  /** Wachsende Punktliste (Float32 lokal + optional Farbe). */
  class PointBuffer {
    constructor(withColor, cap = 1 << 16) {
      this.n = 0; this.cap = cap;
      this.xyz = new Float32Array(cap * 3);
      this.rgb = withColor ? new Uint8Array(cap * 3) : null;
    }
    _ensure(k) {
      if (this.n + k <= this.cap) return;
      let c = this.cap; while (c < this.n + k) c *= 2;
      const x = new Float32Array(c * 3); x.set(this.xyz.subarray(0, this.n * 3)); this.xyz = x;
      if (this.rgb) { const r = new Uint8Array(c * 3); r.set(this.rgb.subarray(0, this.n * 3)); this.rgb = r; }
      this.cap = c;
    }
    push(x, y, z, r, g, b) {
      this._ensure(1);
      const i = this.n * 3;
      this.xyz[i] = x; this.xyz[i + 1] = y; this.xyz[i + 2] = z;
      if (this.rgb) { this.rgb[i] = r; this.rgb[i + 1] = g; this.rgb[i + 2] = b; }
      return this.n++;
    }
    set(k, x, y, z, r, g, b) {
      const i = k * 3;
      this.xyz[i] = x; this.xyz[i + 1] = y; this.xyz[i + 2] = z;
      if (this.rgb) { this.rgb[i] = r; this.rgb[i + 1] = g; this.rgb[i + 2] = b; }
    }
    toCloud(offset) {
      return { n: this.n, xyz: this.xyz.slice(0, this.n * 3), rgb: this.rgb ? this.rgb.slice(0, this.n * 3) : null,
        offset: offset.slice() };
    }
  }

  /**
   * Streaming-Sammler: nimmt globale Koordinaten entgegen, bildet den lokalen Offset
   * (x/y auf 100 m abgerundet, z = 0) und dünnt optional mit einem Voxelraster aus
   * (pro Voxel bleibt der dem Zentrum nächstgelegene Punkt).
   */
  class Collector {
    constructor(voxel = 0, withColor = false, maxPoints = 0) {
      this.voxel = voxel > 0 ? voxel : 0;
      this.buf = new PointBuffer(withColor);
      this.hash = this.voxel ? new CellHash() : null;
      this.best = this.voxel ? [] : null;  // Abstand² zum Voxelzentrum je gespeichertem Punkt
      this.offset = null;
      this.read = 0;
      this.maxPoints = maxPoints;
      this.truncated = false;
    }
    add(gx, gy, gz, r = 0, g = 0, b = 0) {
      if (!(isFinite(gx) && isFinite(gy) && isFinite(gz))) return;
      this.read++;
      if (!this.offset) this.offset = [Math.floor(gx / 100) * 100, Math.floor(gy / 100) * 100, 0];
      const x = gx - this.offset[0], y = gy - this.offset[1], z = gz - this.offset[2];
      if (!this.voxel) {
        if (this.maxPoints && this.buf.n >= this.maxPoints) { this.truncated = true; return; }
        this.buf.push(x, y, z, r, g, b); return;
      }
      const v = this.voxel;
      const qx = x / v, qy = y / v, qz = z / v;
      const ix = Math.floor(qx), iy = Math.floor(qy), iz = Math.floor(qz);
      const fx = qx - ix - 0.5, fy = qy - iy - 0.5, fz = qz - iz - 0.5;
      const d2 = fx * fx + fy * fy + fz * fz;
      const k = this.hash.get(ix, iy, iz);
      if (k === -1) {
        if (this.maxPoints && this.buf.n >= this.maxPoints) { this.truncated = true; return; }
        const id = this.buf.push(x, y, z, r, g, b);
        this.hash.insert(ix, iy, iz, id);
        this.best.push(d2);
      } else if (d2 < this.best[k]) {
        this.best[k] = d2;
        this.buf.set(k, x, y, z, r, g, b);
      }
    }
    result() {
      if (!this.offset) throw new Error('Die Datei enthält keine gültigen Punkte.');
      const c = this.buf.toCloud(this.offset);
      c.nRead = this.read; c.truncated = this.truncated;
      return c;
    }
  }

  /** Bestehende Punktwolke mit Voxelraster ausdünnen. */
  function voxelThin(cloud, voxel) {
    if (!(voxel > 0)) return cloud;
    const col = new Collector(voxel, !!cloud.rgb);
    col.offset = cloud.offset.slice();
    const { xyz, rgb } = cloud;
    for (let i = 0; i < cloud.n; i++) {
      const j = i * 3;
      col.add(xyz[j] + col.offset[0], xyz[j + 1] + col.offset[1], xyz[j + 2] + col.offset[2],
        rgb ? rgb[j] : 0, rgb ? rgb[j + 1] : 0, rgb ? rgb[j + 2] : 0);
    }
    const out = col.buf.toCloud(cloud.offset);
    return out;
  }

  /** Teilmenge nach Indexliste. */
  function subset(cloud, idx) {
    const n = idx.length;
    const xyz = new Float32Array(n * 3);
    const rgb = cloud.rgb ? new Uint8Array(n * 3) : null;
    for (let k = 0; k < n; k++) {
      const i = idx[k] * 3, j = k * 3;
      xyz[j] = cloud.xyz[i]; xyz[j + 1] = cloud.xyz[i + 1]; xyz[j + 2] = cloud.xyz[i + 2];
      if (rgb) { rgb[j] = cloud.rgb[i]; rgb[j + 1] = cloud.rgb[i + 1]; rgb[j + 2] = cloud.rgb[i + 2]; }
    }
    return { n, xyz, rgb, offset: cloud.offset.slice() };
  }

  /** Zufällige Teilmenge mit höchstens maxPoints Punkten (deterministisch). */
  function randomLimit(cloud, maxPoints, seed = 1) {
    if (!(maxPoints > 0) || cloud.n <= maxPoints) return cloud;
    let s = seed >>> 0 || 1;
    const rnd = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
    // Reservoir-freie Auswahl: Teilfolge mit Wahrscheinlichkeit p, danach exakt kürzen
    const idx = [];
    const p = maxPoints / cloud.n;
    for (let i = 0; i < cloud.n; i++) if (rnd() < p) idx.push(i);
    while (idx.length > maxPoints) idx.splice(Math.floor(rnd() * idx.length), 1);
    return subset(cloud, idx);
  }

  /** Isolierte Punkte entfernen: weniger als minNb Nachbarn im Radius r. */
  function removeIsolated(cloud, r, minNb = 3) {
    const { xyz, n } = cloud;
    const hash = new CellHash();
    const heads = [];       // Zelle -> erster Punkt
    const next = new Int32Array(n).fill(-1);
    for (let i = 0; i < n; i++) {
      const ix = Math.floor(xyz[i * 3] / r), iy = Math.floor(xyz[i * 3 + 1] / r), iz = Math.floor(xyz[i * 3 + 2] / r);
      const c = hash.get(ix, iy, iz);
      if (c === -1) { hash.insert(ix, iy, iz, heads.length); heads.push(i); }
      else { next[i] = heads[c]; heads[c] = i; }
    }
    const r2 = r * r;
    const keep = [];
    for (let i = 0; i < n; i++) {
      const x = xyz[i * 3], y = xyz[i * 3 + 1], z = xyz[i * 3 + 2];
      const ix = Math.floor(x / r), iy = Math.floor(y / r), iz = Math.floor(z / r);
      let cnt = 0;
      outer:
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) {
        const h = hash.get(ix + a, iy + b, iz + c);
        if (h === -1) continue;
        for (let j = heads[h]; j !== -1; j = next[j]) {
          if (j === i) continue;
          const dx = xyz[j * 3] - x, dy = xyz[j * 3 + 1] - y, dz = xyz[j * 3 + 2] - z;
          if (dx * dx + dy * dy + dz * dz <= r2 && ++cnt >= minNb) break outer;
        }
      }
      if (cnt >= minNb) keep.push(i);
    }
    return subset(cloud, keep);
  }

  /** 2D-Rasterausdünnung (u/v): ein Punkt pro Zelle, nächster am Zellzentrum. */
  function gridThin2D(P, cell) {
    if (!(cell > 0) || !P.length) return P;
    const map = new Map();
    for (let i = 0; i < P.length; i++) {
      const qx = P[i][0] / cell, qy = P[i][1] / cell;
      const ix = Math.floor(qx), iy = Math.floor(qy);
      const d2 = (qx - ix - 0.5) ** 2 + (qy - iy - 0.5) ** 2;
      const key = ix * 1048576 + iy;    // eindeutig für |iy| < 2^19 Zellen
      const cur = map.get(key);
      if (!cur || d2 < cur[1]) map.set(key, [i, d2]);
    }
    const out = [];
    for (const [i] of map.values()) out.push(P[i]);
    return out;
  }

  function bbox(cloud) {
    const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < cloud.n; i++) for (let k = 0; k < 3; k++) {
      const v = cloud.xyz[i * 3 + k];
      if (v < mn[k]) mn[k] = v; if (v > mx[k]) mx[k] = v;
    }
    return { min: mn, max: mx };
  }

  return { CellHash, PointBuffer, Collector, voxelThin, subset, randomLimit, removeIsolated, gridThin2D, bbox };
})();
