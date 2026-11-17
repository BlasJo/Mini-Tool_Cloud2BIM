import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadCore } from './load.mjs';
import { rng, culvertProfile, sampleProfile } from './synth.mjs';
const C = loadCore();

test('Douglas-Peucker & Abweichung', () => {
  const P = Array.from({ length: 101 }, (_, i) => [i / 100, 0]);
  assert.equal(JSON.stringify(C.g2.douglasPeucker(P, 0.01)), JSON.stringify([0, 100]));
  const rep = C.g2.deviationReport(P, [[0, 0.005], [1, 0.005]], false, 0.01);
  assert.ok(Math.abs(rep.max - 0.005) < 1e-9);
  assert.equal(rep.withinTol, 1);
});

test('Auto-Profil erkennt Durchlass mit Vouten (6 Ecken, geschlossen)', () => {
  const r = rng(3);
  const V0 = culvertProfile();
  let pts = sampleProfile(V0, 0.005, 0.004, r);
  // Störobjekt (Leitung) im Querschnitt und Streupunkte
  for (let i = 0; i < 200; i++) pts.push([1.2 + r() * 0.1, 502 + r() * 0.1]);
  for (let i = 0; i < 30; i++) pts.push([-2 + 4 * r(), 500 + 3 * r()]);
  const prof = C.sec.autoProfile(pts, 0.01);
  assert.equal(prof.closed, true);
  assert.equal(prof.vertices.length, 6, JSON.stringify(prof.vertices));
  for (const v of V0) {
    const d = Math.min(...prof.vertices.map(p => Math.hypot(p[0] - v[0], p[1] - v[1])));
    assert.ok(d < 0.02, 'Ecke ' + v + ' Abstand ' + d);
  }
  const rep = C.g2.deviationReport(pts, prof.vertices, true, 0.01);
  assert.ok(rep.p95 <= 0.01, 'p95 ' + rep.p95);
});

test('Offenes U-Profil (Trog)', () => {
  const r = rng(5);
  const V0 = [[-2, 503], [-2, 500], [2, 500], [2, 503]];
  const pts = [];
  for (let i = 0; i < 3; i++) {
    const a = V0[i], b = V0[i + 1];
    for (let k = 0; k <= 600; k++) { const t = k / 600; pts.push([a[0] + t * (b[0] - a[0]) + (r() - .5) * .006, a[1] + t * (b[1] - a[1]) + (r() - .5) * .006]); }
  }
  const prof = C.sec.autoProfile(pts, 0.01);
  assert.equal(prof.closed, false);
  assert.equal(prof.vertices.length, 4, JSON.stringify(prof.vertices));
});

test('Vorlage an verschobenen Querschnitt anpassen', () => {
  const r = rng(9);
  const V0 = culvertProfile();
  const V1 = V0.map(([u, v]) => [u + 0.12, v + 0.08 + (u > 0 ? 0.03 : 0)]); // verschoben + leicht verzogen
  const pts = sampleProfile(V1, 0.005, 0.003, r);
  const fit = C.sec.fitTemplate(V0, true, pts, 0.2);
  assert.equal(fit.vertices.length, 6);
  fit.vertices.forEach((p, i) => assert.ok(Math.hypot(p[0] - V1[i][0], p[1] - V1[i][1]) < 0.015, `Ecke ${i}: ${p} vs ${V1[i]}`));
});

test('Querschnitte entlang Achse: Abstand und Anzahl', () => {
  const a = C.sec.generateAlongAxis([[0, 0], [10, 0]], { spacing: 3 });
  assert.equal(JSON.stringify(a.map(s => s.station)), JSON.stringify([0, 3, 6, 9, 10]));
  const b = C.sec.generateAlongAxis([[0, 0], [0, 10]], { count: 5 });
  assert.equal(JSON.stringify(b.map(s => s.station)), JSON.stringify([0, 2.5, 5, 7.5, 10]));
  assert.ok(Math.abs(b[2].angle - Math.PI / 2) < 1e-12);
  // u = rechts in Blickrichtung: Blick nach +Y -> rechts ist +X
  const w = C.sec.uvToWorld(b[2], [1, 3]);
  assert.ok(Math.abs(w[0] - 1) < 1e-12 && Math.abs(w[1] - 5) < 1e-12 && w[2] === 3);
});

test('Bauteil-Vorschlag', () => {
  const comps = C.sec.suggestComponents(culvertProfile(), true);
  const names = comps.map(c => c.name).sort();
  assert.equal(JSON.stringify(names), JSON.stringify(['Bodenplatte', 'Decke', 'Wand links', 'Wand rechts']));
  const deck = comps.find(c => c.type === 'ceiling');
  // 45°-Vouten zählen ab 35° Neigung zur Wand
  assert.equal(C.sec.componentEdges(deck, 6, true).length, 1);
  assert.equal(C.sec.componentEdges(comps.find(c => c.name === 'Wand rechts'), 6, true).length, 2);
  // Alle Kanten genau einmal zugeordnet
  assert.equal(comps.reduce((s, c) => s + C.sec.componentEdges(c, 6, true).length, 0), 6);
});

test('Voxel-Ausdünnung', () => {
  const col = new C.thin.Collector(0.1, false);
  for (let i = 0; i < 1000; i++) col.add(2600000 + (i % 10) * 0.01, 1200000, 500);
  const c = col.result();
  assert.equal(c.n, 1);
  assert.equal(JSON.stringify(c.offset), JSON.stringify([2600000, 1200000, 0]));
});

test('Zwei Tunnelröhren: zwei Teilprofile dank max. Punktabstand', () => {
  const r = rng(11);
  const V0 = culvertProfile();
  const left = V0.map(([u, v]) => [u - 4.2, v]), right = V0.map(([u, v]) => [u + 4.2, v]);
  const pts = sampleProfile(left, 0.01, 0.003, r).concat(sampleProfile(right, 0.01, 0.003, r));
  for (let i = 0; i < 150; i++) pts.push([-3 + r() * 0.1, 502 + r() * 0.1]);   // Gerät in der linken Röhre
  const P = C.sec.autoProfiles(pts, 0.01, { maxGap: 0.2 });
  assert.equal(P.length, 2);
  P.forEach(p => { assert.equal(p.closed, true); assert.equal(p.vertices.length, 6, JSON.stringify(p.vertices)); });
  assert.ok(P[0].vertices[0][0] < 0 && P[1].vertices[0][0] > 0, 'links vor rechts');
});

test('Max. Punktabstand: Lücke grösser als Abstand wird nicht überbrückt', () => {
  const r = rng(12);
  // U-Profil mit 0.5 m Lücke im Boden -> zwei offene Teile
  const pts = [];
  for (let k = 0; k <= 300; k++) pts.push([-2 + (r() - .5) * .004, 500 + 3 * k / 300]);
  for (let k = 0; k <= 175; k++) pts.push([-2 + 1.75 * k / 175, 500 + (r() - .5) * .004]);
  for (let k = 0; k <= 175; k++) pts.push([0.25 + 1.75 * k / 175, 500 + (r() - .5) * .004]);
  for (let k = 0; k <= 300; k++) pts.push([2 + (r() - .5) * .004, 500 + 3 * k / 300]);
  assert.equal(C.sec.autoProfiles(pts, 0.01, { maxGap: 0.2 }).length, 2);
  const one = C.sec.autoProfiles(pts, 0.01, { maxGap: 0.8 });
  assert.equal(one.length, 1);
  assert.equal(one[0].closed, false);
});

test('Altes Projektformat wird übernommen', () => {
  const s = { id: 'x', profile: { vertices: [[0, 0], [1, 0]], closed: false }, components: [{ name: 'A' }] };
  const P = C.sec.profilesOf(s);
  assert.equal(P.length, 1); assert.equal(P[0].components[0].name, 'A');
  assert.equal(s.profile, undefined); assert.equal(s.maxGap, 0.2);
});
