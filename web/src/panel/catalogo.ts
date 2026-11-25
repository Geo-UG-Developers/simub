// Catálogo homologado de servicios (el mismo de su Excel) y lectura del Excel histórico de SIMUB.
// Funciones puras: se prueban sin navegador.
import type { Celda, Hoja } from './excel';

export interface Clase { id: string; grupo: string; nombre: string; color: string; orden: number; activo: boolean }

export const MEDIOS = ['911', 'Radio', 'Teléfono de cabina', 'WhatsApp', 'App SIMUB', 'Presencial', 'Otro'];
// Corporaciones de su formato de parte (página 2).
export const CORPORACIONES = ['Policía preventiva', 'Cruz Roja', 'S.U.E.G.', 'P.C. Municipal', 'P.C. Estatal', 'Tránsito Municipal',
  'Policía Estatal de Caminos', 'FSPE', 'Ejército', 'Guardia Nacional', 'Ministerio Público', 'Peritos', 'CONAFOR', 'Otros'];

const norm = (x: unknown) => String(x ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();

/** Clasifica «SERVICIO» + «TIPO DE SERVICIO (ESPECIFICACIÓN)» como lo cuenta SIMUB en su hoja anual. */
export function clasificar(servicio: unknown, especificacion: unknown): { clasificacion: string; falsa: boolean } {
  let s = norm(servicio), t = norm(especificacion);
  const falsa = s.startsWith('FALSA');
  if (falsa) { s = t; t = norm(especificacion); }
  const x = `${s} ${t}`;
  const de = (pares: [RegExp, string][], otro: string) => pares.find(([r]) => r.test(x))?.[1] ?? otro;
  let c: string;
  if (s.startsWith('INCENDIO') || /PASTIZAL|ESTRUCTURAL|BASURA|BALDIO/.test(s)) {
    c = de([[/PASTIZAL|CERRO|MALEZA|ZACATE/, 'inc_pastizal'], [/ESTRUCT|CASA|COMERCIO|BODEGA/, 'inc_estructural'], [/VEHIC|AUTO|CAMION/, 'inc_vehicular'],
      [/FOREST/, 'inc_forestal'], [/BALDI/, 'inc_baldio'], [/CABLE|ELECTR|TRANSFORMADOR/, 'inc_cables'], [/LLANTA/, 'inc_llantas'],
      [/CARRIZ/, 'inc_carrizos'], [/CILINDRO|TANQUE/, 'inc_cilindro'], [/ARBOL|PINO/, 'inc_arbol'], [/BASURA/, 'inc_basura']], falsa ? 'inc_pastizal' : 'inc_basura');
  } else if (s.startsWith('ACCIDENTE') || /^(CHOQUE|ATROPELL)/.test(s)) {
    c = /MOTO/.test(x) ? 'acc_moto' : /VOLCAD/.test(x) ? 'acc_volcadura' : 'acc_vehicular';
  } else if (s.startsWith('RESCATE') || s.startsWith('BUSQUEDA')) {
    c = de([[/ACUAT|PRESA|RIO/, 'res_acuatico'], [/ANGULO|ALTURA/, 'res_angulo'], [/CONFIN/, 'res_confinado'], [/K-?9|CANINO/, 'res_k9']], 'res_vehicular');
  } else if (s.startsWith('PACIENTE') || s.startsWith('LESIONAD')) {
    c = /TRAUMA/.test(x) ? 'pac_trauma' : 'pac_clinico';
  } else if (s.startsWith('TRASLADO')) c = 'traslado';
  else if (s.startsWith('CAIDA')) c = de([[/CABLE/, 'cai_cables'], [/POSTE/, 'cai_poste'], [/ARBOL|RAMA/, 'cai_arbol']], 'cai_estructura');
  else if (/INUNDACI/.test(s)) c = 'inundacion';
  else if (s.startsWith('EVENTO')) c = 'evento';
  else if (s.startsWith('SIMULACRO')) c = 'simulacro';
  else if (s.startsWith('CAPACITACI') || s.startsWith('PLATICA') || s.startsWith('CURSO')) c = 'capacitacion';
  else if (s.startsWith('PREVENCI')) c = 'prevencion';
  else if (/FAUNA|ANIMAL|ABEJA|AVISPA|ENJAMBRE|SERPIENTE|REPTIL|GUARICH/.test(s)) {
    c = /ABEJ|AVISP|GUARICH|PANAL|ENJAMBRE|ABEJORR/.test(x) ? 'fau_enjambre'
      : /SERPIENT|VIBORA|CULEBRA|IGUANA|REPTIL|LAGART|CASCABEL|CORALILLO|TORTUGA/.test(x) ? 'fau_reptil' : 'fau_animal';
  } else if (s.startsWith('REVISION')) c = 'revision';
  else if (/GAS/.test(s)) c = 'fuga_gas';
  else c = 'otros';
  return { clasificacion: c, falsa };
}

// ---------------------------------------------------------------- Excel histórico
const MESES = ['ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE'];
export const MESES_TXT = MESES.map((m) => m[0] + m.slice(1).toLowerCase());

export interface FilaImportada {
  anio: number; folio: number; fecha: string; clasificacion: string; falsa_alarma: boolean; especificacion: string;
  lugar: string; area_afectada: string; unidades: string[]; personal_num: number | null; h_despacho: string | null; h_base: string | null;
}
export interface ResultadoLectura { filas: FilaImportada[]; avisos: string[]; hojas: string[] }

const pad = (n: number) => String(n).padStart(2, '0');
const diasMes = (a: number, m: number) => new Date(Date.UTC(a, m, 0)).getUTCDate();
/** Hora de una celda: fracción de día de Excel o texto «15:;42». Devuelve minutos desde 00:00 (puede pasar de 24 h). */
function minutosDe(v: Celda): number | null {
  if (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v < 3) return Math.round(v * 1440);
  const m = String(v ?? '').match(/(\d{1,2})\D{1,3}(\d{2})/);
  if (m && +m[1] < 48 && +m[2] < 60) return +m[1] * 60 + +m[2];
  return null;
}
const iso = (fecha: string, min: number) => {
  const d = new Date(`${fecha}T00:00:00-06:00`); d.setTime(d.getTime() + min * 60000); return d.toISOString();
};
const unidadesDe = (v: Celda) => String(v ?? '').toUpperCase().split(/\s*(?:\/|,|\bY\b)\s*/)
  .map((u) => u.trim().replace(/^([A-Z]{1,2})\s*-?\s*0?(\d{1,2})$/, (_, l: string, n: string) => `${l}-${n.padStart(2, '0')}`))
  .filter((u) => u && u !== 'N/A' && u !== 'X');

/** Lee las hojas «ENERO 2026», «FEBRERO 2026»… (columnas FOLIO, FECHA, SERVICIO, TIPO, LUGAR, ÁREA, EQUIPO, PERSONAL, TIEMPO, TIEMPO2). */
export function leerHistorico(hojas: Hoja[]): ResultadoLectura {
  const filas: FilaImportada[] = []; const avisos: string[] = []; const usadas: string[] = [];
  const porClave = new Map<string, FilaImportada>();
  for (const h of hojas) {
    const m = norm(h.nombre).match(/^([A-Z]+) (\d{4})$/);
    if (!m || !MESES.includes(m[1])) continue;
    const anio = +m[2], mes = MESES.indexOf(m[1]) + 1;
    const cab = h.filas.findIndex((f) => norm(f[0]) === 'FOLIO');
    if (cab < 0) { avisos.push(`${h.nombre}: no encontré la fila de encabezados (FOLIO, FECHA…).`); continue; }
    const col = (re: RegExp, def: number) => { const i = h.filas[cab].findIndex((x) => re.test(norm(x))); return i < 0 ? def : i; };
    const C = { folio: col(/^FOLIO/, 0), fecha: col(/^FECHA/, 1), serv: col(/^SERVICIO/, 2), tipo: col(/^TIPO/, 3), lugar: col(/^LUGAR/, 4),
      area: col(/^AREA/, 5), equipo: col(/^EQUIPO|^UNIDAD/, 6), personal: col(/^PERSONAL/, 7), t1: col(/^TIEMPO$/, 8), t2: col(/^TIEMPO ?2/, 9) };
    usadas.push(h.nombre);
    let prevFolio = 0, prevDia = 1, n = 0;
    for (const f of h.filas.slice(cab + 1)) {
      if (!f || !norm(f[C.serv])) continue;
      // Fecha: número de Excel; si está mal escrita o es de otro mes, se usa el día anterior de la misma hoja.
      let dia = prevDia; const v = f[C.fecha];
      if (typeof v === 'number' && v > 20000) {
        const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * 864e5);
        if (d.getUTCMonth() + 1 === mes && d.getUTCDate() <= diasMes(anio, mes)) dia = d.getUTCDate();
        else if (d.getUTCDate() <= diasMes(anio, mes) && d.getUTCDate() >= prevDia) dia = d.getUTCDate();
      } else if (v != null && v !== '') {
        const t = String(v).match(/^(\d{1,2})\D/); if (t && +t[1] >= prevDia && +t[1] <= diasMes(anio, mes)) dia = +t[1];
      }
      prevDia = dia;
      const fecha = `${anio}-${pad(mes)}-${pad(dia)}`;
      const { clasificacion, falsa } = clasificar(f[C.serv], f[C.tipo]);
      const t1 = minutosDe(f[C.t1]); let t2 = minutosDe(f[C.t2]);
      if (t1 != null && t2 != null && t2 < t1) t2 += 1440;
      const fila: FilaImportada = {
        anio, folio: 0, fecha, clasificacion, falsa_alarma: falsa,
        especificacion: String(f[C.tipo] ?? '').trim(), lugar: String(f[C.lugar] ?? '').trim(),
        area_afectada: ['N/A', 'NA', '-'].includes(norm(f[C.area])) ? '' : String(f[C.area] ?? '').trim(),
        unidades: unidadesDe(f[C.equipo]), personal_num: Number.isFinite(Number(f[C.personal])) && f[C.personal] !== null && f[C.personal] !== '' ? Math.round(Number(f[C.personal])) : null,
        h_despacho: t1 != null ? iso(fecha, t1) : null, h_base: t2 != null ? iso(fecha, t2) : null,
      };
      // Folio: el de la hoja; si se repite o está fuera de secuencia, se corrige al consecutivo.
      const esperado = prevFolio + 1;
      let folio = Number.isInteger(f[C.folio]) ? (f[C.folio] as number) : NaN;
      const clave = (x: number) => `${anio}-${x}`;
      const dup = Number.isFinite(folio) ? porClave.get(clave(folio)) : undefined;
      if (dup && dup.fecha === fila.fecha && dup.h_despacho === fila.h_despacho && dup.clasificacion === fila.clasificacion) {
        avisos.push(`${h.nombre}: folio ${folio} está repetido (misma hora y servicio); se tomó una sola vez.`); continue;
      }
      if (!Number.isFinite(folio) || dup || (prevFolio && Math.abs(folio - esperado) > 3)) {
        const antes = Number.isFinite(folio) ? String(folio) : `«${String(f[C.folio] ?? '')}»`;
        if (prevFolio && !porClave.has(clave(esperado))) { folio = esperado; avisos.push(`${h.nombre}: folio ${antes} corregido a ${folio} (${fecha}).`); }
        else if (Number.isFinite(folio) && !dup) { /* primer folio de la hoja: se respeta */ }
        else { avisos.push(`${h.nombre}: fila con folio ${antes} (${fecha}) no se pudo ubicar; revísala.`); continue; }
      }
      fila.folio = folio; prevFolio = folio; n++;
      porClave.set(clave(folio), fila); filas.push(fila);
    }
    if (!n) avisos.push(`${h.nombre}: sin servicios.`);
  }
  return { filas, avisos, hojas: usadas };
}
