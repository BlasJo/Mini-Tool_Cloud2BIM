# Cloud2BIM – Punktwolke → IFC (B+S Mini-Tool)

Eigenständige HTML-Datei **`Cloud2BIM_V1_4_0.html`** (aktuelle Fassung; ältere Fassungen bleiben im Ordner): im Browser öffnen (Chrome/Edge/Firefox), keine Installation,
kein Server, kein Netzzugriff. Alle Bibliotheken sind eingebettet (three.js 0.147, Delaunator, laz-perf).

Zum Ausprobieren:
- `beispiel/Demo_Durchlass.laz` – Durchlass 30 m, Achse E 2600512.30 / N 1199830.70 → E 2600538.79 / N 1199844.78, mit Leitung und einer Stütze bei Station 15.
- `beispiel/Demo_Gewoelbe.laz` – Gewölbetunnel (Halbkreis R 3.0 m), Achse E 2601000 / N 1200000.5 → E 2601000 / N 1200014.5.
- `beispiel/Demo_Doppelroehre.laz` – zwei Röhren nebeneinander, Achse E 2600700 / N 1199900 → E 2600719.319 / N 1199894.824 (Schnittdicke 100 mm empfohlen, die Demo-Wolke ist dünn).

## Ablauf

| Schritt | Was passiert |
|---|---|
| **1 Punktwolke laden** | `.xyz .txt .csv .pts .asc .ply .las .laz .e57` (Farben werden übernommen). Blockweises Einlesen mit optionaler Vorausdünnung, damit auch grosse Scans in den Browser passen. Koordinaten intern lokal, Ursprung auf 100 m gerundet (LV95 bleibt erhalten). |
| **2 Ausdünnen & Ausschneiden** | Voxel-Raster (1 Punkt je Würfel, der dem Zentrum nächste) + isolierte Punkte entfernen. **Ausschneiden:** Polygon im Grundriss (optional Höhenbereich) behalten oder entfernen – so werden nur die klaren Teile bearbeitet. |
| **3 Ebenen** | Ebene Flächen (Boden, Wand, Decke) im Grundriss umfahren → robuste Ebene (RANSAC). Die Schnittlinien erscheinen in jedem Querschnitt; nahe, parallele Profilkanten werden exakt auf die Ebene gelegt (automatisch bei den Vorschlägen). |
| **4 Querschnitte** | *Linienbauwerk:* Achse (Start/Ende als Koordinaten oder im Grundriss gezeichnet, auch als Polylinie) → Querschnitte im **Abstand x** oder **Anzahl n gleichmässig verteilt**. *Einzeln:* Schnittlinie im Grundriss zeichnen. Querschnittspunkte lassen sich nochmals vereinfachen (Raster). Ein Querschnitt kann **mehrere Teilprofile** haben (z. B. zwei Tunnelröhren): Punkte werden nur bis zum **max. Punktabstand** (je Querschnitt, Vorgabe 20 cm) verbunden. **Automatischer Vorschlag** mit einstellbarer **max. Abweichung**: Ordnung der Punkte über den Minimal-Spannbaum, Douglas-Peucker, Geradenausgleich je Kante, Ecken als Geradenschnitt; Kleinteile (Leitungen, Geräte) werden ignoriert. Bei Serien wird der typischste Querschnitt zur Vorlage und auf die anderen übertragen/angepasst → **gleiche Eckenzahl** in allen Schnitten. Unklare Punkte lassen sich je Querschnitt **ausblenden** (Polygon, auf alle übertragbar). Jeder Querschnitt ist einzeln bearbeitbar (Ecken ziehen, einfügen, löschen, neu zeichnen, an Punkt fangen, Undo), mit **Mehrfachauswahl** (Strg+Klick, Shift+Rechteck, Strg+A) und **Kreisbögen** (Anfang, Ende, Bogenpunkt; aus Kante oder Eckenkette, in die Punkte eingepasst). Die **Schnitttiefe** ist je Querschnitt einstellbar. Abweichung je Kante farbig, Kennzahlen (max, 95 %, Mittel, % in Toleranz). |
| **5 Bauteile** | Kanten werden Bodenplatte / Wand / Decke zugeordnet (Vorschlag nach Neigung oder Kanten wählen), Stärke je Querschnitt (leer = zwischen Nachbarn **interpoliert**), Stärke nach aussen (umkehrbar). Bauteilfugen auf Gehrung (lückenlos). Volumenkörper = Loft zwischen den Querschnitten; im 3D laufen die interpolierten Körper, Zwischenquerschnitte und die Bauteilflächen der Querschnitte live mit. **Abgleich:** Abstand jedes Punkts zur interpolierten Fläche, Einfärbung nach anpassbarer Farbskala (Einstellungen; Standard ≤ 2 mm grün, ≤ 4 orange, ≤ 10 rot, ≤ 20 violett), Legende/Kennzahlen, Export als PLY. |
| **6 Punktuelle Bauteile** | Stützen: Horizontalschnitt im Grundriss, anklicken → Rechteck (inkl. Drehung) oder Kreis wird in die Punkte eingepasst, Höhe aus den Punkten. Werte editierbar. |
| **7 Export** | **IFC4** (IfcSlab/IfcWall/IfcColumn, Tessellation bzw. Extrusion, Material, Pset_Cloud2BIM mit Dicke/Stationen/Volumen, Georeferenz via IfcMapConversion, z. B. EPSG:2056). **Drahtmodell** als 3D-DXF (Layer Profile, Längskanten, Zwischenprofile, Bauteil-Aussenkanten) oder OBJ (Linien + vermaschte Innenfläche). **Projekt** als JSON (ohne Punktwolke) speichern/öffnen. |

Tastatur im Querschnitt: Mausrad = Zoom, Ziehen = verschieben, Doppelklick auf Kante = Ecke einfügen (auf Bogen: teilen),
Strg+Klick / Shift+Ziehen / Strg+A = mehrere Ecken wählen, Entf/Rechtsklick = gewählte Ecken löschen, Pfeiltasten = Ecke 1 mm (Shift 10 mm) verschieben, Shift = an Punkt fangen,
Strg+Z / Strg+Y = rückgängig / wiederholen, Bild↑/Bild↓ = vorheriger/nächster Querschnitt.

## Entwicklung

```
src/core/   Algorithmen ohne DOM (auch in Node testbar)
  00_geom2d.js     2D-Geometrie, Douglas-Peucker, Abweichung, Triangulierung
  10_thin.js       Punktspeicher, Voxel-/Raster-Ausdünnung, Ausreisser
  20_sections.js   Querschnitte, Achsen, Auto-Profil, Vorlage anpassen, Bauteil-Vorschlag
  22_arcs.js       Kreisbögen (3 Punkte), Auflösung in Polylinien, Bogen einpassen
  25_planes.js     Ausschneiden (Regionen), Masken, Ebenen-Fit, Schnittlinien
  30_model.js      Stärken-Interpolation, Loft-Volumenkörper, Stützen, Drahtmodell
  40_export.js     IFC4-STEP-Writer, DXF R12, OBJ
  45_deviation.js  Abgleich Punktwolke ↔ interpolierte Fläche, Farbklassen, PLY
  50_readers.js    XYZ/PLY/LAS/LAZ/E57-Leser (blockweise)
src/ui/     Oberfläche (Grundriss, 3D, Querschnitt-Editor, Ablauf)
src/template/  Teile der B+S-Layoutvorlage (unverändert übernommen)
vendor/     eingebettete Bibliotheken (Lizenzen beiliegend)
build.mjs   baut Cloud2BIM_V<x>_<y>_<z>.html
```

```bash
node build.mjs                      # HTML bauen
node --test tests/*.test.mjs        # Kern-Tests (Formate, Auto-Profil, Modell, Export)
NODE_PATH=$(npm root -g) node tests/e2e.mjs   # Browser-Test mit Playwright
python tests/validate_ifc.py tests/out/demo.ifc   # IFC mit IfcOpenShell prüfen
```

Testdateien erzeugen: `python tests/make_testfiles.py` (benötigt numpy, laspy[lazrs], pye57, plyfile) und
`python tests/make_demo.py`.

## Grenzen (Stand 1.0.0)

- Der automatische Vorschlag liefert Polygone; Gewölbe werden mit «Bogen» (Eckenkette wählen) zu echten Kreisbögen. Klothoiden/Ellipsen sind nicht vorgesehen.
- Für saubere Interpolation sollten benachbarte Querschnitte gleich viele Ecken haben («Profil auf alle», «Aus Vorgänger»);
  sonst ergänzt das Tool Ecken und meldet es.
- Stützen: senkrecht, Rechteck oder Kreis.
- LAZ bis ca. 1.8 GB (Dekodierung im Browser-Speicher); sehr grosse Scans mit Vorausdünnung einlesen.
- Bisher mit synthetischen Daten und Format-Testdateien geprüft, noch nicht mit realen Projektscans.
