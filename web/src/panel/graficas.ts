// Gráficas en SVG: barras de una serie y barras horizontales con etiqueta directa.
const esc = (t: unknown) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

function escala(max: number) {
  if (max <= 0) return { tope: 4, paso: 1 };
  const bruto = max / 4, pot = 10 ** Math.floor(Math.log10(bruto));
  const paso = Math.max(1, [1, 2, 5, 10].map((m) => m * pot).find((p) => p >= bruto)!);
  return { tope: Math.ceil(max / paso) * paso, paso };
}

/** Columnas verticales (horas del día, semanas). */
export function columnas(datos: { etiqueta: string; valor: number }[], color = '#6E1C22', alto = 200) {
  const ancho = 720, m = { i: 36, d: 8, a: 10, b: 28 };
  const { tope, paso } = escala(Math.max(...datos.map((d) => d.valor), 0));
  const y = (v: number) => m.a + (alto - m.a - m.b) * (1 - v / tope);
  let s = '';
  for (let v = 0; v <= tope; v += paso) s += `<line x1="${m.i}" x2="${ancho - m.d}" y1="${y(v)}" y2="${y(v)}" class="g-rejilla"/><text x="${m.i - 6}" y="${y(v) + 4}" text-anchor="end" class="g-eje">${v}</text>`;
  const ab = (ancho - m.i - m.d) / Math.max(datos.length, 1), w = Math.max(4, Math.min(34, ab - 6));
  const cada = Math.ceil(datos.length / 12);
  const barras = datos.map((d, i) => {
    const x = m.i + ab * i + (ab - w) / 2, h = y(0) - y(d.valor), r = Math.min(3, w / 2, h);
    return `<g><title>${esc(d.etiqueta)}: ${d.valor}</title>${h > 0 ? `<path d="M${x},${y(0)}V${y(d.valor) + r}q0,-${r} ${r},-${r}h${w - 2 * r}q${r},0 ${r},${r}V${y(0)}Z" fill="${color}"/>` : ''}
      ${i % cada === 0 ? `<text x="${x + w / 2}" y="${alto - 9}" text-anchor="middle" class="g-eje">${esc(d.etiqueta)}</text>` : ''}</g>`;
  }).join('');
  return `<svg viewBox="0 0 ${ancho} ${alto}" class="grafica" role="img" aria-label="Gráfica de columnas">${s}${barras}<line x1="${m.i}" x2="${ancho - m.d}" y1="${y(0)}" y2="${y(0)}" class="g-base"/></svg>`;
}

/** Barras horizontales ordenadas, con el valor escrito al final (sirve impreso). */
export function horizontales(datos: { etiqueta: string; valor: number; color?: string }[]) {
  const max = Math.max(...datos.map((d) => d.valor), 1);
  return `<div class="hbarras">${datos.map((d) => `<div class="hb"><span>${esc(d.etiqueta)}</span>
    <div class="hb-barra"><i style="width:${(d.valor / max) * 100}%;background:${d.color ?? '#6E1C22'}"></i></div><b>${d.valor}</b></div>`).join('')}</div>`;
}
