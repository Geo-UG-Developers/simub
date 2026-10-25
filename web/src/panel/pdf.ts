// Parte de servicio en PDF generado en el propio teléfono o computadora (sin imprimir).
// Funciona también dentro del navegador de Telegram, donde «imprimir» no está disponible.
import type { Detalle } from './datos';
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
