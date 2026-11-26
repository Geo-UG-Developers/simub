// Buscador con lista propia (no depende de <datalist>, que en iPhone y algunas tabletas no se ve).
// Muestra sugerencias al tocar el campo y mientras se escribe; siempre se puede escribir algo que no esté.
export interface Opcion { n: string; t?: string; lat?: number; lon?: number }

const esc = (t: unknown) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/^(col\.?|colonia|fracc\.?|fraccionamiento|com\.?|comunidad|barrio|calle|c\.)\s+/, '').trim();

const FUENTES: Record<string, () => Opcion[]> = {};
/** Registra una lista con nombre (p. ej. «colonias», «calles», «personal»). */
export function fuente(nombre: string, f: () => Opcion[]) { FUENTES[nombre] = f; }

/** Campo de texto con buscador. `lista` es el nombre de la fuente registrada. */
export const buscador = (nombre: string, valor: string | null, lista: string, attrs = '') =>
  `<span class="ac" data-ac="${esc(lista)}"><input name="${esc(nombre)}" value="${esc(valor ?? '')}" autocomplete="off" autocorrect="off" spellcheck="false" ${attrs}><ul class="ac-lista" role="listbox" hidden></ul></span>`;

/** Activa los buscadores dentro de un contenedor. `alElegir` recibe el campo y la opción elegida. */
export function activarBuscadores(raiz: HTMLElement, alElegir?: (input: HTMLInputElement, o: Opcion) => void) {
  raiz.querySelectorAll<HTMLElement>('.ac:not([data-listo])').forEach((caja) => {
    caja.dataset.listo = '1';
    const input = caja.querySelector('input')!, ul = caja.querySelector('ul')!;
    let marcada = -1, vis: Opcion[] = [];
    const pintar = () => {
      const q = norm(input.value), todas = FUENTES[caja.dataset.ac!]?.() ?? [];
      vis = (q ? todas.filter((o) => norm(o.n).includes(q)).sort((a, b) => Number(!norm(a.n).startsWith(q)) - Number(!norm(b.n).startsWith(q))) : todas).slice(0, 14);
      if (!vis.length || input.disabled || input.readOnly) { ul.hidden = true; return; }
      marcada = -1;
      ul.innerHTML = vis.map((o, i) => `<li role="option" data-i="${i}"><b>${esc(o.n)}</b>${o.t ? `<small>${esc(o.t)}</small>` : ''}</li>`).join('');
      ul.hidden = false;
      // posición fija junto al campo: así no la recortan tablas con desplazamiento
      const r = input.getBoundingClientRect(), abajo = window.innerHeight - r.bottom;
      Object.assign(ul.style, { position: 'fixed', left: `${r.left}px`, width: `${Math.max(r.width, 240)}px`,
        top: abajo > 220 ? `${r.bottom + 2}px` : '', bottom: abajo > 220 ? '' : `${window.innerHeight - r.top + 2}px` });
    };
    const elegir = (i: number) => {
      const o = vis[i]; if (!o) return; input.value = o.n; ul.hidden = true;
      input.dispatchEvent(new Event('change', { bubbles: true })); alElegir?.(input, o);
    };
    input.addEventListener('focus', pintar); input.addEventListener('input', pintar);
    input.addEventListener('keydown', (e) => {
      if (ul.hidden) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); marcada = Math.max(0, Math.min(vis.length - 1, marcada + (e.key === 'ArrowDown' ? 1 : -1)));
        ul.querySelectorAll('li').forEach((li, i) => li.classList.toggle('on', i === marcada)); }
      else if (e.key === 'Enter' && marcada >= 0) { e.preventDefault(); elegir(marcada); }
      else if (e.key === 'Escape') ul.hidden = true;
    });
    // pointerdown (antes del blur) para que funcione con dedo y con mouse
    ul.addEventListener('pointerdown', (e) => { const li = (e.target as HTMLElement).closest('li'); if (li) { e.preventDefault(); elegir(+li.dataset.i!); } });
    input.addEventListener('blur', () => setTimeout(() => { ul.hidden = true; }, 150));
    window.addEventListener('scroll', (e) => { if (!ul.hidden && e.target !== ul) ul.hidden = true; }, { passive: true, capture: true });
  });
}

// ---------------------------------------------------------------- lugares de Guanajuato (OpenStreetMap + catálogo de la estación)
let OSM: Opcion[] | null = null;
export async function cargarLugares(base: string, propias: { nombre: string; tipo: string | null }[]) {
  if (!OSM) {
    try { const j = await (await fetch(`${base}lugares-gto.json`, { cache: 'force-cache' })).json(); OSM = (j.lugares ?? []).map((x: { n: string; t: string; lat: number; lon: number }) => ({ n: x.n, t: x.t, lat: x.lat, lon: x.lon })); }
    catch { OSM = []; }
  }
  const vistas = new Set<string>(); const sin = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const colonias: Opcion[] = [], calles: Opcion[] = [];
  for (const p of propias) { const k = (p.tipo === 'Vialidad' ? 'c:' : 'l:') + sin(p.nombre); if (!vistas.has(k)) { vistas.add(k); (p.tipo === 'Vialidad' ? calles : colonias).push({ n: p.nombre, t: p.tipo ?? 'Colonia' }); } }
  for (const o of OSM ?? []) { const k = (o.t === 'Calle' ? 'c:' : 'l:') + sin(o.n); if (vistas.has(k)) continue; vistas.add(k); (o.t === 'Calle' ? calles : colonias).push(o); }
  fuente('colonias', () => colonias); fuente('calles', () => calles);
  return { colonias: colonias.length, calles: calles.length };
}
