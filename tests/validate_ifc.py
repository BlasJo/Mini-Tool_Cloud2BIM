"""Prüft eine von Cloud2BIM erzeugte IFC-Datei mit IfcOpenShell (Schema + Geometrie)."""
import sys
import ifcopenshell, ifcopenshell.validate, ifcopenshell.geom, ifcopenshell.util.element as ue
import numpy as np

path = sys.argv[1] if len(sys.argv) > 1 else "tests/out/test.ifc"
f = ifcopenshell.open(path)
log = ifcopenshell.validate.json_logger()
ifcopenshell.validate.validate(f, log, express_rules=True)
errs = [e for e in log.statements if e.get("level", "").lower() == "error" or True]
print("Validierung:", len(log.statements), "Meldungen")
for s in log.statements[:15]:
    print("  ", s.get("message", s)[:300])

settings = ifcopenshell.geom.settings()
settings.set("use-world-coords", True)
tot = 0
for el in f.by_type("IfcElement"):
    shape = ifcopenshell.geom.create_shape(settings, el)
    v = np.array(shape.geometry.verts).reshape(-1, 3)
    fa = np.array(shape.geometry.faces).reshape(-1, 3)
    p, q, r = v[fa[:, 0]], v[fa[:, 1]], v[fa[:, 2]]
    vol = np.einsum("ij,ij->i", p, np.cross(q, r)).sum() / 6
    tot += vol
    ps = ue.get_psets(el).get("Pset_Cloud2BIM", {})
    print(f"{el.is_a():12s} {el.Name:20s} Vol {vol:8.3f} (Pset {ps.get('Volumen', 0):8.3f})  bbox {v.min(0).round(2)} {v.max(0).round(2)}")
mc = f.by_type("IfcMapConversion")
print("MapConversion:", [(m.Eastings, m.Northings, m.TargetCRS.Name) for m in mc])
print("Projekt:", f.by_type("IfcProject")[0].Name, "| Gesamtvolumen", round(tot, 3))
sys.exit(1 if log.statements else 0)
