// Datos del panel de la estación. Sesión propia (correo y contraseña).
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_KEY, SUPABASE_URL, type Estado, type EstadoRevision } from '../api';
import type { Tipo } from '../formularios';

export const dbp = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: 'simub-panel' },
});

export type Rol = 'admin' | 'coordinador' | 'guardia';
export interface Yo { rol: Rol; nombre: string; alertas_vinculado: boolean }
export interface Reporte {
  id: string; folio: string; tipo: Tipo; estado: Estado; lat: number; lon: number; referencia: string | null;
  detalles: { resumen?: string[] }; creado_en: string; actualizado_en: string; escalado: boolean; num_fotos: number;
  tiene_parte: boolean; ultimo_actor: string | null; min_a_visto: number | null; min_a_lugar: number | null; min_a_cierre: number | null;
}
export interface Detalle extends Reporte {
  comentario: string | null; nombre: string | null; telefono: string | null; anonimo: boolean; precision_m: number | null;
  fotos: string[]; puede_deshacer: boolean; tg_message_id: number | null; historial: { estado: Estado; actor: string | null; en: string }[];
  agregados: { texto: string; en: string }[]; parte: Parte | null;
}
export interface Parte {
  reporte_id?: string; unidad: string | null; personal: string[]; hora_salida: string | null; hora_llegada: string | null; hora_retorno: string | null;
  acciones: string | null; agua_litros: number | null; extintores: number | null; lesionados: number | null; traslados: number | null;
  danos: string | null; causa: string | null; autoridades: string | null; folio_911: string | null; observaciones: string | null; responsable: string | null;
  actualizado_en?: string;
}
export interface Revision {
  id: string; folio: string; estado: EstadoRevision; motivos: string[]; inmueble: string | null; direccion: string;
  horario_preferido: string | null; nombre: string; telefono: string; comentario: string | null; fecha: string | null;
  asignado: string | null; nota_estacion: string | null; checklist: Record<string, string> | null; recomendaciones: string | null;
  creado_en: string; historial: { estado: EstadoRevision; actor: string | null; nota: string | null; en: string }[] | null;
}
export interface Informe {
  total: number; falsos: number; abiertos: number; por_tipo: Partial<Record<Tipo, number>>; por_hora: Record<string, number>;
  por_dia: Record<string, number>; por_semana: { semana: string; total: number }[]; mediana_min_visto: number | null; mediana_min_lugar: number | null;
  partes: number; sin_parte: number; agua_litros: number; extintores: number; lesionados: number; traslados: number;
  por_unidad: Record<string, number>; revisiones: { solicitadas: number; realizadas: number };
  servicios: { folio: string; tipo: Tipo; estado: Estado; creado_en: string; referencia: string | null; unidad: string | null;
    personal: string[] | null; acciones: string | null; lat: number; lon: number }[];
}

const rpc = async <T>(fn: string, args: Record<string, unknown> = {}): Promise<T> => {
  const { data, error } = await dbp.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
};
export const yo = () => rpc<Yo | null>('panel_yo');
export const reportes = (desde: Date) => rpc<Reporte[]>('panel_reportes', { p_desde: desde.toISOString() });
export const detalle = (id: string) => rpc<Detalle | null>('panel_detalle', { p_reporte: id });
export const revisiones = (desde: Date) => rpc<Revision[]>('panel_revisiones', { p_desde: desde.toISOString() });
export const proponerFecha = (id: string, fecha: Date, asignado: string, nota: string) =>
  rpc('panel_proponer_fecha', { p_revision: id, p_fecha: fecha.toISOString(), p_asignado: asignado, p_nota: nota });
export const cerrarRevision = (id: string, realizada: boolean, checklist: Record<string, string> | null, recomendaciones: string) =>
  rpc('panel_cerrar_revision', { p_revision: id, p_realizada: realizada, p_checklist: checklist, p_recomendaciones: recomendaciones });
export const guardarParte = (id: string, p: Record<string, unknown>) => rpc('panel_guardar_parte', { p_reporte: id, p });
export const informe = (desde: Date, hasta: Date) => rpc<Informe>('panel_informe', { p_desde: desde.toISOString(), p_hasta: hasta.toISOString() });
export const codigos = () => rpc<{ rol: string; codigo: string; vinculado: boolean; vinculado_en: string | null }[]>('panel_codigos');

export async function urlsFotos(rutas: string[]): Promise<string[]> {
  if (!rutas.length) return [];
  const { data, error } = await dbp.storage.from('fotos').createSignedUrls(rutas, 600);
  if (error) return [];
  return data.map((d) => d.signedUrl).filter(Boolean) as string[];
}

/** Acciones que pasan por el servidor (aplica reglas y avisa a Telegram y al ciudadano). */
export async function accion(cuerpo: Record<string, unknown>) {
  const { data } = await dbp.auth.getSession();
  const r = await fetch(`${SUPABASE_URL}/functions/v1/panel`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${data.session?.access_token}`, apikey: SUPABASE_KEY, 'content-type': 'application/json' },
    body: JSON.stringify(cuerpo),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? 'servidor');
}

// Catálogos y contenido (tablas con reglas: el personal lee, el admin edita).
export async function tabla<T>(nombre: string, orden = 'id'): Promise<T[]> {
  const { data, error } = await dbp.from(nombre).select('*').order(orden);
  if (error) throw new Error(error.message);
  return (data ?? []) as T[];
}
export async function insertar(nombre: string, fila: Record<string, unknown>) {
  const { error } = await dbp.from(nombre).insert(fila); if (error) throw new Error(error.message);
}
export async function actualizar(nombre: string, id: string | number, cambios: Record<string, unknown>, col = 'id') {
  const { error } = await dbp.from(nombre).update(cambios).eq(col, id); if (error) throw new Error(error.message);
}
export async function guardarConfig(clave: string, valor: unknown) {
  const { error } = await dbp.from('config_publica').upsert({ clave, valor, actualizado_en: new Date().toISOString() });
  if (error) throw new Error(error.message);
}
