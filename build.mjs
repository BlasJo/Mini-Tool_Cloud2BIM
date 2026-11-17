// Baut das eigenständige Mini-Tool «Cloud2BIM_V<x>_<y>_<z>.html» aus src/ und vendor/.
// Aufruf: node build.mjs
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const ROOT = path.dirname(new URL(import.meta.url).pathname);
const VERSION = '1.4.0';
const DATE = '17.11.2026';
const TOOL = 'Cloud2BIM';
const rd = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
const sha = p => crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, p))).digest('hex');
const noSourceMap = s => s.replace(/^\/\/# sourceMappingURL=.*$/gm, '');
// </script> innerhalb eingebetteter Skripte unschädlich machen
const safeScript = s => s.replace(/<\/script/gi, '<\\/script');

const LIBS = [
  { file: 'vendor/three.min.js', name: 'three.min.js 0.147.0 (classic build)', lic: 'MIT, (c) 2010-2022 three.js authors', src: 'npm three@0.147.0/build/three.min.js' },
  { file: 'vendor/OrbitControls.js', name: 'OrbitControls.js 0.147.0 (examples/js)', lic: 'MIT, (c) three.js authors', src: 'npm three@0.147.0/examples/js/controls/OrbitControls.js' },
  { file: 'vendor/delaunator.min.js', name: 'delaunator.min.js 5.0.1', lic: 'ISC, (c) Mapbox / Vladimir Agafonkin', src: 'npm delaunator@5.0.1/delaunator.min.js' },
  { file: 'vendor/laz-perf.js', name: 'laz-perf.js 0.0.7 (web)', lic: 'Apache-2.0, (c) Hobu Inc.', src: 'npm laz-perf@0.0.7/lib/web/laz-perf.js' },
  { file: 'vendor/laz-perf.wasm', name: 'laz-perf.wasm 0.0.7 (base64)', lic: 'Apache-2.0, (c) Hobu Inc.', src: 'npm laz-perf@0.0.7/lib/web/laz-perf.wasm' },
];
LIBS.forEach(l => { l.sha = sha(l.file); });

const head = `<!DOCTYPE html>
<!--
${TOOL} · Version: ${VERSION} · Datum: ${DATE} · Gesamtniveau: A

Zweck: Punktwolke (XYZ/TXT/CSV/PTS/ASC, PLY, LAS, LAZ, E57) einlesen, ausduennen, Querschnitte legen
(entlang einer Achse im Abstand x oder mit n gleichmaessig verteilten Schnitten, oder einzeln), Profile
automatisch vorschlagen (max. Abweichung einstellbar) und von Hand bearbeiten, Bauteile (Bodenplatte,
Waende, Decke) mit Staerken je Querschnitt definieren und zwischen den Querschnitten interpolieren,
Stuetzen einpassen, Export als IFC4, Drahtmodell (DXF/OBJ) und Projektdatei (JSON).

Funktion                                     Niveau  Zustimmung   Externe Kommunikation
Punktwolke einlesen (Dateiauswahl/Ziehen)    A       Nutzeraktion keine · Datei wird nur im Browser gelesen (blockweise)
LAZ-Dekodierung (laz-perf, WASM eingebettet) A       —            keine · WebAssembly aus eingebettetem base64
Ausduennen, Querschnitte, Profile, Modell    A       —            keine
3D-Ansicht (three.js eingebettet)            A       —            keine
Export IFC / DXF / OBJ / Projekt (JSON)      A       Nutzeraktion keine · Download (Blob)
Projekt oeffnen (JSON)                       A       Nutzeraktion keine · Datei wird nur im Browser gelesen
Einstellungen                                A       —            keine · localStorage «bs-c2b-settings» (nur UI-Vorgaben, S5, tolerant)
Dark Mode                                    A       —            keine · localStorage «bs-theme» (Vorlage)

Keine Projektdaten im Browser-Speicher; Projekte werden ausschliesslich als Datei gespeichert.
Kein Netzzugriff (CSP connect-src nicht erlaubt), keine Anmeldung, keine Cookies.

Eingebettete Fremdbibliotheken (A1/A4 — vollstaendig lokal, kein Nachladen, kein SRI noetig):
${LIBS.map(l => `  ${l.name} — ${l.lic}\n    Quelle: ${l.src} · SHA-256 ${l.sha}`).join('\n')}

Grenzen (A3): Punktzahl im Speicher einstellbar (Vorgabe hoechstens 30 Mio. nach Vorausduennung);
LAZ bis 1.8 GB (Dekodierung im WASM-Speicher); E57: Felder Float/ScaledInteger/Integer (bis 52 Bit),
kartesisch oder sphaerisch, Pose wird angewendet; PLY ohne Listen-Eigenschaften.
Koordinaten intern lokal (x/y abzueglich Ursprung auf 100 m gerundet, Float32), Export global bzw.
IFC lokal mit IfcMapConversion (Bezugssystem einstellbar, Vorgabe EPSG:2056).
Mindest-Browser: aktuelles Chrome, Edge oder Firefox (WebGL, WebAssembly).

Aenderungen V1.4.0: Abgleich interpoliertes Modell <-> Punktwolke: Abstand jedes Punkts zur interpolierten
  Innenflaeche, Einfaerbung nach Farbskala (Stufen und Farben in den Einstellungen anpassbar, Standard
  <= 2 mm gruen, <= 4 orange, <= 10 rot, <= 20 violett, darueber blau, Suchgrenze 100 mm), Legende mit
  Anteilen, Kennzahlen, Export als PLY mit Abstand.
Aenderungen V1.3.0: Querschnitt-Editor mit Mehrfachauswahl (Strg+Klick, Auswahlrechteck mit Shift, Strg+A;
  gemeinsam loeschen und verschieben), Kreisboegen (Anfang, Ende, Bogenpunkt; aus Kante oder Eckenkette,
  in die Punkte eingepasst; Bogenpunkt ziehbar), Schnitttiefe je Querschnitt.
Aenderungen V1.2.0: Ausschneiden der Punktwolke im Grundriss (Polygon + Hoehenbereich, behalten/entfernen,
  im Projekt gespeichert und rueckgaengig machbar); Ausblenden unklarer Punkte je Querschnitt (Masken, auf
  alle Querschnitte uebertragbar); Ebenen aus Bereichen der Punktwolke einpassen (RANSAC + Ausgleich),
  Anzeige in 3D/Grundriss/Querschnitt und Uebernahme der Schnittlinien in die Profile.
Aenderungen V1.1.0: Teilprofile je Querschnitt (z. B. zwei Tunnelroehren); der automatische Vorschlag
  verbindet nur Punkte bis zum max. Punktabstand (je Querschnitt einstellbar, Vorgabe 20 cm).
  3D: interpolierte Volumenkoerper laufen live mit (inkl. Zwischenquerschnitte), definierte
  Bauteilflaechen der Querschnitte werden gefuellt angezeigt. Projekte V1.0.0 werden uebernommen.
Aenderungen V1.0.0: erste Fassung.
-->
<html lang="de">
<head>
<meta charset="UTF-8">
<!-- CSP gemaess A6, Niveau A: kein Netzzugriff. 'wasm-unsafe-eval' nur fuer das eingebettete laz-perf (LAZ). -->
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; base-uri 'none'; script-src 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'unsafe-inline'; img-src data: blob:; form-action 'none'">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${TOOL} – B+S AG</title>
<style>
${rd('src/template/layout.css')}
</style>

<!-- ═══ Tool-spezifische Styles hier einfuegen ═══ -->
<style>
${rd('src/ui/tool.css')}
</style>
</head>
<body>
<div class="app-shell">

  <!-- ═══════════════════════════════════════════════════════════════
       SIDEBAR — Funktionen, Drop-Zonen, Parameter
       ═══════════════════════════════════════════════════════════════ -->
`;

const sidebar = rd('src/ui/sidebar.html')
  .replace('{{DRAWER_HEAD}}', rd('src/template/drawer_head.html').replace(/\n$/, ''))
  .replace('{{DRAWER_LOG}}', rd('src/template/drawer_log.html').replace(/\n$/, ''));
const header = `
  <!-- ═══════════════════════════════════════════════════════════════
       HEADER — durchgehend, Logo + Toolname + Version rechts
       ═══════════════════════════════════════════════════════════════ -->
${rd('src/template/header.html').replace('{{TOOL}}', TOOL).replace('{{VERSION}}', VERSION)}

  <!-- ═══════════════════════════════════════════════════════════════
       MAIN — Tool-spezifischer Inhalt
       ═══════════════════════════════════════════════════════════════ -->
`;

const libScripts = LIBS.filter(l => l.file.endsWith('.js')).map(l =>
  `<!-- ═══ Eingebettet (A1/A4): ${l.name} · SHA-256 ${l.sha} ═══ -->\n<script>\n${safeScript(noSourceMap(rd(l.file)))}\n</script>`).join('\n');
const wasm = LIBS.find(l => l.file.endsWith('.wasm'));
const wasmB64 = fs.readFileSync(path.join(ROOT, wasm.file)).toString('base64').replace(/.{1,120}/g, '$&\n');

const core = fs.readdirSync(path.join(ROOT, 'src/core')).sort().map(f => rd('src/core/' + f));
const ui = fs.readdirSync(path.join(ROOT, 'src/ui')).filter(f => f.endsWith('.js')).sort().map(f => rd('src/ui/' + f));
const toolCode = `<script>
  /* ═══════════════════════════════════════════════════════════════
     ${TOOL} — Tool-Code (P1: eine IIFE, keine Globals ausser window.BSTool)
     ═══════════════════════════════════════════════════════════════ */
  (function() {
    'use strict';
${safeScript(core.concat(ui).join('\n').replace(/\{\{VERSION\}\}/g, VERSION))}
  })();
</script>`;

const html = head + sidebar + header + rd('src/ui/main.html') + '\n' + rd('src/template/footer_dialog.html') + `

<!-- ═══ Tool-spezifische Scripts hier einfuegen ═══ -->
${libScripts}
<!-- ═══ Eingebettet (A1/A4): ${wasm.name} · SHA-256 der Binaerdatei ${wasm.sha} ═══ -->
<script type="text/plain" id="c2bLazWasm">
${wasmB64}</script>
<script>
${rd('src/template/layout_scripts.js')}</script>
${toolCode}
</body>
</html>
`;

const out = path.join(ROOT, `${TOOL}_V${VERSION.replace(/\./g, '_')}.html`);
fs.writeFileSync(out, html);
console.log('geschrieben:', path.basename(out), (html.length / 1024).toFixed(0) + ' kB');
