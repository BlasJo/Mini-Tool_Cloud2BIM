"""Synthetischer Gewölbetunnel: Sohle 6.0 m breit, Wände 2.0 m hoch, Halbkreisgewölbe R = 3.0 m,
Länge 15 m, Achse E 2601000 / N 1200000 Richtung Nord. Ausgabe: beispiel/Demo_Gewoelbe.laz"""
import numpy as np, laspy
rng = np.random.default_rng(3)
L, E0, N0, Z0, R, HW = 15.0, 2601000.0, 1200000.0, 600.0, 3.0, 2.0
pts, cols = [], []
sp = 0.025
for s in np.arange(0, L, sp):
    segs = []
    segs.append(np.column_stack([rng.uniform(-R, R, 240), np.zeros(240)]))                  # Sohle
    for x in (-R, R): segs.append(np.column_stack([np.full(80, x), rng.uniform(0, HW, 80)]))  # Wände
    a = rng.uniform(0, np.pi, 380); segs.append(np.column_stack([R * np.cos(a), HW + R * np.sin(a)]))  # Gewölbe
    uv = np.vstack(segs) + rng.normal(0, 0.003, (sum(len(x) for x in segs), 2))
    n = len(uv)
    xy = np.column_stack([E0 + uv[:, 0], N0 + s + rng.random(n) * sp])   # Blick nach Nord: u = +E (rechts)
    pts.append(np.column_stack([xy, Z0 + uv[:, 1]])); cols.append(np.clip(np.array([160, 150, 140]) + rng.normal(0, 10, (n, 3)), 0, 255))
P = np.vstack(pts); C = np.vstack(cols)
h = laspy.LasHeader(point_format=3, version="1.2"); h.scales = [0.001] * 3; h.offsets = [2600000, 1199000, 0]
las = laspy.LasData(h); las.x, las.y, las.z = P.T; las.red, las.green, las.blue = (C * 257).astype(np.uint16).T
las.write("beispiel/Demo_Gewoelbe.laz"); print(len(P), "Punkte")
