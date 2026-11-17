import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadCore } from './load.mjs';
const C = loadCore();

const rect = (u0, u1, v0, v1) => [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
function junction() {
  // Achse entlang X. Links (Station 0, 5): zwei Röhren 4 x 3 m; rechts (Station 9, 14): eine Röhre 10 x 4 m.
  // Übergang bei Station 8, Tiefe 0.5 (mittig) -> Volumen 7.75 .. 8.25
  const axis = [[0, 0], [20, 0]];
  const mk = st => C.sec.generateAlongAxis(axis, { count: 1 })[0] && Object.assign(C.sec.newSection([st, 0], 0, st, 0.05, 'QS ' + st), {});
  const secs = [];
  [0, 5].forEach(st => {
    const s = mk(st);
    s.profiles = [-2.6, 2.6].map((du, k) => { const V = rect(du - 2, du + 2, 500, 503); const comps = C.sec.suggestComponents(V, true, { floor: 0.3, wall: 0.3, ceiling: 0.3 });
      comps.forEach(c => { c.name = `Röhre ${k + 1} · ${c.name}`; }); return { vertices: V, closed: true, components: comps }; });
    secs.push(s);
  });
  [9, 14].forEach(st => {
    const s = mk(st);
    const V = rect(-5, 5, 500, 504);
    s.profiles = [{ vertices: V, closed: true, components: C.sec.suggestComponents(V, true, { floor: 0.4, wall: 0.4, ceiling: 0.4 }) }];
    secs.push(s);
  });
  const T = C.trans.newTransition([8, 0], 0, 8, { depth: 0.5, align: 'center', name: 'Stirnwand' });
  secs.push(T);
  return { project: { sections: secs, columns: [], offset: [0, 0, 0] }, T };
}

test('Übergang: Fläche vorschlagen (grosse Röhre minus zwei Öffnungen)', () => {
  const { project, T } = junction();
  const nb = C.trans.neighbors(project.sections, T);
  assert.equal(nb.left.station, 5); assert.equal(nb.right.station, 9);
  T.profiles = C.trans.suggestArea(project.sections, T);
  assert.equal(T.profiles.filter(p => p.role === 'outer').length, 1);
  assert.equal(T.profiles.filter(p => p.role === 'hole').length, 2);
  assert.ok(Math.abs(C.trans.areaOf(T) - (40 - 2 * 12)) < 1e-9, 'Fläche ' + C.trans.areaOf(T));
});

test('Übergang: Prisma und Verschnitt der Interpolation', () => {
  const { project, T } = junction();
  T.profiles = C.trans.suggestArea(project.sections, T);
  const { solids, warnings } = C.model.buildSolids(project);
  assert.equal(warnings.length, 0, warnings.join('\n'));
  const tr = solids.find(s => s.type === 'transition');
  assert.ok(Math.abs(tr.volume - 16 * 0.5) < 1e-6, 'Volumen Übergang ' + tr.volume);
  // wasserdicht
  const cnt = new Map();
  tr.faces.forEach(f => [[f[0], f[1]], [f[1], f[2]], [f[2], f[0]]].forEach(([a, b]) => { const k = Math.min(a, b) + '_' + Math.max(a, b); cnt.set(k, (cnt.get(k) || 0) + 1); }));
  assert.ok([...cnt.values()].every(v => v === 2), 'Übergang nicht geschlossen');
  // linke Röhren enden an 7.75, rechte Röhre beginnt bei 8.25
  const left = solids.filter(s => s.baseName.startsWith('Röhre'));
  const right = solids.filter(s => !s.baseName.startsWith('Röhre') && s.type !== 'transition');
  assert.equal(left.length, 8); assert.equal(right.length, 4);
  left.forEach(s => { assert.ok(Math.abs(s.stations[1] - 7.75) < 1e-9, s.name + ' ' + s.stations); let mx = -1e9; s.verts.forEach(v => { mx = Math.max(mx, v[0]); }); assert.ok(Math.abs(mx - 7.75) < 1e-9); });
  right.forEach(s => { assert.ok(Math.abs(s.stations[0] - 8.25) < 1e-9, s.name + ' ' + s.stations); let mn = 1e9; s.verts.forEach(v => { mn = Math.min(mn, v[0]); }); assert.ok(Math.abs(mn - 8.25) < 1e-9); });
});

test('Normaler Querschnitt im Übergangsbereich wird auf die Stirnfläche gekürzt', () => {
  const { project, T } = junction();
  T.profiles = C.trans.suggestArea(project.sections, T);
  // Querschnitt 9 in den Übergang (8.1) verschieben
  const s9 = project.sections.find(s => s.station === 9);
  s9.station = 8.1; s9.origin = [8.1, 0];
  const { solids } = C.model.buildSolids(project);
  const right = solids.filter(s => !s.baseName.startsWith('Röhre') && s.type !== 'transition');
  right.forEach(s => { let mn = 1e9; s.verts.forEach(v => { mn = Math.min(mn, v[0]); }); assert.ok(Math.abs(mn - 8.25) < 1e-9, s.name + ' beginnt bei ' + mn); });
});

test('Drahtmodell, Abgleich und IFC mit Übergang', () => {
  const { project, T } = junction();
  T.profiles = C.trans.suggestArea(project.sections, T);
  const wf = C.model.buildWireframe(project, {});
  // keine Längskante über den Übergang
  wf.lines.filter(l => l.layer === 'C2B_Laengskanten').forEach(l => {
    const a = Math.min(l.pts[0][0], l.pts[1][0]), b = Math.max(l.pts[0][0], l.pts[1][0]);
    assert.ok(!(a < 7.75 - 1e-9 && b > 8.25 + 1e-9) && !(a < 8 && b > 8 && b - a > 0.6), 'Kante quer durch den Übergang ' + a + '..' + b);
  });
  assert.ok(wf.lines.some(l => l.layer === 'C2B_Uebergang'));
  assert.ok(wf.lines.filter(l => l.layer === 'C2B_Uebergang_Anschluss').length === 3);
  // Abgleich: Punkt auf der Stirnfläche (Station 7.75, zwischen den Röhren) hat Abstand 0
  const surf = C.dev.surfaceTriangles(project), idx = C.dev.buildIndex(surf, 0.1);
  const cloud = { n: 1, xyz: Float32Array.from([7.75, 0, 501.5]), offset: [0, 0, 0] };
  const d = C.dev.distances(idx, cloud, new Float32Array(1));
  assert.ok(d[0] < 1e-4, 'Abstand Stirnfläche ' + d[0]);
  const ifc = C.exp.buildIfc(project, {});
  assert.ok(ifc.text.includes("'Stirnwand'") && ifc.text.includes('Tiefe'));
  require_fs().writeFileSync(new URL('./out/uebergang.ifc', import.meta.url), ifc.text);
});
import fs from 'node:fs';
function require_fs() { return fs; }
