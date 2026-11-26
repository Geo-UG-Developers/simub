// Datos del panel de la estación. Sesión propia (correo y contraseña).
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_KEY, SUPABASE_URL, type Estado, type EstadoRevision } from '../api';
import type { Tipo } from '../formularios';

export const dbp = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: 'simub-panel' },
});

export type Rol = 'admin' | 'coordinador' | 'guardia';
export interface Yo { rol: Rol; nombre: string; cargo: string | null; super: boolean; alertas_vinculado: boolean }
export interface Reporte {
  id: string; folio: string; tipo: Tipo; estado: Estado; lat: number; lon: number; referencia: string | null;
  detalles: { resumen?: string[] }; creado_en: string; actualizado_en: string; escalado: boolean; num_fotos: number;
  tiene_parte: boolean; servicio_id?: string | null; ultimo_actor: string | null; min_a_visto: number | null; min_a_lugar: number | null; min_a_cierre: number | null;
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

// ---------------------------------------------------------------- servicios (folio único, centro de mando)
export type EstadoServicio = 'activo' | 'cerrado' | 'anulado';
export type EstadoUnidad = 'disponible' | 'en_servicio' | 'fuera_servicio';
export interface Tripulante { unidad: string; maquinista: string; jefe: string; bomberos: string }
export interface Servicio {
  id: string; anio: number; folio: number; estado: EstadoServicio; origen: 'captura' | 'app' | 'historico'; reporte_id: string | null;
  clasificacion: string; especificacion: string | null; falsa_alarma: boolean; fecha: string;
  h_reporte: string | null; h_despacho: string | null; h_llegada: string | null; h_disponible: string | null; h_base: string | null;
  km_salida: number | null; km_llegada: number | null; lugar: string | null; lat: number | null; lon: number | null; area_afectada: string | null;
  medio: string | null; reportante: string | null; telefono: string | null; unidades: string[]; personal_num: number | null;
  tripulacion: Tripulante[]; datos: Record<string, string>; vehiculos: Record<string, string>[];
  apoyos: Record<string, { unidades?: string; encargado?: string }>; personas: { nombre: string; codigo: string; edad: string }[];
  observaciones: string | null; jefe_servicio: string | null; radio_operador: string | null; jefe_guardia: string | null;
  creado_en: string; actualizado_en: string; colonia: string | null; capturo: string | null; editado_por: string | null;
  firmas: Record<string, { nombre: string | null; imagen: string; en: string; registro: string }>; bloqueado: boolean; huella: string | null; puede_editar?: boolean;
  bitacora?: { texto: string; autor: string | null; en: string }[]; reporte_folio?: string | null;
}
export type ServicioLista = Pick<Servicio, 'id' | 'anio' | 'folio' | 'estado' | 'origen' | 'clasificacion' | 'especificacion' | 'falsa_alarma' | 'fecha'
  | 'h_reporte' | 'h_despacho' | 'h_llegada' | 'h_base' | 'lugar' | 'colonia' | 'capturo' | 'lat' | 'lon' | 'area_afectada' | 'medio' | 'unidades' | 'personal_num' | 'apoyos'> & { con_parte: boolean; firmado: boolean };
export interface Unidad { id: number; nombre: string; tipo: string | null; estado: EstadoUnidad; nota: string | null; servicio_id: string | null; desde: string; folio: number | null }
export interface Mando {
  servicios: Servicio[]; unidades: Unidad[]; hoy: number;
  pendientes: { id: string; folio: string; tipo: Tipo; estado: Estado; referencia: string | null; creado_en: string; resumen: string[] | null }[];
}
export interface Conteos { conteos: { c: string; mes: number; n: number }[]; apoyos: Record<string, number>; minutos_promedio: number | null }

const dia = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const mando = () => rpc<Mando>('panel_mando');
export const servicio = (id: string) => rpc<Servicio | null>('panel_servicio', { p_id: id });
export const servicios = (desde: Date, hasta: Date) => rpc<ServicioLista[]>('panel_servicios', { p_desde: dia(desde), p_hasta: dia(hasta) });
export const guardarServicio = (id: string | null, p: Record<string, unknown>) =>
  rpc<{ id: string; anio: number; folio: number }>('panel_guardar_servicio', { p_id: id, p });
export const servicioDesdeReporte = (id: string) => rpc<{ id: string }>('panel_servicio_desde_reporte', { p_reporte: id });
export const bitacora = (id: string, texto: string | null, hito: string | null = null) => rpc('panel_bitacora', { p_servicio: id, p_texto: texto, p_hito: hito });
export const cerrarServicio = (id: string) => rpc('panel_cerrar_servicio', { p_servicio: id });
export const reabrirServicio = (id: string) => rpc('panel_reabrir_servicio', { p_servicio: id });
export const anularServicio = (id: string, motivo: string) => rpc('panel_anular_servicio', { p_servicio: id, p_motivo: motivo });
export const estadoUnidad = (id: number, estado: EstadoUnidad, nota: string | null = null) => rpc('panel_unidad', { p_unidad: id, p_estado: estado, p_nota: nota });
export const conteos = (anio: number) => rpc<Conteos>('panel_conteos', { p_anio: anio });
export const importarServicios = (filas: unknown[]) => rpc<{ importados: number; omitidos: number }>('panel_importar_servicios', { p_filas: filas });

// ---------------------------------------------------------------- control interno, firmas, respaldo, voluntariado
export const sesionIniciar = (equipo: string, anterior: number | null) => rpc<number>('panel_sesion_iniciar', { p_equipo: equipo, p_anterior: anterior });
export const latido = (id: number) => rpc<{ activa: boolean }>('panel_latido', { p_sesion: id });
export const sesionCerrar = (id: number, motivo: string) => rpc('panel_sesion_cerrar', { p_sesion: id, p_motivo: motivo });
export interface Sesion { id: number; nombre: string; rol: string; equipo: string | null; inicio: string; fin: string | null; motivo: string | null; turno_de: string | null; minutos: number; folios: string[] }
export interface Auditoria { id: number; en: string; quien: string | null; accion: string; tabla: string | null; registro: string | null; detalle: Record<string, unknown> | null }
export const control = (desde: Date, hasta: Date) => rpc<{ sesiones: Sesion[]; auditoria: Auditoria[]; super: boolean }>('panel_control', { p_desde: desde.toISOString(), p_hasta: hasta.toISOString() });
export const borrarAuditoria = (ids: number[]) => rpc<{ borradas: number }>('panel_auditoria_borrar', { p_ids: ids });
export const firmar = (id: string, campo: string, nombre: string, imagen: string | null, huella: string | null) =>
  rpc('panel_firmar', { p_servicio: id, p_campo: campo, p_nombre: nombre, p_imagen: imagen, p_huella: huella });
export const desbloquear = (id: string, motivo: string) => rpc('panel_desbloquear', { p_servicio: id, p_motivo: motivo });
export const respaldo = (anio: number) => rpc<Record<string, unknown> & { servicios: Servicio[]; bitacora: { servicio: string; texto: string; autor: string; en: string }[] }>('panel_respaldo', { p_anio: anio });
export const registrarImportacion = (resumen: Record<string, unknown>) => rpc('panel_importar_registrar', { p_resumen: resumen });
export interface Voluntario { id: string; nombre: string; edad: number; telefono: string; correo: string | null; escolaridad: string | null; ocupacion: string | null; disponibilidad: string[]; motivo: string | null; estado: string; creado_en: string }
export const voluntarios = () => rpc<Voluntario[]>('panel_voluntarios');
export const estadoVoluntario = (id: string, estado: string) => rpc('panel_voluntario_estado', { p_id: id, p_estado: estado });
