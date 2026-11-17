/* ═══ Cloud2BIM UI: Ablaufsteuerung ═══ */
const APP = {
  raw: null, cloud: null, display: null, colors: null, zRange: [0, 1],
  project: { name: 'Cloud2BIM', source: null, offset: null, axis: [], sections: [], columns: [], crops: [], planes: [] },
  thinned: null,   // Punktwolke nach dem Ausdünnen (vor dem Ausschneiden)
  curSecId: null, curColId: null, solids: null, wire: null, modelBuilt: false,
  undo: new UI.Undo(), secPtsCache: new Map(), abort: null, mode: '3d', defaultHalfWidth: 5,

  // ───────────────────────────────────────────── Initialisierung
  init() {
    UI.loadSettings();
    this.plan = new UI.PlanView(UI.$('c2bPlan'), this);
    try { this.v3d = new UI.View3D(UI.$('c2b3dHost'), this); }
    catch (e) { UI.log('3D-Ansicht nicht verfügbar (WebGL): ' + e.message, 'err'); this.v3d = null; }
    this.ed = new UI.SectionEditor(UI.$('c2bSec'), this);
    this.renderDevScale();
    this._bindSidebar();
    this._bindMain();
    this._bindKeys();
    this.setMode(this.mode);
    this.updateAll();
    UI.log('Cloud2BIM ' + CONFIG.VERSION + ' bereit. Alle Daten bleiben im Browser (kein Netzzugriff).');
  },

  tol() { return Math.max(0.0005, UI.mm('c2bTol', 0.02)); },

  /** Stärkenkarte (aufgelöst inkl. Interpolation) für alle Querschnitte. */
  thicknessMap() { return C2B.model.resolveThicknesses(this.project.sections); },

  curSec() { return this.project.sections.find(s => s.id === this.curSecId) || null; },
  sortedSecs() { return this.project.sections.slice().sort((a, b) => a.station - b.station); },

  // ───────────────────────────────────────────── Undo
  snapshot() { const P = this.project; return { sections: P.sections, columns: P.columns, axis: P.axis, crops: P.crops, planes: P.planes, curSecId: this.curSecId }; },
  pushUndo() { this.undo.push(this.snapshot()); },
  dropUndo() { this.undo.stack.pop(); },
  _restore(st) {
    if (!st) return;
    const cropsChanged = JSON.stringify(st.crops || []) !== JSON.stringify(this.project.crops || []);
    this.project.sections = st.sections; this.project.columns = st.columns; this.project.axis = st.axis || [];
    this.project.crops = st.crops || []; this.project.planes = st.planes || [];
    if (cropsChanged) this.applyCrops(true);
    this.renderCrops(); this.renderPlanes();
    this.curSecId = this.project.sections.some(s => s.id === st.curSecId) ? st.curSecId : (this.project.sections[0] || {}).id || null;
    this.secPtsCache.clear();
    this.selectSection(this.curSecId, true);
    this.modelDirty();
    this.updateAll();
  },
  doUndo() { const st = this.undo.undo(this.snapshot()); if (st) { this._restore(st); UI.log('Rückgängig.'); } },
  doRedo() { const st = this.undo.redo(this.snapshot()); if (st) { this._restore(st); UI.log('Wiederhergestellt.'); } },

  // ───────────────────────────────────────────── Punktwolke
  async loadFile(file) {
    if (this.abort) return;
    const P = this.project;
    if ((P.sections.length || P.columns.length) && P.source && P.source !== file.name) {
      const r = await window.BSDialog.show({ title: 'Neue Punktwolke', message: `Das aktuelle Projekt gehört zu «${P.source}» (${P.sections.length} Querschnitte, ${P.columns.length} Stützen).\n\nVerwerfen und mit «${file.name}» neu beginnen, oder Querschnitte und Stützen behalten?`,
        buttons: [{ label: 'Abbrechen', value: null, variant: 'gray' }, { label: 'Behalten', value: 'keep', variant: 'gray' }, { label: 'Neu beginnen', value: 'reset', variant: 'red', focus: true }] });
      if (!r) return;
      if (r === 'reset') {
        this.pushUndo();
        Object.assign(P, { offset: null, axis: [], sections: [], columns: [], crops: [], planes: [] });
        this.renderCrops(); this.renderPlanes();
        this.curSecId = null; this.curColId = null; this.solids = null; this.modelBuilt = false;
        if (this.v3d) { this.v3d.setModel([], []); this.v3d.setWire([]); }
        ['c2bAxS_E', 'c2bAxS_N', 'c2bAxE_E', 'c2bAxE_N', 'c2bSliceZ'].forEach(id => { UI.$(id).value = ''; });
        UI.$('c2bSliceDz').value = '0'; this.plan.sliceZ = null; this.plan.sliceDz = 0;
        this.invalidateDev();
        UI.$('c2bBuildStat').textContent = '';
        this.selectSection(null);
      }
    }
    const ctrl = this.abort = new AbortController();
    UI.$('c2bAbort').hidden = false;
    UI.$('c2bDropFile').textContent = file.name;
    UI.$('c2bDrop').classList.remove('loaded');
    const voxel = UI.mm('c2bPreVoxel', 0);
    const t0 = performance.now();
    UI.log('Lese ' + file.name + ' (' + (file.size / 1048576).toFixed(1) + ' MB), Vorausdünnung ' + (voxel ? (voxel * 1000).toFixed(0) + ' mm' : 'aus') + ' …');
    try {
      const cloud = await C2B.read.readCloud(file, {
        voxel, maxPoints: Math.max(100000, UI.num('c2bPreMax', 3e7)), signal: ctrl.signal,
        onProgress: (f, col) => UI.progress(f, 'Einlesen ' + (f * 100).toFixed(0) + ' % · ' + UI.fmtInt(col.read) + ' gelesen · ' + UI.fmtInt(col.buf.n) + ' behalten'),
      });
      if (this.project.offset && (this.project.offset[0] !== cloud.offset[0] || this.project.offset[1] !== cloud.offset[1] || this.project.offset[2] !== cloud.offset[2])) {
        // Projekt besteht schon (geöffnet) -> Punktwolke in dessen lokales System verschieben
        const d = [0, 1, 2].map(k => cloud.offset[k] - this.project.offset[k]);
        for (let i = 0; i < cloud.n; i++) for (let k = 0; k < 3; k++) cloud.xyz[i * 3 + k] += d[k];
        cloud.offset = this.project.offset.slice();
      } else this.project.offset = cloud.offset.slice();
      this.raw = cloud; this.thinned = cloud; this.cloud = C2B.planes.applyRegions(cloud, this.project.crops);
      this.project.source = file.name;
      this.secPtsCache.clear();
      const dt = ((performance.now() - t0) / 1000).toFixed(1);
      UI.log(`Eingelesen: ${UI.fmtInt(cloud.nRead)} Punkte, behalten ${UI.fmtInt(cloud.n)}${cloud.rgb ? ', mit Farben' : ''} (${dt} s). Lokaler Ursprung E ${cloud.offset[0]} / N ${cloud.offset[1]}.`);
      if (cloud.truncated) UI.log('Höchstzahl erreicht – weitere Punkte wurden ignoriert. Vorausdünnung erhöhen.', 'warn');
      UI.$('c2bLoadStat').innerHTML = `${UI.fmtInt(cloud.nRead)} gelesen<br>${UI.fmtInt(cloud.n)} im Speicher${cloud.rgb ? ' · RGB' : ''}<br>Ursprung E ${cloud.offset[0]} · N ${cloud.offset[1]}`;
      UI.$('c2bDrop').classList.add('loaded');
      this.refreshDisplay(true);
      UI.$('c2bStep2').open = true;
    } catch (e) {
      UI.log('Fehler beim Einlesen: ' + e.message, 'err');
      UI.alert('Punktwolke konnte nicht gelesen werden', e.message);
      UI.$('c2bDropFile').textContent = '';
    } finally {
      this.abort = null; UI.$('c2bAbort').hidden = true; UI.progress(null);
      this.updateAll();
    }
  },

  refreshDisplay(fit) {
    const c = this.cloud;
    if (!c) return;
    this.display = C2B.thin.randomLimit(c, Math.max(100000, UI.num('c2bDispMax', 1.5e6)));
    this.colors = UI.cloudColors(this.display, UI.$('c2bColorMode').value);
    const bb = C2B.thin.bbox(c);
    this.zRange = [bb.min[2], bb.max[2]];
    this.defaultHalfWidth = Math.max(2, Math.hypot(bb.max[0] - bb.min[0], bb.max[1] - bb.min[1]) / 8);
    if (UI.$('c2bSliceZ').value === '') UI.$('c2bSliceZ').value = ((bb.min[2] + bb.max[2]) / 2).toFixed(2);
    this.plan.setCloud(this.display, this.colors);
    if (this.v3d) { this.v3d.setCloud(this.display, this.colors); this.v3d.setPointSize(UI.num('c2bPtSize', 2)); }
    if (this.dev && this.dev.display !== this.display) this.invalidateDev(); else this.applyCloudColors();
    UI.$('c2bLeftEmpty').hidden = true;
    if (fit) { this.plan.fit(); if (this.v3d) this.v3d.fit(); }
    this.refreshSections3d();
  },

  async thin() {
    if (!this.raw) return;
    const voxel = UI.mm('c2bVoxel', 0.02);
    UI.progress(0.1, 'Ausdünnen …'); await UI.tick();
    const t0 = performance.now();
    let c = C2B.thin.voxelThin(this.raw, voxel);
    let removed = 0;
    if (UI.$('c2bIsoOn').checked) {
      UI.progress(0.6, 'Isolierte Punkte entfernen …'); await UI.tick();
      const n0 = c.n;
      c = C2B.thin.removeIsolated(c, Math.max(0.001, UI.mm('c2bIsoR', 0.06)), Math.max(1, UI.num('c2bIsoN', 3)));
      removed = n0 - c.n;
    }
    this.thinned = c;
    this.cloud = C2B.planes.applyRegions(c, this.project.crops);
    this.secPtsCache.clear();
    UI.progress(null);
    const msg = `${UI.fmtInt(this.raw.n)} → ${UI.fmtInt(c.n)} Punkte (${(100 * c.n / this.raw.n).toFixed(1)} %)` + (removed ? `, ${UI.fmtInt(removed)} isolierte entfernt` : '');
    UI.$('c2bThinStat').textContent = msg;
    UI.log('Ausgedünnt mit ' + (voxel * 1000).toFixed(0) + ' mm: ' + msg + ' in ' + ((performance.now() - t0) / 1000).toFixed(1) + ' s.');
    this.refreshDisplay(false);
    this.reloadCurrentSectionPoints();
    this.updateAll();
  },

  thinReset() {
    if (!this.raw) return;
    this.thinned = this.raw; this.cloud = C2B.planes.applyRegions(this.raw, this.project.crops); this.secPtsCache.clear();
    UI.$('c2bThinStat').textContent = 'Zurückgesetzt auf ' + UI.fmtInt(this.raw.n) + ' Punkte.';
    this.refreshDisplay(false); this.reloadCurrentSectionPoints(); this.updateAll();
  },

  // ───────────────────────────────────────────── Querschnitte
  /** Alle Punkte der Schnittscheibe (vor den Masken). */
  secPtsAll(s) {
    if (!this.cloud) return [];
    const cell = UI.mm('c2bSecCell', 0.005);
    const key = [s.id, s.depth, cell, s.origin[0], s.origin[1], s.angle].join('|');
    let p = this.secPtsCache.get(key);
    if (!p) {
      p = C2B.sec.extractPoints(this.cloud, s, cell);
      if (this.secPtsCache.size > 400) this.secPtsCache.clear();
      this.secPtsCache.set(key, p);
    }
    return p;
  },

  /** Punkte eines Querschnitts für Vorschlag/Abweichung: ohne ausgeblendete (Masken). */
  secPts(s) {
    const all = this.secPtsAll(s);
    return s.masks && s.masks.length ? C2B.planes.applyMasks(all, s.masks) : all;
  },

  /** Querschnitt in den Editor laden (sichtbare + ausgeblendete Punkte, Ebenen-Schnittlinien). */
  edLoad(s, keepView) {
    if (!s) { this.ed.hiddenPts = []; this.ed.planeLines = []; this.ed.setSection(null, []); return; }
    const all = this.secPtsAll(s), vis = this.secPts(s);
    this.ed.hiddenPts = vis.length === all.length ? [] : all.filter(p => !vis.includes(p));
    this.ed.planeLines = C2B.trans.isTrans(s) ? [] : C2B.planes.sectionLines(this.project.planes, s);
    this.ed.overlay = C2B.trans.isTrans(s) ? C2B.trans.overlay(this.project.sections, s, this.thicknessMap()) : null;
    this.ed.setSection(s, vis, keepView);
  },

  reloadCurrentSectionPoints() {
    const s = this.curSec();
    if (s) { this.edLoad(s, true); this.onActiveProfile(true); this.onSelection(this.ed.sel.size); }
  },

  // ───────────────────────────────────────────── Ausschneiden
  applyCrops(quiet) {
    if (!this.thinned) return;
    const n0 = this.thinned.n;
    this.cloud = C2B.planes.applyRegions(this.thinned, this.project.crops);
    this.secPtsCache.clear();
    UI.$('c2bCropStat').textContent = this.project.crops.length ? `${UI.fmtInt(n0)} → ${UI.fmtInt(this.cloud.n)} Punkte nach Ausschnitt` : '';
    if (!quiet) UI.log(`Ausschnitt: ${this.project.crops.length} Bereich(e), ${UI.fmtInt(this.cloud.n)} von ${UI.fmtInt(n0)} Punkten verbleiben.`);
    this.refreshDisplay(false);
    this.reloadCurrentSectionPoints();
    this.project.sections.forEach(x => this.devOf(x));
    this.updateAll();
  },

  cropZ(id0, id1) {
    const a = parseFloat(UI.$(id0).value), b = parseFloat(UI.$(id1).value);
    return [isFinite(a) ? a : null, isFinite(b) ? b : null];
  },

  startCrop(mode) {
    this.setMode('plan');
    this.plan.drawPolygon(`Bereich ${mode === 'keep' ? 'behalten' : 'entfernen'}: Polygon anklicken · Doppelklick/Enter beendet · Esc bricht ab`, poly => {
      const [z0, z1] = this.cropZ('c2bCropZ0', 'c2bCropZ1');
      this.pushUndo();
      this.project.crops = this.project.crops.concat([{ id: C2B.sec.uid(), poly, mode, zMin: z0, zMax: z1 }]);
      this.renderCrops(); this.applyCrops(); this.plan.render();
    });
  },

  renderCrops() {
    const C = this.project.crops || [];
    UI.$('c2bCropList').hidden = !C.length;
    UI.$('c2bCropList').querySelector('tbody').innerHTML = C.map((r, i) => `<tr><td>Bereich ${i + 1}</td><td class="${r.mode === 'keep' ? 'c2b-ok' : 'c2b-bad'}">${r.mode === 'keep' ? 'behalten' : 'entfernen'}</td>` +
      `<td>${r.zMin === null && r.zMax === null ? 'alle' : (r.zMin === null ? '…' : r.zMin.toFixed(1)) + ' – ' + (r.zMax === null ? '…' : r.zMax.toFixed(1))}</td>` +
      `<td><button class="c2b-x" data-del="${r.id}" title="Bereich entfernen" style="border:none;background:none;cursor:pointer;color:var(--bs-text-muted)">×</button></td></tr>`).join('');
  },

  // ───────────────────────────────────────────── Masken im Querschnitt
  onMaskDrawn(poly) {
    const s = this.curSec(); if (!s) return;
    this.pushUndo();
    s.masks = (s.masks || []).concat([{ poly }]);
    const n0 = this.secPtsAll(s).length, n1 = this.secPts(s).length;
    UI.log(`${s.name}: ${n0 - n1} Punkte ausgeblendet (${s.masks.length} Maske(n)).`);
    this.edLoad(s, true); this.renderSecList(); this.updateButtons();
  },

  masksToAll() {
    const src = this.curSec(); if (!src || !(src.masks || []).length) return;
    this.pushUndo();
    this.project.sections.forEach(s => { if (s !== src) s.masks = JSON.parse(JSON.stringify(src.masks)); });
    this.project.sections.forEach(s => this.devOf(s));
    UI.log(`${src.masks.length} Maske(n) von «${src.name}» auf alle Querschnitte übertragen (Lage relativ zur Achse).`);
    this.renderSecList(); this.updateButtons();
  },

  masksClear() {
    const s = this.curSec(); if (!s || !(s.masks || []).length) return;
    this.pushUndo(); s.masks = [];
    this.edLoad(s, true); this.renderSecList(); this.updateButtons();
  },

  // ───────────────────────────────────────────── Ebenen
  startPlane() {
    if (!this.cloud) return;
    this.setMode('plan');
    this.plan.drawPolygon('Ebene: Bereich der ebenen Fläche umfahren · Doppelklick/Enter beendet · Esc bricht ab', poly => {
      const [z0, z1] = this.cropZ('c2bPlZ0', 'c2bPlZ1');
      const pts = C2B.planes.collectRegion(this.cloud, poly, z0, z1);
      let pl;
      try { pl = C2B.planes.fitPlane(pts, { tol: Math.max(0.001, UI.mm('c2bPlTol', 0.01)), kind: UI.$('c2bPlKind').value }); }
      catch (e) { UI.alert('Ebene', e.message); return; }
      this.pushUndo();
      const k = (this.project.planes || []).length + 1;
      Object.assign(pl, { id: C2B.sec.uid(), name: 'Ebene ' + k, poly, zMin: z0, zMax: z1 });
      this.project.planes = (this.project.planes || []).concat([pl]);
      UI.log(`${pl.name}: ${pl.kind} (Neigung ${pl.tilt.toFixed(1)}°), ${UI.fmtInt(pl.nInl)} von ${UI.fmtInt(pl.nAll)} Punkten auf der Ebene, RMS ${(pl.rms * 1000).toFixed(1)} mm.`);
      if (pl.nInl < 0.3 * pl.nAll) UI.log(`${pl.name}: nur ${(100 * pl.nInl / pl.nAll).toFixed(0)} % der Punkte liegen auf der Ebene – Bereich oder Höhe enger wählen.`, 'warn');
      this.renderPlanes(); this.plan.render();
      if (UI.$('c2bPlAuto').checked) this.applyPlanesAll(true);
      else this.reloadCurrentSectionPoints();
      this.updateAll();
    });
  },

  renderPlanes() {
    const L = this.project.planes || [];
    UI.$('c2bPlList').hidden = !L.length;
    UI.$('c2bPlList').querySelector('tbody').innerHTML = L.map(pl => `<tr><td><input type="text" data-pl="${pl.id}" value="${UI.esc(pl.name)}" style="width:90px;border:1px solid transparent;background:transparent;color:inherit;font:inherit"></td>` +
      `<td>${pl.kind}</td><td>${(pl.rms * 1000).toFixed(1)} mm</td><td>${(100 * pl.nInl / pl.nAll).toFixed(0)} %</td>` +
      `<td><button class="c2b-x" data-del="${pl.id}" title="Ebene löschen" style="border:none;background:none;cursor:pointer;color:var(--bs-text-muted)">×</button></td></tr>`).join('');
    if (this.v3d) this.v3d.setPlanes(L);
  },

  /** Ebenen-Schnittlinien in alle Teilprofile eines Querschnitts übernehmen; liefert Anzahl Kanten. */
  applyPlanesTo(s) {
    const lines = C2B.planes.sectionLines(this.project.planes, s);
    if (!lines.length) return 0;
    let n = 0;
    this.profs(s).forEach(P => {
      const r = C2B.planes.applyToProfile(P, lines, { maxDist: Math.max(0.005, UI.mm('c2bPlSnap', 0.1)) });
      if (r.applied.length) { P.vertices = r.vertices; n += r.applied.length; }
    });
    return n;
  },

  /** Nach automatischen Vorschlägen: Ebenen übernehmen, falls eingeschaltet. */
  autoPlanes(secs) {
    if (!UI.$('c2bPlAuto').checked || !(this.project.planes || []).length) return;
    let n = 0;
    secs.forEach(s => { n += this.applyPlanesTo(s); this.devOf(s); });
    if (n) UI.log(`Ebenen übernommen: ${n} Profilkanten auf Ebenen gelegt.`);
  },

  applyPlanesAll(skipUndo) {
    if (!(this.project.planes || []).length) return;
    if (!skipUndo) this.pushUndo();
    let n = 0, ns = 0;
    this.project.sections.forEach(s => { if (C2B.trans.isTrans(s)) return; const k = this.applyPlanesTo(s); if (k) { n += k; ns++; } this.devOf(s); });
    UI.log(`Ebenen auf ${ns} Querschnitte angewendet (${n} Profilkanten).`);
    this.reloadCurrentSectionPoints(); this.refreshSections3d(); this.modelDirty(); this.updateAll();
  },

  applyPlanesCurrent() {
    const s = this.curSec(); if (!s) return;
    this.pushUndo();
    const n = this.applyPlanesTo(s);
    UI.log(n ? `${s.name}: ${n} Profilkante(n) auf Ebenen gelegt.` : `${s.name}: keine Profilkante liegt nahe und parallel zu einer Ebene (Fangabstand ${UI.$('c2bPlSnap').value} mm).`);
    if (!n) this.dropUndo();
    this.ed.update(); this.onProfileChanged(s);
  },

  axisFromInputs() {
    const o = this.project.offset || [0, 0, 0];
    const v = ['c2bAxS_E', 'c2bAxS_N', 'c2bAxE_E', 'c2bAxE_N'].map(id => parseFloat(UI.$(id).value));
    if (v.some(x => !isFinite(x))) return null;
    const pts = [[v[0] - o[0], v[1] - o[1]], [v[2] - o[0], v[3] - o[1]]];
    // gezeichnete Achse mit Zwischenpunkten behalten, wenn Start/Ende übereinstimmen
    const A = this.project.axis;
    if (A && A.length > 2 && Math.hypot(A[0][0] - pts[0][0], A[0][1] - pts[0][1]) < 1e-3 && Math.hypot(A[A.length - 1][0] - pts[1][0], A[A.length - 1][1] - pts[1][1]) < 1e-3) return A;
    return pts;
  },

  setAxisInputs(pts) {
    const o = this.project.offset || [0, 0, 0];
    UI.$('c2bAxS_E').value = (pts[0][0] + o[0]).toFixed(3); UI.$('c2bAxS_N').value = (pts[0][1] + o[1]).toFixed(3);
    const e = pts[pts.length - 1];
    UI.$('c2bAxE_E').value = (e[0] + o[0]).toFixed(3); UI.$('c2bAxE_N').value = (e[1] + o[1]).toFixed(3);
    let L = 0; for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    UI.$('c2bAxisInfo').textContent = `Achslänge ${L.toFixed(2)} m` + (pts.length > 2 ? ` · ${pts.length} Achspunkte (Polylinie)` : '') + '.';
  },

  onAxisDrawn(pts) {
    this.pushUndo();
    this.project.axis = pts;
    this.setAxisInputs(pts);
    this.plan.render();
    UI.log('Achse gezeichnet (' + pts.length + ' Punkte).');
    this.updateAll();
  },

  onCutDrawn(a, b) {
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L < 1e-3) return this.onPlanModeEnd();
    // Blickrichtung: senkrecht zur Schnittlinie, Linie verläuft von links nach rechts
    const ang = Math.atan2(b[0] - a[0], -(b[1] - a[1]));
    const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    this.pushUndo();
    const kind = this.cutKind; this.cutKind = null;
    if (kind === 'transition') {
      const st = this._stationOf(mid);
      const T = C2B.trans.newTransition(mid, ang, st, { depth: UI.mm('c2bTrDepth', 0.5), align: UI.$('c2bTrAlign').value, sliceDepth: UI.mm('c2bDepth', 0.05) });
      this.addTransition(T);
      this.onPlanModeEnd();
      return;
    }
    const s = C2B.sec.newSection(mid, ang, 0, UI.mm('c2bDepth', 0.05), 'QS ' + (this.project.sections.length + 1));
    s.station = this._stationOf(mid);
    this.project.sections.push(s);
    UI.log(`Querschnitt «${s.name}» erzeugt.`);
    this.onPlanModeEnd();
    this.selectSection(s.id);
    if (UI.$('c2bAutoOnGen').checked) this.autoCurrent(true);
    this.updateAll();
  },

  // ───────────────────────────────────────────── Übergangsquerschnitte
  /** Achspunkt und Richtung bei Station st (Achse aus Schritt 4, sonst aktueller Querschnitt). */
  axisAt(st) {
    const A = this.project.axis, s0 = UI.num('c2bStation0', 0);
    if (A && A.length >= 2) {
      let acc = 0, t = st - s0;
      for (let i = 1; i < A.length; i++) {
        const a = A[i - 1], b = A[i], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (t <= acc + L || i === A.length - 1) { const f = (t - acc) / (L || 1); return { p: [a[0] + f * (b[0] - a[0]), a[1] + f * (b[1] - a[1])], ang: Math.atan2(b[1] - a[1], b[0] - a[0]) }; }
        acc += L;
      }
    }
    const c = this.curSec() || this.sortedSecs()[0];
    if (!c) return null;
    const f = C2B.sec.frame(c);
    return { p: [c.origin[0] + f.d[0] * (st - c.station), c.origin[1] + f.d[1] * (st - c.station)], ang: c.angle };
  },

  addTransitionAtStation() {
    const st = parseFloat(UI.$('c2bTrSt').value);
    if (!isFinite(st)) return UI.alert('Übergang', 'Bitte die Station des Übergangs angeben.');
    const ax = this.axisAt(st);
    if (!ax) return UI.alert('Übergang', 'Es fehlt eine Achse (Schritt 4) oder ein Querschnitt als Bezug.');
    this.pushUndo();
    this.addTransition(C2B.trans.newTransition(ax.p, ax.ang, st, { depth: UI.mm('c2bTrDepth', 0.5), align: UI.$('c2bTrAlign').value, sliceDepth: UI.mm('c2bDepth', 0.05) }));
  },

  addTransition(T) {
    this.project.sections.push(T);
    const [a, b] = C2B.trans.range(T);
    UI.log(`${T.name} eingefügt (Station ${a.toFixed(2)} – ${b.toFixed(2)}).`);
    this.selectSection(T.id);
    try {
      T.profiles = C2B.trans.suggestArea(this.project.sections, T);
      UI.log(`${T.name}: Fläche vorgeschlagen (${T.profiles.filter(p => p.role === 'hole').length} Aussparung(en), ${C2B.trans.areaOf(T).toFixed(2)} m²).`);
      this.edLoad(T, false); this.onActiveProfile();
    } catch (e) { UI.log(`${T.name}: ${e.message} Fläche bitte zeichnen.`, 'warn'); }
    this.onProfileChanged(T); this.modelDirty(); this.updateAll();
  },

  suggestTransitionArea() {
    const T = this.curSec(); if (!C2B.trans.isTrans(T)) return;
    try {
      const P = C2B.trans.suggestArea(this.project.sections, T);
      this.pushUndo(); T.profiles = P; this.ed.pi = 0;
      UI.log(`${T.name}: Fläche vorgeschlagen (${P.filter(p => p.role === 'hole').length} Aussparung(en), ${C2B.trans.areaOf(T).toFixed(2)} m²).`);
    } catch (e) { return UI.alert('Fläche vorschlagen', e.message); }
    this.edLoad(T, true); this.ed.fit(); this.onActiveProfile(); this.onProfileChanged(T);
  },

  transInfo(T) {
    const [a, b] = C2B.trans.range(T), A = C2B.trans.areaOf(T), nb = C2B.trans.neighbors(this.project.sections, T);
    return `Station ${a.toFixed(2)} – ${b.toFixed(2)} · Fläche ${A.toFixed(2)} m² · Volumen ${(A * (b - a)).toFixed(2)} m³ · links ${nb.left ? nb.left.name : '–'} · rechts ${nb.right ? nb.right.name : '–'}`;
  },

  _stationOf(p) {
    const A = this.project.axis;
    if (!A || A.length < 2) return this.project.sections.length;
    let best = Infinity, st = 0, acc = 0;
    for (let i = 1; i < A.length; i++) {
      const a = A[i - 1], b = A[i], dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy);
      const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (L * L || 1)));
      const d = Math.hypot(a[0] + t * dx - p[0], a[1] + t * dy - p[1]);
      if (d < best) { best = d; st = acc + t * L; }
      acc += L;
    }
    return UI.num('c2bStation0', 0) + st;
  },

  onPlanModeEnd() {
    UI.$('c2bAxisDraw').textContent = 'Achse im Grundriss zeichnen';
    UI.$('c2bCutDraw').textContent = 'Schnittlinie zeichnen';
    UI.$('c2bColPlace').textContent = 'Stütze platzieren';
    this.plan.setMode('pan');
  },

  async generate() {
    const axis = this.axisFromInputs();
    if (!axis) return UI.alert('Achse fehlt', 'Bitte Start- und Endpunkt eingeben oder die Achse im Grundriss zeichnen.');
    const byCount = UI.$('c2bModeCount').getAttribute('aria-pressed') === 'true';
    let secs;
    try {
      secs = C2B.sec.generateAlongAxis(axis, {
        spacing: byCount ? 0 : UI.num('c2bSpacing', 5), count: byCount ? Math.round(UI.num('c2bCount', 10)) : 0,
        depth: UI.mm('c2bDepth', 0.05), stationStart: UI.num('c2bStation0', 0) });
    } catch (e) { return UI.alert('Querschnitte', e.message); }
    let mode = 'replace';
    if (this.project.sections.length) {
      mode = await window.BSDialog.show({ title: 'Querschnitte erzeugen', message: `Es bestehen bereits ${this.project.sections.length} Querschnitte. Sollen die ${secs.length} neuen sie ersetzen oder ergänzen?`,
        buttons: [{ label: 'Abbrechen', value: null, variant: 'gray' }, { label: 'Ergänzen', value: 'add', variant: 'gray' }, { label: 'Ersetzen', value: 'replace', variant: 'red', focus: true }] });
      if (!mode) return;
    }
    this.pushUndo();
    this.project.axis = axis;
    if (mode === 'replace') this.project.sections = [];
    this.project.sections.push(...secs);
    this.secPtsCache.clear();
    UI.log(`${secs.length} Querschnitte entlang der Achse erzeugt (${byCount ? 'Anzahl ' + secs.length : 'Abstand ' + UI.num('c2bSpacing', 5) + ' m'}).`);
    this.selectSection(secs[0].id);
    if (UI.$('c2bAutoOnGen').checked && this.cloud) await this.proposeSeries(secs);
    this.modelDirty();
    this.updateAll();
  },

  /** Teilprofile des Querschnitts / aktives Teilprofil im Editor. */
  profs(s) { return s ? C2B.sec.profilesOf(s) : []; },
  curProf() { const s = this.curSec(); return s ? (this.profs(s)[this.ed.pi] || null) : null; },
  hasProfile(s) { return this.profs(s).some(p => p.vertices.length >= 2); },
  maxGap(s) { return (s && s.maxGap > 0) ? s.maxGap : C2B.sec.DEFAULT_MAX_GAP; },

  /** Abweichung eines Querschnitts für die Liste berechnen. */
  devOf(s) {
    if (C2B.trans.isTrans(s) || !this.hasProfile(s)) { s._dev = null; return null; }
    const tol = this.tol();
    const rep = C2B.g2.deviationMulti(this.secPts(s), this.profs(s), tol, Math.max(UI.mm('c2bBand', 0.1), tol * 1.5));
    s._dev = rep.max;
    return rep;
  },

  topoKey(profiles) { return profiles.map(p => p.vertices.length + (p.closed ? 'g' : 'o')).join('+'); },

  /**
   * Profile für eine Serie von Querschnitten vorschlagen:
   * 1. für jeden Querschnitt ein automatischer Vorschlag (Teilprofile über max. Punktabstand)
   * 2. Referenz = häufigste Topologie unter den gut passenden Vorschlägen (meiste Punkte)
   * 3. Referenz schrittweise auf die Nachbarn übertragen und anpassen (gleiche Topologie);
   *    passt die Vorlage schlecht, bleibt der eigene Vorschlag.
   */
  async proposeSeries(secs) {
    const tol = this.tol(), search = UI.mm('c2bFitSearch', 0.15), band = Math.max(UI.mm('c2bBand', 0.1), tol * 1.5);
    const S = secs.slice().sort((a, b) => a.station - b.station);
    const auto = [];
    for (let i = 0; i < S.length; i++) {
      UI.progress(0.5 * i / S.length, `Vorschlag ${i + 1} / ${S.length}`);
      if (i % 4 === 0) await UI.tick();
      const pts = this.secPts(S[i]);
      let prof = null, rep = null;
      if (pts.length >= 10) {
        try { prof = C2B.sec.autoProfiles(pts, tol, { maxGap: this.maxGap(S[i]) }); rep = C2B.g2.deviationMulti(pts, prof, tol, band); }
        catch (e) { UI.log(`${S[i].name}: ${e.message}`, 'warn'); }
      }
      auto.push({ prof, rep, n: pts.length });
    }
    const good = auto.map((a, i) => ({ a, i })).filter(x => x.a.prof && x.a.rep.withinTol >= 0.95);
    if (!good.length) {
      S.forEach((s, i) => { if (auto[i].prof) s.profiles = auto[i].prof; });
      this.autoPlanes(S);
      UI.progress(null); UI.log('Kein Querschnitt mit eindeutigem Profil gefunden – Einzelvorschläge übernommen, bitte prüfen.', 'warn');
      S.forEach(s => this.devOf(s)); this.reloadCurrentSectionPoints(); return;
    }
    // Vorlage: möglichst wenige offene Teilprofile (zerrissene Profile nicht weitergeben), dann häufigste Topologie
    const openCnt = prof => prof.filter(p => !p.closed).length;
    const minOpen = Math.min(...good.map(x => openCnt(x.a.prof)));
    const cand = good.filter(x => openCnt(x.a.prof) === minOpen);
    const cnt = {};
    cand.forEach(x => { const k = this.topoKey(x.a.prof); cnt[k] = (cnt[k] || 0) + 1; });
    const modeKey = Object.entries(cnt).sort((a, b) => b[1] - a[1])[0][0];
    const ref = cand.filter(x => this.topoKey(x.a.prof) === modeKey).sort((a, b) => b.a.n - a.a.n)[0].i;
    S[ref].profiles = auto[ref].prof;
    UI.log(`Referenzquerschnitt: ${S[ref].name} (${auto[ref].prof.length > 1 ? auto[ref].prof.length + ' Teilprofile, ' : ''}${auto[ref].prof.map(p => p.vertices.length).join(' + ')} Ecken, ${cnt[modeKey]} von ${S.length} Vorschlägen gleich).`);
    let done = 1;
    const own = [];
    for (const dir of [1, -1]) {
      let prev = S[ref];
      for (let k = ref + dir; k >= 0 && k < S.length; k += dir) {
        const s = S[k], pts = this.secPts(s);
        UI.progress(0.5 + 0.5 * (++done) / S.length, `Anpassen ${done} / ${S.length}`);
        if (done % 4 === 0) await UI.tick();
        if (pts.length < 10) continue;
        const fit = C2B.sec.fitSection(prev, pts, search);
        const rep = C2B.g2.deviationMulti(pts, fit, tol, band);
        const a = auto[k];
        // eigener Vorschlag ist sauberer (weniger offene Profile, gut passend) -> diesen nehmen und von hier weitergeben
        const ownBetter = a.prof && a.rep && a.rep.withinTol >= 0.95 && openCnt(a.prof) < openCnt(fit) && rep.withinTol < 0.99;
        // Abdeckung: Anteil aller Querschnittspunkte, die das Profil erklärt (sonst passt z. B. eine
        // grosse Röhre «gut» auf einen Teil der Punkte zweier kleiner Röhren)
        const covFit = rep.nUsed / Math.max(1, pts.length), covOwn = a.rep ? a.rep.nUsed / Math.max(1, pts.length) : 0;
        const ownClean = a.prof && a.rep && openCnt(a.prof) === 0 && a.rep.withinTol >= 0.95;
        const coverageLost = ownClean && covFit < covOwn - 0.1;   // z. B. eine Röhre statt zwei
        if (!ownBetter && !coverageLost && rep.withinTol !== null && rep.withinTol >= 0.8) { s.profiles = fit; prev = s; }
        else if (a.prof) { s.profiles = a.prof; own.push(s.name); if (openCnt(a.prof) === 0 && a.rep && a.rep.withinTol >= 0.95) prev = s; }
      }
    }
    UI.progress(null);
    this.autoPlanes(S);
    S.forEach(s => this.devOf(s));
    UI.log(`Profile für ${S.length} Querschnitte vorgeschlagen` + (own.length ? `; eigene Topologie (Vorlage passte nicht): ${own.join(', ')}` : '; alle mit gleicher Topologie') + '.');
    if (own.length) UI.log('Querschnitte mit eigener Topologie prüfen – für Drahtmodell und Bauteile ist gleiche Eckenzahl ideal.', 'warn');
    this.reloadCurrentSectionPoints();
  },

  selectSection(id, keepView) {
    const s = this.project.sections.find(x => x.id === id) || null;
    this.curSecId = s ? s.id : null;
    UI.$('c2bSecEmpty').hidden = !!s;
    const isT = C2B.trans.isTrans(s);
    UI.$('c2bSecStats').hidden = !s; UI.$('c2bComp').hidden = !s || isT; UI.$('c2bTrPanel').hidden = !isT; UI.$('c2bSecHelp').hidden = !s; UI.$('c2bSecLegend').hidden = !s || isT;
    if (isT) { UI.$('c2bTrName').value = s.name; UI.$('c2bTrDepthSec').value = Math.round(s.trans.depth * 1000); UI.$('c2bTrAlignSec').value = s.trans.align; }
    if (s && !isT && UI.$('c2bTrSt').value === '') UI.$('c2bTrSt').value = s.station.toFixed(2);
    if (s) {
      this.edLoad(s, keepView && this.ed.sec && this.ed.sec.id === s.id);
      UI.$('c2bSecTitle').textContent = s.name + ' · Station ' + s.station.toFixed(2);
      UI.$('c2bMaxGap').value = Math.round(this.maxGap(s) * 100);
      UI.$('c2bSecDepth').value = Math.round((s.depth || 0.05) * 1000);
    } else { this.edLoad(null); UI.$('c2bSecTitle').textContent = 'Querschnitt'; }
    this.onActiveProfile(true);
    this.onSelection(this.ed.sel.size);
    this.renderSecList(); this.refreshSections3d(); this.plan.render();
    this.updateButtons();
  },

  /** Auswahl des aktiven Teilprofils (Liste, «geschlossen», Bauteiltabelle) nachführen. */
  onActiveProfile(silent) {
    const s = this.curSec(), sel = UI.$('c2bProfSel');
    const P = this.profs(s);
    sel.innerHTML = P.map((p, k) => `<option value="${k}"${k === this.ed.pi ? ' selected' : ''}>Profil ${k + 1} (${p.vertices.length} Ecken${p.closed ? '' : ', offen'})</option>`).join('');
    sel.hidden = P.length < 2;
    const cp = this.curProf();
    UI.$('c2bClosed').checked = !!(cp && cp.closed);
    if (cp && C2B.trans.isTrans(s)) UI.$('c2bTrRole').value = cp.role === 'hole' ? 'hole' : 'outer';
    if (C2B.trans.isTrans(s)) sel.innerHTML = P.map((p, k) => `<option value="${k}"${k === this.ed.pi ? ' selected' : ''}>${p.role === 'hole' ? 'Aussparung' : 'Fläche'} ${k + 1} (${p.vertices.length} Ecken)</option>`).join('');
    this.renderComp();
    this.onEdgeSelection(null);
    if (!silent) this.updateButtons();
  },

  stepSection(d) {
    const S = this.sortedSecs();
    const i = S.findIndex(s => s.id === this.curSecId);
    const j = Math.max(0, Math.min(S.length - 1, i + d));
    if (S[j] && j !== i) this.selectSection(S[j].id, true);
  },

  autoCurrent(quiet) {
    const s = this.curSec();
    if (!s) return;
    const pts = this.secPts(s);
    try {
      if (!quiet) this.pushUndo();
      s.profiles = C2B.sec.autoProfiles(pts, this.tol(), { maxGap: this.maxGap(s) });
      this.ed.pi = 0;
      UI.log(`${s.name}: Vorschlag mit ${s.profiles.length > 1 ? s.profiles.length + ' Teilprofilen, ' : ''}${s.profiles.map(p => p.vertices.length + ' Ecken' + (p.closed ? '' : ' (offen)')).join(' + ')}.`);
    } catch (e) { UI.log(s.name + ': ' + e.message, 'warn'); if (!quiet) UI.alert('Vorschlag nicht möglich', e.message); }
    this.autoPlanes([s]);
    this.edLoad(s, true); this.ed.fit();
    this.onActiveProfile();
    this.onProfileChanged(s, true);
  },

  fromPrev() {
    const S = this.sortedSecs(), i = S.findIndex(s => s.id === this.curSecId);
    let prev = null;
    for (let k = i - 1; k >= 0; k--) if (this.hasProfile(S[k])) { prev = S[k]; break; }
    if (!prev) for (let k = i + 1; k < S.length; k++) if (this.hasProfile(S[k])) { prev = S[k]; break; }
    if (!prev) return UI.alert('Keine Vorlage', 'Es gibt noch keinen anderen Querschnitt mit Profil.');
    const s = S[i];
    this.pushUndo();
    s.profiles = C2B.sec.fitSection(prev, this.secPts(s), UI.mm('c2bFitSearch', 0.15));
    this.ed.pi = 0;
    this.autoPlanes([s]);
    UI.log(`${s.name}: Profil von «${prev.name}» übernommen und angepasst.`);
    this.ed.update(); this.onActiveProfile();
    this.onProfileChanged(s, true);
  },

  refit() {
    const s = this.curSec(), P = this.curProf();
    if (!s || !P || P.vertices.length < 2) return;
    this.pushUndo();
    const f = C2B.sec.fitProfile(P, this.secPts(s), UI.mm('c2bFitSearch', 0.15), false);
    P.vertices = f.vertices;
    if (f.mids) P.mids = f.mids;
    this.ed.update();
    this.onProfileChanged(s, false);
  },

  async autoAll() {
    const empty = this.project.sections.filter(s => !C2B.trans.isTrans(s) && !this.hasProfile(s));
    if (!empty.length) return UI.log('Alle Querschnitte haben bereits ein Profil.');
    this.pushUndo();
    for (let i = 0; i < empty.length; i++) {
      UI.progress(i / empty.length, `Vorschlag ${i + 1} / ${empty.length}`); await UI.tick();
      try { empty[i].profiles = C2B.sec.autoProfiles(this.secPts(empty[i]), this.tol(), { maxGap: this.maxGap(empty[i]) }); this.autoPlanes([empty[i]]); this.devOf(empty[i]); }
      catch (e) { UI.log(empty[i].name + ': ' + e.message, 'warn'); }
    }
    UI.progress(null);
    this.reloadCurrentSectionPoints(); this.modelDirty(); this.updateAll();
  },

  /** Profile + Bauteile des aktuellen Querschnitts schrittweise nach beiden Seiten übertragen. */
  async propagate() {
    const S = this.sortedSecs().filter(x => !C2B.trans.isTrans(x)), i0 = S.findIndex(s => s.id === this.curSecId);
    const src = S[i0];
    if (!src || !this.hasProfile(src)) return;
    const P = this.profs(src);
    const ok = await UI.confirm('Profil auf alle übertragen', `Das Profil von «${src.name}» (${P.length > 1 ? P.length + ' Teilprofile, ' : ''}${P.map(p => p.vertices.length).join(' + ')} Ecken) wird auf alle ${S.length - 1} anderen Querschnitte übertragen und dort an die Punkte angepasst. Bestehende Profile und Bauteile werden ersetzt.`);
    if (!ok) return;
    this.pushUndo();
    const search = UI.mm('c2bFitSearch', 0.15);
    let n = 0;
    for (const dir of [1, -1]) {
      let prev = src;
      for (let k = i0 + dir; k >= 0 && k < S.length; k += dir) {
        const s = S[k];
        UI.progress(++n / (S.length - 1), `Übertragen ${n} / ${S.length - 1}`);
        if (n % 3 === 0) await UI.tick();
        s.profiles = C2B.sec.fitSection(prev, this.secPts(s), search);
        // Bauteile immer vom Ausgangsquerschnitt
        s.profiles.forEach((p, k2) => { p.components = JSON.parse(JSON.stringify(P[k2] ? P[k2].components : [])); });
        prev = s;
      }
    }
    UI.progress(null);
    this.autoPlanes(S.filter(x => x !== src));
    S.forEach(s => this.devOf(s));
    UI.log(`Profil von «${src.name}» auf ${S.length - 1} Querschnitte übertragen.`);
    this.modelDirty(); this.updateAll();
  },

  async deleteSection(all) {
    if (all) {
      if (!(await UI.confirm('Alle Querschnitte löschen', `${this.project.sections.length} Querschnitte inklusive Profile und Bauteile löschen?`, true))) return;
      this.pushUndo(); this.project.sections = [];
      this.selectSection(null);
    } else {
      const s = this.curSec(); if (!s) return;
      this.pushUndo();
      const S = this.sortedSecs(), i = S.indexOf(s);
      this.project.sections = this.project.sections.filter(x => x !== s);
      const nxt = S[i + 1] || S[i - 1];
      this.selectSection(nxt ? nxt.id : null);
    }
    this.modelDirty(); this.updateAll();
  },

  onProfileChanged(s) {
    this.onSelection(this.ed.sel.size);
    const cp = this.curProf();
    UI.$('c2bClosed').checked = !!(cp && cp.closed);
    const sel = UI.$('c2bProfSel');
    if (sel.options.length !== this.profs(s).length) this.onActiveProfile(true);
    this.renderSecList(); this.renderComp();
    clearTimeout(this._t3d); this._t3d = setTimeout(() => this.refreshSections3d(), 150);
    this.plan.render();
    this.modelDirty();
    this.updateButtons();
  },

  onSectionStats(rep) {
    const s = this.curSec();
    const el = UI.$('c2bSecStats');
    if (!s) return;
    const n = this.secPts(s).length;
    const P = this.profs(s);
    if (C2B.trans.isTrans(s)) { el.innerHTML = `<span>Punkte <b>${UI.fmtInt(n)}</b></span><span>${this.transInfo(s)}</span>`; UI.$('c2bTrInfo').textContent = ''; return; }
    const ecken = P.length > 1 ? `<span>Teilprofile <b>${P.length}</b></span><span>Ecken <b>${P.map(p => p.vertices.length).join(' + ')}</b></span>` : `<span>Ecken <b>${P.length ? P[0].vertices.length : 0}</b></span>`;
    if (!rep || rep.max === null) { el.innerHTML = `<span>Punkte <b>${UI.fmtInt(n)}</b></span>${ecken}<span class="c2b-mute">kein Profil – «Vorschlag» oder «Zeichnen»</span>`; return; }
    const tol = this.tol();
    const okCls = rep.max <= tol ? 'c2b-ok' : 'c2b-bad';
    el.innerHTML = `<span>Punkte <b>${UI.fmtInt(n)}</b> (${UI.fmtInt(rep.nUsed)} am Profil)</span>${ecken}` +
      `<span>max <b class="${okCls}">${UI.fmtMM(rep.max)}</b></span><span>95 % <b>${UI.fmtMM(rep.p95)}</b></span><span>Mittel <b>${UI.fmtMM(rep.mean)}</b></span>` +
      `<span>in Toleranz <b>${(rep.withinTol * 100).toFixed(1)} %</b></span><span class="c2b-mute">Toleranz ${UI.fmtMM(tol)}</span>`;
    this.renderSecList();
  },

  renderSecList() {
    const tb = UI.$('c2bSecList').querySelector('tbody');
    const tol = this.tol();
    tb.innerHTML = this.sortedSecs().map(s => {
      if (C2B.trans.isTrans(s)) {
        const [a, b] = C2B.trans.range(s);
        return `<tr data-id="${s.id}" class="${s.id === this.curSecId ? 'sel' : ''}"><td title="Übergangsquerschnitt">⇄ ${UI.esc(s.name)}</td><td>${s.station.toFixed(2)}</td><td colspan="2" class="c2b-mute">Übergang ${((b - a) * 1000).toFixed(0)} mm</td><td>${C2B.trans.areaOf(s) > 0 ? '<span class="c2b-ok">■</span>' : '<span class="c2b-mute">□</span>'}</td></tr>`;
      }
      const P = this.profs(s).filter(p => p.vertices.length);
      const nV = P.map(p => p.vertices.length).join('+');
      const dev = s._dev;
      const devTxt = dev === null || dev === undefined ? '<span class="c2b-mute">–</span>' : `<span class="${dev <= tol ? 'c2b-ok' : 'c2b-bad'}">${(dev * 1000).toFixed(0)} mm</span>`;
      const nc = C2B.sec.allComponents(s).length;
      const comp = nc ? `<span class="c2b-ok" title="${nc} Bauteile">●</span>` : '<span class="c2b-mute">○</span>';
      return `<tr data-id="${s.id}" class="${s.id === this.curSecId ? 'sel' : ''}"><td>${UI.esc(s.name)}</td><td>${s.station.toFixed(2)}</td><td>${nV || '–'}</td><td>${devTxt}</td><td>${comp}</td></tr>`;
    }).join('');
    const sel = tb.querySelector('tr.sel');
    if (sel && sel.scrollIntoView) sel.scrollIntoView({ block: 'nearest' });
  },

  refreshSections3d() {
    if (!this.v3d) return;
    this.v3d.setSections(this.project.sections, this.curSecId, this.zRange, this.thicknessMap(), UI.$('c2bShowAreas').getAttribute('aria-pressed') === 'true');
  },

  // ───────────────────────────────────────────── Bauteile
  defaultThickness() { return { floor: UI.mm('c2bTFloor', 0.3), wall: UI.mm('c2bTWall', 0.3), ceiling: UI.mm('c2bTCeil', 0.3) }; },

  /** Bauteile für ein Teilprofil vorschlagen; bei mehreren Teilprofilen Name mit Präfix «Profil k ·». */
  suggestFor(s, k) {
    const P = this.profs(s)[k];
    const comps = C2B.sec.suggestComponents(P.vertices, P.closed, this.defaultThickness(), UI.num('c2bWallAng', 35));
    if (this.profs(s).length > 1) comps.forEach(c => { c.name = `Profil ${k + 1} · ${c.name}`; });
    P.components = comps;
    return comps;
  },

  suggestCurrent() {
    const s = this.curSec();
    if (!s || !this.hasProfile(s)) return;
    this.pushUndo();
    const names = [];
    this.profs(s).forEach((P, k) => { if (P.vertices.length >= 2) names.push(...this.suggestFor(s, k).map(c => c.name)); });
    UI.log(`${s.name}: ${names.length} Bauteile vorgeschlagen (${names.join(', ')}).`);
    this.onProfileChanged(s); this.ed.render();
  },

  async suggestAll() {
    this.pushUndo();
    let n = 0;
    this.project.sections.forEach(s => {
      if (!C2B.trans.isTrans(s) && this.hasProfile(s) && !C2B.sec.allComponents(s).length) {
        this.profs(s).forEach((P, k) => { if (P.vertices.length >= 2) this.suggestFor(s, k); });
        n++;
      }
    });
    UI.log(`Bauteile für ${n} Querschnitte vorgeschlagen.`);
    this.renderComp(); this.ed.render(); this.modelDirty(); this.updateAll();
  },

  copyComponents() {
    const src = this.curSec();
    if (!src || !C2B.sec.allComponents(src).length) return UI.alert('Keine Bauteile', 'Der aktuelle Querschnitt hat noch keine Bauteile.');
    const blank = UI.$('c2bCompCopyInterp').checked;
    const SP = this.profs(src);
    this.pushUndo();
    let n = 0;
    const skip = [];
    this.project.sections.forEach(s => {
      if (s === src || C2B.trans.isTrans(s)) return;
      const P = this.profs(s);
      const same = P.length === SP.length && P.every((p, k) => p.vertices.length === SP[k].vertices.length && !!p.closed === !!SP[k].closed);
      if (!same) { if (this.hasProfile(s)) skip.push(s.name); return; }
      P.forEach((p, k) => { p.components = SP[k].components.map(c => Object.assign({}, c, blank ? { thickness: null } : {})); });
      n++;
    });
    UI.log(`Bauteile auf ${n} Querschnitte übertragen` + (blank ? ' (Stärken interpoliert)' : '') + '.');
    if (skip.length) UI.log(`Nicht übertragen (andere Topologie): ${skip.join(', ')}. Tipp: «Profil auf alle» für gleiche Topologie.`, 'warn');
    this.renderComp(); this.ed.render(); this.modelDirty(); this.updateAll();
  },

  addComponentFromEdges() {
    const s = this.curSec(), P = this.curProf(), r = this.ed.edgeSelectionAsComponent();
    if (!s || !P || !r) return UI.alert('Keine Kanten gewählt', 'Mit dem Werkzeug «Kanten wählen» zuerst die Kanten des Bauteils markieren (Klick = Anfang, Shift+Klick = Ende).');
    const n = P.vertices.length, closed = P.closed;
    const newE = new Set(C2B.sec.componentEdges(r, n, closed));
    this.pushUndo();
    // gewählte Kanten aus bestehenden Bauteilen herauslösen
    const rest = [];
    P.components.forEach(c => {
      const ce = C2B.sec.componentEdges(c, n, closed);
      let run = [];
      const flush = () => { if (run.length) rest.push(Object.assign({}, c, { start: run[0], end: closed ? (run[run.length - 1] + 1) % n : run[run.length - 1] + 1 })); run = []; };
      ce.forEach(e => { if (newE.has(e)) flush(); else run.push(e); });
      flush();
    });
    const mid = [...newE].map(e => C2B.g2.edges(P.vertices, closed)[e]);
    let ang = 0; mid.forEach(([a, b]) => { const g = Math.abs(Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI); ang += Math.min(g, 180 - g); });
    ang /= mid.length;
    let vmid = 0; mid.forEach(([a, b]) => { vmid += (a[1] + b[1]) / 2; }); vmid /= mid.length;
    const vs = P.vertices.map(p => p[1]), vc = (Math.min(...vs) + Math.max(...vs)) / 2;
    const type = ang > UI.num('c2bWallAng', 35) ? 'wall' : (vmid < vc ? 'floor' : 'ceiling');
    const prefix = this.profs(s).length > 1 ? `Profil ${this.ed.pi + 1} · ` : '';
    const all = C2B.sec.allComponents(s).filter(c => !P.components.includes(c)).concat(rest);
    let name = prefix + UI.TYPE_LABEL[type], k = 1;
    while (all.some(c => c.name === name)) name = prefix + UI.TYPE_LABEL[type] + ' ' + (++k);
    rest.push({ name, type, start: r.start, end: r.end, thickness: this.defaultThickness()[type], flip: false });
    P.components = rest;
    this.ed.edgeSel = null;
    this.onEdgeSelection(null);
    this.onProfileChanged(s); this.ed.render();
  },

  /** Anzahl gewählter Ecken (Mehrfachauswahl im Editor). */
  onSelection(n) {
    const P = this.curProf();
    UI.$('c2bDelSel').disabled = !n;
    UI.$('c2bArc').disabled = !(n >= 2 && this.ed.selChain());
    UI.$('c2bLine').disabled = !(P && P.mids && P.mids.some(Boolean));
    UI.$('c2bDelSel').textContent = n > 1 ? `${n} Ecken löschen` : 'Ecken löschen';
  },

  onEdgeSelection(sel) {
    const r = sel ? this.ed.edgeSelectionAsComponent() : null;
    UI.$('c2bEdgeSel').textContent = r ? `${r.count} Kante(n) gewählt (Ecke ${r.start} → ${r.end})` : '';
    UI.$('c2bCompAdd').disabled = !r;
  },

  renderComp() {
    const s = this.curSec(), P = this.curProf();
    const tb = UI.$('c2bComp').querySelector('tbody');
    if (!s || !P) { tb.innerHTML = s ? `<tr><td colspan="7" class="c2b-mute" style="padding:6px">Noch kein Profil.</td></tr>` : ''; return; }
    const T = this.thicknessMap().get(s.id) || {};
    const n = P.vertices.length;
    tb.innerHTML = P.components.map((c, i) => {
      const ne = C2B.sec.componentEdges(c, n, P.closed).length;
      const eff = T[c.name] ? (T[c.name].t * 1000).toFixed(0) : '';
      const opts = Object.entries(UI.TYPE_LABEL).map(([k, v]) => `<option value="${k}"${k === c.type ? ' selected' : ''}>${v}</option>`).join('');
      const tval = c.thickness === null || c.thickness === undefined || c.thickness === '' ? '' : (c.thickness * 1000).toFixed(0);
      return `<tr data-i="${i}"><td><span class="c2b-swatch" style="background:${UI.TYPE_COLOR[c.type]}"></span></td>` +
        `<td><input type="text" data-f="name" value="${UI.esc(c.name)}"></td><td><select data-f="type">${opts}</select></td>` +
        `<td class="c2b-mute" title="Ecke ${c.start} → ${c.end}">${ne} (${c.start}→${c.end})</td>` +
        `<td><input type="number" data-f="thickness" min="1" step="10" value="${tval}" placeholder="${eff ? 'interp. ' + eff : ''}" title="leer = interpoliert"></td>` +
        `<td style="text-align:center"><input type="checkbox" data-f="flip"${c.flip ? ' checked' : ''}></td>` +
        `<td><button class="c2b-x" data-f="del" title="Bauteil entfernen">×</button></td></tr>`;
    }).join('') || `<tr><td colspan="7" class="c2b-mute" style="padding:6px">Noch keine Bauteile${this.profs(s).length > 1 ? ' in Profil ' + (this.ed.pi + 1) : ''} – «Bauteile vorschlagen» oder Kanten wählen.</td></tr>`;
  },

  // ───────────────────────────────────────────── Abgleich Modell ↔ Punktwolke
  /** Farbskala aus den Einstellungen (Stufen in mm, aufsteigend). */
  devScale() {
    const D = C2B.dev.DEFAULT_SCALE;
    let cls = null;
    try { cls = JSON.parse(UI.$('c2bDevScale').value || 'null'); } catch (e) { cls = null; }
    if (!Array.isArray(cls) || !cls.length) cls = D.classes.map(c => ({ mm: c.max * 1000, color: c.color }));
    return { classes: cls.filter(c => c.mm > 0).map(c => ({ max: c.mm / 1000, color: c.color })).sort((a, b) => a.max - b.max),
      aboveColor: UI.$('c2bDevAbove').value || D.aboveColor, outColor: UI.$('c2bDevOut').value || D.outColor,
      searchMax: Math.max(0.005, UI.mm('c2bDevMax', D.searchMax)) };
  },

  setDevScaleRows(rows) {
    UI.$('c2bDevScale').value = JSON.stringify(rows.slice().sort((a, b) => a.mm - b.mm));
    UI.saveSettings(); this.renderDevScale(); this.recolorDev();
  },

  renderDevScale() {
    const cls = this.devScale().classes;
    UI.$('c2bDevScaleEd').innerHTML = cls.map((c, i) => `<div class="c2b-scale-row"><span>${i ? 'bis' : '≤'}</span>` +
      `<input type="number" data-k="${i}" data-f="mm" min="0.1" step="0.5" value="${+(c.max * 1000).toFixed(2)}" title="obere Grenze der Stufe in mm">` +
      `<input type="color" data-k="${i}" data-f="color" value="${c.color}"><button type="button" data-del="${i}" title="Stufe entfernen">×</button></div>`).join('');
  },

  devRows() { return this.devScale().classes.map(c => ({ mm: +(c.max * 1000).toFixed(3), color: c.color })); },

  async runDeviation() {
    if (!this.display) return;
    const scale = this.devScale();
    const surf = C2B.dev.surfaceTriangles(this.project);
    if (!surf.n) return UI.alert('Abgleich', 'Für die Interpolation braucht es mindestens zwei benachbarte Querschnitte mit Profil (gleiche Teilprofile).');
    const t0 = performance.now();
    UI.progress(0, 'Abweichung: Fläche vorbereiten …'); await UI.tick();
    const idx = C2B.dev.buildIndex(surf, scale.searchMax);
    const c = this.display, out = new Float32Array(c.n), chunk = 100000;
    for (let i = 0; i < c.n; i += chunk) {
      C2B.dev.distances(idx, c, out, i, Math.min(c.n, i + chunk));
      UI.progress(i / c.n, `Abweichung ${Math.round(100 * i / c.n)} % · ${UI.fmtInt(i)} Punkte`);
      await UI.tick();
    }
    UI.progress(null);
    this.dev = { dist: out, pad: scale.searchMax, display: c, stale: false };
    UI.$('c2bDevShow').disabled = false; UI.$('c2bDevShow').checked = true;
    this.recolorDev();
    // Volumenkörper und Flächen verdecken die eingefärbten Punkte: im 3D ausblenden
    [['c2bShowModel', ['model', 'wire']], ['c2bShowAreas', ['areas']], ['c2bShowInterp', ['interp']], ['c2bShowCloud', null]].forEach(([id, groups]) => {
      const on = !groups;
      UI.$(id).setAttribute('aria-pressed', on);
      if (this.v3d) (groups || ['cloud']).forEach(g => this.v3d.setVisible(g, on));
    });
    const r = this.dev.res;
    UI.log(`Abgleich: ${UI.fmtInt(c.n)} Punkte gegen ${UI.fmtInt(surf.n)} Dreiecke der interpolierten Fläche in ${((performance.now() - t0) / 1000).toFixed(1)} s · ` +
      `Mittel ${UI.fmtMM(r.mean)}, 95 % ${UI.fmtMM(r.p95)}, ${(100 * r.nOut / c.n).toFixed(1)} % ausserhalb der Suchgrenze.`);
    this.updateButtons();
  },

  recolorDev() {
    if (!this.dev) return;
    const scale = this.devScale();
    this.dev.res = C2B.dev.colorize(this.dev.dist, scale);
    this.dev.scale = scale;
    this.applyCloudColors();
    this.renderDevStats();
  },

  /** Punktwolke normal oder nach Abweichung einfärben (3D und Grundriss). */
  applyCloudColors() {
    const on = !!(this.dev && this.dev.res && UI.$('c2bDevShow').checked && this.dev.display === this.display);
    const cols = on ? this.dev.res.colors : this.colors;
    if (cols) { this.plan.setColors(cols); if (this.v3d) this.v3d.setColors(cols); }
    UI.$('c2bDevLegend').hidden = !on;
  },

  invalidateDev() {
    if (!this.dev) return;
    this.dev = null;
    UI.$('c2bDevShow').checked = false; UI.$('c2bDevShow').disabled = true;
    UI.$('c2bDevLegend').hidden = true; UI.$('c2bDevStat').textContent = '';
    this.updateButtons();
  },

  renderDevStats() {
    const d = this.dev;
    if (!d || !d.res) { UI.$('c2bDevStat').textContent = ''; return; }
    const r = d.res, sc = d.scale, n = d.dist.length, k = sc.classes.length;
    const mm = x => +(x * 1000).toFixed(1);
    const labels = sc.classes.map((c, i) => (i ? `${mm(sc.classes[i - 1].max)}–${mm(c.max)} mm` : `≤ ${mm(c.max)} mm`))
      .concat([`> ${mm(sc.classes[k - 1].max)} mm`, `ausserhalb (> ${mm(sc.searchMax)} mm)`]);
    const colors = sc.classes.map(c => c.color).concat([sc.aboveColor, sc.outColor]);
    const pct = (c, base) => (base ? (100 * c / base).toFixed(1) + ' %' : '–');
    const rows = labels.map((l, i) => `<div class="c2b-dl-row"><span class="c2b-dl-sw" style="background:${colors[i]}"></span><span>${l}</span><span class="c2b-dl-pct">${pct(r.counts[i], i <= k ? r.nUsed : n)}</span></div>`).join('');
    const stale = d.stale ? '<div class="c2b-bad" style="margin-top:4px">Modell geändert – neu berechnen</div>' : '';
    const grow = sc.searchMax > d.pad + 1e-9 ? '<div class="c2b-bad" style="margin-top:4px">Suchgrenze vergrössert – neu berechnen</div>' : '';
    UI.$('c2bDevLegend').innerHTML = `<div style="font-weight:600;margin-bottom:3px">Abweichung zum Modell</div>${rows}` +
      `<div style="margin-top:4px">Mittel <b>${UI.fmtMM(r.mean)}</b> · 95 % <b>${UI.fmtMM(r.p95)}</b></div>${stale}${grow}`;
    UI.$('c2bDevStat').innerHTML = `${UI.fmtInt(n)} Punkte, ${UI.fmtInt(r.nUsed)} am Modell<br>Mittel ${UI.fmtMM(r.mean)} · Median ${UI.fmtMM(r.median)} · 95 % ${UI.fmtMM(r.p95)}<br>` +
      `${labels.slice(0, k + 1).map((l, i) => `<span style="color:${colors[i]}">■</span> ${pct(r.counts[i], r.nUsed)}`).join(' ')}` + stale + grow;
  },

  exportDevPly() {
    if (!this.dev || !this.dev.res) return;
    UI.download(this.baseName() + '_Abweichung.ply', C2B.dev.buildPly(this.dev.display, this.dev.res.colors, this.dev.dist), 'application/octet-stream');
  },

  // ───────────────────────────────────────────── Modell
  /** Modell (interpolierte Volumenkörper) läuft im 3D immer mit, sobald Bauteile oder Stützen bestehen. */
  modelDirty() {
    if (this.dev && !this.dev.stale) { this.dev.stale = true; this.renderDevStats(); }
    const any = this.project.sections.some(s => C2B.sec.allComponents(s).length) || this.project.columns.length;
    clearTimeout(this._tm);
    if (any || this.modelBuilt) this._tm = setTimeout(() => this.buildModel(true), 400);
    this.updateButtons();
  },

  buildModel(quiet) {
    const { solids, warnings } = C2B.model.buildSolids(this.project, { split: UI.$('c2bIfcSplit').value });
    this.solids = solids;
    this.modelBuilt = true;
    if (this.v3d) this.v3d.setModel(solids, this.project.columns, Math.max(1, Math.round(UI.num('c2bInterpN', 3))));
    this.refreshSections3d();
    this.buildWire();
    let vol = 0; solids.forEach(s => { vol += s.volume; });
    UI.$('c2bBuildStat').innerHTML = `${solids.length} Bauteile · ${this.project.columns.length} Stützen<br>Volumen ${vol.toFixed(2)} m³` + (warnings.length ? `<br><span class="c2b-bad">${warnings.length} Hinweis(e), siehe Log</span>` : '');
    if (!quiet) {
      UI.log(`3D-Modell: ${solids.length} Bauteile, Volumen ${vol.toFixed(2)} m³.`);
      warnings.forEach(w => UI.log(w, 'warn'));
      if (this.mode !== '3d') this.setMode('3d');
    }
    this.updateAll();
  },

  buildWire() {
    if (!this.v3d) return;
    if (!UI.$('c2bWfShow').checked) { this.v3d.setWire([]); return; }
    this.wire = C2B.model.buildWireframe(this.project, { intermediate: Math.round(UI.num('c2bWfInter', 0)), includeComponents: UI.$('c2bWfComp').checked });
    this.v3d.setWire(this.wire.lines);
  },

  // ───────────────────────────────────────────── Stützen
  onColumnClick(x, y) {
    const cloud = this.cloud;
    const z = parseFloat(UI.$('c2bSliceZ').value);
    const dz = Math.max(0.1, UI.num('c2bSliceDz', 0) || 0.25);
    let shape = UI.$('c2bColShape').value;
    const def = { b: UI.mm('c2bColB', 0.4), h: UI.mm('c2bColH', 0.4) };
    const col = { id: C2B.sec.uid(), name: 'Stütze ' + (this.project.columns.length + 1), x, y, zBottom: this.zRange[0], zTop: this.zRange[1],
      shape: shape === 'circle' ? 'circle' : 'rect', b: def.b, h: def.h, d: def.b, rot: 0 };
    if (UI.$('c2bColFit').checked && cloud && isFinite(z)) {
      try {
        const f = C2B.model.fitColumn(cloud, x, y, z, { radius: UI.mm('c2bColR', 0.6), dz, shape });
        if (f.shape === 'circle') Object.assign(col, { shape: 'circle', x: f.circle.x, y: f.circle.y, d: f.circle.d });
        else Object.assign(col, { shape: 'rect', x: f.rect.x, y: f.rect.y, b: f.rect.b, h: f.rect.h, rot: f.rect.rot });
        UI.log(`${col.name}: eingepasst als ${col.shape === 'circle' ? 'Kreis Ø ' + (col.d * 1000).toFixed(0) : 'Rechteck ' + (col.b * 1000).toFixed(0) + ' × ' + (col.h * 1000).toFixed(0)} mm (${f.n} Punkte).`);
      } catch (e) { UI.log(e.message + ' – Standardmass verwendet.', 'warn'); }
    }
    const r = col.shape === 'circle' ? col.d / 2 : Math.min(col.b, col.h) / 2;
    const hz = cloud ? C2B.model.columnHeightFromCloud(cloud, col.x, col.y, r * 0.9) : null;
    if (hz && hz.zTop - hz.zBottom > 0.3) { col.zBottom = hz.zBottom; col.zTop = hz.zTop; }
    this.pushUndo();
    this.project.columns.push(col);
    this.curColId = col.id;
    this.renderColumns(); this.plan.render(); this.modelDirty(); this.updateAll();
  },

  selectColumn(id) { this.curColId = id; this.renderColumns(); this.plan.render(); },

  renderColumns() {
    const tb = UI.$('c2bColList').querySelector('tbody');
    tb.innerHTML = this.project.columns.map(c => `<tr data-id="${c.id}" class="${c.id === this.curColId ? 'sel' : ''}"><td>${UI.esc(c.name)}</td>` +
      `<td>${c.shape === 'circle' ? 'Ø ' + (c.d * 1000).toFixed(0) : (c.b * 1000).toFixed(0) + '×' + (c.h * 1000).toFixed(0)}</td><td>${c.zBottom.toFixed(2)}</td><td>${c.zTop.toFixed(2)}</td>` +
      `<td><button class="c2b-x" data-del="${c.id}" title="Stütze löschen" style="border:none;background:none;cursor:pointer;color:var(--bs-text-muted)">×</button></td></tr>`).join('');
    const c = this.project.columns.find(x => x.id === this.curColId);
    const ed = UI.$('c2bColEdit');
    if (!c) { ed.innerHTML = ''; return; }
    const o = this.project.offset || [0, 0, 0];
    const row = (lbl, f, val, step, unit) => `<div class="param"><span class="c2b-grow">${lbl}</span><input type="number" class="c2b-wide" data-cf="${f}" step="${step}" value="${val}"><span class="c2b-unit">${unit}</span></div>`;
    ed.innerHTML = `<div class="c2b-sub">${UI.esc(c.name)}</div>` +
      `<div class="param"><span class="c2b-grow">Name</span><input type="text" data-cf="name" value="${UI.esc(c.name)}"></div>` +
      `<div class="param"><span class="c2b-grow">Form</span><select data-cf="shape"><option value="rect"${c.shape === 'rect' ? ' selected' : ''}>Rechteck</option><option value="circle"${c.shape === 'circle' ? ' selected' : ''}>Kreis</option></select></div>` +
      row('E', 'x', (c.x + o[0]).toFixed(3), 0.01, 'm') + row('N', 'y', (c.y + o[1]).toFixed(3), 0.01, 'm') +
      row('Unterkante', 'zBottom', c.zBottom.toFixed(3), 0.01, 'm') + row('Oberkante', 'zTop', c.zTop.toFixed(3), 0.01, 'm') +
      (c.shape === 'circle' ? row('Durchmesser', 'd', (c.d * 1000).toFixed(0), 10, 'mm')
        : row('Breite b', 'b', (c.b * 1000).toFixed(0), 10, 'mm') + row('Tiefe h', 'h', (c.h * 1000).toFixed(0), 10, 'mm') + row('Drehung', 'rot', c.rot.toFixed(2), 1, '°'));
  },

  // ───────────────────────────────────────────── Export / Projekt
  baseName() { return (this.project.source || 'cloud2bim').replace(/\.[^.]+$/, ''); },

  exportIfc() {
    const fileName = this.baseName() + '_Cloud2BIM.ifc';
    const { text, warnings, report } = C2B.exp.buildIfc(this.project, {
      projectName: UI.$('c2bIfcProject').value || 'Cloud2BIM', buildingName: UI.$('c2bIfcBuilding').value || 'Bauwerk',
      storeyName: UI.$('c2bIfcBuilding').value || 'Bauwerk', material: UI.$('c2bIfcMat').value, crsName: UI.$('c2bIfcCrs').value.trim(),
      split: UI.$('c2bIfcSplit').value, fileName, version: CONFIG.VERSION });
    warnings.forEach(w => UI.log(w, 'warn'));
    const cnt = Object.entries(report.count).map(([k, v]) => v + ' ' + k).join(', ');
    if (!cnt) return UI.alert('Nichts zu exportieren', 'Es sind noch keine Bauteile (Querschnitte mit Bauteilen in mindestens zwei Querschnitten) oder Stützen definiert.');
    UI.download(fileName, text, 'application/x-step');
    UI.log(`IFC: ${cnt}; Volumen ${report.volume.toFixed(2)} m³.`);
  },

  exportWire(kind) {
    const wf = C2B.model.buildWireframe(this.project, { intermediate: Math.round(UI.num('c2bWfInter', 0)), includeComponents: UI.$('c2bWfComp').checked });
    wf.warnings.forEach(w => UI.log(w, 'warn'));
    if (!wf.lines.length) return UI.alert('Kein Drahtmodell', 'Es sind noch keine Profile vorhanden.');
    const off = this.project.offset || [0, 0, 0];
    if (kind === 'dxf') UI.download(this.baseName() + '_Drahtmodell.dxf', C2B.exp.buildDxf(wf.lines, off), 'application/dxf');
    else UI.download(this.baseName() + '_Drahtmodell.obj', C2B.exp.buildObj(wf, off), 'text/plain');
  },

  saveProject() {
    const data = { format: 'Cloud2BIM-Projekt', version: CONFIG.VERSION, saved: new Date().toISOString(),
      project: { name: this.project.name, source: this.project.source, offset: this.project.offset, axis: this.project.axis,
        sections: this.project.sections.map(s => { const c = Object.assign({}, s); delete c._dev; return c; }), columns: this.project.columns,
        crops: this.project.crops, planes: this.project.planes },
      settings: (() => { const o = {}; UI.SETTING_IDS.forEach(id => { const el = UI.$(id); o[id] = el.type === 'checkbox' ? el.checked : el.value; }); return o; })() };
    UI.download(this.baseName() + '.c2b.json', JSON.stringify(data, null, 1), 'application/json');
  },

  async openProject(file) {
    try {
      const d = JSON.parse(await file.text());
      if (d.format !== 'Cloud2BIM-Projekt' || !d.project) throw new Error('Keine Cloud2BIM-Projektdatei.');
      if (this.project.sections.length && !(await UI.confirm('Projekt öffnen', 'Aktuelle Querschnitte, Bauteile und Stützen werden ersetzt.'))) return;
      this.pushUndo();
      const p = d.project;
      if (this.cloud && p.offset && this.project.offset && (p.offset[0] !== this.project.offset[0] || p.offset[1] !== this.project.offset[1])) {
        // Projekt in das lokale System der geladenen Punktwolke umrechnen
        const dx = p.offset[0] - this.project.offset[0], dy = p.offset[1] - this.project.offset[1];
        (p.sections || []).forEach(s => { s.origin = [s.origin[0] + dx, s.origin[1] + dy]; });
        (p.columns || []).forEach(c => { c.x += dx; c.y += dy; });
        p.axis = (p.axis || []).map(q => [q[0] + dx, q[1] + dy]);
        (p.crops || []).forEach(r => { r.poly = r.poly.map(q => [q[0] + dx, q[1] + dy]); });
        (p.planes || []).forEach(pl => { pl.p0 = [pl.p0[0] + dx, pl.p0[1] + dy, pl.p0[2]]; pl.c = pl.n[0] * pl.p0[0] + pl.n[1] * pl.p0[1] + pl.n[2] * pl.p0[2]; if (pl.poly) pl.poly = pl.poly.map(q => [q[0] + dx, q[1] + dy]); });
        p.offset = this.project.offset;
      }
      Object.assign(this.project, { name: p.name || 'Cloud2BIM', offset: p.offset || this.project.offset, axis: p.axis || [],
        sections: p.sections || [], columns: p.columns || [], crops: p.crops || [], planes: p.planes || [] });
      this.renderCrops(); this.renderPlanes();
      if (this.thinned) this.applyCrops(true);
      if (!this.project.source) this.project.source = p.source;
      this.project.sections.forEach(s => C2B.sec.profilesOf(s));
      if (d.settings) { UI.SETTING_IDS.forEach(id => { const el = UI.$(id); if (el && id in d.settings) { if (el.type === 'checkbox') el.checked = !!d.settings[id]; else el.value = d.settings[id]; } }); }
      if (this.project.axis.length >= 2) this.setAxisInputs(this.project.axis);
      this.secPtsCache.clear();
      this.selectSection((this.sortedSecs()[0] || {}).id || null);
      this.renderColumns();
      UI.log(`Projekt geöffnet: ${this.project.sections.length} Querschnitte, ${this.project.columns.length} Stützen` + (p.source ? ` (Punktwolke: ${p.source})` : '') + '.');
      if (!this.cloud && p.source) UI.log('Bitte die zugehörige Punktwolke «' + p.source + '» laden.', 'warn');
      this.modelBuilt = false;
      this.updateAll();
    } catch (e) { UI.alert('Projekt öffnen', e.message); }
  },

  // ───────────────────────────────────────────── Anzeige-Status
  setMode(m) {
    this.mode = m;
    UI.$('c2bTab3d').setAttribute('aria-pressed', m === '3d');
    UI.$('c2bTabPlan').setAttribute('aria-pressed', m === 'plan');
    UI.$('c2b3dHost').style.display = m === '3d' ? '' : 'none';
    UI.$('c2bPlan').hidden = m !== 'plan';
    UI.$('c2bPlanTools').hidden = m !== 'plan';
    UI.$('c2b3dTools').hidden = m !== '3d';
    if (m === 'plan') this.plan.render(); else if (this.v3d) this.v3d._resize();
    if (m !== 'plan' && this.plan.mode !== 'pan') this.onPlanModeEnd();
  },

  updateButtons() {
    const has = !!this.cloud, nS = this.project.sections.length, s = this.curSec();
    const prof = s && this.hasProfile(s);
    const anyComp = this.project.sections.some(x => C2B.sec.allComponents(x).length);
    const set = (id, en) => { UI.$(id).disabled = !en; };
    set('c2bThin', has); set('c2bThinReset', has && this.thinned !== this.raw);
    set('c2bCropKeep', has); set('c2bCropRemove', has); set('c2bPlDraw', has);
    const nPl = (this.project.planes || []).length;
    set('c2bPlApplyAll', nPl > 0 && nS > 0); set('c2bPlApply', nPl > 0 && prof);
    set('c2bMaskAll', !!s && (s.masks || []).length > 0 && nS > 1); set('c2bMaskClear', !!s && (s.masks || []).length > 0);
    set('c2bAxisDraw', has); set('c2bCutDraw', has); set('c2bGen', has || nS >= 0);
    set('c2bAutoAll', has && nS); set('c2bPropagate', has && prof && nS > 1);
    set('c2bSecDel', !!s); set('c2bSecDelAll', nS > 0);
    set('c2bSecPrev', nS > 1); set('c2bSecNext', nS > 1);
    const isT = C2B.trans.isTrans(s);
    set('c2bTrAdd', nS > 0 || (this.project.axis || []).length >= 2); set('c2bTrDraw', has);
    set('c2bAuto', (has && !!s) || isT); set('c2bFromPrev', has && !!s && nS > 1 && !isT); set('c2bRefit', has && prof); set('c2bClosed', prof && !isT); set('c2bClear', prof);
    set('c2bCompAutoAll', nS > 0); set('c2bCompCopy', s && C2B.sec.allComponents(s).length > 0 && nS > 1);
    set('c2bBuild', anyComp || this.project.columns.length > 0);
    set('c2bColPlace', has);
    set('c2bDevRun', has && this.project.sections.filter(x => this.hasProfile(x)).length >= 2);
    set('c2bDevPly', !!(this.dev && this.dev.res));
    set('c2bExpIfc', anyComp || this.project.columns.length > 0);
    const anyProf = this.project.sections.some(x => this.hasProfile(x));
    set('c2bExpDxf', anyProf); set('c2bExpObj', anyProf);
    set('c2bSave', nS > 0 || this.project.columns.length > 0);
    UI.$('c2bCompAuto').disabled = !prof;
  },

  updateAll() {
    const c = this.cloud, P = this.project;
    const nProf = P.sections.filter(s => this.hasProfile(s)).length;
    const nComp = P.sections.filter(s => C2B.sec.allComponents(s).length).length;
    UI.$('c2bInfo1').textContent = this.raw ? UI.fmtInt(this.raw.n) + ' Pkt' : '';
    UI.$('c2bInfo2').textContent = c && c !== this.raw ? UI.fmtInt(c.n) + ' Pkt' : '';
    UI.$('c2bInfo3').textContent = (P.planes || []).length ? String(P.planes.length) : '';
    UI.$('c2bInfo4').textContent = P.sections.length ? `${nProf}/${P.sections.length}` : '';
    UI.$('c2bInfo5').textContent = P.sections.length ? `${nComp}/${P.sections.length}` : '';
    UI.$('c2bInfo6').textContent = P.columns.length ? String(P.columns.length) : '';
    const done = [!!this.raw, c && c !== this.raw, (P.planes || []).length > 0, nProf > 0 && nProf === P.sections.length, nComp > 0, P.columns.length > 0, false];
    let active = done.findIndex(d => !d);
    if (active === 1 && this.raw) active = 3;
    if (active === 2) active = 3;
    for (let i = 1; i <= 7; i++) {
      const el = UI.$('c2bStep' + i);
      el.classList.toggle('c2b-done', !!done[i - 1]);
      el.classList.toggle('c2b-active', active === i - 1);
    }
    this.renderSecList(); this.renderColumns();
    this.updateButtons();
  },

  setSecTool(t) {
    ['Edit', 'Draw', 'Edges', 'Mask'].forEach(k => UI.$('c2bTool' + k).setAttribute('aria-pressed', t === k.toLowerCase()));
    this.ed.setTool(t);
  },

  // ───────────────────────────────────────────── Ereignisse
  _bindSidebar() {
    const $ = UI.$;
    // Drop-Zone (Sidebar + Hauptbereich)
    $('c2bFile').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; if (f) this.loadFile(f); });
    const dz = $('c2bDrop');
    ['dragenter', 'dragover'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add('drag-over'); }));
    ['dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, () => dz.classList.remove('drag-over')));
    dz.addEventListener('drop', e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) this.loadFile(f); });
    const main = $('c2bLeftWrap');
    main.addEventListener('dragover', e => e.preventDefault());
    main.addEventListener('drop', e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) this.loadFile(f); });
    $('c2bAbort').addEventListener('click', () => { if (this.abort) this.abort.abort(); });

    $('c2bThin').addEventListener('click', () => this.thin());
    $('c2bCropKeep').addEventListener('click', () => this.startCrop('keep'));
    $('c2bCropRemove').addEventListener('click', () => this.startCrop('remove'));
    $('c2bCropList').addEventListener('click', e => {
      const d = e.target.closest('[data-del]'); if (!d) return;
      this.pushUndo(); this.project.crops = this.project.crops.filter(r => r.id !== d.dataset.del);
      this.renderCrops(); this.applyCrops(); this.plan.render();
    });
    $('c2bPlDraw').addEventListener('click', () => this.startPlane());
    $('c2bPlApplyAll').addEventListener('click', () => this.applyPlanesAll());
    $('c2bPlList').addEventListener('click', e => {
      const d = e.target.closest('[data-del]'); if (!d) return;
      this.pushUndo(); this.project.planes = this.project.planes.filter(pl => pl.id !== d.dataset.del);
      UI.log('Ebene gelöscht (bereits angepasste Profile bleiben, «Rückgängig» stellt sie wieder her).');
      this.renderPlanes(); this.plan.render(); this.reloadCurrentSectionPoints(); this.updateAll();
    });
    $('c2bPlList').addEventListener('change', e => {
      const id = e.target.dataset.pl, pl = (this.project.planes || []).find(x => x.id === id);
      if (pl && e.target.value.trim()) { pl.name = e.target.value.trim(); this.plan.render(); this.reloadCurrentSectionPoints(); }
    });
    $('c2bThinReset').addEventListener('click', () => this.thinReset());

    $('c2bAxisDraw').addEventListener('click', () => {
      if (this.plan.mode === 'axis') return this.onPlanModeEnd();
      this.setMode('plan');
      this.plan.setMode('axis', 'Achse: Startpunkt, (Zwischenpunkte,) Endpunkt anklicken · Doppelklick/Enter beendet · Esc bricht ab');
      $('c2bAxisDraw').textContent = 'Zeichnen beenden';
    });
    $('c2bTrAdd').addEventListener('click', () => this.addTransitionAtStation());
    $('c2bTrDraw').addEventListener('click', () => {
      if (this.plan.mode === 'cut') return this.onPlanModeEnd();
      this.cutKind = 'transition';
      this.setMode('plan');
      this.plan.setMode('cut', 'Übergang: Schnittlinie mit zwei Punkten anklicken (links → rechts in Blickrichtung) · Esc bricht ab');
    });
    $('c2bCutDraw').addEventListener('click', () => {
      this.cutKind = null;
      if (this.plan.mode === 'cut') return this.onPlanModeEnd();
      this.setMode('plan');
      this.plan.setMode('cut', 'Schnittlinie: zwei Punkte anklicken (links → rechts in Blickrichtung) · Esc bricht ab');
      $('c2bCutDraw').textContent = 'Abbrechen';
    });
    const segMode = count => { $('c2bModeSpacing').setAttribute('aria-pressed', !count); $('c2bModeCount').setAttribute('aria-pressed', count); $('c2bRowSpacing').hidden = count; $('c2bRowCount').hidden = !count; };
    $('c2bModeSpacing').addEventListener('click', () => segMode(false));
    $('c2bModeCount').addEventListener('click', () => segMode(true));
    ['c2bAxS_E', 'c2bAxS_N', 'c2bAxE_E', 'c2bAxE_N'].forEach(id => $(id).addEventListener('change', () => {
      const a = this.axisFromInputs(); if (a) { this.project.axis = a; this.setAxisInputs(a); this.plan.render(); }
    }));
    $('c2bGen').addEventListener('click', () => this.generate());
    $('c2bAutoAll').addEventListener('click', () => this.autoAll());
    $('c2bPropagate').addEventListener('click', () => this.propagate());
    $('c2bSecDel').addEventListener('click', () => this.deleteSection(false));
    $('c2bSecDelAll').addEventListener('click', () => this.deleteSection(true));
    $('c2bSecList').addEventListener('click', e => { const tr = e.target.closest('tr[data-id]'); if (tr) this.selectSection(tr.dataset.id, true); });
    $('c2bTol').addEventListener('change', () => { this.ed.update(); });
    $('c2bSecCell').addEventListener('change', () => { this.secPtsCache.clear(); this.reloadCurrentSectionPoints(); });

    $('c2bCompAutoAll').addEventListener('click', () => this.suggestAll());
    $('c2bCompCopy').addEventListener('click', () => this.copyComponents());
    $('c2bBuild').addEventListener('click', () => this.buildModel(false));
    $('c2bDevRun').addEventListener('click', () => this.runDeviation());
    $('c2bDevShow').addEventListener('change', () => this.applyCloudColors());
    $('c2bDevPly').addEventListener('click', () => this.exportDevPly());
    $('c2bDevScaleEd').addEventListener('change', e => {
      const k = +e.target.dataset.k, f = e.target.dataset.f; if (!f) return;
      const rows = this.devRows();
      if (f === 'mm') { const v = parseFloat(e.target.value); if (!(v > 0)) { this.renderDevScale(); return; } rows[k].mm = v; }
      else rows[k].color = e.target.value;
      this.setDevScaleRows(rows);
    });
    $('c2bDevScaleEd').addEventListener('click', e => {
      const d = e.target.closest('[data-del]'); if (!d) return;
      const rows = this.devRows(); if (rows.length <= 1) return;
      rows.splice(+d.dataset.del, 1); this.setDevScaleRows(rows);
    });
    $('c2bDevAdd').addEventListener('click', () => {
      const rows = this.devRows(), last = rows[rows.length - 1];
      rows.push({ mm: last ? +(last.mm * 2).toFixed(1) : 2, color: '#E5C100' }); this.setDevScaleRows(rows);
    });
    $('c2bDevDefault').addEventListener('click', () => {
      const D = C2B.dev.DEFAULT_SCALE;
      $('c2bDevAbove').value = D.aboveColor; $('c2bDevOut').value = D.outColor; $('c2bDevMax').value = Math.round(D.searchMax * 1000);
      this.setDevScaleRows(D.classes.map(c => ({ mm: c.max * 1000, color: c.color })));
    });
    ['c2bDevAbove', 'c2bDevMax', 'c2bDevOut'].forEach(id => $(id).addEventListener('change', () => this.recolorDev()));

    $('c2bColPlace').addEventListener('click', () => {
      if (this.plan.mode === 'column') return this.onPlanModeEnd();
      this.setMode('plan');
      if (!(UI.num('c2bSliceDz', 0) > 0)) UI.$('c2bSliceDz').value = '0.25';
      this.plan.sliceZ = parseFloat(UI.$('c2bSliceZ').value); this.plan.sliceDz = UI.num('c2bSliceDz', 0);
      this.plan.setMode('column', 'Stütze anklicken (Horizontalschnitt oben einstellen) · Esc beendet');
      $('c2bColPlace').textContent = 'Platzieren beenden';
    });
    $('c2bColList').addEventListener('click', e => {
      const del = e.target.closest('[data-del]');
      if (del) { this.pushUndo(); this.project.columns = this.project.columns.filter(c => c.id !== del.dataset.del); this.renderColumns(); this.plan.render(); this.modelDirty(); this.updateAll(); return; }
      const tr = e.target.closest('tr[data-id]'); if (tr) this.selectColumn(tr.dataset.id);
    });
    $('c2bColEdit').addEventListener('change', e => {
      const f = e.target.dataset.cf, c = this.project.columns.find(x => x.id === this.curColId);
      if (!f || !c) return;
      this.pushUndo();
      const o = this.project.offset || [0, 0, 0], v = parseFloat(e.target.value);
      if (f === 'name' || f === 'shape') c[f] = e.target.value;
      else if (f === 'x') c.x = v - o[0]; else if (f === 'y') c.y = v - o[1];
      else if (['b', 'h', 'd'].includes(f)) c[f] = v / 1000; else c[f] = v;
      if (f === 'shape' && c.shape === 'circle' && !c.d) c.d = c.b;
      this.renderColumns(); this.plan.render(); this.modelDirty(); this.updateAll();
    });

    $('c2bExpIfc').addEventListener('click', () => this.exportIfc());
    $('c2bExpDxf').addEventListener('click', () => this.exportWire('dxf'));
    $('c2bExpObj').addEventListener('click', () => this.exportWire('obj'));
    UI.$('c2bInterpN').addEventListener('change', () => { if (this.modelBuilt) this.buildModel(true); });
    ['c2bWfInter', 'c2bWfComp', 'c2bWfShow'].forEach(id => $(id).addEventListener('change', () => { if (this.modelBuilt) this.buildWire(); }));
    $('c2bIfcSplit').addEventListener('change', () => this.modelDirty());
    $('c2bSave').addEventListener('click', () => this.saveProject());
    $('c2bOpen').addEventListener('click', () => $('c2bOpenFile').click());
    $('c2bOpenFile').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; if (f) this.openProject(f); });

    $('c2bDispMax').addEventListener('change', () => this.refreshDisplay(false));
    $('c2bColorMode').addEventListener('change', () => this.refreshDisplay(false));
    $('c2bPtSize').addEventListener('change', () => this.v3d && this.v3d.setPointSize(UI.num('c2bPtSize', 2)));
    ['c2bBand', 'c2bTol'].forEach(id => $(id).addEventListener('change', () => this.ed.update()));
    // Einstellungen merken
    UI.SETTING_IDS.forEach(id => { const el = $(id); if (el) el.addEventListener('change', UI.saveSettings); });
  },

  _bindMain() {
    const $ = UI.$;
    $('c2bTab3d').addEventListener('click', () => this.setMode('3d'));
    $('c2bTabPlan').addEventListener('click', () => this.setMode('plan'));
    $('c2bFit').addEventListener('click', () => { if (this.mode === '3d') this.v3d && this.v3d.fit(); else this.plan.fit(); });
    [['c2bShowCloud', 'cloud'], ['c2bShowSecs', 'sections'], ['c2bShowAreas', 'areas'], ['c2bShowModel', 'model'], ['c2bShowInterp', 'interp'], ['c2bShowPlanes', 'planes']].forEach(([id, g]) => $(id).addEventListener('click', () => {
      const on = $(id).getAttribute('aria-pressed') !== 'true';
      $(id).setAttribute('aria-pressed', on);
      if (!this.v3d) return;
      this.v3d.setVisible(g, on);
      if (g === 'model') this.v3d.setVisible('wire', on);
      if (g === 'areas' && on) this.refreshSections3d();
    }));
    const slice = () => { this.plan.sliceZ = parseFloat($('c2bSliceZ').value); this.plan.sliceDz = UI.num('c2bSliceDz', 0); this.plan.render(); };
    $('c2bSliceZ').addEventListener('input', slice); $('c2bSliceDz').addEventListener('input', slice);

    $('c2bSecPrev').addEventListener('click', () => this.stepSection(-1));
    $('c2bSecNext').addEventListener('click', () => this.stepSection(1));
    $('c2bToolEdit').addEventListener('click', () => this.setSecTool('edit'));
    $('c2bToolDraw').addEventListener('click', () => this.setSecTool('draw'));
    $('c2bToolEdges').addEventListener('click', () => this.setSecTool('edges'));
    $('c2bToolMask').addEventListener('click', () => this.setSecTool('mask'));
    $('c2bMaskAll').addEventListener('click', () => this.masksToAll());
    $('c2bMaskClear').addEventListener('click', () => this.masksClear());
    $('c2bPlApply').addEventListener('click', () => this.applyPlanesCurrent());
    $('c2bAuto').addEventListener('click', () => (C2B.trans.isTrans(this.curSec()) ? this.suggestTransitionArea() : this.autoCurrent(false)));
    $('c2bTrSuggest').addEventListener('click', () => this.suggestTransitionArea());
    const drawRole = role => { this.ed.drawRole = role; this.setSecTool('draw'); UI.$('c2bSecHint').textContent = (role === 'hole' ? 'Aussparung' : 'Fläche') + ' zeichnen: Ecken anklicken (Shift = an Ecken der Nachbarn fangen) · Klick auf erste Ecke oder Enter schliesst · Esc bricht ab'; };
    $('c2bTrDrawOuter').addEventListener('click', () => drawRole('outer'));
    $('c2bTrDrawHole').addEventListener('click', () => drawRole('hole'));
    $('c2bTrRole').addEventListener('change', e => { const P = this.curProf(); if (!P) return; this.pushUndo(); P.role = e.target.value; P.closed = true; this.ed.update(); this.onActiveProfile(); this.onProfileChanged(this.curSec()); });
    $('c2bTrName').addEventListener('change', e => { const T = this.curSec(); if (!T || !e.target.value.trim()) return; this.pushUndo(); T.name = e.target.value.trim(); UI.$('c2bSecTitle').textContent = T.name + ' · Station ' + T.station.toFixed(2); this.renderSecList(); this.modelDirty(); this.plan.render(); });
    $('c2bTrDepthSec').addEventListener('change', e => { const T = this.curSec(), v = parseFloat(e.target.value); if (!T || !(v > 0)) return; this.pushUndo(); T.trans.depth = v / 1000; this.onProfileChanged(T); this.onSectionStats(null); this.plan.render(); });
    $('c2bTrAlignSec').addEventListener('change', e => { const T = this.curSec(); if (!T) return; this.pushUndo(); T.trans.align = e.target.value; this.onProfileChanged(T); this.onSectionStats(null); this.plan.render(); });
    $('c2bFromPrev').addEventListener('click', () => this.fromPrev());
    $('c2bRefit').addEventListener('click', () => this.refit());
    $('c2bSecFit').addEventListener('click', () => this.ed.fit());
    $('c2bClosed').addEventListener('change', e => {
      const s = this.curSec(), P = this.curProf(); if (!s || !P) return;
      this.pushUndo(); P.closed = e.target.checked && P.vertices.length >= 3;
      C2B.arc.sync(P);
      const n = P.vertices.length;
      P.components = P.components.filter(c => C2B.sec.componentEdges(c, n, P.closed).length > 0 && (P.closed || c.end > c.start));
      this.ed.update(); this.onActiveProfile(); this.onProfileChanged(s);
    });
    $('c2bClear').addEventListener('click', () => {
      const s = this.curSec(); if (!s || !this.curProf()) return;
      this.pushUndo();
      this.profs(s).splice(this.ed.pi, 1);
      this.ed.pi = Math.max(0, this.ed.pi - 1);
      this.ed.update(); this.onActiveProfile(); this.onProfileChanged(s);
    });
    $('c2bProfSel').addEventListener('change', e => this.ed.setActive(+e.target.value));
    $('c2bArc').addEventListener('click', () => { const msg = this.ed.makeArc(); if (msg) UI.alert('Bogen', msg); else UI.log('Bogen erzeugt und in die Punkte eingepasst.'); });
    $('c2bLine').addEventListener('click', () => { if (!this.ed.makeStraight()) UI.log('Keine Bögen zwischen den gewählten Ecken.', 'warn'); });
    $('c2bDelSel').addEventListener('click', () => this.ed.deleteVertices([...this.ed.sel]));
    $('c2bSecDepth').addEventListener('change', e => {
      const s = this.curSec(), v = parseFloat(e.target.value);
      if (!s) return;
      if (!(v > 0)) { e.target.value = Math.round((s.depth || 0.05) * 1000); return; }
      this.pushUndo();
      s.depth = v / 1000;
      this.reloadCurrentSectionPoints(); this.devOf(s); this.renderSecList(); this.refreshSections3d();
      UI.log(`${s.name}: Schnitttiefe ${v} mm (${UI.fmtInt(this.secPts(s).length)} Punkte).`);
    });
    $('c2bSecDepthAll').addEventListener('click', () => {
      const s = this.curSec(); if (!s) return;
      this.pushUndo();
      this.project.sections.forEach(x => { x.depth = s.depth; this.devOf(x); });
      UI.log(`Schnitttiefe ${Math.round(s.depth * 1000)} mm für alle ${this.project.sections.length} Querschnitte übernommen.`);
      this.renderSecList(); this.refreshSections3d();
    });
    $('c2bMaxGap').addEventListener('change', e => {
      const s = this.curSec(); if (!s) return;
      const v = parseFloat(e.target.value);
      if (!(v > 0)) { e.target.value = Math.round(this.maxGap(s) * 100); return; }
      s.maxGap = v / 100;
      UI.log(`${s.name}: max. Punktabstand ${v} cm – «Vorschlag» neu ausführen, um die Profile neu zu bilden.`);
    });
    $('c2bMaxGapAll').addEventListener('click', () => {
      const s = this.curSec(); if (!s) return;
      this.project.sections.forEach(x => { x.maxGap = this.maxGap(s); });
      UI.log(`Max. Punktabstand ${Math.round(this.maxGap(s) * 100)} cm für alle ${this.project.sections.length} Querschnitte übernommen.`);
    });
    $('c2bCompAuto').addEventListener('click', () => this.suggestCurrent());
    $('c2bCompAdd').addEventListener('click', () => this.addComponentFromEdges());
    const comp = $('c2bComp');
    comp.addEventListener('change', e => {
      const tr = e.target.closest('tr[data-i]'), f = e.target.dataset.f, s = this.curSec(), P = this.curProf();
      if (!tr || !f || !s || !P) return;
      const c = P.components[+tr.dataset.i];
      this.pushUndo();
      if (f === 'name') {
        const nm = e.target.value.trim() || c.name;
        c.name = nm;
      } else if (f === 'type') c.type = e.target.value;
      else if (f === 'thickness') c.thickness = e.target.value === '' ? null : Math.max(0.001, parseFloat(e.target.value) / 1000);
      else if (f === 'flip') c.flip = e.target.checked;
      this.renderComp(); this.ed.render(); this.modelDirty(); this.renderSecList();
    });
    comp.addEventListener('click', e => {
      const tr = e.target.closest('tr[data-i]'), s = this.curSec(), P = this.curProf();
      if (!tr || !s || !P) return;
      const c = P.components[+tr.dataset.i];
      if (e.target.dataset.f === 'del') {
        this.pushUndo(); P.components.splice(+tr.dataset.i, 1);
        this.renderComp(); this.ed.render(); this.modelDirty(); this.updateAll(); return;
      }
      // Kanten des Bauteils hervorheben
      const ce = C2B.sec.componentEdges(c, P.vertices.length, P.closed);
      if (ce.length) { this.ed.edgeSel = { a: ce[0], b: ce[ce.length - 1] }; this.ed.render(); }
      comp.querySelectorAll('tr').forEach(r => r.classList.toggle('sel', r === tr));
    });
    // Teiler
    const split = $('c2bSplit'), mainEl = $('c2bMain');
    split.addEventListener('pointerdown', e => {
      split.setPointerCapture(e.pointerId); split.classList.add('drag');
      const r = mainEl.getBoundingClientRect();
      const mv = ev => { const f = Math.max(0.15, Math.min(0.85, (ev.clientX - r.left) / r.width)); mainEl.style.setProperty('--c2b-left', f + 'fr'); mainEl.style.setProperty('--c2b-right', (1 - f) + 'fr'); };
      const up = () => { split.classList.remove('drag'); split.removeEventListener('pointermove', mv); split.removeEventListener('pointerup', up); };
      split.addEventListener('pointermove', mv); split.addEventListener('pointerup', up);
    });
    split.addEventListener('dblclick', () => { mainEl.style.removeProperty('--c2b-left'); mainEl.style.removeProperty('--c2b-right'); });
  },

  _bindKeys() {
    window.addEventListener('keydown', e => {
      if (e.target.closest && e.target.closest('input,select,textarea')) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); this.doUndo(); }
      else if (mod && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) { e.preventDefault(); this.doRedo(); }
      else if (e.key === 'PageDown') { e.preventDefault(); this.stepSection(1); }
      else if (e.key === 'PageUp') { e.preventDefault(); this.stepSection(-1); }
    });
  },
};
