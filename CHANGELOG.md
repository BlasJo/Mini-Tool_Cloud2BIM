# Changelog Cloud2BIM

Neueste Fassung zuerst.

## 1.4.0 (17.11.2026)

- **Abgleich Modell ↔ Punktwolke** (Schritt 5): Für jeden angezeigten Punkt wird der kürzeste Abstand zur interpolierten Innenfläche berechnet (gleiche Interpolation wie Volumenkörper/Drahtmodell, Bögen aufgelöst; räumliches Raster, ca. 0.4 s für 400'000 Punkte). Die Punktwolke wird in 3D und im Grundriss nach einer Farbskala eingefärbt; Legende mit Anteilen je Stufe, Mittel, Median, 95 %. Volumenkörper/Flächen werden dazu im 3D ausgeblendet (Schalter oben).
- **Farbskala** in den Einstellungen: Stufen (obere Grenze in mm) und Farben frei, «+ Stufe», Stufe entfernen, «Standard» (≤ 2 mm grün, ≤ 4 orange, ≤ 10 rot, ≤ 20 violett, darüber blau). Suchgrenze (Vorgabe 100 mm): weiter entfernte Punkte (Einbauten, ausserhalb der Querschnitte) werden grau. Änderungen der Skala wirken sofort; Modelländerungen werden als «neu berechnen» markiert.
- Export der eingefärbten Punkte als binäres **PLY** (globale Koordinaten, RGB, Spalte `distance` in m, −1 = ausserhalb).
- «Neu beginnen» setzt auch den Horizontalschnitt im Grundriss zurück.

## 1.3.0 (17.11.2026)

- **Mehrfachauswahl** im Querschnitt: Strg+Klick schaltet Ecken um, Shift+Ziehen zieht ein Auswahlrechteck, Strg+A wählt alle Ecken des aktiven Teilprofils, Klick ins Leere/Esc hebt die Auswahl auf. Gewählte Ecken werden gemeinsam gelöscht (Entf, Rechtsklick, «Ecken löschen») und gemeinsam verschoben (Ziehen, Pfeiltasten).
- **Kreisbögen**: Kante = Bogen durch Anfang, Ende und Bogenpunkt (runder Griff, ziehbar; Radius wird angezeigt). «◠ Bogen» macht aus zwei benachbarten gewählten Ecken einen Bogen oder ersetzt eine gewählte Eckenkette (z. B. Gewölbe aus dem Vorschlag) durch einen einzigen Bogen; der Bogenpunkt wird robust in die Punkte eingepasst. «Gerade» macht Bögen wieder gerade. Doppelklick auf einen Bogen teilt ihn. Bögen wirken in Abweichung, Bauteilen (Versatz), Volumenkörpern/IFC (48 Segmente je Bogen), Drahtmodell, «Anpassen», «Aus Vorgänger» und «Profil auf alle»; Ebenen lassen Bögen unverändert.
- **Schnitttiefe je Querschnitt** im Querschnitt-Kopf (mit «für alle»); im Grundriss als Streifen beim aktuellen Querschnitt sichtbar.
- Vorlage anpassen: Verschiebung neu über Punkt-zu-Geraden-Ausgleich (lange Wände verfälschen die Höhenlage nicht mehr).
- Beispiel `beispiel/Demo_Gewoelbe.laz` (Gewölbe R 3.0 m, Achse E 2601000 / N 1200000.5 → N 1200014.5).

## 1.2.0 (17.11.2026)

- **Ausschneiden** (Schritt 2, Grundriss): Polygon zeichnen, «Bereich behalten» oder «Bereich entfernen», optional nur in einem Höhenbereich. Die Bereiche werden im Projekt gespeichert, lassen sich einzeln löschen und rückgängig machen; das Ausdünnen bleibt davon getrennt.
- **Ausblenden im Querschnitt** (Werkzeug «Ausblenden»): Polygon um unklare Punkte; diese zählen für Vorschlag, Vorlage-Anpassung und Abweichung nicht mehr (blass angezeigt). «Masken auf alle» überträgt die Polygone (Lage relativ zur Achse) auf alle Querschnitte.
- **Ebenen** (neuer Schritt 3): Bereich im Grundriss umfahren (optional Höhenbereich, Lage automatisch/horizontal/vertikal) → robuste Ebene (RANSAC + Ausgleich) mit RMS und Anteil der Punkte. Anzeige im Grundriss, in 3D (Schalter «Ebenen») und als Schnittlinie in jedem Querschnitt. Profilkanten, die (fast) parallel und innerhalb des Fangabstands liegen, übernehmen die Ebene, Ecken werden neu geschnitten – automatisch bei allen Vorschlägen (abschaltbar) oder per «Ebenen anwenden».
- Schritte neu nummeriert: 1 Laden · 2 Ausdünnen & Ausschneiden · 3 Ebenen · 4 Querschnitte · 5 Bauteile · 6 Stützen · 7 Export.

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
