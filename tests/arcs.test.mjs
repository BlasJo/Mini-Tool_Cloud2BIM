import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadCore } from './load.mjs';
import { rng } from './synth.mjs';
const C = loadCore();

test('Kreis durch 3 Punkte, Bogenpunkte', () => {
  const p = C.arc.param([-1, 0], [0, 1], [1, 0]);
  assert.ok(Math.hypot(p.c[0], p.c[1]) < 1e-12 && Math.abs(p.r - 1) < 1e-12);
  const q = C.arc.points([-1, 0], [0, 1], [1, 0], 4);
  assert.equal(q.length, 3);
  q.forEach(x => { assert.ok(Math.abs(Math.hypot(x[0], x[1]) - 1) < 1e-12); assert.ok(x[1] > 0); });
  // Bogen nach unten
  C.arc.points([-1, 0], [0, -1], [1, 0], 4).forEach(x => assert.ok(x[1] < 0));
  // grosser Bogen (> Halbkreis) über m
  const big = C.arc.points([-1, 0], [0, -1], [1, 0], 8);
  assert.ok(big.every(x => Math.abs(Math.hypot(x[0], x[1]) - 1) < 1e-12));
  assert.equal(C.arc.param([0, 0], [1, 0], [2, 0]), null);   // kollinear
});

// Gewölbe: Wände 0..2.5 m, Halbkreis-Decke Radius 2 (Scheitel 4.5)
const vault = () => ({ vertices: [[-2, 0], [2, 0], [2, 2.5], [-2, 2.5]], closed: true, mids: [null, null, [0, 4.5], null], components: [] });
function vaultPoints(r = rng(3)) {
  const pts = [];
  for (let k = 0; k <= 400; k++) { const t = k / 400;
    pts.push([-2 + 4 * t, (r() - .5) * .006], [2 + (r() - .5) * .006, 2.5 * t], [-2 + (r() - .5) * .006, 2.5 * t]);
    const a = Math.PI * t; pts.push([2 * Math.cos(a) + (r() - .5) * .006, 2.5 + 2 * Math.sin(a) + (r() - .5) * .006]); }
  return pts;
}

test('Abweichung mit Bogen, Pfeilhöhe einpassen', () => {
  const pts = vaultPoints();
  const rep = C.g2.deviationMulti(pts, [vault()], 0.01);
  assert.ok(rep.max < 0.012, 'max ' + rep.max);   // Sehnenfehler 16 Segmente r=2: 2(1-cos(5.6°)) ≈ 9.6 mm
  // Sehne von rechts nach links: «links» der Fahrtrichtung ist unten -> Scheitel oben = negative Pfeilhöhe
  const s = C.arc.fitSagitta([2, 2.5], [-2, 2.5], pts, -1.5);
  assert.ok(Math.abs(s + 2) < 0.01, 's=' + s);
  const m = C.arc.midFromSagitta([2, 2.5], [-2, 2.5], s);
  assert.ok(Math.hypot(m[0], m[1] - 4.5) < 0.01);
  // Sehne von links nach rechts mit Startwert 0: Suchbereich reicht bis zum Halbkreis
  const s2 = C.arc.fitSagitta([-2, 2.5], [2, 2.5], pts, 0);
  assert.ok(Math.abs(s2 - 2) < 0.01, 's2=' + s2);
});

test('Vorlage mit Bogen an verschobenen Querschnitt anpassen', () => {
  const pts = vaultPoints().map(([u, v]) => [u + 0.1, v + 0.05]);
  const f = C.sec.fitProfile(vault(), pts, 0.2);
  assert.ok(Math.hypot(f.vertices[2][0] - 2.1, f.vertices[2][1] - 2.55) < 0.015, JSON.stringify(f.vertices));
  assert.ok(Math.hypot(f.mids[2][0] - 0.1, f.mids[2][1] - 4.55) < 0.015, JSON.stringify(f.mids));
});

test('Volumenkörper mit gewölbter Decke', () => {
  const secs = C.sec.generateAlongAxis([[0, 0], [10, 0]], { count: 2 });
  secs.forEach(s => {
    const P = vault();
    P.components = [{ name: 'Gewölbe', type: 'ceiling', start: 2, end: 3, thickness: 0.3, flip: false },
      { name: 'Wand rechts', type: 'wall', start: 1, end: 2, thickness: 0.3, flip: false }];
    s.profiles = [P];
  });
  const { solids, warnings } = C.model.buildSolids({ sections: secs, columns: [] });
  assert.equal(warnings.length, 0, warnings.join());
  const g = solids.find(x => x.baseName === 'Gewölbe');
  // Halbring r 2..2.3: π/2 (2.3² - 2²) = 2.026 m² × 10 m (Polygon-Näherung etwas kleiner)
  assert.ok(g.volume > 19.5 && g.volume < 20.4, 'Volumen ' + g.volume);
  const ifc = C.exp.buildIfc({ sections: secs, columns: [], offset: [0, 0, 0] });
  assert.ok(ifc.text.includes('Gew\\X2\\00F6\\X0\\lbe'));
});

test('Ebenen übernehmen lässt Bögen unverändert', () => {
  const s = C.sec.generateAlongAxis([[0, 0], [10, 0]], { count: 3 })[1];
  const floor = []; for (let i = 0; i < 2000; i++) floor.push([Math.random() * 10, -2 + Math.random() * 4, 0.01]);
  const pl = C.planes.fitPlane(floor, { tol: 0.005 });
  const P = vault();
  const r = C.planes.applyToProfile(P, C.planes.sectionLines([pl], s), { maxDist: 0.1 });
  assert.equal(r.applied.length, 1);
  assert.ok(Math.abs(r.vertices[0][1] - 0.01) < 1e-6 && Math.abs(r.vertices[2][1] - 2.5) < 1e-12);
});
