// SIMUB · Unidades y equipo: revisión de la unidad al inicio del turno (con falla crítica → fuera de servicio),
// equipos de respiración, kilometraje y horas de bomba, historial de mantenimiento con recordatorios,
// inventario con caducidades.
import { comprimir } from '../api';
import { dbp, guardia, insertar, actualizar, tabla } from './datos';
import { descargar, escribirExcel, type Celda } from './excel';
import type { Ctx } from './mando';

const esc = (t: unknown) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const fh = (f?: string | null) => f ? new Date(f).toLocaleString('es-MX', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
const fd = (f?: string | null) => f ? new Date(`${f}T12:00:00`).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
const turnoAhora = () => { const h = new Date().getHours(); return h >= 8 && h < 20 ? 'dia' : 'noche'; };
const fechaTurno = () => { const d = new Date(Date.now() - 8 * 3600e3); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

// Lista de revisión. Las marcadas con * sacan la unidad de servicio si fallan.
export const CHECKLIST: [string, string[]][] = [
  ['Motor y niveles', ['Aceite de motor', 'Anticongelante', 'Combustible*', 'Líquido de frenos', 'Batería']],
  ['Unidad', ['Llantas*', 'Frenos*', 'Luces', 'Torreta y sirena', 'Radio*', 'Limpieza']],
  ['Bomba y agua', ['Bomba (prueba)*', 'Tanque de agua lleno', 'Mangueras', 'Pitones', 'Espuma']],
  ['Equipo', ['Equipos de respiración', 'Herramienta de rescate', 'Escaleras', 'Extintor', 'Botiquín', 'Equipo de protección (EPP)', 'Linternas']],
];
const critico = (i: string) => i.endsWith('*');
const limpio = (i: string) => i.replace(/\*$/, '');
interface Insp { id: number; unidad: string; fecha: string; turno: string; km: number | null; horas_bomba: number | null; checklist: Record<string, string>; scba: { equipo: string; psi: number }[]; fallas: string[]; critica: boolean; notas: string | null; fotos: string[]; autor: string | null; en: string }

/** Formulario de revisión (lo usan el panel y el celular de campo). */
export async function formInspeccion(c: Ctx, caja: HTMLElement, unidadFija: string | null, alListo: () => void) {
  const uds = (await tabla<{ nombre: string; tipo: string | null; activa: boolean }>('unidades', 'nombre').catch(() => [])).filter((u) => u.activa);
  caja.innerHTML = `<form class="parte" id="f-insp"><fieldset class="sin-borde">
    <section class="bloque"><div class="rejilla-3">
      <label>Unidad<select name="unidad" required>${unidadFija ? '' : '<option value="">Elige…</option>'}${uds.map((u) => `<option ${u.nombre === unidadFija ? 'selected' : ''}>${esc(u.nombre)}</option>`).join('')}</select></label>
      <label>Kilometraje<input type="number" inputmode="numeric" name="km" placeholder="Del tablero"></label>
      <label>Horas de bomba<input type="number" inputmode="decimal" step="0.1" name="horas_bomba"></label></div>
      <p class="tenue chica">Toca <b>Bien</b>, <b>Falla</b> o <b>N/A</b> en cada renglón. Lo marcado con ● es crítico: si falla, la unidad queda <b>fuera de servicio</b> en el Centro de mando.</p>
      <button type="button" class="btn chico" id="todo-bien">Marcar todo «Bien»</button></section>
    ${CHECKLIST.map(([g, items]) => `<section class="bloque"><h3>${g}</h3>${items.map((i) => `<div class="insp-fila"><span>${esc(limpio(i))}${critico(i) ? ' <b class="rojo">●</b>' : ''}</span>
      <span class="insp-op" data-item="${esc(limpio(i))}" data-crit="${critico(i) ? 1 : 0}">${['ok', 'falla', 'na'].map((v) => `<button type="button" data-v="${v}">${{ ok: 'Bien', falla: 'Falla', na: 'N/A' }[v]}</button>`).join('')}</span></div>`).join('')}</section>`).join('')}
    <section class="bloque"><h3>Equipos de respiración (presión del cilindro)</h3><div id="scba">${[1, 2, 3, 4].map((n) => `<div class="rejilla-2"><label>Equipo<input name="scba_eq" value="${n}"></label><label>Presión (psi)<input name="scba_psi" type="number" inputmode="numeric" placeholder="Ej. 4500"></label></div>`).join('')}</div></section>
    <section class="bloque"><label>Observaciones<textarea name="notas" rows="3"></textarea></label>
      <label class="btn">📷 Foto de la falla (opcional)<input type="file" name="foto" accept="image/*" capture="environment" multiple hidden></label></section>
    <div class="pie-parte"><button class="btn primario grande">Guardar revisión</button></div></fieldset></form>`;
  const form = caja.querySelector<HTMLFormElement>('#f-insp')!;
  const marcar = (op: HTMLElement, v: string) => { op.dataset.sel = v; op.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === v)); };
  form.querySelectorAll<HTMLElement>('.insp-op').forEach((op) => op.addEventListener('click', (e) => { const b = (e.target as HTMLElement).closest('button'); if (b) marcar(op, b.dataset.v!); }));
  $('todo-bien').addEventListener('click', () => form.querySelectorAll<HTMLElement>('.insp-op').forEach((op) => { if (!op.dataset.sel) marcar(op, 'ok'); }));
  form.addEventListener('submit', async (e) => {
    e.preventDefault(); const f = new FormData(form);
    const checklist: Record<string, string> = {}; const fallas: string[] = []; let critica = false, faltan = 0;
    form.querySelectorAll<HTMLElement>('.insp-op').forEach((op) => { const v = op.dataset.sel; if (!v) { faltan++; return; } checklist[op.dataset.item!] = v;
      if (v === 'falla') { fallas.push(op.dataset.item!); if (op.dataset.crit === '1') critica = true; } });
    if (faltan) return c.aviso(`Faltan ${faltan} renglones por revisar.`, true);
    const eq = f.getAll('scba_eq').map(String), psi = f.getAll('scba_psi').map(String);
    const scba = eq.map((x, i) => ({ equipo: x, psi: Number(psi[i]) })).filter((x) => x.psi > 0);
    if (critica && !confirm(`Falla crítica (${fallas.join(', ')}). La unidad quedará FUERA DE SERVICIO. ¿Continuar?`)) return;
    const b = form.querySelector<HTMLButtonElement>('.pie-parte button')!; b.disabled = true; b.textContent = 'Guardando…';
    const fotos: string[] = [];
    for (const file of (f.getAll('foto') as File[]).filter((x) => x.size)) {
      const ruta = `inspecciones/${f.get('unidad')}/${Date.now()}-${Math.random().toString(36).slice(2, 7)}.jpg`;
      const { error } = await dbp.storage.from('evidencias').upload(ruta, await comprimir(file)); if (!error) fotos.push(ruta);
    }
    try {
      await insertar('inspecciones', { unidad: f.get('unidad'), km: Number(f.get('km')) || null, horas_bomba: Number(f.get('horas_bomba')) || null,
        checklist, scba, fallas, critica, notas: String(f.get('notas') ?? '').trim() || null, fotos });
      c.aviso(critica ? 'Revisión guardada. La unidad quedó fuera de servicio.' : fallas.length ? 'Revisión guardada con observaciones.' : 'Revisión guardada: unidad en orden.');
      alListo();
    } catch { c.aviso('No se pudo guardar la revisión. Revisa la conexión.', true); b.disabled = false; b.textContent = 'Guardar revisión'; }
  });
}

// ================================================================ vista del panel
let pestanaU = 'estado';
export async function vistaUnidades(c: Ctx) {
  const edita = c.rol() === 'admin' || c.rol() === 'coordinador';
  c.marco('unidades', 'Unidades y equipo', 'Revisión de cada turno, mantenimiento e inventario con caducidades.', '<div id="un"><p class="tenue">Cargando…</p></div>',
    `<div class="chips-modo">${[['estado', 'Revisión del turno'], ['nueva', 'Nueva revisión'], ['mant', 'Mantenimiento'], ['inv', 'Inventario']].map(([k, t]) => `<button class="chip ${pestanaU === k ? 'on' : ''}" data-pu="${k}">${t}</button>`).join('')}</div>`);
  document.querySelectorAll<HTMLButtonElement>('[data-pu]').forEach((b) => b.addEventListener('click', () => { pestanaU = b.dataset.pu!; vistaUnidades(c); }));
  const caja = $('un');
  if (pestanaU === 'nueva') return formInspeccion(c, caja, null, () => { pestanaU = 'estado'; vistaUnidades(c); });
  if (pestanaU === 'estado') {
    const [uds, ins, g] = await Promise.all([tabla<{ nombre: string; tipo: string | null; activa: boolean; estado: string; nota: string | null }>('unidades', 'nombre'), tabla<Insp>('inspecciones', 'en'),
      guardia().catch(() => null)]);
    const ft = g?.fecha ?? fechaTurno(), tt = g?.turno ?? turnoAhora();   // el turno lo decide el servidor (hora de Guanajuato)
    const ultima = (u: string) => ins.filter((i) => i.unidad === u).sort((a, b) => b.en.localeCompare(a.en))[0];
    caja.innerHTML = `<div class="un-rejilla">${uds.filter((u) => u.activa).map((u) => { const i = ultima(u.nombre); const hoy = i && i.fecha === ft && i.turno === tt;
      return `<article class="tarjeta un-tarjeta ${u.estado === 'fuera_servicio' ? 'fuera' : ''}"><div class="fila-tit"><h3>${esc(u.nombre)}</h3><em class="pill ${hoy ? (i.fallas.length ? 'p-ambar' : 'p-verde') : 'p-rojo'}">${hoy ? (i.fallas.length ? 'Con observaciones' : 'Revisada') : 'Sin revisar este turno'}</em></div>
        <small class="tenue">${esc(u.tipo ?? '')}${u.estado === 'fuera_servicio' ? ` · <b class="rojo">Fuera de servicio</b> ${esc(u.nota ?? '')}` : ''}</small>
        ${i ? `<p class="chica">Última: ${fh(i.en)} · ${esc(i.autor ?? '')}${i.km ? ` · ${i.km} km` : ''}${i.horas_bomba ? ` · ${i.horas_bomba} h bomba` : ''}</p>
          ${i.fallas.length ? `<p class="chica alerta-txt">${esc(i.fallas.join(', '))}</p>` : ''}` : '<p class="chica tenue">Sin revisiones registradas.</p>'}</article>`; }).join('')}</div>
      <section class="tarjeta"><div class="fila-tit"><h3>Historial de revisiones</h3><button class="btn chico" id="xls-ins">Excel</button></div><div class="tabla-caja"><table class="tabla"><thead><tr><th>Fecha</th><th>Turno</th><th>Unidad</th><th>Km</th><th>Fallas</th><th>Quién</th></tr></thead><tbody>
      ${ins.slice().reverse().slice(0, 60).map((i) => `<tr><td class="nw">${fh(i.en)}</td><td>${i.turno === 'dia' ? 'Día' : 'Noche'}</td><td>${esc(i.unidad)}</td><td>${i.km ?? ''}</td>
        <td class="${i.critica ? 'alerta-txt' : ''}">${esc(i.fallas.join(', ') || 'Sin fallas')}</td><td>${esc(i.autor ?? '')}</td></tr>`).join('') || '<tr><td colspan="6" class="tenue">Sin revisiones.</td></tr>'}</tbody></table></div></section>`;
    $('xls-ins').addEventListener('click', () => descargar(escribirExcel([{ nombre: 'Revisiones', filas: [['FECHA', 'TURNO', 'UNIDAD', 'KM', 'HORAS BOMBA', 'FALLAS', 'CRÍTICA', 'QUIÉN', 'NOTAS'],
      ...ins.map((i) => [fh(i.en), i.turno, i.unidad, i.km, i.horas_bomba, i.fallas.join(', '), i.critica ? 'SÍ' : '', i.autor, i.notas] as Celda[])] }]), 'SIMUB_revisiones_unidades.xlsx'));
    return;
  }
  if (pestanaU === 'mant') {
    const [ms, uds] = await Promise.all([tabla<{ id: number; unidad: string; tipo: string; fecha: string; km: number | null; costo: number | null; notas: string | null; proximo_fecha: string | null; proximo_km: number | null; autor: string | null }>('mantenimientos', 'fecha'),
      tabla<{ nombre: string; activa: boolean }>('unidades', 'nombre')]);
    const hoy = new Date().toISOString().slice(0, 10);
    caja.innerHTML = `${edita ? `<form class="tarjeta" id="f-mant"><h3>Registrar mantenimiento</h3><div class="rejilla-3">
        <label>Unidad<select name="unidad" required>${uds.filter((u) => u.activa).map((u) => `<option>${esc(u.nombre)}</option>`).join('')}</select></label>
        <label>Tipo<input name="tipo" list="l-mant" required placeholder="Servicio, frenos, llantas…"></label><label>Fecha<input type="date" name="fecha" value="${hoy}"></label>
        <label>Kilometraje<input type="number" name="km"></label><label>Costo (MXN)<input type="number" name="costo" step="0.01"></label><label>Notas<input name="notas"></label>
        <label>Próximo (fecha)<input type="date" name="proximo_fecha"></label><label>Próximo (km)<input type="number" name="proximo_km"></label></div>
        <datalist id="l-mant">${['Servicio de motor', 'Cambio de aceite', 'Frenos', 'Llantas', 'Batería', 'Bomba', 'Verificación vehicular', 'Seguro', 'Tenencia / refrendo', 'Prueba hidrostática de cilindros', 'Recarga de extintores'].map((x) => `<option value="${x}">`).join('')}</datalist>
        <button class="btn primario">Guardar</button></form>` : ''}
      <section class="tarjeta"><h3>Historial y próximos</h3><div class="tabla-caja"><table class="tabla"><thead><tr><th>Fecha</th><th>Unidad</th><th>Tipo</th><th>Km</th><th>Costo</th><th>Próximo</th><th>Notas</th></tr></thead><tbody>
      ${ms.slice().reverse().map((m) => { const vence = m.proximo_fecha && m.proximo_fecha <= new Date(Date.now() + 15 * 864e5).toISOString().slice(0, 10);
        return `<tr><td class="nw">${fd(m.fecha)}</td><td>${esc(m.unidad)}</td><td>${esc(m.tipo)}</td><td>${m.km ?? ''}</td><td>${m.costo != null ? `$${m.costo.toLocaleString('es-MX')}` : ''}</td>
        <td class="nw ${vence ? 'alerta-txt' : ''}">${m.proximo_fecha ? fd(m.proximo_fecha) : ''}${m.proximo_km ? ` · ${m.proximo_km} km` : ''}</td><td>${esc(m.notas ?? '')}</td></tr>`; }).join('') || '<tr><td colspan="7" class="tenue">Sin registros.</td></tr>'}</tbody></table></div></section>`;
    document.getElementById('f-mant')?.addEventListener('submit', async (e) => {
      e.preventDefault(); const f = new FormData(e.target as HTMLFormElement); const fila: Record<string, unknown> = {};
      f.forEach((v, k) => { const s = String(v).trim(); fila[k] = s === '' ? null : ['km', 'costo', 'proximo_km'].includes(k) ? Number(s) : s; });
      try { await insertar('mantenimientos', fila); c.aviso('Mantenimiento registrado.'); vistaUnidades(c); } catch { c.aviso('No se pudo guardar.', true); }
    });
    return;
  }
  // inventario
  const inv = await tabla<{ id: number; articulo: string; categoria: string | null; ubicacion: string; cantidad: number; caducidad: string | null; estado: string; notas: string | null }>('inventario', 'articulo');
  const lim = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10), hoyS = new Date().toISOString().slice(0, 10);
  caja.innerHTML = `${edita ? `<form class="tarjeta" id="f-inv"><h3>Agregar artículo</h3><div class="rejilla-3">
      <label>Artículo<input name="articulo" required placeholder="Ej. Extintor PQS 6 kg"></label><label>Categoría<input name="categoria" list="l-cat"></label>
      <label>Ubicación<input name="ubicacion" value="Estación" placeholder="Estación o unidad (U-08)"></label><label>Cantidad<input type="number" name="cantidad" value="1" min="0"></label>
      <label>Caducidad<input type="date" name="caducidad"></label><label>Notas<input name="notas"></label></div>
      <datalist id="l-cat">${['Botiquín', 'Extintores', 'EPP', 'Equipo de respiración', 'Herramienta', 'Mangueras', 'Espuma', 'Rescate', 'Comunicación'].map((x) => `<option value="${x}">`).join('')}</datalist>
      <button class="btn primario">Agregar</button></form>` : ''}
    <section class="tarjeta"><div class="fila-tit"><h3>Inventario</h3><button class="btn chico" id="xls-inv">Excel</button></div><div class="tabla-caja"><table class="tabla"><thead><tr><th>Artículo</th><th>Categoría</th><th>Ubicación</th><th>Cant.</th><th>Caducidad</th><th>Estado</th>${edita ? '<th></th>' : ''}</tr></thead><tbody>
    ${inv.filter((x) => x.estado !== 'baja').map((x) => `<tr><td>${esc(x.articulo)}</td><td>${esc(x.categoria ?? '')}</td><td>${esc(x.ubicacion)}</td><td>${x.cantidad}</td>
      <td class="nw ${x.caducidad && x.caducidad <= lim ? 'alerta-txt' : ''}">${x.caducidad ? `${fd(x.caducidad)}${x.caducidad < hoyS ? ' (vencido)' : ''}` : '—'}</td><td>${esc(x.estado)}</td>
      ${edita ? `<td class="nw"><button class="btn chico" data-inv="${x.id}|cantidad|${x.cantidad}">Cantidad</button><button class="btn chico" data-inv="${x.id}|estado|baja">Dar de baja</button></td>` : ''}</tr>`).join('') || '<tr><td colspan="7" class="tenue">Sin artículos.</td></tr>'}</tbody></table></div></section>`;
  document.getElementById('f-inv')?.addEventListener('submit', async (e) => {
    e.preventDefault(); const f = new FormData(e.target as HTMLFormElement); const fila: Record<string, unknown> = {};
    f.forEach((v, k) => { const s = String(v).trim(); fila[k] = s === '' ? null : k === 'cantidad' ? Number(s) : s; });
    try { await insertar('inventario', fila); vistaUnidades(c); } catch { c.aviso('No se pudo agregar.', true); }
  });
  caja.querySelectorAll<HTMLButtonElement>('[data-inv]').forEach((b) => b.addEventListener('click', async () => {
    const [id, campo, val] = b.dataset.inv!.split('|');
    const nuevo = campo === 'cantidad' ? prompt('Nueva cantidad:', val) : val; if (nuevo == null) return;
    try { await actualizar('inventario', id, { [campo]: campo === 'cantidad' ? Number(nuevo) : nuevo, actualizado_en: new Date().toISOString() }); vistaUnidades(c); } catch { c.aviso('No se pudo cambiar.', true); }
  }));
  $('xls-inv').addEventListener('click', () => descargar(escribirExcel([{ nombre: 'Inventario', filas: [['ARTÍCULO', 'CATEGORÍA', 'UBICACIÓN', 'CANTIDAD', 'CADUCIDAD', 'ESTADO', 'NOTAS'],
    ...inv.map((x) => [x.articulo, x.categoria, x.ubicacion, x.cantidad, x.caducidad, x.estado, x.notas] as Celda[])] }]), 'SIMUB_inventario.xlsx'));
}
