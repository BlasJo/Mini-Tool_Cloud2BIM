import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadCore } from './load.mjs';
import { culvertProfile } from './synth.mjs';
const C = loadCore();

function demoProject() {
  const secs = C.sec.generateAlongAxis([[10, 20], [30, 20]], { count: 3 });
  secs.forEach((s, i) => {
    s.profile = { vertices: culvertProfile(), closed: true };
    s.components = C.sec.suggestComponents(s.profile.vertices, true, { floor: 0.4, wall: 0.3, ceiling: 0.35 });
  });
  // mittlerer Querschnitt: Wandstärke offen -> interpoliert; Ende: Wand 0.5
  secs[1].components.forEach(c => { if (c.type === 'wall') c.thickness = null; });
  secs[2].components.forEach(c => { if (c.type === 'wall') c.thickness = 0.5; });
  return { offset: [2600000, 1200000, 0], sections: secs,
    columns: [{ name: 'Stütze 1', x: 20, y: 20, zBottom: 500, zTop: 503, shape: 'rect', b: 0.3, h: 0.4, rot: 30 },
              { name: 'Stütze 2', x: 22, y: 20, zBottom: 500, zTop: 503, shape: 'circle', d: 0.4 }] };
}

test('Stärken-Interpolation', () => {
  const p = demoProject();
  const T = C.model.resolveThicknesses(p.sections);
  const mid = T.get(p.sections[1].id)['Wand links'];
  assert.ok(Math.abs(mid.t - 0.4) < 1e-9 && mid.interpolated);
});

test('Volumenkörper: geschlossen, Volumen plausibel', () => {
  const p = demoProject();
  const { solids, warnings } = C.model.buildSolids(p);
  assert.equal(warnings.length, 0, warnings.join('\n'));
  assert.equal(solids.length, 4);
  const floor = solids.find(s => s.type === 'floor');
  // Bodenplatte: Breite innen 4 m + Gehrungsanteile Wände, Dicke 0.4, Länge 20 m
  // Gehrung: Aussenkante von -2.3..+2.3 bis -2.5..2.5 (Wand 0.3..0.5) -> Trapez
  assert.ok(floor.volume > 4 * 0.4 * 20 && floor.volume < 5.2 * 0.4 * 20, 'Volumen ' + floor.volume);
  // jede Kante gehört zu genau zwei Dreiecken (wasserdicht)
  for (const s of solids) {
    const cnt = new Map();
    s.faces.forEach(f => [[f[0], f[1]], [f[1], f[2]], [f[2], f[0]]].forEach(([a, b]) => {
      const k = a < b ? a + '_' + b : b + '_' + a; cnt.set(k, (cnt.get(k) || 0) + 1); }));
    assert.ok([...cnt.values()].every(v => v === 2), s.name + ' nicht geschlossen');
  }
  // Summe der Bauteilquerschnitte ohne Lücke: Gesamtfläche aussen - innen
  const T = C.model.resolveThicknesses(p.sections);
  const rings = C.model.sectionRings(p.sections[0], T.get(p.sections[0].id));
  let area = 0;
  for (const r of Object.values(rings)) area += Math.abs(C.g2.signedArea(r.inner.concat(r.outer.slice().reverse())));
  const innerA = Math.abs(C.g2.signedArea(culvertProfile()));
  assert.ok(area > 0 && area < 4.6 * 3.75 - innerA + 0.2, 'Fläche ' + area);
});

test('IFC-Export schreiben', () => {
  const p = demoProject();
  const { text, report } = C.exp.buildIfc(p, { projectName: 'Test Durchlass äöü' });
  assert.ok(text.startsWith('ISO-10303-21;'));
  assert.equal(report.count['Stütze'], 2);
  fs.mkdirSync(new URL('./out/', import.meta.url), { recursive: true });
  fs.writeFileSync(new URL('./out/test.ifc', import.meta.url), text);
});

test('Drahtmodell + DXF/OBJ', () => {
  const p = demoProject();
  p.sections[2].profile.vertices = p.sections[2].profile.vertices.slice(2).concat(p.sections[2].profile.vertices.slice(0, 2)); // andere Startecke
  const wf = C.model.buildWireframe(p, { intermediate: 2 });
  const long = wf.lines.filter(l => l.layer === 'C2B_Laengskanten');
  assert.equal(long.length, 12);
  // Längskanten müssen parallel zur Achse (x) laufen, trotz verdrehter Startecke
  long.forEach(l => assert.ok(Math.abs(l.pts[0][1] - l.pts[1][1]) < 1e-9 && Math.abs(l.pts[0][2] - l.pts[1][2]) < 1e-9));
  assert.equal(wf.lines.filter(l => l.layer === 'C2B_Zwischenprofile').length, 4);
  const dxf = C.exp.buildDxf(wf.lines, p.offset);
  assert.ok(dxf.includes('AC1009') && dxf.includes('C2B_Laengskanten') && dxf.trim().endsWith('EOF'));
  const obj = C.exp.buildObj(wf, p.offset);
  assert.ok(/\nf \d+ \d+ \d+ \d+/.test(obj));
  fs.writeFileSync(new URL('./out/test.dxf', import.meta.url), dxf);
});

test('Stütze einpassen: Quadrat 40x40 gedreht und Kreis Ø 50', () => {
  const pts = [];
  const add = (x, y) => { for (let z = 0; z <= 3; z += 0.05) pts.push(x, y, 500 + z); };
  const r = 0.2, a = 20 * Math.PI / 180;
  for (let t = -r; t <= r; t += 0.01) for (const [u, v] of [[t, -r], [t, r], [-r, t], [r, t]])
    add(10 + u * Math.cos(a) - v * Math.sin(a), 5 + u * Math.sin(a) + v * Math.cos(a));
  for (let k = 0; k < 120; k++) { const w = 2 * Math.PI * k / 120; add(14 + 0.25 * Math.cos(w), 5 + 0.25 * Math.sin(w)); }
  const cloud = { n: pts.length / 3, xyz: Float32Array.from(pts), rgb: null, offset: [0, 0, 0] };
  const f = C.model.fitColumn(cloud, 10.05, 5.02, 501.5, { radius: 0.6, dz: 0.3 });
  assert.equal(f.shape, 'rect');
  assert.ok(Math.abs(f.rect.b - 0.4) < 0.02 && Math.abs(f.rect.h - 0.4) < 0.02, JSON.stringify(f.rect));
  assert.ok(Math.abs(((f.rect.rot % 90) + 90) % 90 - 20) < 1.5, 'rot ' + f.rect.rot);
  assert.ok(Math.hypot(f.rect.x - 10, f.rect.y - 5) < 0.01);
  const g = C.model.fitColumn(cloud, 14.1, 5, 501.5, { radius: 0.6, dz: 0.3 });
  assert.equal(g.shape, 'circle');
  assert.ok(Math.abs(g.circle.d - 0.5) < 0.01 && Math.hypot(g.circle.x - 14, g.circle.y - 5) < 0.01);
});

test('Zwei Röhren: Volumenkörper und Drahtmodell je Röhre', () => {
  const secs = C.sec.generateAlongAxis([[0, 0], [20, 0]], { count: 3 });
  secs.forEach(s => {
    s.profiles = [-4.2, 4.2].map((du, k) => {
      const V = culvertProfile().map(([u, v]) => [u + du, v]);
      const comps = C.sec.suggestComponents(V, true);
      comps.forEach(c => { c.name = `Röhre ${k + 1} · ${c.name}`; });
      return { vertices: V, closed: true, components: comps };
    });
  });
  const p = { offset: [0, 0, 0], sections: secs, columns: [] };
  const { solids, warnings } = C.model.buildSolids(p);
  assert.equal(warnings.length, 0, warnings.join());
  assert.equal(solids.length, 8);
  const wf = C.model.buildWireframe(p, {});
  const long = wf.lines.filter(l => l.layer === 'C2B_Laengskanten');
  assert.equal(long.length, 2 * 2 * 6);
  long.forEach(l => assert.ok(Math.abs(l.pts[0][1] - l.pts[1][1]) < 1e-9, 'Längskante verbindet verschiedene Röhren'));
  const ir = C.model.interpolatedRings(solids, 2);
  assert.equal(ir.length, 8 * 2 * 2);
});
