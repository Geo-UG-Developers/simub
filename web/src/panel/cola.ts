// Cola sin conexión para el celular de campo: si no hay señal, lo capturado se guarda en el teléfono
// y se envía solo cuando vuelve el internet (incluidas las fotos).
import { dbp, accion } from './datos';

interface Op { id: string; tipo: 'rpc' | 'accion' | 'foto'; fn?: string; args?: Record<string, unknown>; meta?: Record<string, unknown>; en: number }
const CLAVE = 'simub-cola';
const leer = (): Op[] => { try { return JSON.parse(localStorage.getItem(CLAVE) ?? '[]'); } catch { return []; } };
const escribir = (xs: Op[]) => { try { localStorage.setItem(CLAVE, JSON.stringify(xs)); } catch { /* lleno */ } aviso(); };
let alCambiar: ((n: number) => void) | null = null;
const aviso = () => alCambiar?.(leer().length);
export const pendientes = () => leer().length;
export function escucharCola(f: (n: number) => void) { alCambiar = f; f(pendientes()); }

// ---------------------------------------------------------------- fotos en IndexedDB
function idb(): Promise<IDBDatabase> {
  return new Promise((ok, mal) => { const r = indexedDB.open('simub-campo', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('fotos'); r.onsuccess = () => ok(r.result); r.onerror = () => mal(r.error); });
}
async function guardarBlob(k: string, b: Blob) { const d = await idb(); await new Promise((ok, mal) => { const t = d.transaction('fotos', 'readwrite'); t.objectStore('fotos').put(b, k); t.oncomplete = ok; t.onerror = mal; }); }
async function leerBlob(k: string): Promise<Blob | undefined> { const d = await idb(); return new Promise((ok) => { const r = d.transaction('fotos').objectStore('fotos').get(k); r.onsuccess = () => ok(r.result); r.onerror = () => ok(undefined); }); }
async function borrarBlob(k: string) { const d = await idb(); d.transaction('fotos', 'readwrite').objectStore('fotos').delete(k); }

const sinRed = (e: unknown) => !navigator.onLine || /fetch|network|Failed|Load failed|NetworkError/i.test(String((e as Error)?.message ?? e));

async function ejecutar(op: Op) {
  if (op.tipo === 'rpc') { const { error } = await dbp.rpc(op.fn!, op.args); if (error) throw new Error(error.message); }
  else if (op.tipo === 'accion') await accion(op.args!);
  else {
    const m = op.meta as { servicio: string; ext: string; nota: string; lat: number | null; lon: number | null; tipo: string };
    const b = await leerBlob(op.id); if (!b) return;
    const ruta = `${m.servicio}/${op.en}-${op.id.slice(0, 6)}.${m.ext}`;
    const { error } = await dbp.storage.from('evidencias').upload(ruta, b, { contentType: b.type || undefined, upsert: true });
    if (error && !/exists/i.test(error.message)) throw new Error(error.message);
    const { error: e2 } = await dbp.rpc('panel_evidencia', { p_servicio: m.servicio, p_ruta: ruta, p_tipo: m.tipo, p_nota: m.nota, p_lat: m.lat, p_lon: m.lon });
    if (e2) throw new Error(e2.message);
    await borrarBlob(op.id);
  }
}

/** Intenta al momento; si no hay señal, lo deja en la cola. Devuelve true si se envió ya. */
export async function enviar(op: Omit<Op, 'id' | 'en'>, blob?: Blob): Promise<boolean> {
  const o: Op = { ...op, id: crypto.randomUUID(), en: Date.now() };
  if (blob) await guardarBlob(o.id, blob);
  try { await ejecutar(o); return true; }
  catch (e) {
    if (!sinRed(e)) { if (blob) await borrarBlob(o.id); throw e; }
    escribir([...leer(), o]); return false;
  }
}
let vaciando = false;
export async function vaciar() {
  if (vaciando || !navigator.onLine) return; vaciando = true;
  try {
    for (const op of leer()) {
      try { await ejecutar(op); escribir(leer().filter((x) => x.id !== op.id)); }
      catch (e) { if (sinRed(e)) break; escribir(leer().filter((x) => x.id !== op.id)); }   // error de datos: se descarta
    }
  } finally { vaciando = false; }
}
window.addEventListener('online', () => { vaciar(); });
setInterval(() => { vaciar(); }, 30000);

/** Ubicación actual (o null si no hay permiso o tarda mucho). */
export function gps(espera = 8000): Promise<GeolocationPosition | null> {
  return new Promise((ok) => {
    if (!navigator.geolocation) return ok(null);
    navigator.geolocation.getCurrentPosition(ok, () => ok(null), { enableHighAccuracy: true, timeout: espera, maximumAge: 20000 });
  });
}
