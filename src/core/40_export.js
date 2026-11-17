/* ═══ Cloud2BIM Kern: Export IFC4 (STEP), DXF (R12, 3D-Polylinien), OBJ ═══ */
C2B.exp = (() => {
  const B64 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$';

  function randomBytes(n) {
    const b = new Uint8Array(n);
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(b);
    else for (let i = 0; i < n; i++) b[i] = Math.floor(Math.random() * 256);
    return b;
  }

  /** IFC-GlobalId: 128 Bit, 22 Zeichen (IFC-Base64). */
  function ifcGuid() {
    const b = randomBytes(16);
    b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
    const num = [b[0]];
    for (let i = 1; i < 16; i += 3) num.push((b[i] << 16) | (b[i + 1] << 8) | b[i + 2]);
    let s = '';
    num.forEach((v, i) => {
      const len = i === 0 ? 2 : 4;
      let t = '';
      for (let k = 0; k < len; k++) { t = B64[v & 63] + t; v = Math.floor(v / 64); }
      s += t;
    });
    return s;
  }

  /** STEP-Zeichenkette (ISO 10303-21, Nicht-ASCII als \X2\...\X0\). */
  function str(s) {
    if (s === null || s === undefined) return '$';
    let out = '';
    for (const ch of String(s)) {
      const c = ch.codePointAt(0);
      if (ch === "'") out += "''";
      else if (ch === '\\') out += '\\\\';
      else if (c >= 32 && c < 127) out += ch;
      else if (c < 0x10000) out += '\\X2\\' + c.toString(16).toUpperCase().padStart(4, '0') + '\\X0\\';
      else out += '\\X4\\' + c.toString(16).toUpperCase().padStart(8, '0') + '\\X0\\';
    }
    return "'" + out + "'";
  }

  function real(x, dec = 6) {
    if (!isFinite(x)) x = 0;
    let s = (+x.toFixed(dec)).toString();
    if (s.includes('e')) { const [m, e] = s.split('e'); s = (m.includes('.') ? m : m + '.') + 'E' + e; }
    else if (!s.includes('.')) s += '.';
    return s === '-0.' ? '0.' : s;
  }

  class StepWriter {
    constructor() { this.lines = []; this.n = 0; }
    add(entity) { this.n++; this.lines.push('#' + this.n + '=' + entity + ';'); return '#' + this.n; }
  }

  const TYPE_IFC = {
    floor: { cls: 'IFCSLAB', pre: '.BASESLAB.', label: 'Bodenplatte', color: [0.62, 0.62, 0.60] },
    wall: { cls: 'IFCWALL', pre: '.SOLIDWALL.', label: 'Wand', color: [0.80, 0.78, 0.74] },
    ceiling: { cls: 'IFCSLAB', pre: '.FLOOR.', label: 'Decke', color: [0.70, 0.72, 0.78] },
    column: { cls: 'IFCCOLUMN', pre: '.COLUMN.', label: 'Stütze', color: [0.84, 0.0, 0.21] },
    transition: { cls: 'IFCWALL', pre: '.SOLIDWALL.', label: 'Übergangswand', color: [0.37, 0.49, 0.54] },
  };

  /**
   * IFC4-Datei erzeugen.
   * opts: { projectName, siteName, buildingName, storeyName, crsName, material, split, fileName }
   */
  function buildIfc(project, opts = {}) {
    const o = Object.assign({ projectName: 'Cloud2BIM', siteName: 'Gelände', buildingName: 'Bauwerk',
      storeyName: 'Bauwerk', crsName: 'EPSG:2056', material: 'Beton', split: 'durchgehend', fileName: 'cloud2bim.ifc',
      version: '1.0.0' }, opts);
    const w = new StepWriter();
    const off = project.offset || [0, 0, 0];
    const P3 = (x, y, z) => w.add(`IFCCARTESIANPOINT((${real(x)},${real(y)},${real(z)}))`);
    const D3 = (x, y, z) => w.add(`IFCDIRECTION((${real(x)},${real(y)},${real(z)}))`);
    const origin = P3(0, 0, 0);
    const ax3 = (pt, z, x) => w.add(`IFCAXIS2PLACEMENT3D(${pt},${z || '$'},${x || '$'})`);
    const worldAx = ax3(origin, null, null);

    // Einheiten
    const uLen = w.add(`IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.)`);
    const uArea = w.add(`IFCSIUNIT(*,.AREAUNIT.,$,.SQUARE_METRE.)`);
    const uVol = w.add(`IFCSIUNIT(*,.VOLUMEUNIT.,$,.CUBIC_METRE.)`);
    const uAng = w.add(`IFCSIUNIT(*,.PLANEANGLEUNIT.,$,.RADIAN.)`);
    const units = w.add(`IFCUNITASSIGNMENT((${uLen},${uArea},${uVol},${uAng}))`);

    const trueNorth = w.add(`IFCDIRECTION((0.,1.))`);
    const ctx = w.add(`IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-05,${worldAx},${trueNorth})`);
    const body = w.add(`IFCGEOMETRICREPRESENTATIONSUBCONTEXT('Body','Model',*,*,*,*,${ctx},$,.MODEL_VIEW.,$)`);
    const proj = w.add(`IFCPROJECT('${ifcGuid()}',$,${str(o.projectName)},${str('Erzeugt mit Cloud2BIM aus Punktwolke')},$,$,$,(${ctx}),${units})`);

    // Georeferenzierung: lokale Koordinaten + Offset (IfcMapConversion)
    if (o.crsName) {
      const crs = w.add(`IFCPROJECTEDCRS(${str(o.crsName)},$,$,$,$,$,$)`);
      w.add(`IFCMAPCONVERSION(${ctx},${crs},${real(off[0], 4)},${real(off[1], 4)},${real(off[2], 4)},1.,0.,1.)`);
    }

    const sitePl = w.add(`IFCLOCALPLACEMENT($,${ax3(origin)})`);
    const site = w.add(`IFCSITE('${ifcGuid()}',$,${str(o.siteName)},$,$,${sitePl},$,$,.ELEMENT.,$,$,$,$,$)`);
    const bldPl = w.add(`IFCLOCALPLACEMENT(${sitePl},${ax3(origin)})`);
    const bld = w.add(`IFCBUILDING('${ifcGuid()}',$,${str(o.buildingName)},$,$,${bldPl},$,$,.ELEMENT.,$,$,$)`);
    const stPl = w.add(`IFCLOCALPLACEMENT(${bldPl},${ax3(origin)})`);
    const storey = w.add(`IFCBUILDINGSTOREY('${ifcGuid()}',$,${str(o.storeyName)},$,$,${stPl},$,$,.ELEMENT.,0.)`);
    w.add(`IFCRELAGGREGATES('${ifcGuid()}',$,$,$,${proj},(${site}))`);
    w.add(`IFCRELAGGREGATES('${ifcGuid()}',$,$,$,${site},(${bld}))`);
    w.add(`IFCRELAGGREGATES('${ifcGuid()}',$,$,$,${bld},(${storey}))`);

    const styles = {};
    const styleFor = type => {
      if (styles[type]) return styles[type];
      const c = TYPE_IFC[type].color;
      const col = w.add(`IFCCOLOURRGB($,${real(c[0], 3)},${real(c[1], 3)},${real(c[2], 3)})`);
      const sh = w.add(`IFCSURFACESTYLESHADING(${col},0.)`);
      return (styles[type] = w.add(`IFCSURFACESTYLE(${str(TYPE_IFC[type].label)},.BOTH.,(${sh}))`));
    };
    const material = o.material ? w.add(`IFCMATERIAL(${str(o.material)},$,$)`) : null;

    const elements = [], byMaterial = [];
    const report = { count: {}, volume: 0 };
    const props = (el, list) => {
      const ps = list.map(([n, t, v]) => {
        const val = t === 'L' ? `IFCLENGTHMEASURE(${real(v, 4)})` : t === 'V' ? `IFCVOLUMEMEASURE(${real(v, 4)})`
          : t === 'R' ? `IFCREAL(${real(v, 4)})` : `IFCLABEL(${str(v)})`;
        return w.add(`IFCPROPERTYSINGLEVALUE(${str(n)},$,${val},$)`);
      });
      const pset = w.add(`IFCPROPERTYSET('${ifcGuid()}',$,'Pset_Cloud2BIM',$,(${ps.join(',')}))`);
      w.add(`IFCRELDEFINESBYPROPERTIES('${ifcGuid()}',$,$,$,(${el}),${pset})`);
    };

    const { solids, warnings } = C2B.model.buildSolids(project, { split: o.split });
    for (const so of solids) {
      const t = TYPE_IFC[so.type] || TYPE_IFC.wall;
      const coords = so.verts.map(p => `(${real(p[0], 5)},${real(p[1], 5)},${real(p[2], 5)})`).join(',');
      const pl = w.add(`IFCCARTESIANPOINTLIST3D((${coords}))`);
      const idx = so.faces.map(f => `(${f[0] + 1},${f[1] + 1},${f[2] + 1})`).join(',');
      const fs = w.add(`IFCTRIANGULATEDFACESET(${pl},$,.T.,(${idx}),$)`);
      w.add(`IFCSTYLEDITEM(${fs},(${styleFor(so.type)}),$)`);
      const rep = w.add(`IFCSHAPEREPRESENTATION(${body},'Body','Tessellation',(${fs}))`);
      const pds = w.add(`IFCPRODUCTDEFINITIONSHAPE($,$,(${rep}))`);
      const elPl = w.add(`IFCLOCALPLACEMENT(${stPl},${ax3(origin)})`);
      const el = w.add(`${t.cls}('${ifcGuid()}',$,${str(so.name)},$,${str(t.label)},${elPl},${pds},$,${t.pre})`);
      elements.push(el); byMaterial.push(el);
      const tmin = Math.min(...so.thickness), tmax = Math.max(...so.thickness);
      if (so.type === 'transition') props(el, [['Bauteiltyp', 'S', t.label], ['Tiefe', 'L', so.thickness[0]],
        ['Station_von', 'L', so.stations[0]], ['Station_bis', 'L', so.stations[1]], ['Volumen', 'V', so.volume], ['Quelle', 'S', 'Punktwolke (Cloud2BIM), Übergangsquerschnitt']]);
      else props(el, [['Bauteiltyp', 'S', t.label], ['Dicke_min', 'L', tmin], ['Dicke_max', 'L', tmax],
        ['Station_von', 'L', so.stations[0]], ['Station_bis', 'L', so.stations[1]], ['Volumen', 'V', so.volume],
        ['Quelle', 'S', 'Punktwolke (Cloud2BIM)']]);
      report.count[t.label] = (report.count[t.label] || 0) + 1;
      report.volume += so.volume;
    }

    for (const c of project.columns || []) {
      const t = TYPE_IFC.column;
      const p2 = w.add(`IFCCARTESIANPOINT((0.,0.))`);
      const a2 = w.add(`IFCAXIS2PLACEMENT2D(${p2},$)`);
      const prof = c.shape === 'circle'
        ? w.add(`IFCCIRCLEPROFILEDEF(.AREA.,${str('D' + Math.round(c.d * 1000))},${a2},${real(c.d / 2, 5)})`)
        : w.add(`IFCRECTANGLEPROFILEDEF(.AREA.,${str(Math.round(c.b * 1000) + 'x' + Math.round(c.h * 1000))},${a2},${real(c.b, 5)},${real(c.h, 5)})`);
      const H = c.zTop - c.zBottom;
      const solid = w.add(`IFCEXTRUDEDAREASOLID(${prof},${ax3(origin)},${D3(0, 0, 1)},${real(H, 5)})`);
      w.add(`IFCSTYLEDITEM(${solid},(${styleFor('column')}),$)`);
      const rep = w.add(`IFCSHAPEREPRESENTATION(${body},'Body','SweptSolid',(${solid}))`);
      const pds = w.add(`IFCPRODUCTDEFINITIONSHAPE($,$,(${rep}))`);
      const r = (c.rot || 0) * Math.PI / 180;
      const elPl = w.add(`IFCLOCALPLACEMENT(${stPl},${ax3(P3(c.x, c.y, c.zBottom), D3(0, 0, 1), D3(Math.cos(r), Math.sin(r), 0))})`);
      const el = w.add(`${t.cls}('${ifcGuid()}',$,${str(c.name)},$,${str(t.label)},${elPl},${pds},$,${t.pre})`);
      elements.push(el); byMaterial.push(el);
      const vol = c.shape === 'circle' ? Math.PI * c.d * c.d / 4 * H : c.b * c.h * H;
      props(el, [['Bauteiltyp', 'S', t.label], ['Querschnitt', 'S', c.shape === 'circle' ? `Ø ${c.d.toFixed(3)} m` : `${c.b.toFixed(3)} × ${c.h.toFixed(3)} m`],
        ['Hoehe', 'L', H], ['Volumen', 'V', vol], ['Quelle', 'S', 'Punktwolke (Cloud2BIM)']]);
      report.count[t.label] = (report.count[t.label] || 0) + 1;
      report.volume += vol;
    }

    if (elements.length) w.add(`IFCRELCONTAINEDINSPATIALSTRUCTURE('${ifcGuid()}',$,$,$,(${elements.join(',')}),${storey})`);
    if (material && byMaterial.length) w.add(`IFCRELASSOCIATESMATERIAL('${ifcGuid()}',$,$,$,(${byMaterial.join(',')}),${material})`);

    const now = new Date().toISOString().slice(0, 19);
    const header = ['ISO-10303-21;', 'HEADER;',
      `FILE_DESCRIPTION(('ViewDefinition [ReferenceView_V1.2]'),'2;1');`,
      `FILE_NAME(${str(o.fileName)},'${now}',(''),(''),'Cloud2BIM ${o.version}','Cloud2BIM ${o.version} (B+S AG)','');`,
      `FILE_SCHEMA(('IFC4'));`, 'ENDSEC;', 'DATA;'];
    const text = header.concat(w.lines, ['ENDSEC;', 'END-ISO-10303-21;']).join('\n') + '\n';
    return { text, warnings, report };
  }

  // ─────────────────────────────────────────────── DXF R12
  function buildDxf(lines, offset = [0, 0, 0]) {
    const out = ['0', 'SECTION', '2', 'HEADER', '9', '$ACADVER', '1', 'AC1009', '9', '$INSUNITS', '70', '6', '0', 'ENDSEC'];
    const layers = [...new Set(lines.map(l => l.layer))];
    const colors = { C2B_Profile: 1, C2B_Laengskanten: 5, C2B_Zwischenprofile: 8, C2B_Bauteile_Aussen: 3, C2B_Bauteile_Laengs: 4, C2B_Uebergang: 6, C2B_Uebergang_Anschluss: 1 };
    out.push('0', 'SECTION', '2', 'TABLES', '0', 'TABLE', '2', 'LAYER', '70', String(layers.length));
    layers.forEach(l => out.push('0', 'LAYER', '2', l, '70', '0', '62', String(colors[l] || 7), '6', 'CONTINUOUS'));
    out.push('0', 'ENDTAB', '0', 'ENDSEC', '0', 'SECTION', '2', 'ENTITIES');
    const f = x => (+x.toFixed(4)).toString();
    for (const l of lines) {
      const P = l.pts.map(p => [p[0] + offset[0], p[1] + offset[1], p[2] + offset[2]]);
      if (P.length === 2 && !l.closed) {
        out.push('0', 'LINE', '8', l.layer, '10', f(P[0][0]), '20', f(P[0][1]), '30', f(P[0][2]), '11', f(P[1][0]), '21', f(P[1][1]), '31', f(P[1][2]));
      } else {
        out.push('0', 'POLYLINE', '8', l.layer, '66', '1', '10', '0', '20', '0', '30', '0', '70', String(8 + (l.closed ? 1 : 0)));
        P.forEach(p => out.push('0', 'VERTEX', '8', l.layer, '10', f(p[0]), '20', f(p[1]), '30', f(p[2]), '70', '32'));
        out.push('0', 'SEQEND', '8', l.layer);
      }
    }
    out.push('0', 'ENDSEC', '0', 'EOF');
    return out.join('\r\n') + '\r\n';
  }

  // ─────────────────────────────────────────────── OBJ
  function buildObj(wire, offset = [0, 0, 0], { lines = true, faces = true } = {}) {
    const out = ['# Cloud2BIM Drahtmodell', `# Koordinaten global (Offset ${offset.join(', ')})`];
    const f = x => (+x.toFixed(4)).toString();
    let n = 0;
    const v = p => { out.push(`v ${f(p[0] + offset[0])} ${f(p[1] + offset[1])} ${f(p[2] + offset[2])}`); return ++n; };
    if (lines) {
      const byLayer = {};
      wire.lines.forEach(l => (byLayer[l.layer] = byLayer[l.layer] || []).push(l));
      for (const [layer, ls] of Object.entries(byLayer)) {
        out.push('g ' + layer);
        ls.forEach(l => {
          const ids = l.pts.map(v);
          if (l.closed) ids.push(ids[0]);
          out.push('l ' + ids.join(' '));
        });
      }
    }
    if (faces && wire.mesh.quads.length) {
      out.push('g C2B_Innenflaeche');
      const base = n;
      wire.mesh.verts.forEach(v);
      wire.mesh.quads.forEach(q => out.push('f ' + q.map(i => i + 1 + base).join(' ')));
    }
    return out.join('\n') + '\n';
  }

  /** Volumenkörper als OBJ (zur Kontrolle in beliebigen Viewern). */
  function solidsToObj(solids, offset = [0, 0, 0]) {
    const out = ['# Cloud2BIM Volumenkörper'];
    const f = x => (+x.toFixed(4)).toString();
    let base = 0;
    solids.forEach(s => {
      out.push('o ' + s.name.replace(/\s+/g, '_'));
      s.verts.forEach(p => out.push(`v ${f(p[0] + offset[0])} ${f(p[1] + offset[1])} ${f(p[2] + offset[2])}`));
      s.faces.forEach(t => out.push(`f ${t[0] + 1 + base} ${t[1] + 1 + base} ${t[2] + 1 + base}`));
      base += s.verts.length;
    });
    return out.join('\n') + '\n';
  }

  return { ifcGuid, buildIfc, buildDxf, buildObj, solidsToObj, str, real, TYPE_IFC };
})();
