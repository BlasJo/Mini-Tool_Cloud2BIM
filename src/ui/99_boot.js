/* ═══ Start ═══ */
C2B.read.lazWasmProvider = () => {
  const el = document.getElementById('c2bLazWasm');
  if (!el) return null;
  const bin = atob(el.textContent.replace(/\s+/g, ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => APP.init());
else APP.init();
window.BSTool = { APP, C2B };
