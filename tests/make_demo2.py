"""Synthetische Doppelröhre: zwei Rechteckröhren (je 4.0 x 3.0 m innen) nebeneinander, Achse 20 m,
Abstand der Innenwände 1.0 m (Mittelwand). Ausgabe: beispiel/Demo_Doppelroehre.laz"""
import numpy as np, laspy
rng = np.random.default_rng(7)
L, E0, N0, Z0 = 20.0, 2600700.0, 1199900.0, 480.0
ang = np.radians(-15)
d = np.array([np.cos(ang), np.sin(ang)]); u = np.array([np.sin(ang), -np.cos(ang)])
W, H = 4.0, 3.0
prof = lambda off: np.array([[off - W / 2, 0], [off + W / 2, 0], [off + W / 2, H], [off - W / 2, H]])
pts, cols = [], []
sp = 0.03
for s in np.arange(0, L, sp):
    for off in (-2.5, 2.5):
        V = prof(off)
        for i in range(4):
            a, b = V[i], V[(i + 1) % 4]
            n = max(2, int(np.hypot(*(b - a)) / sp))
            t = rng.random(n)
            uv = a + t[:, None] * (b - a) + rng.normal(0, 0.003, (n, 2))
            xy = np.array([E0, N0]) + (s + rng.random(n) * sp)[:, None] * d + uv[:, :1] * u
            pts.append(np.column_stack([xy, Z0 + uv[:, 1]]))
            cols.append(np.clip(np.array([150, 145, 135]) + rng.normal(0, 12, (n, 3)), 0, 255))
P = np.vstack(pts); C = np.vstack(cols)
h = laspy.LasHeader(point_format=3, version="1.2"); h.scales = [0.001] * 3; h.offsets = [2600000, 1199000, 0]
las = laspy.LasData(h); las.x, las.y, las.z = P.T; las.red, las.green, las.blue = (C * 257).astype(np.uint16).T
las.write("beispiel/Demo_Doppelroehre.laz")
print(len(P), "Punkte; Achse", E0, N0, "->", round(E0 + L * d[0], 3), round(N0 + L * d[1], 3))
