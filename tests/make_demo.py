"""Erzeugt eine synthetische Demo-Punktwolke: Rechteckdurchlass mit Vouten, schräger Achse,
leicht wechselnder Höhe, Leitung an der Wand und einer Stütze. Ausgabe: beispiel/Demo_Durchlass.laz"""
import numpy as np, laspy

rng = np.random.default_rng(42)
L = 30.0                       # Länge [m]
E0, N0, Z0 = 2600512.30, 1199830.70, 512.40
ang = np.radians(28)           # Achsrichtung
d = np.array([np.cos(ang), np.sin(ang)]); u = np.array([np.sin(ang), -np.cos(ang)])
W, H, CH = 4.0, 3.0, 0.30      # Breite, Höhe innen, Voute

def profile(s):
    w = W + 0.2 * s / L        # leicht aufweitend
    z0 = Z0 + 0.01 * s         # 1 % Gefälle
    hw = w / 2
    return np.array([[-hw, z0], [hw, z0], [hw, z0 + H - CH], [hw - CH, z0 + H], [-hw + CH, z0 + H], [-hw, z0 + H - CH]])

pts, cols = [], []
spacing = 0.03
for s in np.arange(0, L, spacing):
    V = profile(s)
    for i in range(len(V)):
        a, b = V[i], V[(i + 1) % len(V)]
        n = max(2, int(np.hypot(*(b - a)) / spacing))
        t = rng.random(n)
        uv = a + t[:, None] * (b - a) + rng.normal(0, 0.003, (n, 2))
        ss = s + rng.random(n) * spacing
        xy = np.array([E0, N0]) + ss[:, None] * d + uv[:, :1] * u
        pts.append(np.column_stack([xy, uv[:, 1]]))
        base = np.array([150, 148, 140]) if i != 0 else np.array([110, 105, 95])
        cols.append(np.clip(base + rng.normal(0, 12, (n, 3)), 0, 255))
# Leitung (Rohr Ø 0.15) an der linken Wand
for s in np.arange(0, L, 0.02):
    V = profile(s)
    c = np.array([V[0][0] + 0.25, V[0][1] + 2.2])
    a = rng.random(30) * 2 * np.pi
    uv = c + 0.075 * np.column_stack([np.cos(a), np.sin(a)])
    xy = np.array([E0, N0]) + (s + rng.random(30) * 0.02)[:, None] * d + uv[:, :1] * u
    pts.append(np.column_stack([xy, uv[:, 1]])); cols.append(np.tile([60, 60, 200], (30, 1)))
# Stütze 0.40 x 0.40 in der Mitte bei Station 15
cs, cu = 15.0, 0.0
for z in np.arange(0, H, 0.01):
    for k in range(4):
        t = rng.random(12) * 0.4 - 0.2
        loc = [np.column_stack([t, np.full(12, -0.2)]), np.column_stack([t, np.full(12, 0.2)]),
               np.column_stack([np.full(12, -0.2), t]), np.column_stack([np.full(12, 0.2), t])][k]
        xy = np.array([E0, N0]) + (cs + loc[:, 0])[:, None] * d + (cu + loc[:, 1])[:, None] * u
        zz = Z0 + 0.01 * cs + z + rng.random(12) * 0.01
        pts.append(np.column_stack([xy, zz])); cols.append(np.tile([200, 80, 80], (12, 1)))
P = np.vstack(pts); C = np.vstack(cols)
h = laspy.LasHeader(point_format=3, version="1.2"); h.scales = [0.001] * 3; h.offsets = [2600000, 1199000, 0]
las = laspy.LasData(h); las.x, las.y, las.z = P.T
las.red, las.green, las.blue = (C * 257).astype(np.uint16).T
las.write("beispiel/Demo_Durchlass.laz")
print(len(P), "Punkte; Achse Start", E0, N0, "Ende", E0 + L * d[0], N0 + L * d[1])
