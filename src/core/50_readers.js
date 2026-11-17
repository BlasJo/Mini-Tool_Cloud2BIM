/* ═══ Cloud2BIM Kern: Einlesen von Punktwolken (im Browser, blockweise) ═══
   XYZ/TXT/CSV/PTS/ASC · PLY (ASCII/binär) · LAS 1.0–1.4 · LAZ (laz-perf) · E57 (ASTM E2807)
   Alle Leser füttern einen C2B.thin.Collector (Vorausdünnung beim Einlesen). */
C2B.read = (() => {
  const CHUNK = 16 * 1024 * 1024;
  const EXT = ['xyz', 'txt', 'csv', 'pts', 'asc', 'ply', 'las', 'laz', 'e57'];
  const tick = () => new Promise(r => setTimeout(r, 0));

  async function bytes(file, start, end) {
    return new Uint8Array(await file.slice(start, Math.min(end, file.size)).arrayBuffer());
  }

  function checkAbort(o) { if (o.signal && o.signal.aborted) throw new Error('Einlesen abgebrochen.'); }

  // ─────────────────────────────────────────────────────────── Text
  function splitTokens(line) {
    return line.trim().split(/[\s,;]+/).filter(Boolean);
  }
  function detectText(lines) {
    let skip = 0;
    for (const l of lines) {
      const t = splitTokens(l);
      if (t.length >= 3 && t.every(x => isFinite(+x))) return { skip, ncol: t.length };
      skip++;
    }
    throw new Error('Textformat nicht erkannt: erwartet werden mindestens 3 Zahlenspalten (X Y Z).');
  }

  async function readText(file, col, o) {
    const dec = new TextDecoder('utf-8');
    let rest = '', lineNo = 0, layout = null, rgbCols = null;
    const sample = [];
    for (let pos = 0; pos < file.size; pos += CHUNK) {
      checkAbort(o);
      const txt = rest + dec.decode(await bytes(file, pos, pos + CHUNK), { stream: pos + CHUNK < file.size });
      const lines = txt.split(/\r?\n/);
      rest = pos + CHUNK < file.size ? lines.pop() : '';
      if (!layout) {
        layout = detectText(lines.slice(0, 60));
        // Farben: letzte drei Spalten bei >= 6 Spalten, wenn ganzzahlig 0..255 (bzw. 0..65535)
        if (layout.ncol >= 6) {
          let ok = true, mx = 0;
          for (const l of lines.slice(layout.skip, layout.skip + 2000)) {
            const t = splitTokens(l);
            if (t.length < layout.ncol) continue;
            for (const v of t.slice(t.length - 3)) { const x = +v; if (!(x >= 0 && x <= 65535 && Number.isInteger(x))) ok = false; mx = Math.max(mx, x); }
          }
          if (ok) rgbCols = { off: layout.ncol - 3, scale: mx > 255 ? 255 / 65535 : 1 };
        }
        col.setColor(!!rgbCols);
      }
      for (const l of lines) {
        lineNo++;
        if (lineNo <= layout.skip) continue;
        if (!l || l[0] === '#' || l[0] === '/') continue;
        const t = splitTokens(l);
        if (t.length < 3) continue;
        if (rgbCols && t.length >= layout.ncol) {
          const s = rgbCols.scale, k = rgbCols.off;
          col.add(+t[0], +t[1], +t[2], +t[k] * s, +t[k + 1] * s, +t[k + 2] * s);
        } else col.add(+t[0], +t[1], +t[2]);
      }
      o.onProgress && o.onProgress(Math.min(1, (pos + CHUNK) / file.size), col);
      await tick();
    }
  }

  // ─────────────────────────────────────────────────────────── PLY
  const PLY_T = { char: ['getInt8', 1], int8: ['getInt8', 1], uchar: ['getUint8', 1], uint8: ['getUint8', 1],
    short: ['getInt16', 2], int16: ['getInt16', 2], ushort: ['getUint16', 2], uint16: ['getUint16', 2],
    int: ['getInt32', 4], int32: ['getInt32', 4], uint: ['getUint32', 4], uint32: ['getUint32', 4],
    float: ['getFloat32', 4], float32: ['getFloat32', 4], double: ['getFloat64', 8], float64: ['getFloat64', 8] };

  async function readPly(file, col, o) {
    const head = new TextDecoder('latin1').decode(await bytes(file, 0, 65536));
    const endIdx = head.indexOf('end_header');
    if (!head.startsWith('ply') || endIdx < 0) throw new Error('Ungültige PLY-Datei.');
    let dataStart = endIdx + 'end_header'.length;
    if (head[dataStart] === '\r') dataStart++;
    if (head[dataStart] === '\n') dataStart++;
    const hl = head.slice(0, endIdx).split(/\r?\n/);
    let format = 'ascii', elements = [], cur = null;
    for (const l of hl) {
      const t = l.trim().split(/\s+/);
      if (t[0] === 'format') format = t[1];
      else if (t[0] === 'element') { cur = { name: t[1], count: +t[2], props: [] }; elements.push(cur); }
      else if (t[0] === 'property' && cur) {
        if (t[1] === 'list') cur.props.push({ list: true, ct: t[2], it: t[3], name: t[4] });
        else cur.props.push({ type: t[1], name: t[2] });
      }
    }
    const vi = elements.findIndex(e => e.name === 'vertex');
    if (vi < 0) throw new Error('PLY ohne Punkte (element vertex).');
    const vert = elements[vi];
    const names = vert.props.map(p => p.name);
    const ix = names.indexOf('x'), iy = names.indexOf('y'), iz = names.indexOf('z');
    let ir = names.indexOf('red'), ig = names.indexOf('green'), ib = names.indexOf('blue');
    if (ir < 0) { ir = names.indexOf('r'); ig = names.indexOf('g'); ib = names.indexOf('b'); }
    const hasCol = ir >= 0 && ig >= 0 && ib >= 0;
    col.setColor(hasCol);
    const cscale = hasCol && /short|16/.test(vert.props[ir].type) ? 255 / 65535 : 1;
    if (vert.props.some(p => p.list) || elements.slice(0, vi).some(e => e.count > 0 && format !== 'ascii' && e.props.some(p => p.list)))
      throw new Error('PLY mit Listen-Eigenschaften vor/in den Punkten wird nicht unterstützt.');
    if (format === 'ascii') {
      // vorausgehende Elemente überspringen (Zeilen)
      let skipLines = elements.slice(0, vi).reduce((s, e) => s + e.count, 0);
      let rest = '', done = 0;
      const dec = new TextDecoder('utf-8');
      for (let pos = dataStart; pos < file.size && done < vert.count; pos += CHUNK) {
        checkAbort(o);
        const txt = rest + dec.decode(await bytes(file, pos, pos + CHUNK), { stream: true });
        const lines = txt.split(/\r?\n/);
        rest = lines.pop();
        for (const l of lines) {
          if (skipLines > 0) { skipLines--; continue; }
          if (done >= vert.count) break;
          const t = l.trim().split(/\s+/);
          if (t.length < 3) continue;
          done++;
          if (hasCol) col.add(+t[ix], +t[iy], +t[iz], +t[ir] * cscale, +t[ig] * cscale, +t[ib] * cscale);
          else col.add(+t[ix], +t[iy], +t[iz]);
        }
        o.onProgress && o.onProgress(Math.min(1, done / vert.count), col);
        await tick();
      }
      return;
    }
    const le = format === 'binary_little_endian';
    let start = dataStart;
    for (const e of elements.slice(0, vi)) start += e.count * e.props.reduce((s, p) => s + PLY_T[p.type][1], 0);
    const offs = [];
    let stride = 0;
    vert.props.forEach(p => { offs.push(stride); stride += PLY_T[p.type][1]; });
    const rd = vert.props.map(p => PLY_T[p.type][0]);
    const per = Math.floor(CHUNK / stride);
    for (let i0 = 0; i0 < vert.count; i0 += per) {
      checkAbort(o);
      const n = Math.min(per, vert.count - i0);
      const buf = await bytes(file, start + i0 * stride, start + (i0 + n) * stride);
      const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
      for (let i = 0; i < n; i++) {
        const b = i * stride;
        const x = dv[rd[ix]](b + offs[ix], le), y = dv[rd[iy]](b + offs[iy], le), z = dv[rd[iz]](b + offs[iz], le);
        if (hasCol) col.add(x, y, z, dv[rd[ir]](b + offs[ir], le) * cscale, dv[rd[ig]](b + offs[ig], le) * cscale, dv[rd[ib]](b + offs[ib], le) * cscale);
        else col.add(x, y, z);
      }
      o.onProgress && o.onProgress(Math.min(1, (i0 + n) / vert.count), col);
      await tick();
    }
  }

  // ─────────────────────────────────────────────────────────── LAS / LAZ
  const LAS_RGB = { 2: 20, 3: 28, 5: 28, 7: 30, 8: 30, 10: 30 };

  function lasHeader(h) {
    const dv = new DataView(h.buffer, h.byteOffset, h.byteLength);
    const sig = String.fromCharCode(h[0], h[1], h[2], h[3]);
    if (sig !== 'LASF') throw new Error('Keine LAS/LAZ-Datei (Signatur fehlt).');
    const minor = h[25];
    const fmtRaw = h[104];
    const H = {
      minor, offsetToData: dv.getUint32(96, true), format: fmtRaw & 0x3f, compressed: (fmtRaw & 0xC0) !== 0,
      recLen: dv.getUint16(105, true), count: dv.getUint32(107, true),
      scale: [dv.getFloat64(131, true), dv.getFloat64(139, true), dv.getFloat64(147, true)],
      off: [dv.getFloat64(155, true), dv.getFloat64(163, true), dv.getFloat64(171, true)],
    };
    if (minor >= 4 && h.byteLength >= 255) {
      const big = Number(dv.getBigUint64(247, true));
      if (big > 0) H.count = big;
    }
    H.rgbOff = LAS_RGB[H.format];
    return H;
  }

  function lasColorScale(sampleMax) { return sampleMax > 255 ? 255 / 65535 : 1; }

  async function readLas(file, col, o) {
    const H = lasHeader(await bytes(file, 0, 375));
    if (H.compressed || /\.laz$/i.test(file.name)) return readLaz(file, col, o, H);
    const hasCol = H.rgbOff !== undefined;
    col.setColor(hasCol);
    const per = Math.floor(CHUNK / H.recLen);
    let cs = null;
    for (let i0 = 0; i0 < H.count; i0 += per) {
      checkAbort(o);
      const n = Math.min(per, H.count - i0);
      const buf = await bytes(file, H.offsetToData + i0 * H.recLen, H.offsetToData + (i0 + n) * H.recLen);
      const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
      const m = Math.floor(buf.byteLength / H.recLen);
      if (hasCol && cs === null) {
        let mx = 0;
        for (let i = 0; i < Math.min(m, 5000); i++) mx = Math.max(mx, dv.getUint16(i * H.recLen + H.rgbOff, true), dv.getUint16(i * H.recLen + H.rgbOff + 2, true), dv.getUint16(i * H.recLen + H.rgbOff + 4, true));
        cs = lasColorScale(mx);
      }
      for (let i = 0; i < m; i++) {
        const b = i * H.recLen;
        const x = dv.getInt32(b, true) * H.scale[0] + H.off[0];
        const y = dv.getInt32(b + 4, true) * H.scale[1] + H.off[1];
        const z = dv.getInt32(b + 8, true) * H.scale[2] + H.off[2];
        if (hasCol) col.add(x, y, z, dv.getUint16(b + H.rgbOff, true) * cs, dv.getUint16(b + H.rgbOff + 2, true) * cs, dv.getUint16(b + H.rgbOff + 4, true) * cs);
        else col.add(x, y, z);
      }
      o.onProgress && o.onProgress(Math.min(1, (i0 + n) / H.count), col);
      await tick();
    }
  }

  let lazModule = null;
  async function getLazPerf(o) {
    if (lazModule) return lazModule;
    const factory = o.lazFactory || (typeof createLazPerf !== 'undefined' ? createLazPerf : null);
    const wasm = o.lazWasm || (C2B.read.lazWasmProvider ? C2B.read.lazWasmProvider() : null);
    if (!factory || !wasm) throw new Error('LAZ-Dekoder (laz-perf) nicht verfügbar.');
    lazModule = await factory({ wasmBinary: wasm, locateFile: f => f, print: () => {}, printErr: () => {} });
    return lazModule;
  }

  async function readLaz(file, col, o, H) {
    if (file.size > 1.8e9) throw new Error('LAZ-Dateien über 1.8 GB werden im Browser nicht unterstützt – bitte vorher teilen oder als LAS/E57 exportieren.');
    const M = await getLazPerf(o);
    const data = await bytes(file, 0, file.size);
    const ptr = M._malloc(data.byteLength);
    M.HEAPU8.set(data, ptr);
    const laz = new M.LASZip();
    let pt = 0;
    try {
      laz.open(ptr, data.byteLength);
      const n = laz.getCount(), len = laz.getPointLength(), fmt = laz.getPointFormat() & 0x3f;
      const rgbOff = LAS_RGB[fmt];
      const hasCol = rgbOff !== undefined;
      col.setColor(hasCol);
      pt = M._malloc(len);
      let cs = hasCol ? null : 1;
      const step = 200000;
      const sampleMax = [];
      for (let i = 0; i < n; i++) {
        laz.getPoint(pt);
        const dv = new DataView(M.HEAPU8.buffer, pt, len);
        const x = dv.getInt32(0, true) * H.scale[0] + H.off[0];
        const y = dv.getInt32(4, true) * H.scale[1] + H.off[1];
        const z = dv.getInt32(8, true) * H.scale[2] + H.off[2];
        if (hasCol) {
          const r = dv.getUint16(rgbOff, true), g = dv.getUint16(rgbOff + 2, true), b = dv.getUint16(rgbOff + 4, true);
          if (cs === null) { sampleMax.push(Math.max(r, g, b)); if (sampleMax.length >= 2000 || i === n - 1) cs = lasColorScale(Math.max(...sampleMax)); }
          const s = cs === null ? (Math.max(r, g, b) > 255 ? 255 / 65535 : 1) : cs;
          col.add(x, y, z, r * s, g * s, b * s);
        } else col.add(x, y, z);
        if (i % step === step - 1) { checkAbort(o); o.onProgress && o.onProgress(i / n, col); await tick(); }
      }
      o.onProgress && o.onProgress(1, col);
    } finally {
      if (pt) M._free(pt);
      laz.delete();
      M._free(ptr);
    }
  }

  // ─────────────────────────────────────────────────────────── E57
  /** Minimaler XML-Parser (Elemente, Attribute, Text) für den E57-XML-Teil. */
  function parseXml(s) {
    const root = { name: '#root', attrs: {}, children: [], text: '' };
    const stack = [root];
    const re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<(\/?)([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
    let m;
    const ent = t => t.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
    while ((m = re.exec(s))) {
      const top = stack[stack.length - 1];
      if (m[1] !== undefined) top.text += m[1];
      else if (m[3]) {
        if (m[2] === '/') { stack.pop(); continue; }
        const attrs = {};
        (m[4] || '').replace(/([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g, (_, k, __, a, b) => { attrs[k] = ent(a !== undefined ? a : b); });
        const el = { name: m[3], attrs, children: [], text: '' };
        top.children.push(el);
        if (m[5] !== '/') stack.push(el);
      } else if (m[6] !== undefined) top.text += ent(m[6]);
    }
    return root;
  }
  const child = (el, name) => el && el.children.find(c => c.name === name);
  const num = (el, def = 0) => (el && el.text.trim() !== '' ? +el.text.trim() : def);

  /** Liest logische Bytes (ohne die 4-Byte-CRC je 1024-Byte-Seite). */
  class E57Reader {
    constructor(file, pageSize = 1024) { this.file = file; this.ps = pageSize; this.ls = pageSize - 4; }
    physToLog(p) { return Math.floor(p / this.ps) * this.ls + (p % this.ps); }
    logToPhys(l) { return Math.floor(l / this.ls) * this.ps + (l % this.ls); }
    async read(logStart, len) {
      const out = new Uint8Array(len);
      const p0 = this.logToPhys(logStart), p1 = this.logToPhys(logStart + len - 1) + 1;
      const raw = await bytes(this.file, p0, p1);
      let o = 0, l = logStart;
      while (o < len) {
        const inPage = l % this.ls;
        const take = Math.min(this.ls - inPage, len - o);
        const p = this.logToPhys(l) - p0;
        out.set(raw.subarray(p, p + take), o);
        o += take; l += take;
      }
      return out;
    }
  }

  /** Dekodierer je Feld (Float / Integer / ScaledInteger mit Bitpacking). */
  function makeFieldDecoder(proto) {
    const t = proto.attrs.type;
    if (t === 'Float') {
      const dbl = (proto.attrs.precision || 'double') !== 'single';
      const size = dbl ? 8 : 4;
      let pend = new Uint8Array(0);
      return {
        push(buf, out) {
          let b = buf;
          if (pend.length) { b = new Uint8Array(pend.length + buf.length); b.set(pend); b.set(buf, pend.length); }
          const n = Math.floor(b.length / size);
          const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
          for (let i = 0; i < n; i++) out.push(dbl ? dv.getFloat64(i * size, true) : dv.getFloat32(i * size, true));
          pend = b.slice(n * size);
        },
      };
    }
    const min = +(proto.attrs.minimum !== undefined ? proto.attrs.minimum : (t === 'Integer' ? -(2 ** 63) : 0));
    const max = +(proto.attrs.maximum !== undefined ? proto.attrs.maximum : 2 ** 63 - 1);
    const scale = t === 'ScaledInteger' ? +(proto.attrs.scale || 1) : 1;
    const off = t === 'ScaledInteger' ? +(proto.attrs.offset || 0) : 0;
    const range = max - min;
    const bits = range <= 0 ? 0 : Math.ceil(Math.log2(range + 1));
    if (bits > 52) throw new Error('E57: Ganzzahlfelder mit mehr als 52 Bit werden nicht unterstützt.');
    let acc = 0, accBits = 0;   // Bitspeicher (bis 52+8 Bit -> als Zahl mit Multiplikation geführt)
    return {
      bits,
      constant: bits === 0 ? min * scale + off : null,
      push(buf, out) {
        if (bits === 0) return;
        const full = 2 ** bits;
        for (let i = 0; i < buf.length; i++) {
          acc += buf[i] * 2 ** accBits;
          accBits += 8;
          while (accBits >= bits) {
            const raw = acc % full;
            acc = (acc - raw) / full;
            accBits -= bits;
            out.push((raw + min) * scale + off);
          }
        }
      },
    };
  }

  function quatToMat(w, x, y, z) {
    return [1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y),
      2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x),
      2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)];
  }

  async function readE57(file, col, o) {
    const hb = await bytes(file, 0, 48);
    const sig = String.fromCharCode(...hb.subarray(0, 8));
    if (sig !== 'ASTM-E57') throw new Error('Keine E57-Datei (Signatur fehlt).');
    const dv = new DataView(hb.buffer, hb.byteOffset, 48);
    const xmlPhys = Number(dv.getBigUint64(24, true)), xmlLen = Number(dv.getBigUint64(32, true));
    const pageSize = Number(dv.getBigUint64(40, true)) || 1024;
    const R = new E57Reader(file, pageSize);
    const xml = new TextDecoder('utf-8').decode(await R.read(R.physToLog(xmlPhys), xmlLen));
    const doc = parseXml(xml);
    const root = child(doc, 'e57Root');
    const data3D = child(root, 'data3D');
    if (!data3D || !data3D.children.length) throw new Error('E57 enthält keine 3D-Scans (data3D).');
    const scans = data3D.children;
    const totalRec = scans.reduce((s, sc) => s + +(child(sc, 'points') || { attrs: {} }).attrs.recordCount || 0, 0);
    let doneRec = 0;
    const anyColor = scans.some(sc => { const p = child(child(sc, 'points'), 'prototype'); return p && child(p, 'colorRed'); });
    col.setColor(anyColor);
    for (const sc of scans) {
      const pts = child(sc, 'points');
      if (!pts || pts.attrs.type !== 'CompressedVector') continue;
      const proto = child(pts, 'prototype');
      const fields = proto.children;
      const names = fields.map(f => f.name);
      const cart = names.includes('cartesianX');
      const sph = names.includes('sphericalRange');
      if (!cart && !sph) continue;
      const rec = +pts.attrs.recordCount;
      // Pose
      const pose = child(sc, 'pose');
      let Rm = null, T = [0, 0, 0];
      if (pose) {
        const rq = child(pose, 'rotation'), tr = child(pose, 'translation');
        if (rq) Rm = quatToMat(num(child(rq, 'w'), 1), num(child(rq, 'x')), num(child(rq, 'y')), num(child(rq, 'z')));
        if (tr) T = [num(child(tr, 'x')), num(child(tr, 'y')), num(child(tr, 'z'))];
      }
      // Farbbereich
      const cr = child(proto, 'colorRed');
      const cmin = cr ? +(cr.attrs.minimum || 0) : 0, cmax = cr ? +(cr.attrs.maximum || 255) : 255;
      const cmul = 255 / ((cmax - cmin) || 1);
      const dec = fields.map(makeFieldDecoder);
      const queues = fields.map(() => []);
      const heads = fields.map(() => 0);
      const idx = n => names.indexOf(n);
      const iX = idx(cart ? 'cartesianX' : 'sphericalRange'), iY = idx(cart ? 'cartesianY' : 'sphericalAzimuth'), iZ = idx(cart ? 'cartesianZ' : 'sphericalElevation');
      const iInv = idx(cart ? 'cartesianInvalidState' : 'sphericalInvalidState');
      const iR = idx('colorRed'), iG = idx('colorGreen'), iB = idx('colorBlue');
      const val = (i, k) => (dec[i].bits === 0 ? dec[i].constant : queues[i][heads[i] + k]);
      let emitted = 0;
      const emit = () => {
        let avail = Infinity;
        for (let i = 0; i < fields.length; i++) if (dec[i].bits !== 0) avail = Math.min(avail, queues[i].length - heads[i]);
        if (avail === Infinity) avail = rec - emitted;
        avail = Math.min(avail, rec - emitted);
        for (let k = 0; k < avail; k++) {
          if (iInv >= 0 && val(iInv, k) !== 0) continue;
          let x = val(iX, k), y = val(iY, k), z = val(iZ, k);
          if (!cart) { const r = x, az = y, el = z; x = r * Math.cos(el) * Math.cos(az); y = r * Math.cos(el) * Math.sin(az); z = r * Math.sin(el); }
          if (Rm) { const a = x, b = y, c = z; x = Rm[0] * a + Rm[1] * b + Rm[2] * c; y = Rm[3] * a + Rm[4] * b + Rm[5] * c; z = Rm[6] * a + Rm[7] * b + Rm[8] * c; }
          x += T[0]; y += T[1]; z += T[2];
          if (anyColor && iR >= 0) col.add(x, y, z, (val(iR, k) - cmin) * cmul, (val(iG, k) - cmin) * cmul, (val(iB, k) - cmin) * cmul);
          else col.add(x, y, z, 128, 128, 128);
        }
        emitted += avail;
        for (let i = 0; i < fields.length; i++) if (dec[i].bits !== 0) {
          heads[i] += avail;
          if (heads[i] > 1 << 20) { queues[i] = queues[i].slice(heads[i]); heads[i] = 0; }
        }
      };
      // Abschnittskopf
      const secPhys = +pts.attrs.fileOffset;
      const sh = await R.read(R.physToLog(secPhys), 32);
      const sdv = new DataView(sh.buffer, sh.byteOffset, 32);
      if (sh[0] !== 1) throw new Error('E57: unerwarteter Abschnittstyp.');
      const secLogLen = Number(sdv.getBigUint64(8, true));
      const dataPhys = Number(sdv.getBigUint64(16, true));
      let cur = R.physToLog(dataPhys);
      const secEnd = R.physToLog(secPhys) + secLogLen;
      while (emitted < rec && cur < secEnd) {
        checkAbort(o);
        const ph = await R.read(cur, 6);
        const type = ph[0];
        const plen = (ph[2] | (ph[3] << 8)) + 1;
        const pk = await R.read(cur, plen);
        if (type === 1) {
          const pdv = new DataView(pk.buffer, pk.byteOffset, pk.byteLength);
          const nbs = pdv.getUint16(4, true);
          let p = 6 + 2 * nbs;
          for (let i = 0; i < nbs; i++) {
            const bl = pdv.getUint16(6 + 2 * i, true);
            if (i < fields.length && bl) dec[i].push(pk.subarray(p, p + bl), queues[i]);
            p += bl;
          }
          emit();
        }
        cur += plen;
        o.onProgress && o.onProgress(Math.min(1, (doneRec + emitted) / (totalRec || 1)), col);
        if ((cur & 0xfffff) < plen) await tick();
      }
      doneRec += rec;
    }
  }

  /**
   * Punktwolke einlesen.
   * o: { voxel (m, Vorausdünnung), maxPoints, onProgress(f, collector), signal, lazWasm, lazFactory }
   */
  async function readCloud(file, o = {}) {
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    if (!EXT.includes(ext)) throw new Error(`Format ".${ext}" nicht unterstützt. Möglich: ${EXT.map(e => '.' + e).join(', ')}`);
    const col = new C2B.thin.Collector(o.voxel || 0, true, o.maxPoints || 0);
    col.setColor = flag => { if (!flag) col.buf.rgb = null; };
    if (ext === 'las' || ext === 'laz') await readLas(file, col, o);
    else if (ext === 'e57') await readE57(file, col, o);
    else if (ext === 'ply') await readPly(file, col, o);
    else await readText(file, col, o);
    const c = col.result();
    c.source = file.name;
    return c;
  }

  return { readCloud, parseXml, makeFieldDecoder, lasHeader, EXT };
})();
