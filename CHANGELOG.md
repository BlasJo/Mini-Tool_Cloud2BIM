# Changelog Cloud2BIM

Neueste Fassung zuerst.

## 1.1.0 (17.11.2026)

- **Teilprofile je Querschnitt** (z. B. zwei Tunnelröhren): Ein Querschnitt kann mehrere Profile haben, jedes mit eigenen Bauteilen («Profil k · Wand links» …). Im Editor wird das aktive Teilprofil bearbeitet (Klick auf ein anderes Profil, Auswahlliste oder Tab wechselt), «Zeichnen» fügt ein Teilprofil hinzu, «Löschen» entfernt das aktive.
- **Max. Punktabstand** (je Querschnitt, Vorgabe 20 cm, «für alle» übernehmbar): Der automatische Vorschlag verbindet nur Punkte, die höchstens so weit auseinanderliegen; grössere Lücken trennen Teilprofile. Ein Profil gilt nur als geschlossen, wenn die Lücke zwischen Anfang und Ende diesen Abstand nicht überschreitet.
- Vorschlag robuster: kleine Punktgruppen gelten nur als Fremdobjekt (Leitung, Gerät), wenn sie das Profil höchstens einseitig berühren; kurze Fasen an Ecken werden zu scharfen Ecken, sofern die Toleranz eingehalten bleibt.
- **3D**: interpolierte Volumenkörper werden automatisch nachgeführt, sobald Bauteile bestehen; interpolierte Zwischenquerschnitte als Konturen (Anzahl je Intervall in den Einstellungen); definierte Bauteilflächen der Querschnitte gefüllt. Neue Schalter «Flächen» und «Interpolation».
- Drahtmodell ordnet Teilprofile benachbarter Querschnitte über den Schwerpunkt zu.
- Neue Punktwolke mit anderem Dateinamen: Rückfrage «Neu beginnen» oder Querschnitte/Stützen behalten.
- Endquerschnitt wird nicht mehr doppelt erzeugt, wenn die Achslänge knapp über einem Vielfachen des Abstands liegt.
- Projektdateien 1.0.0 werden beim Öffnen übernommen.
- Beispiel `beispiel/Demo_Doppelroehre.laz` (zwei Röhren 4 × 3 m, Achse E 2600700 / N 1199900 → E 2600719.319 / N 1199894.824).

## 1.0.0 (17.11.2026)

Erste Fassung.

- Einlesen XYZ/TXT/CSV/PTS/ASC, PLY (ASCII/binär), LAS 1.0–1.4, LAZ (laz-perf, eingebettet), E57 (Float, ScaledInteger, Integer; kartesisch/sphärisch; Pose) – blockweise mit Vorausdünnung.
- Ausdünnen (Voxel), isolierte Punkte entfernen.
- Querschnitte entlang Achse (Abstand oder Anzahl), einzelne Schnittlinie, Achse als Polylinie zeichenbar.
- Automatischer Profilvorschlag mit max. Abweichung; Serienvorschlag mit gleicher Topologie; Vorlage übertragen/anpassen; Profil-Editor mit Undo.
- Bauteile Bodenplatte/Wand/Decke mit Stärke je Querschnitt und Interpolation; Gehrungsfugen; Loft-Volumenkörper.
- Stützen: Einpassen Rechteck (mit Drehung)/Kreis, Höhe aus Punkten.
- Export IFC4 (Georeferenz IfcMapConversion), Drahtmodell DXF/OBJ (mit Zwischenprofilen, Innenfläche), Projekt JSON.
