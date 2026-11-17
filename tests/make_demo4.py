"""Synthetische Verzweigung: Station 0–8.5 zwei Röhren (je 4.0 x 3.0 m, Achsen u = ±2.6 m),
Stirnwand 8.0–8.5 (Öffnungen = kleine Röhren), ab 8.5 eine Röhre 10.0 x 4.0 m bis Station 18.
Achse: E 2601500 / N 1200500 Richtung Ost (u rechts = Süd). Ausgabe: beispiel/Demo_Verzweigung.laz"""
import numpy as np, laspy
rng = np.random.default_rng(5)
E0, N0, Z0 = 2601500.0, 1200500.0, 450.0
pts = []
def ring(w, h, du, n):
    per = 2 * (w + h); t = rng.random(n) * per
    out = np.zeros((n, 2))
    for i, x in enumerate(t):
        if x < w: out[i] = (du - w / 2 + x, 0)
        elif x < w + h: out[i] = (du + w / 2, x - w)
        elif x < 2 * w + h: out[i] = (du + w / 2 - (x - w - h), h)
        else: out[i] = (du - w / 2, h - (x - 2 * w - h))
    return out
def add(uv, s):
    uv = uv + rng.normal(0, 0.003, uv.shape)
    pts.append(np.column_stack([E0 + s, N0 - uv[:, 0], Z0 + uv[:, 1]]))
for s in np.arange(0, 8.5, 0.03):
    for du in (-2.6, 2.6): add(ring(4, 3, du, 700), s + rng.random(700) * 0.03)
for s in np.arange(8.5, 18, 0.03): add(ring(10, 4, 0, 1400), s + rng.random(1400) * 0.03)
# Stirnwand bei 8.5: Fläche der grossen Röhre ohne die beiden Öffnungen
uv = np.column_stack([rng.uniform(-5, 5, 60000), rng.uniform(0, 4, 60000)])
inside = lambda u, v, du: (np.abs(u - du) < 2) & (v < 3)
uv = uv[~(inside(uv[:, 0], uv[:, 1], -2.6) | inside(uv[:, 0], uv[:, 1], 2.6))]
add(uv, np.full(len(uv), 8.5))
P = np.vstack(pts)
h = laspy.LasHeader(point_format=1, version="1.2"); h.scales = [0.001] * 3; h.offsets = [2600000, 1199000, 0]
las = laspy.LasData(h); las.x, las.y, las.z = P.T
las.write("beispiel/Demo_Verzweigung.laz"); print(len(P), "Punkte")
