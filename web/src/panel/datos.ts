// Datos del panel de la estación. Sesión propia (correo y contraseña).
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_KEY, SUPABASE_URL, type Estado, type EstadoRevision } from '../api';
import type { Tipo } from '../formularios';

export const dbp = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: 'simub-panel' },
});

export type Rol = 'admin' | 'coordinador' | 'guardia' | 'campo';
export interface Yo { rol: Rol; nombre: string; cargo: string | null; super: boolean; alertas_vinculado: boolean; unidad?: string | null }
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
  return j as Record<string, unknown>;
}

// Catálogos y contenido (tablas con reglas: el personal lee, el admin edita).
// «personal» no expone al navegador el chat de Telegram ni el código de vinculación: se piden columnas exactas.
export const COLS_PERSONAL = 'id, nombre, cargo, activo, nombre_corto, telefono, email, comunicacion_interna, reportes_app, comparte_ubicacion';
export async function tabla<T>(nombre: string, orden = 'id'): Promise<T[]> {
  const { data, error } = await dbp.from(nombre).select(nombre === 'personal' ? COLS_PERSONAL : '*').order(orden);
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
  turno?: 'dia' | 'noche' | null; recursos?: Record<string, number | string>; perimetro?: unknown; sci?: Record<string, string>;
  escena?: { id: number; persona: string; asignacion: string | null; entra: string; sale: string | null; aire_inicio: string | null; aire_min: number | null }[];
  evidencias?: { id: string; ruta: string; tipo: string; nota: string | null; autor: string | null; en: string }[]; voy?: string[];
  bitacora?: { texto: string; autor: string | null; en: string }[]; reporte_folio?: string | null;
}
export type ServicioLista = Pick<Servicio, 'id' | 'anio' | 'folio' | 'estado' | 'origen' | 'clasificacion' | 'especificacion' | 'falsa_alarma' | 'fecha'
  | 'h_reporte' | 'h_despacho' | 'h_llegada' | 'h_base' | 'lugar' | 'colonia' | 'capturo' | 'turno' | 'lat' | 'lon' | 'area_afectada' | 'medio' | 'unidades' | 'personal_num' | 'apoyos'> & { con_parte: boolean; firmado: boolean };
export interface Unidad { id: number; nombre: string; tipo: string | null; estado: EstadoUnidad; nota: string | null; servicio_id: string | null; desde: string; folio: number | null }
export interface Posicion { unidad: string; tipo?: 'unidad' | 'oficial'; lat: number; lon: number; en: string; servicio_id: string | null; autor?: string | null; folio?: number | null; clase?: string | null; precision_m?: number | null }
export interface Mando {
  servicios: (Servicio & { escena?: number; enviado_oficial?: string[]; enviado_interno?: boolean })[]; unidades: Unidad[]; hoy: number; guardia?: Guardia; alertas?: Alertas;
  posiciones?: Posicion[];
  pendientes: { id: string; folio: string; tipo: Tipo; estado: Estado; referencia: string | null; creado_en: string; resumen: string[] | null }[];
}
export interface Conteos { conteos: { c: string; mes: number; n: number }[]; turnos?: { mes: number; turno: string; n: number }[]; apoyos: Record<string, number>; minutos_promedio: number | null; dias?: { fecha: string; n: number }[] }

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

// ---------------------------------------------------------------- operación: turno, campo, unidades, mapa, capacitación
export interface Guardia { fecha: string; turno: 'dia' | 'noche'; jefe: string | null; personal: string[]; registro: string | null; en: string | null }
export const guardia = () => rpc<Guardia>('panel_guardia');
export const guardarGuardia = (jefe: string, personal: string[]) => rpc<Guardia>('panel_guardia_guardar', { p_jefe: jefe, p_personal: personal });
export interface Alertas { sin_inspeccion: string[]; caducidades: { articulo: string; ubicacion: string; caducidad: string }[];
  mantenimiento: { unidad: string; tipo: string; proximo: string }[]; certificaciones: { titulo: string; vigencia: string }[]; sin_firma: number }
export interface Escena { id: number; persona: string; asignacion: string | null; entra: string; sale: string | null; aire_inicio: string | null; aire_min: number | null }
export interface Evidencia { id: string; ruta: string; tipo: string; nota: string | null; autor: string | null; en: string }
export interface ServicioCampo extends Servicio { clase: string; color: string; escena: Escena[]; evidencias: Evidencia[] }
export const campo = () => rpc<{ unidad: string | null; servicios: ServicioCampo[] }>('panel_campo');
export const servicioParcial = (id: string, p: Record<string, unknown>) => rpc('panel_servicio_parcial', { p_id: id, p });
export const posicion = (unidad: string, lat: number, lon: number, precision: number, servicio: string | null) =>
  rpc('panel_posicion', { p_unidad: unidad, p_lat: lat, p_lon: lon, p_precision: Math.round(precision), p_servicio: servicio });
export const evidencia = (servicio: string, ruta: string, tipo: string, nota: string, lat: number | null, lon: number | null) =>
  rpc('panel_evidencia', { p_servicio: servicio, p_ruta: ruta, p_tipo: tipo, p_nota: nota, p_lat: lat, p_lon: lon });
export const escena = (servicio: string, accion: string, persona: string | null, asignacion: string | null = null, aire: number | null = null, id: number | null = null) =>
  rpc('panel_escena', { p_servicio: servicio, p_accion: accion, p_persona: persona, p_asignacion: asignacion, p_aire_min: aire, p_id: id });
export const bitacoraGps = (id: string, texto: string | null, hito: string | null, lat: number | null, lon: number | null) =>
  rpc('panel_bitacora', { p_servicio: id, p_texto: texto, p_hito: hito, p_lat: lat, p_lon: lon });
export const alertas = () => rpc<Alertas>('panel_alertas');
export const horas = (anio: number) => rpc<{ persona: string; capacitacion: number; guardias: number; horas_guardia: number }[]>('panel_horas', { p_anio: anio });
export const guardarFirms = (llave: string) => rpc('panel_guardar_firms', { p_llave: llave });
/** Avisa al grupo interno de Telegram (crea o actualiza el mensaje del folio). No bloquea si falla. */
export const notificar = (servicio: string) => accion({ accion: 'servicio', servicio }).catch(() => {});
export async function subirEvidencia(servicio: string, archivo: Blob, ext: string): Promise<string> {
  const ruta = `${servicio}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await dbp.storage.from('evidencias').upload(ruta, archivo, { contentType: archivo.type || undefined, upsert: false });
  if (error) throw new Error(error.message);
  return ruta;
}
export async function urlsEvidencias(rutas: string[]): Promise<string[]> {
  if (!rutas.length) return [];
  const { data } = await dbp.storage.from('evidencias').createSignedUrls(rutas, 900);
  return (data ?? []).map((d) => d.signedUrl ?? '');
}

// ---------------------------------------------------------------- acceso con límite de intentos (función «acceso»)
export type ResultadoAcceso = { ok: true; user_id: string } | { ok: false; error: 'credenciales' | 'bloqueado' | 'red' | 'servidor'; restantes?: number };
/** Entra con correo y contraseña pasando por el servidor (5 intentos fallidos → bloqueo de 30 min y correo al usuario). */
export async function entrar(email: string, clave: string, cliente = dbp): Promise<ResultadoAcceso> {
  let r: Response;
  try {
    r = await fetch(`${SUPABASE_URL}/functions/v1/acceso`, { method: 'POST',
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ email: email.trim(), password: clave }) });
  } catch { return { ok: false, error: 'red' }; }
  const j = await r.json().catch(() => ({}));
  if (r.status === 423) return { ok: false, error: 'bloqueado' };
  if (r.status === 401) return { ok: false, error: 'credenciales', restantes: j.restantes };
  if (!r.ok || !j.sesion?.access_token) return { ok: false, error: 'servidor' };
  const { data, error } = await cliente.auth.setSession({ access_token: j.sesion.access_token, refresh_token: j.sesion.refresh_token });
  return error || !data.user ? { ok: false, error: 'servidor' } : { ok: true, user_id: data.user.id };
}
export const textoAcceso = (r: ResultadoAcceso) => r.ok ? '' : r.error === 'bloqueado'
  ? 'Cuenta bloqueada 30 minutos por 5 intentos fallidos. Se envió un aviso a su correo para restablecer la contraseña; el Admin. Maestro puede desbloquearla en Ajustes.'
  : r.error === 'credenciales' ? `Correo o contraseña incorrectos.${r.restantes != null ? ` Quedan ${r.restantes} intento(s) antes del bloqueo.` : ''}`
  : r.error === 'red' ? 'Sin conexión. Revisa el internet.' : 'No se pudo verificar. Intenta de nuevo.';

export interface Oficial { id: number; nombre: string; corto: string; cargo: string | null; telefono: string | null; vinculado: boolean; comparte: boolean; enlace?: string | null }
export const oficiales = () => rpc<Oficial[]>('panel_oficiales');
export const enviarOficial = (servicio: string, ids: number[]) => accion({ accion: 'oficial', servicio, oficiales: ids }) as unknown as Promise<{ enviados: string[]; sin_telegram: string[] }>;
export const enviarInterno = (servicio: string) => accion({ accion: 'interno', servicio });
export interface Cuenta { user_id: string; nombre: string; rol: Rol; cargo: string | null; unidad: string | null; superusuario: boolean; email: string | null; ultimo_acceso: string | null; bloqueado: boolean }
export const cuentas = () => rpc<Cuenta[]>('panel_cuentas');
export const desbloquearAcceso = (email: string) => rpc('panel_desbloquear_acceso', { p_email: email });
export const guardarCuenta = (c: Record<string, unknown>) => accion({ accion: 'cuenta', ...c });

/** Autorización del Admin. Maestro para corregir un parte cerrado (30 min, para la cuenta que está en el panel).
 *  Se verifica con una sesión temporal que no reemplaza la de quien está en turno. */
export async function autorizarEdicion(servicioId: string, email: string, clave: string): Promise<string | null> {
  const { data: s } = await dbp.auth.getSession(); const para = s.session?.user.id;
  if (!para) return 'Tu sesión venció. Vuelve a entrar.';
  const temp = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false, autoRefreshToken: false, storageKey: 'simub-autoriza' } });
  const r = await entrar(email, clave, temp);
  if (!r.ok) return textoAcceso(r);
  try {
    const quien = (await temp.rpc('panel_yo')).data as Yo | null;
    if (quien?.rol !== 'admin') return 'Esa cuenta no es Admin. Maestro: no puede autorizar correcciones.';
    const { error } = await temp.rpc('panel_autorizar', { p_servicio: servicioId, p_para: para });
    return error ? 'No se pudo registrar la autorización.' : null;
  } finally { await temp.auth.signOut({ scope: 'local' }).catch(() => {}); }
}
