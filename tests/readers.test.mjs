import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { loadCore } from './load.mjs';
const C = loadCore();
const out = new URL('./out/', import.meta.url);
const ref = JSON.parse(fs.readFileSync(new URL('fmt_ref.json', out)));
const fileOf = name => new File([fs.readFileSync(new URL(name, out))], name);

function lazFactory() {
  const ctx = vm.createContext({ window: {}, console, WebAssembly, setTimeout, clearTimeout, TextDecoder, performance });
  vm.runInContext(fs.readFileSync(new URL('../vendor/laz-perf.js', import.meta.url), 'utf8') + ';globalThis.f=createLazPerf;', ctx);
  return ctx.f;
}
const lazWasm = fs.readFileSync(new URL('../vendor/laz-perf.wasm', import.meta.url));

function compare(c, tolXYZ, { color = true, expectN = ref.length, coarse = false } = {}) {
  assert.equal(c.n, expectN);
  const got = [];
  for (let i = 0; i < c.n; i++) got.push([c.xyz[i * 3] + c.offset[0], c.xyz[i * 3 + 1] + c.offset[1], c.xyz[i * 3 + 2] + c.offset[2],
    c.rgb ? c.rgb[i * 3] : -1, c.rgb ? c.rgb[i * 3 + 1] : -1, c.rgb ? c.rgb[i * 3 + 2] : -1]);
  const R = ref.slice().sort((a, b) => a[0] - b[0]);
  got.sort((a, b) => a[0] - b[0]);
  let maxd = 0, colErr = 0, j = 0;
  for (const g of got) {
    while (j < R.length - 1 && Math.abs(R[j + 1][0] - g[0]) < Math.abs(R[j][0] - g[0])) j++;
    // nächster Referenzpunkt in der Umgebung
    let best = null, bd = Infinity;
    for (let k = Math.max(0, j - 30); k < Math.min(R.length, j + 30); k++) {
      const d = Math.hypot(R[k][0] - g[0], R[k][1] - g[1], R[k][2] - g[2]);
      if (d < bd) { bd = d; best = R[k]; }
    }
    maxd = Math.max(maxd, bd);
    if (color) colErr = Math.max(colErr, Math.abs(best[3] - g[3]), Math.abs(best[4] - g[4]), Math.abs(best[5] - g[5]));
  }
  assert.ok(maxd <= tolXYZ, 'Koordinatenabweichung ' + maxd);
  if (coarse) { assert.ok(c.rgb, 'Farben fehlen'); return; }  // Single-Precision bei LV95: Zuordnung unsicher
  if (color) { assert.ok(c.rgb, 'Farben fehlen'); assert.ok(colErr <= 1, 'Farbabweichung ' + colErr); }
  else assert.equal(c.rgb, null);
}

for (const [name, tol, opt] of [['fmt.xyz', 1e-4], ['fmt.pts', 1e-4], ['fmt.csv', 1e-4, { color: false }],
  ['fmt.las', 1e-3], ['fmt.ply', 5e-5], ['fmt_ascii.ply', 1e-4], ['fmt.laz', 1e-3],
  ['fmt.e57', 2, { coarse: true }], ['fmt_scaled.e57', 1e-3, { expectN: ref.length - 20 }]]) {
  test('Lesen ' + name, async () => {
    const c = await C.read.readCloud(fileOf(name), { lazFactory: lazFactory(), lazWasm });
    compare(c, tol, opt);
    assert.deepEqual([...c.offset], [2600000, 1200000, 0]);
  });
}

test('Vorausdünnung beim Einlesen', async () => {
  const c = await C.read.readCloud(fileOf('fmt.las'), { voxel: 1 });
  assert.ok(c.n < 200 && c.n > 100, 'n=' + c.n);   // 10 x 5 x 3 Voxel = 150
  assert.equal(c.nRead, ref.length);
});
