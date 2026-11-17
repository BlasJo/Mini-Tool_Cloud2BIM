/* ═══ Cloud2BIM UI: Grundriss (Draufsicht, Achse/Schnittlinie zeichnen, Stützen platzieren) ═══ */
UI.PlanView = class {
  constructor(canvas, app) {
    this.cv = canvas; this.app = app;
    this.ctx = canvas.getContext('2d');
    this.scale = 10; this.cx = 0; this.cy = 0;   // px je m, Bildmitte (lokal)
    this.mode = 'pan';                            // pan | axis | cut | column
    this.temp = [];                               // Punkte beim Zeichnen
    this.mouse = null;
    this.cloud = null; this.colors = null;
    this.sliceZ = null; this.sliceDz = 0;
    this._bind();
  }

  setCloud(cloud, colors) { this.cloud = cloud; this.colors = colors; this.render(); }

  fit() {
    const c = this.cloud;
    if (!c || !c.n) return;
    const bb = C2B.thin.bbox(c);
    const w = this.cv.clientWidth || 600, h = this.cv.clientHeight || 400;
    this.cx = (bb.min[0] + bb.max[0]) / 2; this.cy = (bb.min[1] + bb.max[1]) / 2;
    this.scale = 0.9 * Math.min(w / ((bb.max[0] - bb.min[0]) || 1), h / ((bb.max[1] - bb.min[1]) || 1));
    this.render();
  }

  toScreen(x, y) { const w = this.cv.clientWidth, h = this.cv.clientHeight; return [w / 2 + (x - this.cx) * this.scale, h / 2 - (y - this.cy) * this.scale]; }
  toWorld(px, py) { const w = this.cv.clientWidth, h = this.cv.clientHeight; return [this.cx + (px - w / 2) / this.scale, this.cy - (py - h / 2) / this.scale]; }

  /** Polygon zeichnen (Doppelklick/Enter beendet), danach cb(poly). */
  drawPolygon(hint, cb) { this.setMode('poly', hint); this.polyCb = cb; }

  setMode(mode, hint) {
    this.mode = mode; this.temp = [];
    if (mode !== 'poly') this.polyCb = null;
    const el = UI.$('c2bPlanHint');
    el.hidden = !hint; el.textContent = hint || '';
    this.cv.style.cursor = mode === 'pan' ? 'grab' : 'crosshair';
    this.render();
  }

  render() {
    const cv = this.cv, dpr = window.devicePixelRatio || 1;
    const w = cv.clientWidth, h = cv.clientHeight;
    if (!w || !h) return;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cv.width, cv.height);
    const c = this.cloud;
    if (c && c.n) {
      // Punkte als Pixel (Höhenschnitt optional), höchster Punkt gewinnt
      const W = cv.width, H = cv.height;
      const img = ctx.createImageData(W, H);
      const zb = new Float32Array(W * H).fill(-Infinity);
      const d = img.data, s = this.scale * dpr, ox = W / 2 - this.cx * s, oy = H / 2 + this.cy * s;
      const slice = this.sliceDz > 0 && this.sliceZ !== null;
      const z0 = slice ? this.sliceZ - this.sliceDz : 0, z1 = slice ? this.sliceZ + this.sliceDz : 0;
      const xyz = c.xyz, col = this.colors;
      for (let i = 0; i < c.n; i++) {
        const z = xyz[i * 3 + 2];
        if (slice && (z < z0 || z > z1)) continue;
        const px = (xyz[i * 3] * s + ox) | 0, py = (oy - xyz[i * 3 + 1] * s) | 0;
        if (px < 0 || py < 0 || px >= W || py >= H) continue;
        const k = py * W + px;
        if (z <= zb[k]) continue;
        zb[k] = z;
        d[k * 4] = col[i * 3]; d[k * 4 + 1] = col[i * 3 + 1]; d[k * 4 + 2] = col[i * 3 + 2]; d[k * 4 + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this._drawOverlay(ctx);
  }

  _drawOverlay(ctx) {
    const app = this.app, P = app.project;
    const path = pts => { ctx.beginPath(); pts.forEach((p, i) => { const [x, y] = this.toScreen(p[0], p[1]); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.closePath(); };
    // Ausschnitt-Bereiche
    (P.crops || []).forEach(r => {
      path(r.poly);
      ctx.fillStyle = r.mode === 'keep' ? 'rgba(45,134,83,0.08)' : 'rgba(215,0,54,0.12)'; ctx.fill();
      ctx.strokeStyle = r.mode === 'keep' ? '#2D8653' : '#D70036'; ctx.lineWidth = 1.5; ctx.setLineDash([6, 4]); ctx.stroke(); ctx.setLineDash([]);
    });
    // Ebenen (Umriss der Ebenenfläche im Grundriss)
    (P.planes || []).forEach(pl => {
      path(C2B.planes.planeCorners(pl));
      ctx.fillStyle = 'rgba(31,111,178,0.10)'; ctx.fill();
      ctx.strokeStyle = '#1f6fb2'; ctx.lineWidth = 1.5; ctx.stroke();
      const c = this.toScreen(pl.p0[0], pl.p0[1]);
      ctx.fillStyle = '#1f6fb2'; ctx.font = '11px system-ui, sans-serif'; ctx.fillText(pl.name, c[0] + 4, c[1] - 4);
    });
    // Achse
    const axis = P.axis || [];
    if (axis.length >= 2) {
      ctx.strokeStyle = '#D70036'; ctx.lineWidth = 2; ctx.setLineDash([8, 4]);
      ctx.beginPath(); axis.forEach((p, i) => { const [x, y] = this.toScreen(p[0], p[1]); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.stroke();
      ctx.setLineDash([]);
      const [sx, sy] = this.toScreen(axis[0][0], axis[0][1]);
      ctx.fillStyle = '#D70036'; ctx.beginPath(); ctx.arc(sx, sy, 4, 0, 7); ctx.fill();
      // Pfeil am Ende
      const a = axis[axis.length - 2], b = axis[axis.length - 1];
      const [ex, ey] = this.toScreen(b[0], b[1]);
      const ang = Math.atan2(-(b[1] - a[1]), b[0] - a[0]);
      ctx.beginPath(); ctx.moveTo(ex, ey); ctx.lineTo(ex - 12 * Math.cos(ang - 0.4), ey - 12 * Math.sin(ang - 0.4));
      ctx.lineTo(ex - 12 * Math.cos(ang + 0.4), ey - 12 * Math.sin(ang + 0.4)); ctx.closePath(); ctx.fill();
    }
    // Querschnitte
    for (const s of P.sections) {
      const half = this._secHalfWidth(s);
      const f = C2B.sec.frame(s);
      const p1 = this.toScreen(f.o[0] - f.u[0] * half, f.o[1] - f.u[1] * half);
      const p2 = this.toScreen(f.o[0] + f.u[0] * half, f.o[1] + f.u[1] * half);
      const cur = s.id === app.curSecId;
      if (cur) {   // Schnitttiefe als Streifen
        const hd = 0.5 * (s.depth || 0.05);
        const q = [[-half, -hd], [half, -hd], [half, hd], [-half, hd]].map(([u, t]) => this.toScreen(f.o[0] + f.u[0] * u + f.d[0] * t, f.o[1] + f.u[1] * u + f.d[1] * t));
        ctx.fillStyle = 'rgba(215,0,54,0.18)'; ctx.beginPath(); q.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); ctx.fill();
      }
      ctx.strokeStyle = cur ? '#D70036' : (this.app.hasProfile(s) ? '#2D8653' : '#8E8E93');
      ctx.lineWidth = cur ? 3 : 1.5;
      ctx.beginPath(); ctx.moveTo(p1[0], p1[1]); ctx.lineTo(p2[0], p2[1]); ctx.stroke();
      if (cur || this.scale > 3) {
        ctx.fillStyle = ctx.strokeStyle; ctx.font = (cur ? 'bold ' : '') + '11px system-ui, sans-serif';
        ctx.fillText(s.name, p2[0] + 4, p2[1] - 4);
      }
      // Blickrichtung
      const o = this.toScreen(f.o[0], f.o[1]), q = this.toScreen(f.o[0] + f.d[0] * 12 / this.scale, f.o[1] + f.d[1] * 12 / this.scale);
      ctx.beginPath(); ctx.moveTo(o[0], o[1]); ctx.lineTo(q[0], q[1]); ctx.stroke();
    }
    // Stützen
    for (const c of P.columns) {
      const m = C2B.model.columnMesh(c, 24);
      const n = m.verts.length / 2;
      ctx.fillStyle = 'rgba(215,0,54,0.35)'; ctx.strokeStyle = '#D70036'; ctx.lineWidth = c.id === app.curColId ? 2.5 : 1.2;
      ctx.beginPath();
      for (let i = 0; i < n; i++) { const [x, y] = this.toScreen(m.verts[i][0], m.verts[i][1]); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
      ctx.closePath(); ctx.fill(); ctx.stroke();
    }
    // Zeichnen
    if (this.temp.length && this.mouse) {
      ctx.strokeStyle = '#D70036'; ctx.lineWidth = 2;
      ctx.beginPath();
      this.temp.forEach((p, i) => { const [x, y] = this.toScreen(p[0], p[1]); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
      const [mx, my] = this.toScreen(this.mouse[0], this.mouse[1]);
      ctx.lineTo(mx, my);
      if (this.mode === 'poly') { const [fx, fy] = this.toScreen(this.temp[0][0], this.temp[0][1]); ctx.lineTo(fx, fy); }
      ctx.stroke();
      if (this.mode === 'cut' && this.temp.length === 1) {
        const a = this.temp[0], b = this.mouse;
        const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (L > 0) {   // Blickrichtung = senkrecht zur Schnittlinie (nach links gedreht)
          const mxw = (a[0] + b[0]) / 2, myw = (a[1] + b[1]) / 2, dx = -(b[1] - a[1]) / L, dy = (b[0] - a[0]) / L;
          const s1 = this.toScreen(mxw, myw), s2 = this.toScreen(mxw + dx * 20 / this.scale, myw + dy * 20 / this.scale);
          ctx.beginPath(); ctx.moveTo(s1[0], s1[1]); ctx.lineTo(s2[0], s2[1]); ctx.stroke();
        }
      }
    }
    // Massstab
    const w = this.cv.clientWidth, h = this.cv.clientHeight;
    const target = 100 / this.scale;
    const pow = Math.pow(10, Math.floor(Math.log10(target)));
    const step = [1, 2, 5, 10].map(k => k * pow).find(v => v >= target) || pow;
    ctx.strokeStyle = getComputedStyle(document.body).color; ctx.fillStyle = ctx.strokeStyle; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(w - 20 - step * this.scale, h - 20); ctx.lineTo(w - 20, h - 20); ctx.stroke();
    ctx.font = '11px system-ui, sans-serif'; ctx.textAlign = 'right';
    ctx.fillText(step >= 1 ? step + ' m' : (step * 100).toFixed(0) + ' cm', w - 20, h - 26);
    ctx.textAlign = 'left';
  }

  _secHalfWidth(s) {
    const V = C2B.sec.profilesOf(s).reduce((a, p) => a.concat(p.vertices), []);
    if (V.length >= 2) { let m = 0; V.forEach(p => { m = Math.max(m, Math.abs(p[0])); }); return m + 0.5; }
    return this.app.defaultHalfWidth || 5;
  }

  _hitSection(px, py) {
    let best = null, bd = 8;
    for (const s of this.app.project.sections) {
      const half = this._secHalfWidth(s), f = C2B.sec.frame(s);
      const a = this.toScreen(f.o[0] - f.u[0] * half, f.o[1] - f.u[1] * half), b = this.toScreen(f.o[0] + f.u[0] * half, f.o[1] + f.u[1] * half);
      const d = C2B.g2.distPointSeg(px, py, a[0], a[1], b[0], b[1]);
      if (d < bd) { bd = d; best = s; }
    }
    return best;
  }

  _hitColumn(x, y) {
    return this.app.project.columns.find(c => Math.hypot(c.x - x, c.y - y) <= Math.max(c.shape === 'circle' ? c.d / 2 : Math.max(c.b, c.h) / 2, 4 / this.scale));
  }

  _bind() {
    const cv = this.cv;
    let drag = null;
    const pos = e => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    cv.addEventListener('wheel', e => {
      e.preventDefault();
      const [px, py] = pos(e), [wx, wy] = this.toWorld(px, py);
      const f = Math.exp(-e.deltaY * 0.0015);
      this.scale = Math.min(5000, Math.max(0.01, this.scale * f));
      const [nx, ny] = this.toWorld(px, py);
      this.cx += wx - nx; this.cy += wy - ny;
      this.render();
    }, { passive: false });
    cv.addEventListener('pointerdown', e => {
      cv.setPointerCapture(e.pointerId);
      drag = { x: e.clientX, y: e.clientY, cx: this.cx, cy: this.cy, moved: false, button: e.button };
    });
    cv.addEventListener('pointermove', e => {
      const [px, py] = pos(e);
      this.mouse = this.toWorld(px, py);
      const o = this.app.project.offset || [0, 0, 0];
      UI.$('c2bLeftInfo').textContent = 'E ' + (this.mouse[0] + o[0]).toFixed(2) + ' · N ' + (this.mouse[1] + o[1]).toFixed(2);
      if (drag) {
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
        if (drag.moved) { this.cx = drag.cx - dx / this.scale; this.cy = drag.cy + dy / this.scale; cv.style.cursor = 'grabbing'; }
      }
      if (drag && drag.moved || this.temp.length) this.render();
    });
    cv.addEventListener('pointerup', e => {
      const d = drag; drag = null;
      cv.style.cursor = this.mode === 'pan' ? 'grab' : 'crosshair';
      if (!d || d.moved || d.button !== 0) return;
      const [px, py] = pos(e), w = this.toWorld(px, py);
      if (this.mode === 'axis' || this.mode === 'poly') { this.temp.push(w); this.render(); }
      else if (this.mode === 'cut') {
        this.temp.push(w);
        if (this.temp.length === 2) { const t = this.temp; this.setMode('pan'); this.app.onCutDrawn(t[0], t[1]); }
      } else if (this.mode === 'column') { this.app.onColumnClick(w[0], w[1]); }
      else {
        const col = this._hitColumn(w[0], w[1]);
        if (col) { this.app.selectColumn(col.id); return; }
        const s = this._hitSection(px, py);
        if (s) this.app.selectSection(s.id);
      }
    });
    cv.addEventListener('dblclick', e => {
      if (this.mode === 'axis') { e.preventDefault(); this._finishAxis(); }
      else if (this.mode === 'poly') { e.preventDefault(); this._finishPoly(); }
    });
    window.addEventListener('keydown', e => {
      if (cv.hidden || e.target.closest && e.target.closest('input,select,textarea')) return;
      if (this.mode === 'axis' && e.key === 'Enter') this._finishAxis();
      if (this.mode === 'poly' && e.key === 'Enter') this._finishPoly();
      if (this.mode !== 'pan' && e.key === 'Escape') { this.setMode('pan'); this.app.onPlanModeEnd(); }
    });
    new ResizeObserver(() => this.render()).observe(cv);
  }

  _dedup() {
    const pts = [];
    this.temp.forEach(p => { if (!pts.length || Math.hypot(p[0] - pts[pts.length - 1][0], p[1] - pts[pts.length - 1][1]) > 1e-6) pts.push(p); });
    return pts;
  }

  _finishPoly() {
    const pts = this._dedup(), cb = this.polyCb;
    this.setMode('pan');
    if (pts.length >= 3 && cb) cb(pts); else this.app.onPlanModeEnd();
  }

  _finishAxis() {
    // Doppelklick erzeugt zwei Klicks am selben Ort -> Duplikate entfernen
    const pts = [];
    this.temp.forEach(p => { if (!pts.length || Math.hypot(p[0] - pts[pts.length - 1][0], p[1] - pts[pts.length - 1][1]) > 1e-6) pts.push(p); });
    this.setMode('pan');
    if (pts.length >= 2) this.app.onAxisDrawn(pts);
    else this.app.onPlanModeEnd();
  }
};
