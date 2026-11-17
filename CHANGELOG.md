# Changelog Cloud2BIM

Neueste Fassung zuerst.

## 1.0.0 (17.11.2026)

Erste Fassung.

- Einlesen XYZ/TXT/CSV/PTS/ASC, PLY (ASCII/binär), LAS 1.0–1.4, LAZ (laz-perf, eingebettet), E57 (Float, ScaledInteger, Integer; kartesisch/sphärisch; Pose) – blockweise mit Vorausdünnung.
- Ausdünnen (Voxel), isolierte Punkte entfernen.
- Querschnitte entlang Achse (Abstand oder Anzahl), einzelne Schnittlinie, Achse als Polylinie zeichenbar.
- Automatischer Profilvorschlag mit max. Abweichung; Serienvorschlag mit gleicher Topologie; Vorlage übertragen/anpassen; Profil-Editor mit Undo.
- Bauteile Bodenplatte/Wand/Decke mit Stärke je Querschnitt und Interpolation; Gehrungsfugen; Loft-Volumenkörper.
- Stützen: Einpassen Rechteck (mit Drehung)/Kreis, Höhe aus Punkten.
- Export IFC4 (Georeferenz IfcMapConversion), Drahtmodell DXF/OBJ (mit Zwischenprofilen, Innenfläche), Projekt JSON.
