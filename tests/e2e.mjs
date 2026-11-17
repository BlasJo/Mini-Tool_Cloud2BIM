// End-to-End-Test im Browser: node tests/e2e.mjs  (Screenshots in tests/out/)
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import path from 'node:path';
import fs from 'node:fs';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const html = fs.readdirSync(root).filter(f => /^Cloud2BIM_V.*\.html$/.test(f)).sort().pop();
const out = path.join(root, 'tests/out');
const errors = [];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 950 }, deviceScaleFactor: 1, acceptDownloads: true });
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
await page.goto('file://' + path.join(root, html));
await page.waitForFunction(() => window.BSTool && window.BSTool.APP);
const log = () => page.$eval('#log', e => e.textContent);
const step = async (name, fn) => { const t = Date.now(); await fn(); console.log('✓', name, (Date.now() - t) + ' ms'); };

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
  await page.waitForFunction(() => window.BSTool.APP.project.sections.length === 7 && window.BSTool.APP.project.sections.every(s => s.profile.vertices.length > 0), null, { timeout: 60000 });
});
const secInfo = await page.evaluate(() => window.BSTool.APP.sortedSecs().map(s => [s.name, s.profile.vertices.length, s.profile.closed, s._dev]));
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
  const n0 = await page.evaluate(() => window.BSTool.APP.curSec().profile.vertices.length);
  const p = await page.evaluate(() => {
    const A = window.BSTool.APP, s = A.curSec(), V = s.profile.vertices;
    const a = V[0], b = V[1]; const [x, y] = A.ed.toS((a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
    const r = document.getElementById('c2bSec').getBoundingClientRect(); return { x: r.left + x, y: r.top + y };
  });
  await page.mouse.dblclick(p.x, p.y);
  const n1 = await page.evaluate(() => window.BSTool.APP.curSec().profile.vertices.length);
  if (n1 !== n0 + 1) throw new Error('Ecke nicht eingefügt ' + n0 + ' -> ' + n1);
  await page.keyboard.press('Control+z');
  const n2 = await page.evaluate(() => window.BSTool.APP.curSec().profile.vertices.length);
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
console.log('--- Log ---\n' + (await log()));
await browser.close();
if (errors.length) { console.log('FEHLER:\n' + errors.join('\n')); process.exit(1); }
console.log('Keine Browserfehler.');
