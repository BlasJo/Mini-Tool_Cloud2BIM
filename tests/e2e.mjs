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
  await page.click('#c2bStep3 summary');
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
  await page.click('#c2bStep4 summary');
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
  await page.click('#c2bStep5 summary');
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
await page.click('#c2bTab3d');
await page.click('#c2bStep6 summary');
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
console.log('--- Log ---\n' + (await log()));
await browser.close();
if (errors.length) { console.log('FEHLER:\n' + errors.join('\n')); process.exit(1); }
console.log('Keine Browserfehler.');
