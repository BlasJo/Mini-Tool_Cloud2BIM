import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadCore } from './load.mjs';
import { rng, culvertProfile } from './synth.mjs';
const C = loadCore();

const cloudOf = pts => ({ n: pts.length, xyz: Float32Array.from(pts.flat()), rgb: null, offset: [0, 0, 0] });

test('Ausschneiden: Region behalten / entfernen, Höhenbereich', () => {
  const pts = [];
  for (let x = 0; x < 10; x += 0.5) for (let y = 0; y < 10; y += 0.5) pts.push([x, y, 500 + (x > 5 ? 3 : 0)]);
  const c = cloudOf(pts);
  const poly = [[-1, -1], [4.9, -1], [4.9, 11], [-1, 11]];
  assert.equal(C.planes.applyRegions(c, [{ poly, mode: 'keep', zMin: null, zMax: null }]).n, 10 * 20);
  assert.equal(C.planes.applyRegions(c, [{ poly, mode: 'remove', zMin: null, zMax: null }]).n, 10 * 20);
  // ganze Fläche, aber nur Punkte über 501 entfernen
  assert.equal(C.planes.applyRegions(c, [{ poly: [[-1, -1], [11, -1], [11, 11], [-1, 11]], mode: 'remove', zMin: 501, zMax: null }]).n, 11 * 20);
});

test('Masken im Querschnitt', () => {
  const uv = [[0, 0], [1, 1], [2, 2]];
  assert.equal(C.planes.applyMasks(uv, [{ poly: [[0.5, 0.5], [1.5, 0.5], [1.5, 1.5], [0.5, 1.5]] }]).length, 2);
});

test('Ebene einpassen (RANSAC) trotz Störpunkten, horizontal und vertikal', () => {
  const r = rng(4), pts = [];
  for (let i = 0; i < 4000; i++) pts.push([r() * 10, r() * 4, 500 + 0.01 * r() * 10 * 0 + (r() - .5) * 0.004]);   // Boden z=500
  for (let i = 0; i < 1500; i++) pts.push([r() * 10, 4 + (r() - .5) * 0.004, 500 + r() * 3]);              // Wand y=4
  for (let i = 0; i < 300; i++) pts.push([r() * 10, r() * 4, 500 + r() * 3]);                               // Störpunkte
  const h = C.planes.fitPlane(pts, { tol: 0.01, kind: 'horizontal' });
  assert.ok(Math.abs(h.n[2] - 1) < 1e-4 && Math.abs(h.c - 500) < 0.002, JSON.stringify(h));
  assert.equal(h.kind, 'horizontal');
  const v = C.planes.fitPlane(pts, { tol: 0.01, kind: 'vertical' });
  const yAt = (v.c - v.n[0] * 5 - v.n[2] * 501.5) / v.n[1];   // Lage der Ebene in Wandmitte
  assert.ok(Math.abs(Math.abs(v.n[1]) - 1) < 1e-3 && Math.abs(yAt - 4) < 0.003, JSON.stringify(v.n) + ' y=' + yAt);
  assert.ok(v.ext[1] - v.ext[0] > 9.5);
});

test('Schnittlinie im Querschnitt und Übernahme ins Profil', () => {
  // Achse entlang +X -> u = rechts = -Y. Wand-Ebene y = -2 (rechte Wand bei u = 2), Boden z = 500
  const s = C.sec.generateAlongAxis([[0, 0], [20, 0]], { count: 3 })[1];
  const r = rng(5), wall = [], floor = [];
  for (let i = 0; i < 3000; i++) wall.push([r() * 20, -2, 500 + r() * 3]);
  for (let i = 0; i < 3000; i++) floor.push([r() * 20, -2 + r() * 4, 500]);
  const pw = C.planes.fitPlane(wall, { tol: 0.005 }), pf = C.planes.fitPlane(floor, { tol: 0.005 });
  const lines = C.planes.sectionLines([pw, pf], s);
  assert.equal(lines.length, 2);
  const lw = lines.find(l => l.plane === pw);
  assert.ok(Math.abs(lw.a[0] - 2) < 1e-6 && Math.abs(lw.b[0] - 2) < 1e-6, JSON.stringify(lw));
  // ungenaues Profil: rechte Wand bei u≈2.03 leicht schief, Boden bei 500.02
  const V = culvertProfile().map(p => p.slice());
  V[0][1] = 500.02; V[1] = [2.03, 500.02]; V[2] = [2.02, 502.7];
  const res = C.planes.applyToProfile({ vertices: V, closed: true }, lines, { maxDist: 0.1 });
  assert.equal(res.applied.length, 2);
  assert.ok(Math.abs(res.vertices[1][0] - 2) < 1e-6 && Math.abs(res.vertices[1][1] - 500) < 1e-6, JSON.stringify(res.vertices[1]));
  assert.ok(Math.abs(res.vertices[2][0] - 2) < 1e-6, 'Wandecke oben auf Ebene');
  assert.ok(Math.abs(res.vertices[0][1] - 500) < 1e-6, 'Bodenecke links auf Ebene');
});
