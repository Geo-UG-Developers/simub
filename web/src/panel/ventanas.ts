// SIMUB · Dos ventanas en la misma computadora (panel y tablero de guardia): lo que se hace en una
// se refleja en la otra al instante (BroadcastChannel, con respaldo por localStorage) y, por si acaso,
// cada vista se vuelve a leer sola cada pocos segundos y al regresar a la ventana.
type Oyente = (motivo: string) => void;
const oyentes = new Set<Oyente>();
const canal: BroadcastChannel | null = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('simub-panel') : null;
const emitir = (m: string) => oyentes.forEach((f) => { try { f(m); } catch { /* vista ya cerrada */ } });
canal?.addEventListener('message', (e) => emitir(String((e.data as { m?: string })?.m ?? 'cambio')));
window.addEventListener('storage', (e) => { if (e.key === 'simub-pulso' && !canal) emitir('cambio'); });
/** Avisa a las demás ventanas del panel que algo cambió (servicio, unidad, envío, sesión…). */
export function avisarVentanas(motivo = 'cambio') {
  canal?.postMessage({ m: motivo, t: Date.now() });
  try { localStorage.setItem('simub-pulso', String(Date.now())); } catch { /* sin almacenamiento */ }
}
/** Se llama cuando otra ventana avisa un cambio. Varios avisos seguidos se juntan en una sola lectura (0.6 s). */
export function alCambiar(fn: Oyente) {
  let espera: number | undefined;
  const f: Oyente = (m) => {
    if (m !== 'cambio') { fn(m); return; }
    clearTimeout(espera); espera = window.setTimeout(() => fn(m), 600);
  };
  oyentes.add(f); return () => oyentes.delete(f);
}
