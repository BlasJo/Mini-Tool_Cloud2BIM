import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadCore } from './load.mjs';
import { rng, culvertProfile } from './synth.mjs';
const C = loadCore();

test('Punkt-Dreieck-Abstand', () => {
  const T = Float64Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  assert.ok(Math.abs(C.dev.dist2PointTri(0.2, 0.2, 0.5, T, 0) - 0.25) < 1e-12);   // über der Fläche
  assert.ok(Math.abs(C.dev.dist2PointTri(2, 0, 0, T, 0) - 1) < 1e-12);            // neben Ecke B
  assert.ok(Math.abs(C.dev.dist2PointTri(1, 1, 0, T, 0) - 0.5) < 1e-12);          // neben Kante BC
});

function project() {
  // Durchlass, Achse entlang X, Querschnitte bei 0 und 10 m; zweiter Querschnitt 0.10 m höher
  const secs = C.sec.generateAlongAxis([[0, 0], [10, 0]], { count: 2 });
  secs[0].profiles = [{ vertices: culvertProfile(), closed: true, components: [] }];
  secs[1].profiles = [{ vertices: culvertProfile().map(([u, v]) => [u, v + 0.10]), closed: true, components: [] }];
  return { sections: secs, columns: [], offset: [0, 0, 0] };
}

test('Abstände zur interpolierten Fläche und Farbklassen', () => {
  const surf = C.dev.surfaceTriangles(project());
  assert.ok(surf.n > 0);
  const idx = C.dev.buildIndex(surf, 0.1);
  // Boden in Station 5: interpoliert auf z = 500.05; Punkte mit +0/+3/+7/+15/+50/+200 mm
  const offs = [0, 0.003, 0.007, 0.015, 0.05, 0.2];
  const pts = offs.map(d => [5, 0.3, 500.05 + d]);
  const cloud = { n: pts.length, xyz: Float32Array.from(pts.flat()), offset: [0, 0, 0] };
  const out = new Float32Array(cloud.n);
  C.dev.distances(idx, cloud, out);
  offs.slice(0, 5).forEach((d, i) => assert.ok(Math.abs(out[i] - d) < 2e-4, `Punkt ${i}: ${out[i]} statt ${d}`));
  assert.equal(out[5], Infinity);   // jenseits der Suchgrenze (pad 0.1)
  const c = C.dev.colorize(out, C.dev.DEFAULT_SCALE);
  assert.equal(JSON.stringify(c.counts), JSON.stringify([1, 1, 1, 1, 1, 1]));
  assert.equal(c.nOut, 1);
  const ply = C.dev.buildPly(cloud, c.colors, out);
  assert.ok(new TextDecoder().decode(ply.slice(0, 600)).includes('property float distance'));
});

test('Interpolation mit Bogen: Punkte auf dem echten Kreis', () => {
  const secs = C.sec.generateAlongAxis([[0, 0], [8, 0]], { count: 2 });
  secs.forEach(s => { s.profiles = [{ vertices: [[-2, 0], [2, 0], [2, 2.5], [-2, 2.5]], closed: true, mids: [null, null, [0, 4.5], null], components: [] }]; });
  const idx = C.dev.buildIndex(C.dev.surfaceTriangles({ sections: secs }), 0.1);
  const r = rng(2), pts = [];
  for (let i = 0; i < 2000; i++) { const a = Math.PI * r(), w = C.sec.uvToWorld(secs[0], [2 * Math.cos(a), 2.5 + 2 * Math.sin(a)]); pts.push([8 * r(), w[1], w[2]]); }
  const cloud = { n: pts.length, xyz: Float32Array.from(pts.flat()), offset: [0, 0, 0] };
  const out = C.dev.distances(idx, cloud, new Float32Array(cloud.n));
  let mx = 0; out.forEach(d => { mx = Math.max(mx, d); });
  assert.ok(mx < 0.0015, 'max ' + mx);   // Sehnenfehler bei 48 Segmenten, r = 2 m
});
