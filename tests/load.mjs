// Lädt die Kern-Module (ohne DOM) für Node-Tests.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
export function loadCore() {
  const files = [path.join(root, 'vendor/delaunator.min.js'),
    ...fs.readdirSync(path.join(root, 'src/core')).sort().map(f => path.join(root, 'src/core', f))];
  const code = files.map(f => fs.readFileSync(f, 'utf8')).join('\n;\n') + '\n;C2B';
  const ctx = vm.createContext({ console, TextDecoder, TextEncoder, Math, Date, setTimeout });
  return vm.runInContext(code, ctx, { filename: 'core.js' });
}
