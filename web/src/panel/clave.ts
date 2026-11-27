// Campo de contraseña con botón «Ver». Es un campo de texto enmascarado (no «password») para que el navegador
// NO ofrezca guardar la contraseña en la computadora de cabina; a lo mucho recuerda el correo.
const OCULTA = typeof CSS !== 'undefined' && (CSS.supports('-webkit-text-security', 'disc') || CSS.supports('text-security', 'disc'));
export const campoClave = (id: string, etq: string, _auto = '') =>
  `<label>${etq}<span class="clave-caja"><input type="${OCULTA ? 'text' : 'password'}" class="clave-oculta" id="${id}" data-clave="${id}" name="${id}-${Math.random().toString(36).slice(2, 7)}"
    autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" data-lpignore="true" data-1p-ignore data-bwignore required minlength="8">
   <button type="button" class="ver-clave" data-ver="${id}" aria-label="Mostrar contraseña" aria-pressed="false">Ver</button></span></label>`;
export function activarClaves(raiz: ParentNode) {
  raiz.querySelectorAll<HTMLButtonElement>('[data-ver]').forEach((b) => b.addEventListener('click', () => {
    const i = raiz.querySelector<HTMLInputElement>(`[data-clave="${b.dataset.ver}"]`); if (!i) return;
    const ver = !i.classList.contains('visible');
    i.classList.toggle('visible', ver); if (!OCULTA) i.type = ver ? 'text' : 'password'; b.textContent = ver ? 'Ocultar' : 'Ver';
    b.setAttribute('aria-pressed', String(ver)); b.setAttribute('aria-label', ver ? 'Ocultar contraseña' : 'Mostrar contraseña');
  }));
}
/** Valor de un campo de contraseña creado con campoClave (su «name» cambia en cada carga). */
export const valorClave = (raiz: ParentNode, id: string) => raiz.querySelector<HTMLInputElement>(`[data-clave="${id}"]`)?.value ?? '';
