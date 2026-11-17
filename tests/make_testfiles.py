"""Erzeugt Test-Punktwolken in allen unterstützten Formaten (tests/out/fmt.*)."""
import numpy as np, laspy, pye57, uuid
from pye57 import libe57
from plyfile import PlyData, PlyElement

rng = np.random.default_rng(1)
N = 5000
xyz = np.column_stack([2600000 + rng.uniform(0, 10, N), 1200000 + rng.uniform(0, 5, N), 500 + rng.uniform(0, 3, N)])
rgb = rng.integers(0, 256, (N, 3))
np.save("tests/out/fmt_ref.npy", np.hstack([xyz, rgb]))

# XYZ mit Farben, PTS mit Kopfzeile + Intensität
np.savetxt("tests/out/fmt.xyz", np.hstack([xyz, rgb]), fmt=["%.4f"] * 3 + ["%d"] * 3)
with open("tests/out/fmt.pts", "w") as f:
    f.write(f"{N}\n")
    np.savetxt(f, np.hstack([xyz, rng.integers(-2048, 2047, (N, 1)), rgb]), fmt=["%.4f"] * 3 + ["%d"] * 4)
np.savetxt("tests/out/fmt.csv", xyz, fmt="%.4f", delimiter=",", header="X,Y,Z", comments="")

# LAS 1.4 (Format 7 mit RGB 16 bit) und LAZ
for ext, fmt in (("las", 7), ("laz", 3)):
    h = laspy.LasHeader(point_format=fmt, version="1.4" if fmt == 7 else "1.2")
    h.scales = [0.001] * 3; h.offsets = [2600000, 1200000, 0]
    las = laspy.LasData(h)
    las.x, las.y, las.z = xyz.T
    las.red, las.green, las.blue = (rgb * 257).T
    las.write(f"tests/out/fmt.{ext}")

# PLY binär (double) und ASCII
v = np.empty(N, dtype=[("x", "f8"), ("y", "f8"), ("z", "f8"), ("red", "u1"), ("green", "u1"), ("blue", "u1")])
v["x"], v["y"], v["z"] = xyz.T; v["red"], v["green"], v["blue"] = rgb.T
PlyData([PlyElement.describe(v, "vertex")]).write("tests/out/fmt.ply")
PlyData([PlyElement.describe(v, "vertex")], text=True).write("tests/out/fmt_ascii.ply")

# E57 (pye57: Float single + Integer-Farben)
e = pye57.E57("tests/out/fmt.e57", mode="w")
e.write_scan_raw({"cartesianX": xyz[:, 0], "cartesianY": xyz[:, 1], "cartesianZ": xyz[:, 2],
                  "colorRed": rgb[:, 0].astype(np.uint8), "colorGreen": rgb[:, 1].astype(np.uint8), "colorBlue": rgb[:, 2].astype(np.uint8)})
e.close()

# E57 mit ScaledInteger (Bitpacking, nicht byte-ausgerichtet), Pose und zwei Scans
imf = libe57.ImageFile("tests/out/fmt_scaled.e57", "w")
root = imf.root()
root.set("formatName", libe57.StringNode(imf, "ASTM E57 3D Imaging Data File"))
root.set("guid", libe57.StringNode(imf, "{%s}" % uuid.uuid4()))
vm = libe57.StructureNode(imf); vm.set("major", libe57.IntegerNode(imf, 1)); vm.set("minor", libe57.IntegerNode(imf, 0))
root.set("versionMajor", libe57.IntegerNode(imf, 1)); root.set("versionMinor", libe57.IntegerNode(imf, 0))
root.set("coordinateMetadata", libe57.StringNode(imf, ""))
data3d = libe57.VectorNode(imf, True); root.set("data3D", data3d)
halves = [slice(0, N // 2), slice(N // 2, N)]
# Scan 2 in lokalem System: Rotation 90° um Z + Translation
ang = np.pi / 2
Rz = np.array([[np.cos(ang), -np.sin(ang), 0], [np.sin(ang), np.cos(ang), 0], [0, 0, 1]])
T = np.array([2600005.0, 1200002.0, 501.0])
for si, sl in enumerate(halves):
    P = xyz[sl].copy()
    if si == 1:
        P = (P - T) @ Rz  # lokal = R^T (global - T)
    scan = libe57.StructureNode(imf)
    scan.set("guid", libe57.StringNode(imf, "{%s}" % uuid.uuid4()))
    if si == 1:
        pose = libe57.StructureNode(imf)
        rot = libe57.StructureNode(imf)
        q = [np.cos(ang / 2), 0, 0, np.sin(ang / 2)]
        for k, val in zip("wxyz", q): rot.set(k, libe57.FloatNode(imf, float(val)))
        tr = libe57.StructureNode(imf)
        for k, val in zip("xyz", T): tr.set(k, libe57.FloatNode(imf, float(val)))
        pose.set("rotation", rot); pose.set("translation", tr); scan.set("pose", pose)
    proto = libe57.StructureNode(imf)
    names = ["cartesianX", "cartesianY", "cartesianZ"]
    for k, nm in enumerate(names):
        mn, mx = float(P[:, k].min()) - 1, float(P[:, k].max()) + 1
        proto.set(nm, libe57.ScaledIntegerNode(imf, int(np.floor(mn / 0.0005)), int(np.floor(mn / 0.0005)), int(np.ceil(mx / 0.0005)), 0.0005, 0.0))
    for nm in ("colorRed", "colorGreen", "colorBlue"):
        proto.set(nm, libe57.IntegerNode(imf, 0, 0, 255))
    proto.set("cartesianInvalidState", libe57.IntegerNode(imf, 0, 0, 2))
    codecs = libe57.VectorNode(imf, True)
    pts = libe57.CompressedVectorNode(imf, proto, codecs)
    scan.set("points", pts)
    data3d.append(scan)
    n = P.shape[0]
    inv = np.zeros(n, dtype=np.int8); inv[:10] = 2  # 10 ungültige Punkte
    arrs = {nm: np.ascontiguousarray(P[:, k]) for k, nm in enumerate(names)}
    for k, nm in enumerate(("colorRed", "colorGreen", "colorBlue")): arrs[nm] = np.ascontiguousarray(rgb[sl][:, k].astype(np.uint8))
    arrs["cartesianInvalidState"] = inv
    bufs = libe57.VectorSourceDestBuffer()
    for nm, a in arrs.items():
        bufs.append(libe57.SourceDestBuffer(imf, nm, a, n, True, True))
    w = pts.writer(bufs); w.write(n); w.close()
imf.close()
print("ok")
