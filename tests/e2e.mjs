// End-to-End-Test im Browser: node tests/e2e.mjs  (Screenshots in tests/out/)
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import path from 'node:path';
import fs from 'node:fs';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const html = fs.readdirSync(root).filter(f => /^Cloud2BIM_V.*\.html$/.test(f)).sort((a, b) => a.localeCompare(b, 'en', { numeric: true })).pop();
console.log('Teste', html);
const out = path.join(root, 'tests/out');
const errors = [];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 950 }, deviceScaleFactor: 1, acceptDownloads: true });
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
await page.goto('file://' + path.join(root, html));
await page.waitForFunction(() => window.BSTool && window.BSTool.APP);
const log = () => page.$eval('#log', e => e.textContent);
const step = async (name, fn) => { const t = Date.now(); try { await fn(); } catch (e) { console.log('✗', name, e.message.split('\n')[0]); console.log(await log()); await page.screenshot({ path: path.join(out, 'e2e_fehler.png') }); await browser.close(); process.exit(1); } console.log('✓', name, (Date.now() - t) + ' ms'); };

await step('LAZ laden', async () => {
  await page.setInputFiles('#c2bFile', path.join(root, 'beispiel/Demo_Durchlass.laz'));
  await page.waitForFunction(() => window.BSTool.APP.raw, null, { timeout: 120000 });
});
await step('Ausdünnen', async () => {
  await page.fill('#c2bVoxel', '15');
  await page.click('#c2bThin');
  await page.waitForFunction(() => window.BSTool.APP.cloud !== window.BSTool.APP.raw);
});
await page.screenshot({ path: path.join(out, 'e2e_1_geladen.png') });
await step('Querschnitte entlang Achse (Abstand 5 m)', async () => {
  await page.click('#c2bStep4 summary');
  await page.fill('#c2bAxS_E', '2600512.3'); await page.fill('#c2bAxS_N', '1199830.7');
  await page.fill('#c2bAxE_E', '2600538.788'); await page.fill('#c2bAxE_N', '1199844.784');
  await page.fill('#c2bSpacing', '5');
  await page.click('#c2bGen');
  await page.waitForFunction(() => window.BSTool.APP.project.sections.length === 7 && window.BSTool.APP.project.sections.every(s => s.profiles && s.profiles.length > 0), null, { timeout: 60000 });
});
const secInfo = await page.evaluate(() => window.BSTool.APP.sortedSecs().map(s => [s.name, s.profiles.map(p => p.vertices.length + (p.closed ? 'g' : 'o')).join('+'), s._dev && +s._dev.toFixed(3)]));
console.log('  Querschnitte:', JSON.stringify(secInfo));
await step('Bauteile vorschlagen + übertragen', async () => {
  await page.click('#c2bCompAuto');
  await page.click('#c2bStep5 summary');
  await page.click('#c2bCompCopy');
});
await step('3D-Modell', async () => { await page.click('#c2bBuild'); });
const build = await page.$eval('#c2bBuildStat', e => e.innerText);
console.log('  ', build.replace(/\n/g, ' | '));
await page.screenshot({ path: path.join(out, 'e2e_2_modell.png') });
await page.click('#c2bShowCloud'); await page.click('#c2bFit'); await page.waitForTimeout(200);
await page.screenshot({ path: path.join(out, 'e2e_2b_modell_ohne_punkte.png'), clip: { x: 300, y: 68, width: 650, height: 850 } });
await page.click('#c2bShowCloud');
await step('Stütze im Grundriss einpassen', async () => {
  await page.click('#c2bStep6 summary');
  await page.click('#c2bColPlace');
  // Stützenmitte bei Station 15 auf der Achse
  const pt = await page.evaluate(() => {
    const A = window.BSTool.APP, o = A.project.offset;
    const E = 2600512.3 + 15 * Math.cos(28 * Math.PI / 180) - o[0], N = 1199830.7 + 15 * Math.sin(28 * Math.PI / 180) - o[1];
    A.plan.cx = E; A.plan.cy = N; A.plan.scale = 60; A.plan.render();
    const r = document.getElementById('c2bPlan').getBoundingClientRect();
    const [x, y] = A.plan.toScreen(E + 0.05, N - 0.03);
    return { x: r.left + x, y: r.top + y };
  });
  await page.fill('#c2bSliceZ', '514'); await page.fill('#c2bSliceDz', '0.3');
  await page.mouse.click(pt.x, pt.y);
  await page.waitForFunction(() => window.BSTool.APP.project.columns.length === 1);
});
const col = await page.evaluate(() => window.BSTool.APP.project.columns[0]);
console.log('   Stütze:', JSON.stringify({ shape: col.shape, b: col.b?.toFixed(3), h: col.h?.toFixed(3), rot: col.rot?.toFixed(1), zB: col.zBottom.toFixed(2), zT: col.zTop.toFixed(2) }));
await page.screenshot({ path: path.join(out, 'e2e_3_grundriss.png') });
await page.keyboard.press('Escape');
await step('Querschnitt-Editor: Ecke einfügen + Undo', async () => {
  const n0 = await page.evaluate(() => window.BSTool.APP.curProf().vertices.length);
  const p = await page.evaluate(() => {
    const A = window.BSTool.APP, V = A.curProf().vertices;
    const a = V[0], b = V[1]; const [x, y] = A.ed.toS((a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
    const r = document.getElementById('c2bSec').getBoundingClientRect(); return { x: r.left + x, y: r.top + y };
  });
  await page.mouse.dblclick(p.x, p.y);
  const n1 = await page.evaluate(() => window.BSTool.APP.curProf().vertices.length);
  if (n1 !== n0 + 1) throw new Error('Ecke nicht eingefügt ' + n0 + ' -> ' + n1);
  await page.keyboard.press('Control+z');
  const n2 = await page.evaluate(() => window.BSTool.APP.curProf().vertices.length);
  if (n2 !== n0) throw new Error('Undo fehlgeschlagen');
});
// ── Ausschneiden, Ebene, Maske
const clickPlan = async pts => {
  for (const [E, N] of pts) {
    const p = await page.evaluate(([E, N]) => { const A = window.BSTool.APP, o = A.project.offset;
      const [x, y] = A.plan.toScreen(E - o[0], N - o[1]); const r = document.getElementById('c2bPlan').getBoundingClientRect(); return { x: r.left + x, y: r.top + y }; }, [E, N]);
    await page.mouse.click(p.x, p.y);
  }
  await page.keyboard.press('Enter');
};
// Punkt auf der Achse: Station s, Abstand q nach links (+) / rechts (-)
const ax = (st, q) => { const a = 28 * Math.PI / 180; return [2600512.3 + st * Math.cos(a) - q * Math.sin(a), 1199830.7 + st * Math.sin(a) + q * Math.cos(a)]; };
await step('Ausschneiden: Bereich um die Stütze entfernen', async () => {
  await page.evaluate(() => { document.getElementById('c2bStep2').open = true; });
  await page.evaluate(() => { const A = window.BSTool.APP; A.setMode('plan'); A.plan.fit(); });
  const n0 = await page.evaluate(() => window.BSTool.APP.cloud.n);
  await page.click('#c2bCropRemove');
  await clickPlan([ax(14.5, 0.5), ax(15.5, 0.5), ax(15.5, -0.5), ax(14.5, -0.5)]);
  await page.waitForFunction(() => window.BSTool.APP.project.crops.length === 1);
  const n1 = await page.evaluate(() => window.BSTool.APP.cloud.n);
  console.log('   Punkte', n0, '->', n1);
  if (!(n1 < n0)) throw new Error('nichts ausgeschnitten');
  const dev15 = await page.evaluate(() => { const A = window.BSTool.APP, s = A.sortedSecs().find(x => x.station === 15); return A.devOf(s).max; });
  console.log('   max. Abweichung QS 15 nach Ausschnitt:', (dev15 * 1000).toFixed(1), 'mm');
  if (dev15 > 0.03) throw new Error('Stützenpunkte noch im Querschnitt');
});
await step('Ebene: Boden einpassen und in Querschnitte übernehmen', async () => {
  await page.evaluate(() => { document.getElementById('c2bStep3').open = true; });
  await page.selectOption('#c2bPlKind', 'horizontal');
  await page.fill('#c2bPlZ0', ''); await page.fill('#c2bPlZ1', '512.8');
  await page.click('#c2bPlDraw');
  await clickPlan([ax(-0.5, 1.7), ax(30.5, 1.7), ax(30.5, -1.7), ax(-0.5, -1.7)]);
  await page.waitForFunction(() => window.BSTool.APP.project.planes.length === 1);
  const r = await page.evaluate(() => {
    const A = window.BSTool.APP, pl = A.project.planes[0], C = window.BSTool.C2B;
    let worst = 0;
    A.project.sections.forEach(s => { const V = s.profiles[0].vertices; const lo = V.slice().sort((a, b) => a[1] - b[1]).slice(0, 2);
      lo.forEach(v => { const w = C.sec.uvToWorld(s, v); worst = Math.max(worst, Math.abs(pl.n[0] * w[0] + pl.n[1] * w[1] + pl.n[2] * w[2] - pl.c)); }); });
    return { kind: pl.kind, rms: pl.rms, tilt: pl.tilt, worst };
  });
  console.log('   Ebene:', JSON.stringify(r));
  if (r.worst > 1e-4) throw new Error('Bodenecken liegen nicht auf der Ebene');
});
await step('Maske im Querschnitt', async () => {
  await page.evaluate(() => { const A = window.BSTool.APP; A.selectSection(A.sortedSecs()[1].id); });
  const n0 = await page.evaluate(() => window.BSTool.APP.ed.pts.length);
  await page.click('#c2bToolMask');
  const pts = await page.evaluate(() => { const A = window.BSTool.APP, r = document.getElementById('c2bSec').getBoundingClientRect();
    const V = A.curProf().vertices, u0 = Math.min(...V.map(p => p[0])), v0 = Math.min(...V.map(p => p[1]));
    return [[u0 - 0.2, v0 - 0.2], [u0 + 1, v0 - 0.2], [u0 + 1, v0 + 1], [u0 - 0.2, v0 + 1]].map(([u, v]) => { const [x, y] = A.ed.toS(u, v); return [r.left + x, r.top + y]; }); });
  for (const [x, y] of pts) await page.mouse.click(x, y);
  await page.keyboard.press('Enter');
  const n1 = await page.evaluate(() => window.BSTool.APP.ed.pts.length);
  console.log('   Punkte im Querschnitt', n0, '->', n1);
  if (!(n1 < n0)) throw new Error('Maske wirkt nicht');
  await page.keyboard.press('Escape');
  await page.screenshot({ path: path.join(out, 'e2e_8_maske_ebene.png') });
  await page.keyboard.press('Control+z');
  const n2 = await page.evaluate(() => window.BSTool.APP.ed.pts.length);
  if (n2 !== n0) throw new Error('Undo Maske');
});
await page.click('#c2bTab3d');
await page.click('#c2bStep7 summary');
for (const [btn, name] of [['#c2bExpIfc', 'demo.ifc'], ['#c2bExpDxf', 'demo.dxf'], ['#c2bExpObj', 'demo.obj'], ['#c2bSave', 'demo.c2b.json']]) {
  await step('Export ' + name, async () => {
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click(btn)]);
    await dl.saveAs(path.join(out, name));
  });
}
await page.click('#themeToggle');
await page.waitForTimeout(300);
await page.screenshot({ path: path.join(out, 'e2e_4_dark.png') });
await page.click('#themeToggle');
await step('Doppelröhre: zwei Teilprofile je Querschnitt', async () => {
  await page.setInputFiles('#c2bFile', path.join(root, 'beispiel/Demo_Doppelroehre.laz'));
  await page.click('.bs-dialog .bs-btn--red');   // «Neu beginnen»
  await page.waitForFunction(() => window.BSTool.APP.raw && window.BSTool.APP.project.source === 'Demo_Doppelroehre.laz', null, { timeout: 120000 });
  await page.click('#c2bThin');
  await page.waitForTimeout(500);
  await page.fill('#c2bAxS_E', '2600700'); await page.fill('#c2bAxS_N', '1199900');
  await page.fill('#c2bAxE_E', '2600719.319'); await page.fill('#c2bAxE_N', '1199894.824');
  await page.fill('#c2bSpacing', '4');
  await page.fill('#c2bDepth', '100');
  await page.click('#c2bGen');
  await page.waitForFunction(() => window.BSTool.APP.project.sections.length >= 6 && window.BSTool.APP.project.sections.every(s => s.profiles.length > 0), null, { timeout: 60000 });
  const info = await page.evaluate(() => window.BSTool.APP.sortedSecs().map(s => [s.name, s.profiles.map(p => p.vertices.length + (p.closed ? 'g' : 'o')).join('+'), s._dev && +s._dev.toFixed(3)]));
  console.log('  Doppelröhre:', JSON.stringify(info));
  if (!info.every(r => r[1] === '4g+4g')) throw new Error('erwartet je zwei geschlossene Rechtecke');
  await page.click('#c2bCompAuto');
  await page.click('#c2bCompCopy');
  await page.waitForFunction(() => window.BSTool.APP.solids && window.BSTool.APP.solids.length === 8, null, { timeout: 10000 });
  console.log('  Bauteile:', JSON.stringify(await page.evaluate(() => window.BSTool.APP.solids.map(s => s.name + ' ' + s.volume.toFixed(1)))));
  await page.click('#c2bTab3d'); await page.click('#c2bFit'); await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(out, 'e2e_5_doppelroehre.png') });
  await page.click('#c2bShowCloud'); await page.click('#c2bFit'); await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(out, 'e2e_6_doppelroehre_modell.png'), clip: { x: 300, y: 68, width: 650, height: 850 } });
  // Nahansicht: Kamera auf den Anfang der Röhren
  await page.evaluate(() => { const v = window.BSTool.APP.v3d, A = window.BSTool.APP, s = A.sortedSecs()[0];
    const c = window.BSTool.C2B.sec.uvToWorld(s, [0, 481.5]); v.controls.target.set(c[0], c[1], c[2]);
    const f = window.BSTool.C2B.sec.frame(s); v.camera.position.set(c[0] - f.d[0] * 9 + f.u[0] * 6, c[1] - f.d[1] * 9 + f.u[1] * 6, c[2] + 5); v.controls.update(); v.render(); });
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(out, 'e2e_7_doppelroehre_nah.png'), clip: { x: 300, y: 68, width: 650, height: 850 } });
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#c2bExpIfc')]);
  await dl.saveAs(path.join(out, 'doppelroehre.ifc'));
});
await step('Gewölbe: Mehrfachauswahl, Bogen, Schnitttiefe', async () => {
  await page.setInputFiles('#c2bFile', path.join(root, 'beispiel/Demo_Gewoelbe.laz'));
  await page.click('.bs-dialog .bs-btn--red');   // «Neu beginnen»
  await page.waitForFunction(() => window.BSTool.APP.project.source === 'Demo_Gewoelbe.laz' && window.BSTool.APP.raw, null, { timeout: 120000 });
  await page.click('#c2bThin'); await page.waitForTimeout(400);
  await page.evaluate(() => { document.getElementById('c2bStep4').open = true; });
  await page.fill('#c2bAxS_E', '2601000'); await page.fill('#c2bAxS_N', '1200000.5');
  await page.fill('#c2bAxE_E', '2601000'); await page.fill('#c2bAxE_N', '1200014.5');
  await page.click('#c2bModeCount'); await page.fill('#c2bCount', '4'); await page.fill('#c2bDepth', '50');
  await page.click('#c2bGen');
  await page.waitForFunction(() => window.BSTool.APP.project.sections.length === 4 && window.BSTool.APP.project.sections.every(s => s.profiles.length), null, { timeout: 60000 });
  const before = await page.evaluate(() => window.BSTool.APP.curProf().vertices.length);
  // Schnitttiefe dieses Querschnitts ändern
  const n50 = await page.evaluate(() => window.BSTool.APP.ed.pts.length);
  await page.fill('#c2bSecDepth', '100'); await page.press('#c2bSecDepth', 'Enter');
  const n100 = await page.evaluate(() => window.BSTool.APP.ed.pts.length);
  console.log('   Punkte bei Schnitttiefe 50 / 100 mm:', n50, '/', n100);
  if (!(n100 > n50 * 1.5)) throw new Error('Schnitttiefe wirkt nicht');
  // Auswahlrechteck (Shift+Ziehen) über dem Gewölbe inkl. Kämpferpunkten
  const box = await page.evaluate(() => { const A = window.BSTool.APP, r = document.getElementById('c2bSec').getBoundingClientRect();
    const a = A.ed.toS(-3.3, 605.3), b = A.ed.toS(3.3, 601.9), cl = (v, lo, hi) => Math.max(lo + 2, Math.min(hi - 2, v));
    return [r.left + cl(a[0], 0, r.width), r.top + cl(a[1], 0, r.height), r.left + cl(b[0], 0, r.width), r.top + cl(b[1], 0, r.height)]; });
  await page.keyboard.down('Shift');
  await page.mouse.move(box[0], box[1]); await page.mouse.down(); await page.mouse.move(box[2], box[3], { steps: 5 }); await page.mouse.up();
  await page.keyboard.up('Shift');
  const nsel = await page.evaluate(() => window.BSTool.APP.ed.sel.size);
  await page.click('#c2bArc');
  const res = await page.evaluate(() => { const A = window.BSTool.APP, P = A.curProf(), C = window.BSTool.C2B;
    const i = P.mids.findIndex(Boolean), n = P.vertices.length; const pr = C.arc.param(P.vertices[i], P.mids[i], P.vertices[(i + 1) % n]);
    return { n, r: pr.r, c: pr.c, dev: A.curSec()._dev }; });
  console.log('   Ecken vorher', before, '· gewählt', nsel, '· nachher', res.n, '· Radius', res.r.toFixed(4), '· Zentrum', res.c.map(x => x.toFixed(3)).join('/'), '· max. Abw.', (res.dev * 1000).toFixed(1), 'mm');
  if (res.n > 5 || Math.abs(res.r - 3) > 0.01) throw new Error('Bogen falsch');
  await page.screenshot({ path: path.join(out, 'e2e_9_gewoelbe.png') });
  // Mehrfachauswahl löschen + Undo
  const pts2 = await page.evaluate(() => { const A = window.BSTool.APP, r = document.getElementById('c2bSec').getBoundingClientRect(), V = A.curProf().vertices;
    return [0, 1].map(i => { const [x, y] = A.ed.toS(V[i][0], V[i][1]); return [r.left + x, r.top + y]; }); });
  const empty = await page.evaluate(() => { const A = window.BSTool.APP, r = document.getElementById('c2bSec').getBoundingClientRect(); const [x, y] = A.ed.toS(0, 601); return [r.left + x, r.top + y]; });
  await page.mouse.click(empty[0], empty[1]);   // Klick ins Leere: Auswahl aufheben
  await page.keyboard.down('Control');
  for (const [x, y] of pts2) await page.mouse.click(x, y);
  await page.keyboard.up('Control');
  await page.keyboard.press('Delete');
  const nDel = await page.evaluate(() => window.BSTool.APP.curProf().vertices.length);
  await page.keyboard.press('Control+z');
  const nUndo = await page.evaluate(() => window.BSTool.APP.curProf().vertices.length);
  console.log('   2 Ecken gewählt und gelöscht:', res.n, '->', nDel, '· Rückgängig ->', nUndo);
  if (nDel !== res.n - 2 || nUndo !== res.n) throw new Error('Mehrfach-Löschen');
  // Profil mit Bogen auf alle übertragen
  await page.click('#c2bPropagate');
  await page.click('.bs-dialog .bs-dialog-actions button:last-child');
  await page.waitForTimeout(800);
  const all = await page.evaluate(() => window.BSTool.APP.sortedSecs().map(s => { const P = s.profiles[0], C = window.BSTool.C2B; const i = (P.mids || []).findIndex(Boolean);
    const pr = i >= 0 ? C.arc.param(P.vertices[i], P.mids[i], P.vertices[(i + 1) % P.vertices.length]) : null; return [P.vertices.length, pr && +pr.r.toFixed(4), s._dev && +(s._dev * 1000).toFixed(1)]; }));
  console.log('   alle Querschnitte [Ecken, Radius, max. Abw. mm]:', JSON.stringify(all));
  if (!all.every(a => a[0] === res.n && Math.abs(a[1] - 3) < 0.01)) throw new Error('Übertragen mit Bogen');
  await page.click('#c2bCompAuto'); await page.click('#c2bCompCopy');
  await page.waitForFunction(() => window.BSTool.APP.solids && window.BSTool.APP.solids.length >= 3, null, { timeout: 10000 });
  console.log('   Bauteile:', JSON.stringify(await page.evaluate(() => window.BSTool.APP.solids.map(s => s.name + ' ' + s.volume.toFixed(2)))));
  await page.click('#c2bTab3d'); await page.click('#c2bShowCloud'); await page.click('#c2bFit'); await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(out, 'e2e_10_gewoelbe_3d.png'), clip: { x: 300, y: 68, width: 650, height: 850 } });
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#c2bExpIfc')]);
  await dl.saveAs(path.join(out, 'gewoelbe.ifc'));
});
await step('Abgleich Modell ↔ Punktwolke (Gewölbe)', async () => {
  await page.evaluate(() => { document.getElementById('c2bStep5').open = true; });
  await page.click('#c2bShowCloud').catch(() => {});
  if (await page.$eval('#c2bShowCloud', b => b.getAttribute('aria-pressed')) !== 'true') await page.click('#c2bShowCloud');
  await page.click('#c2bDevRun');
  await page.waitForFunction(() => window.BSTool.APP.dev && window.BSTool.APP.dev.res, null, { timeout: 60000 });
  const r = await page.evaluate(() => { const d = window.BSTool.APP.dev; return { n: d.dist.length, counts: d.res.counts, mean: d.res.mean, p95: d.res.p95, legend: !document.getElementById('c2bDevLegend').hidden }; });
  console.log('   Abgleich:', JSON.stringify({ n: r.n, counts: r.counts, mean_mm: +(r.mean * 1000).toFixed(2), p95_mm: +(r.p95 * 1000).toFixed(2), legende: r.legend }));
  if (!r.legend || !(r.mean < 0.004)) throw new Error('Abgleich unplausibel');
  await page.click('#c2bFit'); await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(out, 'e2e_11_abgleich.png') });
  // Skala anpassen: erste Stufe 3 mm
  await page.evaluate(() => { const i = document.querySelector('#c2bDevScaleEd input[data-k="0"][data-f="mm"]'); i.value = '3'; i.dispatchEvent(new Event('change', { bubbles: true })); });
  const c2 = await page.evaluate(() => window.BSTool.APP.dev.res.counts);
  console.log('   Stufe 1 auf 3 mm: Anteil grün', r.counts[0], '->', c2[0]);
  if (!(c2[0] > r.counts[0])) throw new Error('Skala wirkt nicht');
  await page.click('#c2bDevDefault');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#c2bDevPly')]);
  await dl.saveAs(path.join(out, 'abweichung.ply'));
  await page.click('#c2bTabPlan'); await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(out, 'e2e_12_abgleich_grundriss.png') });
});
await step('Übergang: zwei Röhren → eine Röhre (Stirnwand)', async () => {
  await page.setInputFiles('#c2bFile', path.join(root, 'beispiel/Demo_Verzweigung.laz'));
  await page.click('.bs-dialog .bs-btn--red');
  await page.waitForFunction(() => window.BSTool.APP.project.source === 'Demo_Verzweigung.laz' && window.BSTool.APP.raw, null, { timeout: 120000 });
  await page.click('#c2bThin'); await page.waitForTimeout(400);
  await page.evaluate(() => { document.getElementById('c2bStep4').open = true; });
  await page.fill('#c2bAxS_E', '2601500'); await page.fill('#c2bAxS_N', '1200500');
  await page.fill('#c2bAxE_E', '2601518'); await page.fill('#c2bAxE_N', '1200500');
  await page.click('#c2bModeSpacing'); await page.fill('#c2bSpacing', '3'); await page.fill('#c2bDepth', '50');
  await page.click('#c2bGen');
  await page.waitForFunction(() => window.BSTool.APP.project.sections.length === 7 && window.BSTool.APP.project.sections.every(s => s.profiles.length), null, { timeout: 60000 });
  console.log('   Querschnitte:', JSON.stringify(await page.evaluate(() => window.BSTool.APP.sortedSecs().map(s => s.name + ':' + s.profiles.map(p => p.vertices.length).join('+')))));

  await page.click('#c2bCompAutoAll');
  // Übergang bei Station 8.25, Tiefe 500 mm mittig -> 8.0 .. 8.5
  await page.fill('#c2bTrSt', '8.25'); await page.fill('#c2bTrDepth', '500'); await page.selectOption('#c2bTrAlign', 'center');
  await page.click('#c2bTrAdd');
  await page.waitForFunction(() => { const T = window.BSTool.APP.curSec(); return T && T.kind === 'transition' && T.profiles.length; });
  const tr = await page.evaluate(() => { const A = window.BSTool.APP, C = window.BSTool.C2B, T = A.curSec(); return { roles: T.profiles.map(p => p.role), area: C.trans.areaOf(T), nb: C.trans.neighbors(A.project.sections, T) && [C.trans.neighbors(A.project.sections, T).left.name, C.trans.neighbors(A.project.sections, T).right.name] }; });
  console.log('   Übergang:', JSON.stringify(tr));
  if (tr.roles.filter(r => r === 'hole').length !== 2 || Math.abs(tr.area - 16) > 0.3) throw new Error('Fläche Übergang');
  await page.screenshot({ path: path.join(out, 'e2e_13_uebergang_editor.png') });
  await page.click('#c2bBuild');
  await page.waitForFunction(() => window.BSTool.APP.solids && window.BSTool.APP.solids.some(s => s.type === 'transition'), null, { timeout: 10000 });
  const sol = await page.evaluate(() => window.BSTool.APP.solids.map(s => [s.name, s.stations.map(x => +x.toFixed(2)).join('–'), +s.volume.toFixed(2)]));
  console.log('   Körper:', JSON.stringify(sol));
  const bad = sol.filter(([n, st]) => n !== 'Übergang 8.25' && !(st.endsWith('–8') || st.startsWith('8.5–')));
  if (bad.length) throw new Error('Läufe nicht an den Stirnflächen: ' + JSON.stringify(bad));
  await page.click('#c2bTab3d');
  for (const id of ['#c2bShowCloud']) if (await page.$eval(id, b => b.getAttribute('aria-pressed')) === 'true') await page.click(id);
  for (const id of ['#c2bShowModel', '#c2bShowAreas']) if (await page.$eval(id, b => b.getAttribute('aria-pressed')) !== 'true') await page.click(id);
  await page.evaluate(() => { const v = window.BSTool.APP.v3d, o = window.BSTool.APP.project.offset; const c = [1508.5 - (o[0] - 2600000), 1200500 - o[1], 452];
    v.controls.target.set(c[0], c[1], c[2]); v.camera.position.set(c[0] + 9, c[1] - 11, c[2] + 7); v.controls.update(); v.render(); });
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(out, 'e2e_14_uebergang_3d.png'), clip: { x: 300, y: 68, width: 650, height: 850 } });
  await page.evaluate(() => { document.getElementById('c2bStep5').open = true; });
  await page.click('#c2bDevRun');
  await page.waitForFunction(() => window.BSTool.APP.dev && window.BSTool.APP.dev.res, null, { timeout: 60000 });
  const r = await page.evaluate(() => { const d = window.BSTool.APP.dev; return { mean: d.res.mean, p95: d.res.p95, out: d.res.nOut / d.dist.length }; });
  console.log('   Abgleich:', JSON.stringify({ mean_mm: +(r.mean * 1000).toFixed(2), p95_mm: +(r.p95 * 1000).toFixed(2), ausserhalb: +(r.out * 100).toFixed(1) + ' %' }));
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#c2bExpIfc')]);
  await dl.saveAs(path.join(out, 'verzweigung.ifc'));
});
console.log('--- Log ---\n' + (await log()));
await browser.close();
if (errors.length) { console.log('FEHLER:\n' + errors.join('\n')); process.exit(1); }
console.log('Keine Browserfehler.');
