// Controles para llenar rápido: elegir varias personas o unidades con un toque, colonia con sugerencias,
// área en m² o ha, filas que se agregan (vehículos, personas) y firma con el dedo o el mouse.
const esc = (t: unknown) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

/**
 * Selector de varias opciones: chips con las opciones de la lista y un campo para escribir alguien que no esté.
 * El valor queda en un <input type="hidden" name=...> separado por comas (compatible con lo ya guardado).
 */
export function multi(nombre: string, opciones: string[], seleccion: string[], placeholder = 'Escribir otro y Enter', deshabilitado = false, sugerencias: string[] = opciones) {
  const sel = new Set(seleccion.map((x) => x.trim()).filter(Boolean));
  const todas = [...new Set([...opciones, ...sel])];
  return `<div class="multi" data-multi="${esc(nombre)}">
    <input type="hidden" name="${esc(nombre)}" value="${esc([...sel].join(', '))}">
    <div class="multi-chips">${todas.map((o) => `<button type="button" class="mchip ${sel.has(o) ? 'on' : ''}" data-v="${esc(o)}" ${deshabilitado ? 'disabled' : ''}>${esc(o)}</button>`).join('')}</div>
    ${deshabilitado ? '' : `<input class="multi-otro" placeholder="${esc(placeholder)}" list="${esc(nombre)}-lista"><datalist id="${esc(nombre)}-lista">${sugerencias.map((o) => `<option value="${esc(o)}">`).join('')}</datalist>`}
  </div>`;
}

/** Activa todos los selectores múltiples dentro de un contenedor. Se puede llamar varias veces. */
export function activarMulti(raiz: HTMLElement) {
  raiz.querySelectorAll<HTMLElement>('[data-multi]:not([data-listo])').forEach((m) => {
    m.dataset.listo = '1';
    const oculto = m.querySelector<HTMLInputElement>('input[type=hidden]')!;
    const caja = m.querySelector<HTMLElement>('.multi-chips')!;
    const sync = () => { oculto.value = [...caja.querySelectorAll<HTMLButtonElement>('.mchip.on')].map((b) => b.dataset.v).join(', '); oculto.dispatchEvent(new Event('change', { bubbles: true })); };
    caja.addEventListener('click', (e) => { const b = (e.target as HTMLElement).closest<HTMLButtonElement>('.mchip'); if (!b || b.disabled) return; b.classList.toggle('on'); sync(); });
    const otro = m.querySelector<HTMLInputElement>('.multi-otro');
    const agregar = () => {
      const v = otro!.value.trim(); if (!v) return;
      let b = [...caja.querySelectorAll<HTMLButtonElement>('.mchip')].find((x) => x.dataset.v!.toLowerCase() === v.toLowerCase());
      if (!b) { b = document.createElement('button'); b.type = 'button'; b.className = 'mchip'; b.dataset.v = v; b.textContent = v; caja.appendChild(b); }
      b.classList.add('on'); otro!.value = ''; sync();
    };
    otro?.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); agregar(); } });
    otro?.addEventListener('change', () => { if (otro.value && [...(otro.list?.options ?? [])].some((o) => o.value === otro.value)) agregar(); });
    otro?.addEventListener('blur', agregar);
  });
}
export const valoresMulti = (v: FormDataEntryValue | null) => String(v ?? '').split(',').map((x) => x.trim()).filter(Boolean);

/** Selección de una persona de la lista (o escribir otra). */
export const persona = (nombre: string, valor: string, lista: string, attrs = '') =>
  `<input name="${esc(nombre)}" value="${esc(valor)}" list="${esc(lista)}" autocomplete="off" ${attrs}>`;
export const datalist = (id: string, opciones: string[]) => `<datalist id="${esc(id)}">${opciones.map((o) => `<option value="${esc(o)}">`).join('')}</datalist>`;

/** Área afectada: número + unidad (m² o ha). Guarda «500 m²» / «2 ha»; si viene otro texto, lo respeta. */
export function area(nombre: string, valor: string | null, attrs = '') {
  const m = String(valor ?? '').trim().match(/^([\d.,\s]+)\s*(m2|m²|mts?2?|ha|has|hectáreas?)?$/i);
  const num = m ? m[1].replace(/\s/g, '') : '', uni = m && /^h/i.test(m[2] ?? '') ? 'ha' : 'm²';
  const libre = !m && valor ? valor : '';
  return `<span class="area" data-area="${esc(nombre)}"><input type="text" inputmode="decimal" class="area-n" value="${esc(num || libre)}" placeholder="Ej. 500" ${attrs}>
    <select class="area-u" ${attrs}><option ${uni === 'm²' ? 'selected' : ''}>m²</option><option ${uni === 'ha' ? 'selected' : ''}>ha</option></select>
    <input type="hidden" name="${esc(nombre)}" value="${esc(valor ?? '')}"></span>`;
}
export function activarArea(raiz: HTMLElement) {
  raiz.querySelectorAll<HTMLElement>('[data-area]').forEach((a) => {
    const n = a.querySelector<HTMLInputElement>('.area-n')!, u = a.querySelector<HTMLSelectElement>('.area-u')!, h = a.querySelector<HTMLInputElement>('input[type=hidden]')!;
    const sync = () => { const v = n.value.trim(); h.value = !v ? '' : /^[\d.,]+$/.test(v) ? `${v} ${u.value}` : v; };
    n.addEventListener('input', sync); u.addEventListener('change', sync);
  });
}

/** Tabla con filas que se agregan con «+ Agregar». `fila(i)` devuelve el HTML de la fila i. */
export function filasAgregables(id: string, n: number, fila: (i: number) => string, texto: string, deshabilitado = false) {
  return `<div class="tabla-caja"><table class="tabla t-form" id="${esc(id)}"><tbody>${[...Array(n)].map((_, i) => fila(i)).join('')}</tbody></table></div>
    ${deshabilitado ? '' : `<button type="button" class="btn chico" data-agregar="${esc(id)}">+ ${esc(texto)}</button>`}`;
}
export function activarAgregables(raiz: HTMLElement, fabrica: Record<string, (i: number) => string>, contar: Record<string, () => number>) {
  raiz.querySelectorAll<HTMLButtonElement>('[data-agregar]').forEach((b) => b.addEventListener('click', () => {
    const id = b.dataset.agregar!, tb = raiz.querySelector(`#${id} tbody`)!;
    const i = contar[id](); tb.insertAdjacentHTML('beforeend', fabrica[id](i));
    (tb.lastElementChild?.querySelector('input') as HTMLInputElement | null)?.focus();
  }));
}

// ---------------------------------------------------------------- firma en pantalla
/** Lienzo de firma. Devuelve funciones para limpiar y leer la imagen (PNG recortado, fondo transparente). */
export function lienzoFirma(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext('2d')!;
  const escala = () => { const r = canvas.getBoundingClientRect(); const d = window.devicePixelRatio || 1;
    canvas.width = Math.round(r.width * d); canvas.height = Math.round(r.height * d); ctx.setTransform(d, 0, 0, d, 0, 0);
    ctx.lineWidth = 2.4; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#14287a'; };
  escala();
  let dibujando = false, trazos = 0, ultimo: [number, number] | null = null;
  const pos = (e: PointerEvent): [number, number] => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  canvas.addEventListener('pointerdown', (e) => { dibujando = true; ultimo = pos(e); canvas.setPointerCapture(e.pointerId); e.preventDefault(); });
  canvas.addEventListener('pointermove', (e) => {
    if (!dibujando || !ultimo) return; const p = pos(e);
    ctx.beginPath(); ctx.moveTo(...ultimo); ctx.lineTo(...p); ctx.stroke(); ultimo = p; trazos++;
  });
  const fin = () => { dibujando = false; ultimo = null; };
  canvas.addEventListener('pointerup', fin); canvas.addEventListener('pointercancel', fin);
  return {
    limpiar() { ctx.clearRect(0, 0, canvas.width, canvas.height); trazos = 0; },
    vacia: () => trazos < 8,
    imagen(): string {
      // reduce a máx. 600 px de ancho para que pese poco
      const k = Math.min(1, 600 / canvas.width), c2 = document.createElement('canvas');
      c2.width = Math.round(canvas.width * k); c2.height = Math.round(canvas.height * k);
      c2.getContext('2d')!.drawImage(canvas, 0, 0, c2.width, c2.height);
      return c2.toDataURL('image/png');
    },
  };
}

/** Huella SHA-256 (hex) de un objeto: si alguien cambia el parte después de firmar, la huella ya no coincide. */
export async function huella(obj: unknown): Promise<string> {
  const datos = new TextEncoder().encode(JSON.stringify(obj));
  const h = await crypto.subtle.digest('SHA-256', datos);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ---------------------------------------------------------------- especificaciones sugeridas por tipo
export const ESPECIFICACIONES: Record<string, string[]> = {
  inc_estructural: ['Casa habitación', 'Comercio', 'Bodega', 'Cocina', 'Escuela'], inc_pastizal: ['Pastizal', 'Maleza', 'Cerro', 'Lote baldío'],
  inc_vehicular: ['Automóvil', 'Camioneta', 'Motocicleta', 'Camión'], inc_basura: ['Basura', 'Contenedor', 'Tiradero'],
  inc_cables: ['Cables de luz', 'Transformador', 'Medidor'], inc_arbol: ['Pino', 'Eucalipto', 'Árbol'],
  acc_vehicular: ['Choque', 'Alcance', 'Atropellamiento', 'Persona prensada', 'Salida del camino'], acc_moto: ['Derrapó', 'Choque contra auto', 'Atropellamiento'],
  acc_volcadura: ['Automóvil', 'Camioneta', 'Camión'], pac_clinico: ['Desmayo', 'Convulsión', 'Dificultad para respirar', 'Dolor de pecho', 'Diabético'],
  pac_trauma: ['Caída', 'Herida', 'Fractura', 'Golpe en la cabeza'], traslado: ['Traslado programado', 'Traslado a hospital'],
  fuga_gas: ['Cilindro 10 kg', 'Cilindro 20 kg', 'Cilindro 30 kg', 'Tanque estacionario', 'Instalación', 'Pipa', 'Olor a gas'],
  fau_enjambre: ['Abejas', 'Avispas', 'Guarichos', 'Panal'], fau_reptil: ['Serpiente', 'Víbora de cascabel', 'Iguana'],
  fau_animal: ['Tlacuache', 'Cacomixtle', 'Murciélago', 'Gato', 'Ave', 'Animal atrapado'],
  cai_arbol: ['Árbol', 'Rama'], cai_cables: ['Cables de luz', 'Cables de teléfono'], cai_estructura: ['Barda', 'Lámina', 'Fachada', 'Anuncio'],
  revision: ['NOM-002', 'Olor a gas', 'Panal', 'Cilindro', 'Instalación eléctrica'], evento: ['Quema de pirotecnia', 'Carrera', 'Evento deportivo', 'Circo', 'Desfile', 'Plática'],
  simulacro: ['Incendio', 'Sismo', 'Evacuación'], capacitacion: ['Brigadas multifuncionales', 'Extintores', 'Primeros auxilios', 'Evacuación'],
  res_acuatico: ['Presa', 'Río', 'Alberca'], res_angulo: ['Cerro', 'Barranca', 'Edificio'], res_vehicular: ['Persona prensada'],
};
export const CODIGOS_PERSONA = ['Verde (sin lesiones graves)', 'Amarillo (urgente)', 'Rojo (grave)', 'Negro (sin vida)', 'Ileso', 'Trasladado'];
export const TIPOS_VEHICULO = ['Automóvil', 'Camioneta', 'Pick-up', 'Motocicleta', 'Camión', 'Autobús', 'Tráiler', 'Bicicleta'];
export const COLORES = ['Blanco', 'Negro', 'Gris', 'Plata', 'Rojo', 'Azul', 'Verde', 'Amarillo', 'Café', 'Dorado'];
