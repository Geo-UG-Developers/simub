// Parte de servicio en PDF generado en el propio teléfono o computadora (sin imprimir).
// Funciona también dentro del navegador de Telegram, donde «imprimir» no está disponible.
import type { Detalle } from './datos';
import type { Servicio } from './datos';
import { CORPORACIONES } from './catalogo';
import { FORMULARIOS } from '../formularios';

const fechaLarga = (f?: string | null) => f ? new Date(f).toLocaleString('es-MX', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

async function imagenDataUrl(url: string): Promise<string | null> {
  try {
    const b = await (await fetch(url)).blob();
    return await new Promise((ok) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.readAsDataURL(b); });
  } catch { return null; }
}

export async function partePdf(d: Detalle, v: Record<string, string>, personal: string[], escudoUrl: string): Promise<{ blob: Blob; nombre: string }> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'mm', format: 'letter' });
  const W = 216, M = 16, CW = W - 2 * M;
  let y = 16;
  const guinda: [number, number, number] = [110, 28, 34];
  const escudo = await imagenDataUrl(escudoUrl);
  if (escudo) doc.addImage(escudo, 'PNG', M, y - 2, 20, 20);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(14); doc.setTextColor(...guinda);
  doc.text('BOMBEROS SIMUB VOLUNTARIOS, A.C.', M + 24, y + 5);
  doc.setFontSize(11); doc.setTextColor(35, 20, 22); doc.text('PARTE DE SERVICIO', M + 24, y + 11);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(94, 75, 77);
  doc.text('Guanajuato, Gto. · Honor, valor y servicio', M + 24, y + 16);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(...guinda); doc.text(`Folio ${d.folio}`, W - M, y + 5, { align: 'right' });
  y += 24; doc.setDrawColor(...guinda); doc.setLineWidth(0.6); doc.line(M, y, W - M, y); y += 6;

  const seccion = (t: string) => {
    if (y > 250) { doc.addPage(); y = 18; }
    doc.setFillColor(246, 242, 238); doc.rect(M, y - 4.5, CW, 7, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(...guinda); doc.text(t.toUpperCase(), M + 2, y); y += 7;
  };
  const fila = (pares: [string, string][]) => {
    const ancho = CW / pares.length;
    let alto = 0;
    pares.forEach(([et, val], i) => {
      const x = M + i * ancho;
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(94, 75, 77); doc.text(et, x, y);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(35, 20, 22);
      const lineas = doc.splitTextToSize(val || '—', ancho - 4) as string[];
      doc.text(lineas, x, y + 4.5); alto = Math.max(alto, 4.5 + lineas.length * 4.6);
    });
    y += alto + 3;
    if (y > 262) { doc.addPage(); y = 18; }
  };
  const f = FORMULARIOS[d.tipo];
  seccion('Datos del reporte');
  fila([['Tipo de emergencia', f.nombre], ['Recibido', fechaLarga(d.creado_en)], ['Folio 911', v.folio_911]]);
  fila([['Ubicación', `${d.lat.toFixed(5)}, ${d.lon.toFixed(5)}${d.referencia ? ` · ${d.referencia}` : ''}`]]);
  if ((d.detalles.resumen ?? []).length) fila([['Lo que reportó la persona', d.detalles.resumen!.join(' · ')]]);
  if (d.comentario) fila([['Descripción', d.comentario]]);
  seccion('Salida');
  fila([['Unidad', v.unidad], ['Hora de salida', fechaLarga(v.hora_salida)], ['Hora de llegada', fechaLarga(v.hora_llegada)]]);
  fila([['Hora de regreso', fechaLarga(v.hora_retorno)], ['Responsable', v.responsable], ['', '']]);
  fila([['Personal que acudió', personal.join(', ')]]);
  seccion('Atención');
  fila([['Qué se hizo', v.acciones]]);
  fila([['Agua (litros)', v.agua_litros], ['Extintores', v.extintores], ['Lesionados', v.lesionados], ['Traslados', v.traslados]]);
  fila([['Causa probable', v.causa], ['Daños materiales', v.danos]]);
  fila([['Autoridades presentes', v.autoridades]]);
  if (v.observaciones) fila([['Observaciones', v.observaciones]]);
  y = Math.max(y + 18, 230);
  if (y > 262) { doc.addPage(); y = 40; }
  doc.setDrawColor(35, 20, 22); doc.setLineWidth(0.3); doc.line(M, y, M + 70, y);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(94, 75, 77);
  doc.text(`Firma del responsable${v.responsable ? `: ${v.responsable}` : ''}`, M, y + 4.5);
  doc.setFontSize(7.5);
  doc.text(`Generado ${fechaLarga(new Date().toISOString())} · App SIMUB · GEO UG Developers`, W - M, 272, { align: 'right' });
  return { blob: doc.output('blob'), nombre: `Parte_${d.folio}.pdf` };
}

/** En el celular abre «Compartir» (WhatsApp, Drive, Archivos…); si no se puede, descarga el archivo. */
export async function entregarPdf(blob: Blob, nombre: string) {
  const archivo = new File([blob], nombre, { type: 'application/pdf' });
  const nav = navigator as Navigator & { canShare?: (d: unknown) => boolean };
  if (nav.canShare?.({ files: [archivo] }) && /android|iphone|ipad/i.test(navigator.userAgent)) {
    try { await nav.share({ files: [archivo], title: nombre }); return; } catch { /* cancelado: descargar */ }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = nombre; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 30000);
}

// ---------------------------------------------------------------- parte con el formato de SIMUB (2 páginas, carta)

const hhmm = (f?: string | null) => f ? new Date(f).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: false }) : '';
// Casillas del formato impreso de SIMUB → clasificación del catálogo.
const CASILLAS: [string, [string, string][]][] = [
  ['Incendios', [['Estructural', 'inc_estructural'], ['Pastizal', 'inc_pastizal'], ['Vehicular', 'inc_vehicular'], ['Basura', 'inc_basura'], ['Baldío', 'inc_baldio'], ['Cables', 'inc_cables'], ['Otro', 'inc_*']]],
  ['Accidentes', [['Vehicular', 'acc_vehicular'], ['Motocicleta', 'acc_moto'], ['Volcadura', 'acc_volcadura']]],
  ['Pacientes', [['Clínico', 'pac_clinico'], ['Trauma', 'pac_trauma'], ['Traslado', 'traslado']]],
  ['Rescate', [['Acuático', 'res_acuatico'], ['Ángulo elevado', 'res_angulo'], ['Vehicular', 'res_vehicular'], ['Espacios confinados', 'res_confinado'], ['K9', 'res_k9']]],
  ['Control fauna', [['Abejas', 'fau_enjambre'], ['Serpientes', 'fau_reptil'], ['Otros', 'fau_animal']]],
  ['Fuga de gas', [['Fuga de gas', 'fuga_gas']]],
  ['Caída de', [['Cables', 'cai_cables'], ['Estructura', 'cai_estructura'], ['Árbol', 'cai_arbol'], ['Poste', 'cai_poste'], ['Inundación', 'inundacion']]],
  ['Servicio de rutina', [['Revisión de seguridad', 'revision'], ['Evento especial', 'evento'], ['Capacitación', 'capacitacion'], ['Simulacro', 'simulacro'], ['Prevención', 'prevencion'], ['Otros', 'otros']]],
];

export async function servicioPdf(s: Servicio, nombreClase: string, escudoUrl: string): Promise<{ blob: Blob; nombre: string }> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'mm', format: 'letter' });
  const W = 216, M = 14, CW = W - 2 * M;
  const negro: [number, number, number] = [20, 20, 20], guinda: [number, number, number] = [110, 28, 34];
  const escudo = await imagenDataUrl(escudoUrl);
  const folio = `${s.anio}-${String(s.folio).padStart(4, '0')}`;
  const t = (x: number, y: number, txt: string, tam = 8.5, negrita = false, opts?: Record<string, unknown>) => {
    doc.setFont('helvetica', negrita ? 'bold' : 'normal'); doc.setFontSize(tam); doc.setTextColor(...negro); doc.text(txt, x, y, opts);
  };
  const caja = (x: number, y: number, w: number, h: number) => { doc.setDrawColor(...negro); doc.setLineWidth(0.25); doc.rect(x, y, w, h); };
  const val = (x: number, y: number, w: number, txt: string | null | undefined, tam = 8.5) => {
    if (!txt) return; doc.setFont('helvetica', 'bold'); doc.setFontSize(tam); doc.setTextColor(20, 40, 120);
    doc.text((doc.splitTextToSize(String(txt), w) as string[])[0] ?? '', x, y);
  };
  const titulo = (x: number, y: number, w: number, txt: string) => { doc.setFillColor(238, 232, 228); doc.rect(x, y, w, 6, 'F'); caja(x, y, w, 6); t(x + w / 2, y + 4.2, txt, 9, true, { align: 'center' }); };

  // ---------- página 1
  if (escudo) doc.addImage(escudo, 'PNG', M, 9, 20, 20);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.setTextColor(...guinda); doc.text('CUERPO DE BOMBEROS SIMUB VOLUNTARIOS A.C.', M + 24, 17);
  t(M + 24, 25, 'Falsa alarma', 9); caja(M + 45, 21.5, 4.5, 4.5); if (s.falsa_alarma) t(M + 46.1, 25.2, 'X', 9, true);
  t(M + 70, 25, 'Fecha', 9); val(M + 81, 25, 40, new Date(`${s.fecha}T12:00:00`).toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric' }), 9.5);
  t(M + 140, 25, 'Folio', 9); val(M + 150, 25, 40, folio, 10);

  let y = 32;
  titulo(M, y, CW, 'Cronología (hora de:)'); y += 6;
  const cron: [string, string | null][] = [['Reporte', s.h_reporte], ['Despacho', s.h_despacho], ['Llegada a la escena', s.h_llegada], ['Unidad disponible', s.h_disponible], ['Llegada a la base', s.h_base]];
  const cw = CW / 5;
  cron.forEach(([e, h], i) => { caja(M + i * cw, y, cw, 6); t(M + i * cw + cw / 2, y + 4.2, e, 8, false, { align: 'center' }); caja(M + i * cw, y + 6, cw, 6); val(M + i * cw + 2, y + 10.3, cw - 4, hhmm(h), 9.5); });
  y += 12; caja(M, y, CW / 2, 6); caja(M + CW / 2, y, CW / 2, 6);
  t(M + 2, y + 4.2, 'Kilometraje salida'); val(M + 32, y + 4.2, 50, s.km_salida != null ? String(s.km_salida) : '');
  t(M + CW / 2 + 2, y + 4.2, 'Kilometraje llegada'); val(M + CW / 2 + 34, y + 4.2, 50, s.km_llegada != null ? String(s.km_llegada) : '');
  y += 10;

  caja(M, y, CW, 13);
  t(M + 2, y + 4.5, 'Reportante'); val(M + 22, y + 4.5, 60, s.reportante);
  t(M + 90, y + 4.5, 'Medio'); val(M + 102, y + 4.5, 32, s.medio);
  t(M + 136, y + 4.5, 'No. de teléfono', 7.5); val(M + 158, y + 4.5, 30, s.telefono);
  t(M + 2, y + 10.5, 'Lugar del incidente'); val(M + 32, y + 10.5, CW - 34, [s.colonia, s.lugar, s.lat != null ? `(${s.lat.toFixed(5)}, ${s.lon?.toFixed(5)})` : ''].filter(Boolean).join(' '));
  y += 17;

  // Unidades y tripulación (hasta 3 columnas, como el formato)
  const trip = (s.tripulacion ?? []).filter((x) => x.unidad || x.maquinista || x.jefe || x.bomberos).slice(0, 3);
  const filasT: [string, (x: typeof trip[number]) => string][] = [['Unidad', (x) => x.unidad], ['Maquinista', (x) => x.maquinista], ['Jefe de servicio', (x) => x.jefe], ['Bomberos', (x) => x.bomberos]];
  const c0 = 34, cc = (CW - c0) / 3;
  caja(M, y, CW, 4 * 7);
  filasT.forEach(([e, f], i) => {
    t(M + 2, y + i * 7 + 4.8, e); for (let j = 0; j < 3; j++) { caja(M + c0 + j * cc, y + i * 7, cc, 7); val(M + c0 + j * cc + 2, y + i * 7 + 4.8, cc - 4, trip[j] ? f(trip[j]) : (i === 0 ? s.unidades[j] : '')); }
  });
  y += 4 * 7 + 2; t(M + 2, y + 3, `Personal total: ${s.personal_num ?? '—'}`, 8); y += 6;

  // Tipo de servicio (casillas)
  // columnas fijas: [grupo índice en CASILLAS]
  const COLS = [[0], [1, 5, 4], [2, 6], [3, 7]];
  caja(M, y, CW, 88); const colW = CW / 4;
  COLS.forEach((gs, col) => {
    let cy = y + 5; const cx = M + col * colW + 2;
    for (const gi of gs) {
      const [grupo, ops] = CASILLAS[gi];
      t(cx, cy, grupo, 9, true);
      ops.forEach(([e, id], k) => {
        const yy = cy + 4.8 + k * 4.4; t(cx + 2, yy, e, 8); caja(cx + colW - 12, yy - 3.2, 3.8, 3.8);
        const marcada = id.endsWith('*') ? s.clasificacion.startsWith(id.slice(0, -1)) && !CASILLAS.some(([, o]) => o.some(([, x]) => x === s.clasificacion)) : s.clasificacion === id;
        if (marcada) t(cx + colW - 11.3, yy, 'X', 8.5, true);
      });
      cy += 8 + ops.length * 4.4;
    }
  });
  const yt = y + 77; t(M + 2, yt, 'Tipo:', 8); val(M + 12, yt, 80, nombreClase);
  t(M + 95, yt, 'Especificación:', 8); val(M + 117, yt, CW - 120, s.especificacion);
  t(M + 2, yt + 6, 'Área afectada:', 8); val(M + 24, yt + 6, 50, s.area_afectada);
  t(M + 80, yt + 6, 'Compañía:', 8); val(M + 96, yt + 6, 40, s.datos?.compania); t(M + 140, yt + 6, 'Kilos:', 8); val(M + 150, yt + 6, 30, s.datos?.kilos);
  y += 92;
  caja(M, y, CW, 8); t(M + 2, y + 5.3, 'Hora de inicio'); val(M + 25, y + 5.3, 30, hhmm(s.h_despacho)); t(M + 95, y + 5.3, 'Hora de término'); val(M + 120, y + 5.3, 30, hhmm(s.h_base));
  t(M + 150, y + 5.3, 'Folio 911'); val(M + 166, y + 5.3, 30, s.datos?.folio_911);

  // ---------- página 2
  doc.addPage(); y = 14;
  const veh = (s.vehiculos ?? []).slice(0, 3);
  const camposV: [string, string][] = [['Placas', 'placas'], ['Color', 'color'], ['Tipo', 'tipo'], ['Modelo', 'modelo'], ['Nombre del conductor', 'conductor'], ['Propietario / Razón social', 'propietario']];
  caja(M, y, CW, camposV.length * 6.5);
  camposV.forEach(([e, k], i) => { t(M + 2, y + i * 6.5 + 4.5, e, 8); for (let j = 0; j < 3; j++) { caja(M + 44 + j * ((CW - 44) / 3), y + i * 6.5, (CW - 44) / 3, 6.5); val(M + 46 + j * ((CW - 44) / 3), y + i * 6.5 + 4.5, (CW - 44) / 3 - 4, veh[j]?.[k]); } });
  y += camposV.length * 6.5 + 6;

  const ca = 50, cu = (CW - ca) / 2;
  caja(M, y, CW, 6); t(M + ca + cu / 2, y + 4.2, 'Unidad(es)', 9, true, { align: 'center' }); t(M + ca + cu * 1.5, y + 4.2, 'Encargado(s)', 9, true, { align: 'center' }); y += 6;
  const extras = Object.keys(s.apoyos ?? {}).filter((k) => !CORPORACIONES.includes(k));
  [...CORPORACIONES.filter((k) => k !== 'Otros'), ...extras, 'Otros'].forEach((corp) => {
    const a = s.apoyos?.[corp];
    caja(M, y, ca, 5.6); caja(M + ca, y, cu, 5.6); caja(M + ca + cu, y, cu, 5.6);
    t(M + 2, y + 4, corp, 8); val(M + ca + 2, y + 4, cu - 4, a?.unidades ?? (a ? 'Sí' : ''), 8); val(M + ca + cu + 2, y + 4, cu - 4, a?.encargado, 8); y += 5.6;
  });
  y += 5;
  titulo(M, y, CW, 'Personas localizadas en la escena'); y += 6;
  const per = (s.personas ?? []).slice(0, 7);
  caja(M, y, 120, 5.6); caja(M + 120, y, 40, 5.6); caja(M + 160, y, CW - 160, 5.6); t(M + 2, y + 4, 'Nombre'); t(M + 122, y + 4, 'Código'); t(M + 162, y + 4, 'Edad'); y += 5.6;
  for (let i = 0; i < 7; i++) { caja(M, y, 120, 5.6); caja(M + 120, y, 40, 5.6); caja(M + 160, y, CW - 160, 5.6); val(M + 2, y + 4, 116, per[i]?.nombre, 8); val(M + 122, y + 4, 36, per[i]?.codigo, 8); val(M + 162, y + 4, 20, per[i]?.edad, 8); y += 5.6; }
  y += 5;
  titulo(M, y, CW, 'OBSERVACIONES'); y += 6;
  const obs = doc.splitTextToSize(s.observaciones ?? '', CW - 4) as string[];
  const altoObs = Math.max(26, Math.min(obs.length, 8) * 4.2 + 4); caja(M, y, CW, altoObs);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(20, 40, 120); doc.text(obs.slice(0, 8), M + 2, y + 4.5);
  y += altoObs + 6;
  const fw = (CW - 12) / 3;
  ([['Nombre y Firma Jefe de Servicio', s.jefe_servicio], ['Nombre y Firma Radio Operador', s.radio_operador], ['Nombre y Firma Jefe de Guardia', s.jefe_guardia]] as const).forEach(([e, n], i) => {
    const x = M + i * (fw + 6); caja(x, y, fw, 22); val(x + 2, y + 5, fw - 4, n ?? '', 8.5);
    const img = s.firmas?.[(['jefe_servicio', 'radio_operador', 'jefe_guardia'] as const)[i]]?.imagen;
    if (img?.startsWith('data:image/png')) { try { doc.addImage(img, 'PNG', x + 4, y + 6, fw - 8, 10.5); } catch { /* firma dañada */ } }
    doc.line(x, y + 17, x + fw, y + 17); t(x + 2, y + 20.6, e, 7.5);
  });
  if (s.huella) { doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5); doc.setTextColor(110, 100, 100);
    doc.text(`Firmado electrónicamente · huella SHA-256: ${s.huella}`, M, y + 27); }
  doc.setFontSize(7); doc.setTextColor(110, 100, 100);
  doc.text(`Folio ${folio} · generado ${new Date().toLocaleString('es-MX')} · App SIMUB`, W - M, 273, { align: 'right' });
  // Anexo: vehículos o personas de más, y observaciones largas
  const vehExtra = (s.vehiculos ?? []).slice(3), perExtra = (s.personas ?? []).slice(7), obsExtra = obs.slice(8);
  if (vehExtra.length || perExtra.length || obsExtra.length) {
    doc.addPage(); y = 16; t(M, y, `ANEXO · Folio ${folio}`, 11, true); y += 8;
    const linea = (txt: string) => { if (y > 265) { doc.addPage(); y = 16; } val(M + 2, y, CW - 4, txt, 8.5); y += 5.5; };
    if (vehExtra.length) { t(M, y, 'Vehículos involucrados (continuación)', 9, true); y += 6; vehExtra.forEach((v, i) => linea(`${i + 4}. ${['placas', 'color', 'tipo', 'modelo', 'conductor', 'propietario'].map((k) => v[k]).filter(Boolean).join(' · ')}`)); y += 3; }
    if (perExtra.length) { t(M, y, 'Personas localizadas (continuación)', 9, true); y += 6; perExtra.forEach((p, i) => linea(`${i + 8}. ${[p.nombre, p.codigo, p.edad && `${p.edad} años`].filter(Boolean).join(' · ')}`)); y += 3; }
    if (obsExtra.length) { t(M, y, 'Observaciones (continuación)', 9, true); y += 6; obsExtra.forEach((l) => linea(l)); }
  }
  return { blob: doc.output('blob'), nombre: `Parte_SIMUB_${folio}.pdf` };
}
