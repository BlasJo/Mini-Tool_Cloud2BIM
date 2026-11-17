/* ═══ Cloud2BIM UI: Querschnitt-Editor (u/v-Ansicht, Profil zeichnen/bearbeiten, Bauteile) ═══ */
UI.SectionEditor = class {
  constructor(canvas, app) {
    this.cv = canvas; this.app = app; this.ctx = canvas.getContext('2d');
    this.sec = null; this.pts = [];
    this.scale = 50; this.cu = 0; this.cv0 = 0;
    this.tool = 'edit';
    this.selV = -1; this.hoverV = -1; this.hoverE = -1;
    this.edgeSel = null;           // { a: Kante, b: Kante }
    this.report = null;
    this.mouse = null;
    this.drawing = null;           // Liste beim Zeichnen
    this._bind();
  }

  setSection(sec, pts, keepView) {
    this.sec = sec; this.pts = pts || []; this.selV = -1; this.edgeSel = null; this.drawing = null;
    if (!keepView) this.fit();
    this.update();
  }

  setTool(t) {
    this.tool = t; this.drawing = t === 'draw' ? [] : null; this.edgeSel = t === 'edges' ? this.edgeSel : null;
    const hint = UI.$('c2bSecHint');
    hint.hidden = t === 'edit';
    hint.textContent = t === 'draw' ? 'Ecken anklicken · Klick auf erste Ecke = geschlossen · Enter = offen beenden · Esc = abbrechen'
      : t === 'edges' ? 'Kante anklicken = Anfang · Shift+Klick = Ende des Bereichs · danach «+ aus gewählten Kanten»' : '';
    this.cv.style.cursor = t === 'edit' ? 'default' : 'crosshair';
    this.app.onEdgeSelection(this.edgeSel);
    this.render();
  }

  fit() {
    const P = this.pts.length ? this.pts : (this.sec ? this.sec.profile.vertices : []);
    const w = this.cv.clientWidth || 500, h = this.cv.clientHeight || 400;
    if (!P.length) { this.cu = 0; this.cv0 = 0; this.scale = 40; return this.render(); }
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const p of P) { if (p[0] < u0) u0 = p[0]; if (p[0] > u1) u1 = p[0]; if (p[1] < v0) v0 = p[1]; if (p[1] > v1) v1 = p[1]; }
    this.cu = (u0 + u1) / 2; this.cv0 = (v0 + v1) / 2;
    this.scale = 0.88 * Math.min(w / ((u1 - u0) || 1), h / ((v1 - v0) || 1));
    this.render();
  }

  toS(u, v) { const w = this.cv.clientWidth, h = this.cv.clientHeight; return [w / 2 + (u - this.cu) * this.scale, h / 2 - (v - this.cv0) * this.scale]; }
  toW(px, py) { const w = this.cv.clientWidth, h = this.cv.clientHeight; return [this.cu + (px - w / 2) / this.scale, this.cv0 - (py - h / 2) / this.scale]; }

  /** Abweichung neu berechnen und anzeigen. */
  update() {
    const s = this.sec;
    if (s && s.profile.vertices.length >= 2) {
      const tol = this.app.tol(), band = UI.mm('c2bBand', 0.1);
      this.report = C2B.g2.deviationReport(this.pts, s.profile.vertices, s.profile.closed, tol, Math.max(band, tol * 1.5));
      s._dev = this.report.max;
    } else { this.report = null; if (s) s._dev = null; }
    this.render();
    this.app.onSectionStats(this.report);
  }

  render() {
    const cv = this.cv, dpr = window.devicePixelRatio || 1;
    const w = cv.clientWidth, h = cv.clientHeight;
    if (!w || !h) return;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (!this.sec) return;
    const dark = document.documentElement.getAttribute('data-theme') === 'dark';
    this._grid(ctx, w, h, dark);
    // Bauteile (Ringe)
    const T = this.app.thicknessMap();
    const rings = this.sec.profile.vertices.length >= 2 ? C2B.model.sectionRings(this.sec, T.get(this.sec.id) || {}) : {};
    Object.values(rings).forEach(r => {
      const poly = r.inner.concat(r.outer.slice().reverse());
      const col = UI.TYPE_COLOR[r.comp.type] || '#999';
      ctx.fillStyle = col + '55'; ctx.strokeStyle = col; ctx.lineWidth = 1;
      ctx.beginPath(); poly.forEach((p, i) => { const [x, y] = this.toS(p[0], p[1]); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
      ctx.closePath(); ctx.fill(); ctx.stroke();
    });
    // Punkte
    ctx.fillStyle = dark ? '#c9c9cf' : '#3a3a3c';
    const r = Math.max(1, Math.min(2.5, this.scale * 0.004));
    for (const p of this.pts) {
      const x = w / 2 + (p[0] - this.cu) * this.scale, y = h / 2 - (p[1] - this.cv0) * this.scale;
      if (x < -2 || y < -2 || x > w + 2 || y > h + 2) continue;
      ctx.fillRect(x - r / 2, y - r / 2, r, r);
    }
    // Profil
    const V = this.sec.profile.vertices, closed = this.sec.profile.closed;
    if (V.length >= 2) {
      const E = C2B.g2.edges(V, closed);
      const ok = this.report ? this.report.segOk : [];
      const selEdges = this._selEdgeSet();
      E.forEach(([a, b], e) => {
        const [x1, y1] = this.toS(a[0], a[1]), [x2, y2] = this.toS(b[0], b[1]);
        if (selEdges.has(e)) { ctx.strokeStyle = '#1f6fb2'; ctx.lineWidth = 6; ctx.globalAlpha = 0.45; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); ctx.globalAlpha = 1; }
        ctx.strokeStyle = ok[e] === false ? '#D70036' : '#2D8653';
        ctx.lineWidth = e === this.hoverE ? 3.5 : 2.2;
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
        if (this.scale > 25) {
          const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
          if (L * this.scale > 60) {
            ctx.fillStyle = dark ? '#AEAEB2' : '#636366'; ctx.font = '10px system-ui, sans-serif'; ctx.textAlign = 'center';
            ctx.fillText(L.toFixed(3), (x1 + x2) / 2, (y1 + y2) / 2 - 5); ctx.textAlign = 'left';
          }
        }
      });
    }
    V.forEach((p, i) => {
      const [x, y] = this.toS(p[0], p[1]);
      const sel = i === this.selV, hov = i === this.hoverV;
      ctx.fillStyle = sel ? '#D70036' : (dark ? '#2C2C2E' : '#fff');
      ctx.strokeStyle = '#D70036'; ctx.lineWidth = 1.6;
      const s = sel || hov ? 5 : 3.5;
      ctx.beginPath(); ctx.rect(x - s, y - s, 2 * s, 2 * s); ctx.fill(); ctx.stroke();
    });
    // Zeichnen
    if (this.drawing && this.drawing.length) {
      ctx.strokeStyle = '#D70036'; ctx.lineWidth = 2; ctx.setLineDash([5, 3]);
      ctx.beginPath(); this.drawing.forEach((p, i) => { const [x, y] = this.toS(p[0], p[1]); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
      if (this.mouse) { const [x, y] = this.toS(this.mouse[0], this.mouse[1]); ctx.lineTo(x, y); }
      ctx.stroke(); ctx.setLineDash([]);
      this.drawing.forEach(p => { const [x, y] = this.toS(p[0], p[1]); ctx.fillStyle = '#D70036'; ctx.fillRect(x - 3, y - 3, 6, 6); });
    }
    if (this._snap) { const [x, y] = this.toS(this._snap[0], this._snap[1]); ctx.strokeStyle = '#1f6fb2'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x, y, 6, 0, 7); ctx.stroke(); }
  }

  _grid(ctx, w, h, dark) {
    const target = 70 / this.scale;
    const pow = Math.pow(10, Math.floor(Math.log10(target)));
    const step = [1, 2, 5, 10].map(k => k * pow).find(v => v >= target) || pow;
    const [u0, v1] = this.toW(0, 0), [u1, v0] = this.toW(w, h);
    ctx.strokeStyle = dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'; ctx.lineWidth = 1;
    ctx.fillStyle = dark ? '#8E8E93' : '#8E8E93'; ctx.font = '10px ui-monospace, Menlo, Consolas, monospace';
    for (let u = Math.ceil(u0 / step) * step; u <= u1; u += step) {
      const [x] = this.toS(u, 0); ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
      ctx.fillText(+u.toFixed(6) + '', x + 2, h - 4);
    }
    for (let v = Math.ceil(v0 / step) * step; v <= v1; v += step) {
      const [, y] = this.toS(0, v); ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
      ctx.fillText(+v.toFixed(6) + '', 2, y - 2);
    }
    // Achse u = 0
    const [x0] = this.toS(0, 0);
    ctx.strokeStyle = 'rgba(215,0,54,0.35)'; ctx.setLineDash([6, 4]); ctx.beginPath(); ctx.moveTo(x0, 0); ctx.lineTo(x0, h); ctx.stroke(); ctx.setLineDash([]);
  }

  _selEdgeSet() {
    const set = new Set();
    if (!this.edgeSel || !this.sec) return set;
    this._edgeRange().forEach(e => set.add(e));
    return set;
  }

  /** Gewählter Kantenbereich a..b (bei geschlossenen Profilen zyklisch vorwärts). */
  _edgeRange() {
    const V = this.sec.profile.vertices, closed = this.sec.profile.closed;
    const ne = C2B.g2.edgeCount(V.length, closed);
    if (!this.edgeSel || !ne) return [];
    const { a, b } = this.edgeSel;
    const out = [];
    if (closed) { for (let e = a, g = 0; g < ne; g++, e = (e + 1) % ne) { out.push(e); if (e === b) break; } }
    else for (let e = Math.min(a, b); e <= Math.max(a, b); e++) out.push(e);
    return out;
  }

  edgeSelectionAsComponent() {
    const r = this._edgeRange();
    if (!r.length) return null;
    const n = this.sec.profile.vertices.length, closed = this.sec.profile.closed;
    return { start: r[0], end: closed ? (r[r.length - 1] + 1) % n : r[r.length - 1] + 1, count: r.length };
  }

  _hitVertex(px, py, tolPx = 8) {
    const V = this.sec ? this.sec.profile.vertices : [];
    let best = -1, bd = tolPx;
    V.forEach((p, i) => { const [x, y] = this.toS(p[0], p[1]); const d = Math.hypot(x - px, y - py); if (d < bd) { bd = d; best = i; } });
    return best;
  }
  _hitEdge(px, py, tolPx = 7) {
    const V = this.sec ? this.sec.profile.vertices : [];
    if (V.length < 2) return -1;
    let best = -1, bd = tolPx;
    C2B.g2.edges(V, this.sec.profile.closed).forEach(([a, b], e) => {
      const [x1, y1] = this.toS(a[0], a[1]), [x2, y2] = this.toS(b[0], b[1]);
      const d = C2B.g2.distPointSeg(px, py, x1, y1, x2, y2);
      if (d < bd) { bd = d; best = e; }
    });
    return best;
  }
  _nearestPoint(u, v, rPx = 14) {
    let best = null, bd = (rPx / this.scale) ** 2;
    for (const p of this.pts) { const d = (p[0] - u) ** 2 + (p[1] - v) ** 2; if (d < bd) { bd = d; best = p; } }
    return best;
  }

  _changed(structural) {
    this.app.onProfileChanged(this.sec, structural);
    this.update();
  }

  insertVertex(e, p) {
    const s = this.sec, V = s.profile.vertices;
    this.app.pushUndo();
    const ni = e + 1;
    V.splice(ni, 0, p);
    s.components.forEach(c => { if (c.start >= ni) c.start++; if (c.end >= ni) c.end++; });
    this.selV = ni;
    this._changed(true);
  }

  deleteVertex(i) {
    const s = this.sec, V = s.profile.vertices;
    if (i < 0 || i >= V.length) return;
    this.app.pushUndo();
    V.splice(i, 1);
    const n = V.length;
    if (s.profile.closed && n < 3) s.profile.closed = false;
    s.components.forEach(c => {
      if (c.start > i) c.start--; if (c.end > i) c.end--;
      if (s.profile.closed) { c.start = ((c.start % n) + n) % n; c.end = ((c.end % n) + n) % n; }
      else { c.start = Math.min(c.start, n - 1); c.end = Math.min(c.end, n - 1); }
    });
    s.components = s.components.filter(c => C2B.sec.componentEdges(c, n, s.profile.closed).length > 0 && c.start !== c.end);
    this.selV = -1;
    this._changed(true);
  }

  _bind() {
    const cv = this.cv;
    let drag = null;
    const pos = e => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    cv.addEventListener('contextmenu', e => {
      e.preventDefault();
      if (!this.sec || this.tool !== 'edit') return;
      const [px, py] = pos(e), i = this._hitVertex(px, py);
      if (i >= 0) this.deleteVertex(i);
    });
    cv.addEventListener('wheel', e => {
      e.preventDefault();
      const [px, py] = pos(e), [wu, wv] = this.toW(px, py);
      this.scale = Math.min(1e5, Math.max(0.5, this.scale * Math.exp(-e.deltaY * 0.0015)));
      const [nu, nv] = this.toW(px, py);
      this.cu += wu - nu; this.cv0 += wv - nv;
      this.render();
    }, { passive: false });
    cv.addEventListener('pointerdown', e => {
      if (!this.sec) return;
      cv.focus();
      cv.setPointerCapture(e.pointerId);
      const [px, py] = pos(e);
      const vi = this.tool === 'edit' && e.button === 0 ? this._hitVertex(px, py) : -1;
      if (vi >= 0) { this.selV = vi; this.app.pushUndo(); drag = { type: 'vertex', i: vi, moved: false }; this.render(); return; }
      drag = { type: 'pan', x: e.clientX, y: e.clientY, cu: this.cu, cv: this.cv0, moved: false, button: e.button };
    });
    cv.addEventListener('pointermove', e => {
      if (!this.sec) return;
      const [px, py] = pos(e);
      let w = this.toW(px, py);
      this._snap = null;
      if (e.shiftKey && (this.tool === 'draw' || (drag && drag.type === 'vertex'))) {
        const q = this._nearestPoint(w[0], w[1]);
        if (q) { w = q.slice(); this._snap = q; }
      }
      this.mouse = w;
      UI.$('c2bSecInfo').textContent = 'u ' + w[0].toFixed(3) + ' m · Z ' + w[1].toFixed(3) + ' m';
      if (drag && drag.type === 'vertex') {
        drag.moved = true;
        this.sec.profile.vertices[drag.i] = [w[0], w[1]];
        this.render();
        return;
      }
      if (drag && drag.type === 'pan') {
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
        if (drag.moved) { this.cu = drag.cu - dx / this.scale; this.cv0 = drag.cv + dy / this.scale; this.render(); }
        return;
      }
      const hv = this.tool === 'edit' ? this._hitVertex(px, py) : -1;
      const he = hv < 0 && this.tool !== 'draw' ? this._hitEdge(px, py) : -1;
      if (hv !== this.hoverV || he !== this.hoverE || this.drawing) { this.hoverV = hv; this.hoverE = he; this.render(); }
      cv.style.cursor = hv >= 0 ? 'move' : (this.tool === 'edit' ? (he >= 0 ? 'copy' : 'default') : 'crosshair');
    });
    cv.addEventListener('pointerup', e => {
      const d = drag; drag = null;
      if (!this.sec || !d) return;
      if (d.type === 'vertex') {
        if (d.moved) this._changed(false); else this.app.dropUndo();
        return;
      }
      if (d.moved || d.button !== 0) return;
      const [px, py] = pos(e);
      let w = this.toW(px, py);
      if (e.shiftKey && this.tool === 'draw') { const q = this._nearestPoint(w[0], w[1]); if (q) w = q.slice(); }
      if (this.tool === 'draw') {
        const D = this.drawing || (this.drawing = []);
        if (D.length >= 3) {
          const [fx, fy] = this.toS(D[0][0], D[0][1]);
          if (Math.hypot(fx - px, fy - py) < 9) { this._finishDraw(true); return; }
        }
        D.push(w); this.render();
      } else if (this.tool === 'edges') {
        const ed = this._hitEdge(px, py, 9);
        if (ed < 0) { this.edgeSel = null; }
        else if (e.shiftKey && this.edgeSel) this.edgeSel = { a: this.edgeSel.a, b: ed };
        else this.edgeSel = { a: ed, b: ed };
        this.app.onEdgeSelection(this.edgeSel);
        this.render();
      } else {
        const vi = this._hitVertex(px, py);
        this.selV = vi;
        this.render();
      }
    });
    cv.addEventListener('dblclick', e => {
      if (!this.sec || this.tool !== 'edit') return;
      const [px, py] = pos(e);
      if (this._hitVertex(px, py) >= 0) return;
      const ed = this._hitEdge(px, py, 9);
      if (ed >= 0) {
        const [a, b] = C2B.g2.edges(this.sec.profile.vertices, this.sec.profile.closed)[ed];
        const w = this.toW(px, py);
        const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy || 1;
        const t = Math.max(0, Math.min(1, ((w[0] - a[0]) * dx + (w[1] - a[1]) * dy) / L2));
        this.insertVertex(ed, [a[0] + t * dx, a[1] + t * dy]);
      }
    });
    cv.tabIndex = 0;
    cv.addEventListener('keydown', e => {
      if (!this.sec) return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && this.selV >= 0 && this.tool === 'edit') { e.preventDefault(); this.deleteVertex(this.selV); }
      else if (e.key === 'Enter' && this.tool === 'draw') { e.preventDefault(); this._finishDraw(false); }
      else if (e.key === 'Escape') { if (this.tool !== 'edit') this.app.setSecTool('edit'); else { this.selV = -1; this.render(); } }
      else if (this.tool === 'edit' && this.selV >= 0 && e.key.startsWith('Arrow')) {
        e.preventDefault();
        const st = e.shiftKey ? 0.01 : 0.001;
        const p = this.sec.profile.vertices[this.selV];
        this.app.pushUndo();
        if (e.key === 'ArrowLeft') p[0] -= st; if (e.key === 'ArrowRight') p[0] += st;
        if (e.key === 'ArrowUp') p[1] += st; if (e.key === 'ArrowDown') p[1] -= st;
        this._changed(false);
      }
    });
    new ResizeObserver(() => this.render()).observe(cv);
  }

  _finishDraw(closed) {
    const D = this.drawing || [];
    if (D.length < 2) { this.app.setSecTool('edit'); return; }
    this.app.pushUndo();
    this.sec.profile = { vertices: D.map(p => p.slice()), closed: closed && D.length >= 3 };
    if (this.sec.profile.closed && C2B.g2.signedArea(this.sec.profile.vertices) < 0) this.sec.profile.vertices.reverse();
    this.sec.components = [];
    this.drawing = null;
    this.app.setSecTool('edit');
    this._changed(true);
  }
};
