// SIMUB · Capacitación: cursos, prácticas y certificaciones con sus participantes y vigencias;
// horas por persona (capacitación + guardias del pase de lista) y constancia en PDF.
import { horas, insertar, tabla } from './datos';
import { descargar, escribirExcel, type Celda } from './excel';
import { activarMulti, multi, valoresMulti } from './selectores';
import { activarBuscadores, fuente } from './buscador';
import type { Ctx } from './mando';

const esc = (t: unknown) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const fd = (f?: string | null) => f ? new Date(`${f}T12:00:00`).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
interface Cap { id: number; titulo: string; tipo: string; fecha: string; horas: number; instructor: string | null; participantes: string[]; vigencia: string | null; notas: string | null }
let anioCap = new Date().getFullYear();

export async function vistaCapacitacion(c: Ctx) {
  c.marco('capacitacion', 'Capacitación y horas', 'Cursos, prácticas y certificaciones; horas de capacitación y de guardia por persona.', '<div id="cap"><p class="tenue">Cargando…</p></div>',
    `<input id="cap-anio" type="number" class="anio" value="${anioCap}" aria-label="Año">`);
  $<HTMLInputElement>('cap-anio').addEventListener('change', (e) => { anioCap = +(e.target as HTMLInputElement).value; vistaCapacitacion(c); });
  const [caps, per, hs] = await Promise.all([tabla<Cap>('capacitaciones', 'fecha').catch(() => []),
    tabla<{ nombre: string; cargo: string | null; activo: boolean }>('personal', 'nombre').catch(() => []), horas(anioCap).catch(() => [])]);
  fuente('personal', () => per.filter((p) => p.activo).map((p) => ({ n: p.nombre, t: p.cargo ?? '' })));
  const delAnio = caps.filter((x) => x.fecha.startsWith(String(anioCap)));
  const hoy = new Date().toISOString().slice(0, 10);
  $('cap').innerHTML = `<form class="tarjeta" id="f-cap"><h3>Registrar capacitación</h3><div class="rejilla-3">
      <label>Título<input name="titulo" required placeholder="Ej. Combate de incendios forestales"></label>
      <label>Tipo<select name="tipo"><option>curso</option><option>práctica</option><option>certificación</option><option>plática</option></select></label>
      <label>Fecha<input type="date" name="fecha" value="${hoy}"></label><label>Horas<input type="number" name="horas" value="4" step="0.5" min="0"></label>
      <label>Instructor<input name="instructor"></label><label>Vigencia (certificaciones)<input type="date" name="vigencia"></label></div>
      <label>Participantes</label>${multi('participantes', [], [], 'Toca y escribe el nombre', false, [], 'personal')}
      <label>Notas<input name="notas"></label><button class="btn primario">Guardar</button></form>
    <section class="tarjeta"><h3>Capacitaciones ${anioCap} (${delAnio.length})</h3><div class="tabla-caja"><table class="tabla"><thead><tr><th>Fecha</th><th>Título</th><th>Tipo</th><th>Horas</th><th>Participantes</th><th>Vigencia</th></tr></thead><tbody>
      ${delAnio.slice().reverse().map((x) => `<tr><td class="nw">${fd(x.fecha)}</td><td>${esc(x.titulo)}</td><td>${esc(x.tipo)}</td><td>${x.horas}</td><td class="chica">${esc(x.participantes.join(', '))}</td>
        <td class="nw ${x.vigencia && x.vigencia < hoy ? 'alerta-txt' : ''}">${x.vigencia ? fd(x.vigencia) : ''}</td></tr>`).join('') || '<tr><td colspan="6" class="tenue">Sin registros.</td></tr>'}</tbody></table></div></section>
    <section class="tarjeta"><div class="fila-tit"><h3>Horas por persona ${anioCap}</h3><button class="btn chico" id="cap-xls">Excel</button></div>
      <p class="tenue chica">Guardias: cada turno del pase de lista cuenta 12 horas.</p><div class="tabla-caja"><table class="tabla"><thead><tr><th>Persona</th><th>Capacitación (h)</th><th>Guardias</th><th>Horas de guardia</th><th>Total</th><th></th></tr></thead><tbody>
      ${hs.map((x) => `<tr><td>${esc(x.persona)}</td><td>${x.capacitacion}</td><td>${x.guardias}</td><td>${x.horas_guardia}</td><td><b>${Number(x.capacitacion) + Number(x.horas_guardia)}</b></td>
        <td><button class="btn chico" data-const="${esc(x.persona)}">Constancia PDF</button></td></tr>`).join('') || '<tr><td colspan="6" class="tenue">Sin horas registradas.</td></tr>'}</tbody></table></div></section>`;
  activarMulti($('cap')); activarBuscadores($('cap'));
  $('f-cap').addEventListener('submit', async (e) => {
    e.preventDefault(); const f = new FormData(e.target as HTMLFormElement);
    try { await insertar('capacitaciones', { titulo: String(f.get('titulo')).trim(), tipo: f.get('tipo'), fecha: f.get('fecha'), horas: Number(f.get('horas')) || 0,
      instructor: String(f.get('instructor') ?? '').trim() || null, vigencia: String(f.get('vigencia') ?? '') || null, participantes: valoresMulti(f.get('participantes')),
      notas: String(f.get('notas') ?? '').trim() || null }); c.aviso('Capacitación registrada.'); vistaCapacitacion(c); } catch { c.aviso('No se pudo guardar (solo administración y coordinación).', true); }
  });
  $('cap-xls').addEventListener('click', () => descargar(escribirExcel([
    { nombre: `Horas ${anioCap}`, filas: [['PERSONA', 'HORAS CAPACITACIÓN', 'GUARDIAS', 'HORAS GUARDIA', 'TOTAL'], ...hs.map((x) => [x.persona, x.capacitacion, x.guardias, x.horas_guardia, Number(x.capacitacion) + Number(x.horas_guardia)] as Celda[])] },
    { nombre: `Capacitaciones ${anioCap}`, filas: [['FECHA', 'TÍTULO', 'TIPO', 'HORAS', 'INSTRUCTOR', 'PARTICIPANTES', 'VIGENCIA'], ...delAnio.map((x) => [x.fecha, x.titulo, x.tipo, x.horas, x.instructor, x.participantes.join(', '), x.vigencia] as Celda[])] },
  ]), `SIMUB_capacitacion_${anioCap}.xlsx`));
  $('cap').querySelectorAll<HTMLButtonElement>('[data-const]').forEach((b) => b.addEventListener('click', async () => {
    const quien = b.dataset.const!, h = hs.find((x) => x.persona === quien)!; const cursos = delAnio.filter((x) => x.participantes.includes(quien));
    const { jsPDF } = await import('jspdf'); const doc = new jsPDF({ unit: 'mm', format: 'letter' });
    doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.setTextColor(110, 28, 34); doc.text('BOMBEROS SIMUB VOLUNTARIOS, A.C.', 108, 30, { align: 'center' });
    doc.setFontSize(13); doc.setTextColor(30, 30, 30); doc.text('CONSTANCIA DE HORAS DE SERVICIO Y CAPACITACIÓN', 108, 42, { align: 'center' });
    doc.setFont('helvetica', 'normal'); doc.setFontSize(11);
    const txt = doc.splitTextToSize(`Se hace constar que ${quien} participó como integrante de Bomberos SIMUB Voluntarios, A.C. durante ${anioCap}, acumulando ${h.horas_guardia} horas de guardia (${h.guardias} turnos) y ${h.capacitacion} horas de capacitación, según los registros del sistema de la estación.`, 170) as string[];
    doc.text(txt, 23, 60); let y = 60 + txt.length * 6 + 8;
    if (cursos.length) { doc.setFont('helvetica', 'bold'); doc.text('Capacitaciones:', 23, y); y += 7; doc.setFont('helvetica', 'normal');
      for (const x of cursos) { doc.text(`• ${fd(x.fecha)} · ${x.titulo} (${x.horas} h)`, 26, y); y += 6; if (y > 240) break; } }
    doc.text(`Guanajuato, Gto., a ${new Date().toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' })}.`, 23, 245);
    doc.line(70, 262, 146, 262); doc.text('Comandante', 108, 268, { align: 'center' });
    descargar(doc.output('blob'), `Constancia_${quien.replace(/\s+/g, '_')}_${anioCap}.pdf`);
  }));
}
