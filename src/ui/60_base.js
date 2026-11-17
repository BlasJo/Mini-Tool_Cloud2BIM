/* ═══ Cloud2BIM UI: Grundfunktionen (DOM, Log, Fortschritt, Download, Einstellungen) ═══ */
const UI = {};

UI.$ = id => document.getElementById(id);
UI.esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
UI.fmtInt = n => Math.round(n).toLocaleString('de-CH');
UI.fmtM = (x, d = 3) => (x === null || x === undefined || !isFinite(x)) ? '–' : x.toFixed(d);
UI.fmtMM = x => (x === null || x === undefined || !isFinite(x)) ? '–' : (x * 1000).toFixed(1) + ' mm';

UI.TYPE_COLOR = { floor: '#7A8696', wall: '#C29A5B', ceiling: '#4F86B8', column: '#D70036' };
UI.TYPE_LABEL = { floor: 'Bodenplatte', wall: 'Wand', ceiling: 'Decke' };

UI.MAX_LOG_LINES = 400;
UI.log = (msg, level) => {
  const el = UI.$('log');
  const t = new Date();
  const ts = [t.getHours(), t.getMinutes(), t.getSeconds()].map(v => String(v).padStart(2, '0')).join(':');
  const line = ts + ' ' + (level === 'err' ? '✗ ' : level === 'warn' ? '! ' : '') + msg;
  if (el) {
    const lines = el.textContent ? el.textContent.split('\n') : [];
    lines.push(line);
    if (lines.length > UI.MAX_LOG_LINES) lines.splice(0, lines.length - UI.MAX_LOG_LINES);
    el.textContent = lines.join('\n');
    el.scrollTop = el.scrollHeight;
  }
  if (level === 'err') console.error('[c2b]', msg); else console.log('[c2b]', msg);
};

UI.progress = (frac, text) => {
  const w = UI.$('progress-wrap'), b = UI.$('progress-bar'), t = UI.$('progress-text');
  if (frac === null || frac === undefined) { w.style.display = 'none'; t.textContent = text || ''; return; }
  w.style.display = 'block';
  b.style.width = Math.max(0, Math.min(100, frac * 100)).toFixed(1) + '%';
  t.textContent = text || '';
};

UI.tick = () => new Promise(r => setTimeout(r, 0));

UI.download = (name, content, mime = 'application/octet-stream') => {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  UI.log('Datei erzeugt: ' + name + ' (' + UI.fmtInt(blob.size / 1024) + ' kB)');
};

UI.alert = (title, text) => (window.BSDialog ? window.BSDialog.show({ title, message: text, buttons: [{ label: 'OK', value: true, variant: 'red' }] }) : Promise.resolve(alert(title + '\n\n' + text)));
UI.confirm = (title, text, danger) => (window.BSDialog ? window.BSDialog.confirm({ title, message: text, danger, confirmLabel: 'OK' }) : Promise.resolve(confirm(title + '\n\n' + text)));

/** Einstellungen (nur UI-Vorgaben, Praefix bs-, S5-tolerant). */
UI.SETTINGS_KEY = 'bs-c2b-settings';
UI.SETTING_IDS = ['c2bPreVoxel', 'c2bPreMax', 'c2bVoxel', 'c2bIsoOn', 'c2bIsoR', 'c2bIsoN', 'c2bSpacing', 'c2bCount', 'c2bDepth',
  'c2bAutoOnGen', 'c2bTol', 'c2bSecCell', 'c2bTFloor', 'c2bTWall', 'c2bTCeil', 'c2bWallAng', 'c2bColShape', 'c2bColR', 'c2bColFit',
  'c2bColB', 'c2bColH', 'c2bIfcMat', 'c2bIfcCrs', 'c2bIfcSplit', 'c2bWfInter', 'c2bWfComp', 'c2bWfShow', 'c2bDispMax', 'c2bPtSize',
  'c2bColorMode', 'c2bInterpN', 'c2bPlKind', 'c2bPlTol', 'c2bPlAuto', 'c2bPlSnap', 'c2bDevScale', 'c2bDevAbove', 'c2bDevMax', 'c2bDevOut', 'c2bFitSearch', 'c2bBand', 'c2bCompCopyInterp'];
UI.loadSettings = () => {
  let s = null;
  try { s = JSON.parse(localStorage.getItem(UI.SETTINGS_KEY) || 'null'); } catch (e) { s = null; }
  if (!s || typeof s !== 'object') return;
  UI.SETTING_IDS.forEach(id => {
    const el = UI.$(id);
    if (!el || !(id in s)) return;
    if (el.type === 'checkbox') el.checked = !!s[id]; else el.value = String(s[id]);
  });
};
UI.saveSettings = () => {
  const s = {};
  UI.SETTING_IDS.forEach(id => { const el = UI.$(id); if (el) s[id] = el.type === 'checkbox' ? el.checked : el.value; });
  try { localStorage.setItem(UI.SETTINGS_KEY, JSON.stringify(s)); } catch (e) { /* Speicher gesperrt – ohne Persistenz */ }
};
UI.num = (id, def = 0) => { const v = parseFloat(UI.$(id).value); return isFinite(v) ? v : def; };
UI.mm = (id, def = 0) => UI.num(id, def * 1000) / 1000;

/** Höhen-Farbskala (blau → grün → gelb → rot). */
UI.ramp = t => {
  t = Math.max(0, Math.min(1, t));
  const stops = [[0.18, 0.33, 0.70], [0.16, 0.65, 0.60], [0.55, 0.78, 0.30], [0.98, 0.80, 0.25], [0.86, 0.25, 0.20]];
  const x = t * (stops.length - 1), i = Math.min(stops.length - 2, Math.floor(x)), f = x - i;
  return stops[i].map((c, k) => c + (stops[i + 1][k] - c) * f);
};

/** Farben (0..255) für die Anzeige-Punktwolke. */
UI.cloudColors = (cloud, mode) => {
  const n = cloud.n, out = new Uint8Array(n * 3);
  if (mode === 'rgb' && cloud.rgb) { out.set(cloud.rgb); return out; }
  let zmin = Infinity, zmax = -Infinity;
  for (let i = 0; i < n; i++) { const z = cloud.xyz[i * 3 + 2]; if (z < zmin) zmin = z; if (z > zmax) zmax = z; }
  const span = zmax - zmin || 1;
  const lut = [];
  for (let k = 0; k < 256; k++) lut.push(UI.ramp(k / 255).map(c => Math.round(c * 255)));
  for (let i = 0; i < n; i++) {
    const c = lut[Math.round((cloud.xyz[i * 3 + 2] - zmin) / span * 255)];
    out[i * 3] = c[0]; out[i * 3 + 1] = c[1]; out[i * 3 + 2] = c[2];
  }
  return out;
};

/** Rückgängig-Stapel (Projektzustand ohne Punktwolke). */
UI.Undo = class {
  constructor(max = 60) { this.stack = []; this.redoStack = []; this.max = max; }
  push(state) { this.stack.push(JSON.stringify(state)); if (this.stack.length > this.max) this.stack.shift(); this.redoStack = []; }
  undo(cur) { if (!this.stack.length) return null; this.redoStack.push(JSON.stringify(cur)); return JSON.parse(this.stack.pop()); }
  redo(cur) { if (!this.redoStack.length) return null; this.stack.push(JSON.stringify(cur)); return JSON.parse(this.redoStack.pop()); }
};
