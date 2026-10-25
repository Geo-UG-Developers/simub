// Conexión con el servidor de SIMUB (Supabase).
import { createClient } from '@supabase/supabase-js';
import type { Tipo } from './formularios';

export const SUPABASE_URL = 'https://mgvlvqhnnfhaytjkrtqj.supabase.co';
// Llave pública: va dentro de la app por diseño (la seguridad la dan las reglas de la base de datos).
// GitHub Actions la pone al compilar (VITE_SUPABASE_KEY).
export const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_KEY ?? 'falta-llave-publica';

export const db = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: 'simub-sesion' },
});

export type Estado = 'enviado' | 'visto' | 'en_camino' | 'atendiendo' | 'cerrado' | 'falso';
export type EstadoRevision = 'solicitada' | 'propuesta' | 'confirmada' | 'realizada' | 'cancelada';

export interface MiReporte {
  id: string; folio: string; tipo: Tipo; estado: Estado; creado_en: string; lat: number; lon: number;
  eventos: { estado: Estado; en: string }[]; agregados: number;
}
export interface MiRevision {
  id: string; folio: string; estado: EstadoRevision; motivos: string[]; direccion: string; fecha: string | null;
  asignado: string | null; nota_estacion: string | null; recomendaciones: string | null; creado_en: string;
}
export interface Noticia { id: string; categoria: 'evento' | 'donacion' | 'aviso'; titulo: string; texto: string; foto: string | null; destacada: boolean; publicada_en: string }
export interface InfoPublica {
  config: {
    estacion?: { nombre: string; telefono: string; telefono_texto?: string; direccion: string; horario: string; correo?: string; quienes_somos: string; redes?: Record<string, string> };
    donativos?: { titular: string; banco: string; clabe: string; clabe_texto?: string; concepto: string; enlace_pago: string; montos: number[];
      recibo_deducible: boolean; contacto_recibo: string; voluntariado: string };
    revisiones?: { dias: string; horario: string; costo: string; anticipacion_dias: number };
  };
  necesidades: { id: number; articulo: string; urgente: boolean; cantidad: string | null }[];
  noticias: Noticia[];
}

export async function asegurarSesion(): Promise<string> {
  const { data } = await db.auth.getSession();
  if (data.session) return data.session.access_token;
  const { data: nueva, error } = await db.auth.signInAnonymously();
  if (error || !nueva.session) throw new Error('sin_sesion');
  return nueva.session.access_token;
}

async function llamar(f: FormData): Promise<Record<string, unknown>> {
  const token = await asegurarSesion();
  const r = await fetch(`${SUPABASE_URL}/functions/v1/reportar`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, apikey: SUPABASE_KEY }, body: f,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? 'servidor');
  return j;
}

export async function enviarReporte(d: {
  tipo: Tipo; lat: number; lon: number; precision?: number; detalles: unknown; comentario: string; referencia: string;
  nombre: string; telefono: string; anonimo: boolean; fotos: Blob[];
}): Promise<{ id: string; folio: string; estado: Estado; creado_en: string }> {
  const f = new FormData();
  f.append('accion', 'reporte');
  f.append('tipo', d.tipo); f.append('lat', String(d.lat)); f.append('lon', String(d.lon));
  if (d.precision) f.append('precision', String(Math.round(d.precision)));
  f.append('detalles', JSON.stringify(d.detalles));
  for (const k of ['comentario', 'referencia', 'nombre', 'telefono'] as const) if (d[k]) f.append(k, d[k]);
  if (d.anonimo) f.append('anonimo', '1');
  d.fotos.forEach((b, i) => f.append('fotos', b, `foto${i + 1}.jpg`));
  return await llamar(f) as never;
}

export async function agregarInfo(reporte: string, texto: string) {
  const f = new FormData(); f.append('accion', 'agregar'); f.append('reporte', reporte); f.append('texto', texto);
  await llamar(f);
}

export async function solicitarRevision(d: { motivos: string[]; inmueble: string; direccion: string; horario: string; nombre: string; telefono: string; comentario: string }) {
  const f = new FormData(); f.append('accion', 'revision');
  d.motivos.forEach((m) => f.append('motivos', m));
  for (const k of ['inmueble', 'direccion', 'horario', 'nombre', 'telefono', 'comentario'] as const) if (d[k]) f.append(k, d[k]);
  return await llamar(f) as { id: string; folio: string };
}

export async function responderRevision(revision: string, confirmar: boolean, nota = '') {
  const f = new FormData(); f.append('accion', 'responder_revision'); f.append('revision', revision);
  f.append('confirmar', confirmar ? '1' : '0'); if (nota) f.append('nota', nota);
  await llamar(f);
}

export async function misReportes(): Promise<MiReporte[]> {
  await asegurarSesion();
  const { data, error } = await db.rpc('mis_reportes');
  if (error) throw error;
  return (data ?? []) as MiReporte[];
}
export async function misRevisiones(): Promise<MiRevision[]> {
  await asegurarSesion();
  const { data, error } = await db.rpc('mis_revisiones');
  if (error) throw error;
  return (data ?? []) as MiRevision[];
}

let cacheInfo: InfoPublica | null = null;
export async function infoPublica(fresca = false): Promise<InfoPublica> {
  if (cacheInfo && !fresca) return cacheInfo;
  const { data, error } = await db.rpc('info_publica');
  if (error) throw error;
  cacheInfo = data as InfoPublica;
  return cacheInfo;
}
export const urlFotoNoticia = (ruta: string) => `${SUPABASE_URL}/storage/v1/object/public/noticias/${ruta}`;

/** Reduce la foto a máx. 1600 px y JPEG ~80 %. */
export async function comprimir(archivo: File): Promise<Blob> {
  const img = await createImageBitmap(archivo);
  const escala = Math.min(1, 1600 / Math.max(img.width, img.height));
  const c = document.createElement('canvas');
  c.width = Math.round(img.width * escala); c.height = Math.round(img.height * escala);
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
  return await new Promise((ok) => c.toBlob((b) => ok(b!), 'image/jpeg', 0.8));
}

// ---------------------------------------------------------------- avisos (web push)
export type EstadoAvisos = 'activos' | 'apagados' | 'bloqueados' | 'no_soportado' | 'instalar_ios';
const esIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
const instalada = () => matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;

export async function registrarServiceWorker() {
  if ('serviceWorker' in navigator) {
    try { await navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`); } catch { /* sin avisos */ }
  }
}
export async function estadoAvisos(): Promise<EstadoAvisos> {
  if (esIOS() && !instalada()) return 'instalar_ios';
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'no_soportado';
  if (Notification.permission === 'denied') return 'bloqueados';
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  return sub && Notification.permission === 'granted' ? 'activos' : 'apagados';
}
const aBytes = (b64: string) => {
  const s = atob(b64.replace(/-/g, '+').replace(/_/g, '/') + '=='.slice(0, (4 - (b64.length % 4)) % 4));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
};
export async function activarAvisos(): Promise<EstadoAvisos> {
  await asegurarSesion();
  const permiso = await Notification.requestPermission();
  if (permiso !== 'granted') return permiso === 'denied' ? 'bloqueados' : 'apagados';
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    const r = await fetch(`${SUPABASE_URL}/functions/v1/avisos`, { headers: { apikey: SUPABASE_KEY } });
    const { publicKey } = await r.json();
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: aBytes(publicKey) });
  }
  const { error } = await db.rpc('registrar_push', { p_token: JSON.stringify(sub) });
  if (error) throw error;
  return 'activos';
}
