/* ═══ Cloud2BIM UI: 3D-Ansicht (three.js) ═══ */
UI.View3D = class {
  constructor(host, app) {
    this.host = host; this.app = app;
    const R = this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: false });
    R.setPixelRatio(window.devicePixelRatio || 1);
    host.appendChild(R.domElement);
    R.domElement.style.display = 'block';
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.05, 50000);
    this.camera.up.set(0, 0, 1);
    this.camera.position.set(20, -20, 20);
    this.controls = new THREE.OrbitControls(this.camera, R.domElement);
    this.controls.enableDamping = false;
    this.controls.screenSpacePanning = true;
    this.controls.addEventListener('change', () => this.render());
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x666666, 0.75));
    const dl = new THREE.DirectionalLight(0xffffff, 0.6); dl.position.set(0.5, -0.8, 1.2); this.scene.add(dl);
    this.groups = {};
    ['cloud', 'sections', 'areas', 'model', 'interp', 'wire', 'planes'].forEach(k => { this.groups[k] = new THREE.Group(); this.scene.add(this.groups[k]); });
    this.ptSize = 2;
    this._resize();
    new ResizeObserver(() => this._resize()).observe(host);
    this._themeBg();
    new MutationObserver(() => this._themeBg()).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  }

  _themeBg() {
    const dark = document.documentElement.getAttribute('data-theme') === 'dark';
    this.renderer.setClearColor(dark ? 0x18181a : 0xf8f7f5, 1);
    this.render();
  }

  _resize() {
    const w = this.host.clientWidth, h = this.host.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = w + 'px'; this.renderer.domElement.style.height = h + 'px';
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.render();
  }

  render() {
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => { this._raf = 0; this.renderer.render(this.scene, this.camera); });
  }

  _clear(g) {
    while (g.children.length) {
      const o = g.children.pop();
      o.traverse(x => { if (x.geometry) x.geometry.dispose(); if (x.material) (Array.isArray(x.material) ? x.material : [x.material]).forEach(m => m.dispose()); });
    }
  }

  setVisible(key, v) { this.groups[key].visible = v; this.render(); }

  setCloud(cloud, colors) {
    this._clear(this.groups.cloud);
    if (!cloud || !cloud.n) return this.render();
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(cloud.xyz, 3));
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3, true));
    g.computeBoundingBox(); g.computeBoundingSphere();
    this.pointsMat = new THREE.PointsMaterial({ size: this.ptSize, sizeAttenuation: false, vertexColors: true });
    this.groups.cloud.add(new THREE.Points(g, this.pointsMat));
    this.bbox = g.boundingBox.clone();
    this.render();
  }

  setPointSize(px) { this.ptSize = px; if (this.pointsMat) { this.pointsMat.size = px; this.render(); } }

  fit() {
    const box = new THREE.Box3();
    Object.values(this.groups).forEach(g => { if (g.visible && g.children.length) box.expandByObject(g); });
    if (box.isEmpty()) return;
    const c = box.getCenter(new THREE.Vector3()), r = box.getSize(new THREE.Vector3()).length() / 2 || 10;
    this.controls.target.copy(c);
    const dir = new THREE.Vector3(0.6, -1, 0.7).normalize();
    // Abstand so, dass die Hüllkugel in den engeren der beiden Öffnungswinkel passt
    const fovV = this.camera.fov * Math.PI / 180;
    const fovH = 2 * Math.atan(Math.tan(fovV / 2) * this.camera.aspect);
    const dist = 1.1 * r / Math.sin(Math.min(fovV, fovH) / 2);
    this.camera.position.copy(c).addScaledVector(dir, dist);
    this.camera.near = Math.max(0.01, r / 1000); this.camera.far = r * 100;
    this.camera.updateProjectionMatrix();
    this.controls.update();
    this.render();
  }

  /**
   * Querschnitte: Rahmen, alle Teilprofile (aktueller Querschnitt hervorgehoben) und die
   * definierten Bauteilflächen (gefüllt, Farbe je Bauteiltyp).
   */
  setSections(sections, curId, zRange, tmap, showAreas = true) {
    this._clear(this.groups.sections);
    this._clear(this.groups.areas);
    const [z0, z1] = zRange || [0, 1];
    const W = (s, p) => new THREE.Vector3(...C2B.sec.uvToWorld(s, p));
    sections.forEach(s => {
      const cur = s.id === curId;
      const P = C2B.sec.profilesOf(s);
      const all = P.reduce((a, p) => a.concat(p.vertices), []);
      let half = 5;
      if (all.length >= 2) { half = 0; all.forEach(p => { half = Math.max(half, Math.abs(p[0])); }); half += 0.5; }
      const corners = [[-half, z0], [half, z0], [half, z1], [-half, z1], [-half, z0]].map(p => W(s, p));
      this.groups.sections.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(corners),
        new THREE.LineBasicMaterial({ color: cur ? 0xD70036 : 0x8E8E93, transparent: true, opacity: cur ? 0.9 : 0.3 })));
      P.forEach(pr => {
        if (pr.vertices.length < 2) return;
        const pts = pr.vertices.map(p => W(s, p));
        if (pr.closed) pts.push(pts[0].clone());
        this.groups.sections.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: cur ? 0xD70036 : 0x2D8653 })));
      });
      // Bauteilflächen
      if (showAreas && tmap) {
        const rings = C2B.model.sectionRings(s, tmap.get(s.id) || {});
        Object.values(rings).forEach(r => {
          const poly = r.inner.concat(r.outer.slice().reverse());
          const tris = C2B.g2.triangulate(poly);
          if (!tris.length) return;
          const pos = new Float32Array(tris.length * 9);
          tris.forEach((t, i) => t.forEach((vi, k) => pos.set(C2B.sec.uvToWorld(s, poly[vi]), i * 9 + k * 3)));
          const g = new THREE.BufferGeometry();
          g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
          const col = new THREE.Color(UI.TYPE_COLOR[r.comp.type] || '#999');
          this.groups.areas.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: col, side: THREE.DoubleSide, transparent: true, opacity: cur ? 0.95 : 0.8, depthWrite: false })));
          const outline = poly.map(p => W(s, p)); outline.push(outline[0].clone());
          this.groups.areas.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(outline), new THREE.LineBasicMaterial({ color: cur ? 0xD70036 : 0x1C1C1E })));
        });
      }
    });
    this.render();
  }

  /** Ebenen als halbtransparente Flächen mit Umriss. */
  setPlanes(planes) {
    this._clear(this.groups.planes);
    (planes || []).forEach(pl => {
      const C = C2B.planes.planeCorners(pl).map(p => new THREE.Vector3(...p));
      const g = new THREE.BufferGeometry().setFromPoints([C[0], C[1], C[2], C[0], C[2], C[3]]);
      this.groups.planes.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0x1f6fb2, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false })));
      this.groups.planes.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(C.concat([C[0]])), new THREE.LineBasicMaterial({ color: 0x1f6fb2 })));
    });
    this.render();
  }

  /** Volumenkörper (Loft) + interpolierte Zwischenquerschnitte als Konturen. */
  setModel(solids, columns, interpPerInterval = 3) {
    this._clear(this.groups.model);
    this._clear(this.groups.interp);
    if (solids && solids.length && interpPerInterval > 0) {
      const by = {};
      C2B.model.interpolatedRings(solids, interpPerInterval).forEach(r => {
        const arr = by[r.type] = by[r.type] || [];
        for (let i = 0; i < r.pts.length; i++) arr.push(...r.pts[i], ...r.pts[(i + 1) % r.pts.length]);
      });
      Object.entries(by).forEach(([type, arr]) => {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(arr), 3));
        const col = new THREE.Color(UI.TYPE_COLOR[type] || '#999').multiplyScalar(0.55);
        this.groups.interp.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: col })));
      });
    }
    const mk = (mesh, color) => {
      const pos = new Float32Array(mesh.faces.length * 9);
      mesh.faces.forEach((f, i) => f.forEach((vi, k) => { const v = mesh.verts[vi]; pos.set(v, i * 9 + k * 3); }));
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.computeVertexNormals();
      const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }));
      const e = new THREE.LineSegments(new THREE.EdgesGeometry(g, 25), new THREE.LineBasicMaterial({ color: 0x2C2C2E, transparent: true, opacity: 0.5 }));
      this.groups.model.add(m, e);
    };
    (solids || []).forEach(s => mk(s, new THREE.Color(UI.TYPE_COLOR[s.type] || '#999')));
    (columns || []).forEach(c => mk(C2B.model.columnMesh(c), new THREE.Color(UI.TYPE_COLOR.column)));
    this.render();
  }

  setWire(lines) {
    this._clear(this.groups.wire);
    if (!lines || !lines.length) return this.render();
    const col = { C2B_Profile: 0xD70036, C2B_Laengskanten: 0x1f6fb2, C2B_Zwischenprofile: 0x8E8E93, C2B_Bauteile_Aussen: 0x2D8653, C2B_Bauteile_Laengs: 0x2D8653 };
    const by = {};
    lines.forEach(l => {
      const arr = by[l.layer] = by[l.layer] || [];
      const P = l.closed ? l.pts.concat([l.pts[0]]) : l.pts;
      for (let i = 0; i < P.length - 1; i++) arr.push(...P[i], ...P[i + 1]);
    });
    Object.entries(by).forEach(([layer, arr]) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(arr), 3));
      this.groups.wire.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: col[layer] || 0x444444 })));
    });
    this.render();
  }
};
