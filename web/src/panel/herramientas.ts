// SIMUB · Herramientas de campo: calculadoras de hidráulica, flujo de agua necesario, tiempo de aire,
// autonomía del tanque, clasificación de pacientes (START) y acceso a la Guía de Respuesta en Caso de Emergencia.
import type { Ctx } from './mando';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const num = (id: string) => Number(($(id) as HTMLInputElement).value) || 0;
const C_MANGUERA: Record<string, number> = { '1½"': 24, '1¾"': 15.5, '2"': 8, '2½"': 2, '3"': 0.8, '4"': 0.2, '5"': 0.08 };
const BOQUILLAS: [string, number][] = [['Niebla estándar (100 psi)', 100], ['Niebla baja presión (75 psi)', 75], ['Chorro sólido manual (50 psi)', 50], ['Chorro sólido monitor (80 psi)', 80]];

export function vistaHerramientas(c: Ctx) {
  c.marco('herramientas', 'Herramientas de campo', 'Cálculos rápidos de referencia (valores de manual IFSTA). Confirmen siempre con la experiencia del operador.',
    `<div class="rejilla-graf herramientas">
      <section class="tarjeta"><h3>Pérdida por fricción y presión de bomba</h3>
        <div class="rejilla-2"><label>Diámetro de manguera<select id="hc-d">${Object.keys(C_MANGUERA).map((k) => `<option ${k === '1¾"' ? 'selected' : ''}>${k}</option>`).join('')}</select></label>
          <label>Caudal<span class="con-ahora"><input id="hc-q" type="number" inputmode="decimal" value="150"><select id="hc-qu"><option value="gpm">gpm</option><option value="lpm">L/min</option></select></span></label>
          <label>Longitud<span class="con-ahora"><input id="hc-l" type="number" inputmode="decimal" value="60"><select id="hc-lu"><option value="m">m</option><option value="ft">pies</option></select></span></label>
          <label>Boquilla<select id="hc-np">${BOQUILLAS.map(([t, v]) => `<option value="${v}">${t}</option>`).join('')}</select></label>
          <label>Desnivel (+ subir / − bajar, m)<input id="hc-z" type="number" inputmode="decimal" value="0"></label>
          <label>Accesorios (psi)<input id="hc-ac" type="number" inputmode="decimal" value="0"></label></div>
        <p class="calc-res" id="hc-res"></p></section>
      <section class="tarjeta"><h3>Flujo de agua necesario</h3><p class="tenue chica">Fórmula de área: (largo × ancho ÷ 3) × % involucrado.</p>
        <div class="rejilla-3"><label>Largo (m)<input id="nf-l" type="number" value="10"></label><label>Ancho (m)<input id="nf-a" type="number" value="8"></label>
          <label>% involucrado<input id="nf-p" type="number" value="50"></label></div><p class="calc-res" id="nf-res"></p></section>
      <section class="tarjeta"><h3>Tiempo de aire del equipo de respiración</h3>
        <div class="rejilla-2"><label>Presión actual (psi)<input id="ai-p" type="number" value="4500"></label><label>Presión llena (psi)<select id="ai-l"><option>4500</option><option>2216</option><option>3000</option></select></label>
          <label>Duración nominal (min)<select id="ai-n"><option>30</option><option>45</option><option>60</option></select></label><label>Reserva (%)<input id="ai-r" type="number" value="25"></label></div>
        <p class="calc-res" id="ai-res"></p><p class="tenue chica">El tiempo real depende del esfuerzo: con trabajo pesado puede ser la mitad.</p></section>
      <section class="tarjeta"><h3>Autonomía del tanque</h3><div class="rejilla-2"><label>Agua en el tanque (L)<input id="ta-l" type="number" value="3000"></label>
        <label>Caudal total (L/min)<input id="ta-q" type="number" value="470"></label></div><p class="calc-res" id="ta-res"></p></section>
      <section class="tarjeta"><h3>Clasificación de pacientes (START)</h3><ol class="start">
        <li><b>¿Camina?</b> → <span class="t-v">VERDE</span> (menor).</li><li><b>¿Respira?</b> No, ni al abrir la vía aérea → <span class="t-n">NEGRO</span>. Respira solo al abrirla → <span class="t-r">ROJO</span>.</li>
        <li><b>Respiraciones > 30 por minuto</b> → <span class="t-r">ROJO</span>.</li><li><b>Llenado capilar > 2 s o sin pulso radial</b> → <span class="t-r">ROJO</span> (controlar hemorragias).</li>
        <li><b>¿No obedece órdenes sencillas?</b> → <span class="t-r">ROJO</span>. Si obedece → <span class="t-a">AMARILLO</span>.</li></ol></section>
      <section class="tarjeta"><h3>Materiales peligrosos</h3><p>Usen la <b>Guía de Respuesta en Caso de Emergencia (GRE 2024)</b> oficial: identifica el material por su número ONU o placa y da distancias de aislamiento.</p>
        <div class="fila-btn"><a class="btn" href="https://apps.apple.com/app/id385775821" target="_blank" rel="noopener">GRE 2024 para iPhone</a>
        <a class="btn" href="https://play.google.com/store/search?q=ERG%202024&c=apps" target="_blank" rel="noopener">GRE / ERG para Android</a>
        <a class="btn" href="https://www.phmsa.dot.gov/hazmat/erg/emergency-response-guidebook-erg" target="_blank" rel="noopener">GRE en PDF (PHMSA)</a></div></section>
    </div>`);
  const calcular = () => {
    const q = $<HTMLSelectElement>('hc-qu').value === 'lpm' ? num('hc-q') / 3.785 : num('hc-q');
    const l = $<HTMLSelectElement>('hc-lu').value === 'm' ? num('hc-l') * 3.281 : num('hc-l');
    const fl = C_MANGUERA[$<HTMLSelectElement>('hc-d').value] * (q / 100) ** 2 * (l / 100);
    const pdp = Number($<HTMLSelectElement>('hc-np').value) + fl + num('hc-z') * 3.281 * 0.434 + num('hc-ac');
    $('hc-res').innerHTML = `Pérdida por fricción: <b>${fl.toFixed(0)} psi</b> (${(fl / 14.5).toFixed(1)} bar)<br>Presión de bomba: <b>${pdp.toFixed(0)} psi</b> (${(pdp / 14.5).toFixed(1)} bar)<br><small>${q.toFixed(0)} gpm = ${(q * 3.785).toFixed(0)} L/min</small>`;
    const nf = (num('nf-l') * num('nf-a') * 10.764 / 3) * (num('nf-p') / 100);
    $('nf-res').innerHTML = `<b>${nf.toFixed(0)} gpm</b> (${(nf * 3.785).toFixed(0)} L/min) · por minuto de ataque`;
    const ut = Math.max(0, (num('ai-p') - Number($<HTMLSelectElement>('ai-l').value) * num('ai-r') / 100) / Number($<HTMLSelectElement>('ai-l').value)) * Number($<HTMLSelectElement>('ai-n').value);
    $('ai-res').innerHTML = `Tiempo de trabajo antes de la reserva: <b>${Math.floor(ut)} min</b>`;
    const t = num('ta-q') ? num('ta-l') / num('ta-q') : 0;
    $('ta-res').innerHTML = `El tanque dura <b>${Math.floor(t)} min ${Math.round((t % 1) * 60)} s</b> a ese caudal.`;
  };
  document.querySelector('.herramientas')!.addEventListener('input', calcular);
  document.querySelector('.herramientas')!.addEventListener('change', calcular);
  calcular();
}
