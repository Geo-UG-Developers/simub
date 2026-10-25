// Avisos al ciudadano por web push. Las llaves VAPID se generan solas la primera vez.
import webpush from 'npm:web-push@3.6.7';
import { db } from './servicios.ts';
import { CATEGORIA, ETIQUETA_TIPO, fechaMx } from './mensajes.ts';

const b64u = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const desdeB64u = (s: string) =>
  Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '=='.slice(0, (4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0));

interface Llaves { publica: string; privada: string }

export async function llavesVapid(): Promise<Llaves> {
  const { data } = await db.from('config_privada').select('valor').eq('clave', 'vapid').maybeSingle();
  if (data) return data.valor as Llaves;
  const k = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const jwk = await crypto.subtle.exportKey('jwk', k.privateKey);
  const llaves = { publica: b64u(new Uint8Array([4, ...desdeB64u(jwk.x!), ...desdeB64u(jwk.y!)])), privada: jwk.d! };
  await db.from('config_privada').upsert({ clave: 'vapid', valor: llaves }, { onConflict: 'clave', ignoreDuplicates: true });
  const { data: final } = await db.from('config_privada').select('valor').eq('clave', 'vapid').single();
  return final!.valor as Llaves;
}

interface Pendiente { fuente: 'reporte' | 'revision' | 'recordatorio'; id: number; ref: string; estado: string;
  folio: string; tipo: string | null; fecha: string | null; suscripciones: string[] }

function texto(p: Pendiente): { titulo: string; cuerpo: string; url: string } | null {
  const tipo = p.tipo ? ETIQUETA_TIPO[p.tipo] ?? '' : '';
  if (p.fuente === 'reporte') {
    const t: Record<string, [string, string]> = {
      visto: ['La estación vio tu reporte', 'SIMUB ya tiene tu reporte.'],
      en_camino: ['Unidad en camino', 'Una unidad de SIMUB va hacia el lugar. Mantente a salvo.'],
      atendiendo: ['Atendiendo en el lugar', 'El personal de SIMUB ya está atendiendo.'],
      cerrado: ['Reporte atendido', 'SIMUB terminó de atender tu reporte. Gracias por avisar.'],
      falso: ['Reporte cerrado', 'La estación lo marcó como duplicado o no confirmado.'],
    };
    const x = t[p.estado]; if (!x) return null;
    return { titulo: x[0], cuerpo: `${x[1]} ${tipo} · folio ${p.folio}`, url: '#/mis' };
  }
  const f = p.fecha ? fechaMx(p.fecha) : '';
  if (p.fuente === 'recordatorio') return { titulo: 'Tu revisión de seguridad es pronto', cuerpo: `${f} · folio ${p.folio}`, url: '#/mis' };
  const t: Record<string, [string, string]> = {
    propuesta: ['Fecha propuesta para tu revisión', `SIMUB propone: ${f}. Confírmala o pide otra fecha en la app.`],
    realizada: ['Revisión realizada', 'Gracias. Las recomendaciones están en la app.'],
    cancelada: ['Revisión cancelada', 'La estación canceló la visita. Puedes volver a solicitarla.'],
  };
  const x = t[p.estado]; if (!x) return null;
  return { titulo: x[0], cuerpo: `${x[1]} Folio ${p.folio}`, url: '#/mis' };
}

async function mandar(subs: string[], carga: string): Promise<number> {
  let n = 0;
  for (const s of subs) {
    try {
      const req = webpush.generateRequestDetails(JSON.parse(s), carga, { TTL: 86400, urgency: 'high' });
      const r = await fetch(req.endpoint, { method: 'POST', headers: req.headers as Record<string, string>, body: req.body });
      if (r.status === 404 || r.status === 410) await db.rpc('quitar_suscripcion', { p_token: s });
      else if (r.ok) n++;
      else console.error('push', r.status, await r.text());
    } catch (e) { console.error('push error', e); }
  }
  return n;
}

async function preparar() {
  const llaves = await llavesVapid();
  webpush.setVapidDetails('mailto:geougdevelopers@gmail.com', llaves.publica, llaves.privada);
}

export async function enviarAvisos(): Promise<number> {
  const { data, error } = await db.rpc('avisos_pendientes');
  if (error) { console.error('avisos_pendientes', error.message); return 0; }
  const ps = (data ?? []) as Pendiente[];
  if (!ps.length) return 0;
  await preparar();
  let n = 0;
  for (const p of ps) {
    const t = texto(p);
    if (t && p.suscripciones.length) n += await mandar(p.suscripciones, JSON.stringify({ ...t, etiqueta: p.ref }));
  }
  await db.rpc('marcar_avisados', {
    p_reportes: ps.filter((p) => p.fuente === 'reporte').map((p) => p.id),
    p_revisiones: ps.filter((p) => p.fuente === 'revision').map((p) => p.id),
    p_recordatorios: ps.filter((p) => p.fuente === 'recordatorio').map((p) => p.ref),
  });
  return n;
}

/** Noticias nuevas: aviso a todas las personas suscritas. */
export async function avisarNoticias(): Promise<number> {
  const { data, error } = await db.rpc('noticias_por_avisar');
  if (error) { console.error('noticias_por_avisar', error.message); return 0; }
  const ns = (data?.noticias ?? []) as { id: string; titulo: string; categoria: string }[];
  const subs = (data?.suscripciones ?? []) as string[];
  if (!ns.length || !subs.length) return 0;
  await preparar();
  let n = 0;
  for (const x of ns) {
    n += await mandar(subs, JSON.stringify({ titulo: `SIMUB · ${CATEGORIA[x.categoria] ?? 'Noticia'}`, cuerpo: x.titulo, url: '#/noticias', etiqueta: x.id }));
  }
  return n;
}
