// SIMUB · Ajustes (solo Admin. Maestro). Menú de botones: cada sección se abre sola, se queda abierta al
// refrescar (#ajustes/<sección>) y al guardar se vuelve a pintar SOLO esa sección sin mover la pantalla.
import { I } from '../iconos';
import {
  accion, actualizar, borrarCuenta, borrarPersona, codigos, cuentas, dbp, desbloquearAcceso, guardarConfig, guardarCuenta, insertar, invitarGrupo,
  miembrosGrupos, oficiales, tabla, type Cuenta, type MiembroGrupo, type Oficial,
} from './datos';
import { activarImportar, tarjetaImportar, type Ctx } from './mando';
import { activarRespaldo, tarjetaRespaldo } from './control';

const esc = (t: unknown) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const fecha = (f: string) => new Date(f).toLocaleString('es-MX', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
export const ROL_CUENTA: Record<string, string> = { admin: 'Admin. Maestro', coordinador: 'Admin (coordinación)', guardia: 'Cabinero', campo: 'Campo (celular de unidad)' };
interface Persona { id: number; nombre: string; cargo: string | null; activo: boolean; nombre_corto: string | null; telefono: string | null; email: string | null; comunicacion_interna: boolean; reportes_app: boolean }
const ROL_CHAT: Record<string, string> = { alertas: 'Reportes de la app (alertas)', interno: 'Comunicación interna', comunicacion: 'Comunicación (noticias y donativos)', respaldo: 'Respaldo (si nadie contesta en 10 min)' };

type Seccion = { id: string; txt: string; desc: string; grupo: string; ic: (n: number) => string; solo_super?: boolean };
const SECCIONES: Seccion[] = [
  { id: 'cuentas', txt: 'Cuentas del panel', desc: 'Usuarios, roles, contraseñas, bloqueos', grupo: 'Personas', ic: I.escudo },
  { id: 'personal', txt: 'Oficiales y personal', desc: 'Teléfonos, grupos, enlace del bot', grupo: 'Personas', ic: I.lista },
  { id: 'grupos', txt: 'Grupos de Telegram', desc: 'Vincular grupos e invitar al personal', grupo: 'Personas', ic: I.campana },
  { id: 'importar', txt: 'Importar servicios', desc: 'Excel histórico de SIMUB', grupo: 'Datos', ic: I.noticias },
  { id: 'respaldo', txt: 'Copias de seguridad', desc: 'Nube y esta computadora', grupo: 'Datos', ic: I.caja },
  { id: 'estacion', txt: 'Datos de la estación', desc: 'Teléfono, donativos, revisiones', grupo: 'Datos', ic: I.tel },
  { id: 'unidades', txt: 'Unidades', desc: 'Vehículos de la estación', grupo: 'Catálogos', ic: I.unidad },
  { id: 'colonias', txt: 'Colonias y lugares', desc: 'Sugerencias del buscador', grupo: 'Catálogos', ic: I.pin },
  { id: 'necesidades', txt: 'Necesidades en especie', desc: 'Lo que se pide en la app', grupo: 'Catálogos', ic: I.mano },
  { id: 'noticias', txt: 'Noticias', desc: 'Ocultar o destacar', grupo: 'Catálogos', ic: I.noticias },
  { id: 'produccion', txt: 'Preparar producción', desc: 'Solo desarrollador', grupo: 'Desarrollador', ic: I.escudo, solo_super: true },
];

let actual = 'cuentas';
let filtroPer = 'todos', buscaPer = '', buscaCta = '';

export async function vistaAjustes(c: Ctx, sec?: string) {
  const yo = c.yo();
  if (yo.rol !== 'admin' && !yo.super) { location.hash = '#mando'; return; }
  if (sec && SECCIONES.some((s) => s.id === sec)) actual = sec;
  const visibles = SECCIONES.filter((s) => !s.solo_super || yo.super);
  const grupos = [...new Set(visibles.map((s) => s.grupo))];
  c.marco('ajustes', 'Ajustes', 'Elige una sección. Solo se abre esa; al guardar no se mueve la pantalla.',
    `<nav class="aj-menu" aria-label="Secciones de ajustes">${grupos.map((g) => `<div class="aj-grupo"><span class="aj-gtit">${g}</span><div class="aj-botones">
      ${visibles.filter((s) => s.grupo === g).map((s) => `<button type="button" class="aj-btn ${s.id === actual ? 'on' : ''}" data-sec="${s.id}" aria-pressed="${s.id === actual}">
        ${s.ic(20)}<span><b>${s.txt}</b><small>${s.desc}</small></span><em id="aj-n-${s.id}"></em></button>`).join('')}</div></div>`).join('')}</nav>
     <div id="aj-sec" class="aj-sec"><p class="tenue">Cargando…</p></div>`);
  const menu = document.querySelector('.aj-menu')!;
  menu.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-sec]'); if (!b) return;
    actual = b.dataset.sec!; history.replaceState(null, '', `#ajustes/${actual}`);
    menu.querySelectorAll('.aj-btn').forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', String(x === b)); });
    pintar(true);
  });
  // contadores de los botones (sin bloquear)
  Promise.all([cuentas().catch(() => []), tabla<Persona>('personal', 'nombre').catch(() => []), codigos().catch(() => [])]).then(([cs, ps, cds]) => {
    const n = (id: string, t: string, alerta = false) => { const e = document.getElementById(`aj-n-${id}`); if (e) { e.textContent = t; e.classList.toggle('alerta', alerta); } };
    n('cuentas', String(cs.length), cs.some((x) => x.bloqueado)); n('personal', String(ps.filter((p) => p.activo).length));
    const sin = cds.filter((x) => !x.vinculado).length; n('grupos', sin ? `${sin} sin vincular` : '✔', sin > 0);
  });
  const cont = document.getElementById('aj-sec')!;
  /** Vuelve a pintar la sección actual. `irArriba` solo cuando se cambia de sección. */
  const pintar = async (irArriba = false) => {
    const y = window.scrollY;
    const s = SECCIONES.find((x) => x.id === actual)!;
    cont.setAttribute('aria-busy', 'true');
    try { await (PINTORES[actual] ?? PINTORES.cuentas)(c, cont, () => pintar()); }
    catch { cont.innerHTML = '<p class="alerta-txt">No se pudo cargar esta sección. Revisa el internet.</p>'; }
    cont.removeAttribute('aria-busy');
    if (irArriba) cont.scrollIntoView({ behavior: 'smooth', block: 'start' }); else window.scrollTo(0, y);
    document.title = `${s.txt} · Ajustes · SIMUB`;
  };
  pintar();
}

// ---------------------------------------------------------------- cajón (formulario lateral)
function cajon(titulo: string, html: string) {
  document.querySelector('.cajon-fondo')?.remove();
  const f = document.createElement('div'); f.className = 'cajon-fondo';
  f.innerHTML = `<aside class="cajon" role="dialog" aria-modal="true" aria-label="${esc(titulo)}"><div class="det-cab"><div><h2>${titulo}</h2></div>
    <button class="btn cerrar-x" data-x aria-label="Cerrar">✕</button></div>${html}</aside>`;
  document.body.appendChild(f);
  const cerrar = () => f.remove();
  f.addEventListener('click', (e) => { if (e.target === f || (e.target as HTMLElement).closest('[data-x]')) cerrar(); });
  (f.querySelector('input:not([type=hidden]),select') as HTMLElement | null)?.focus();
  return { f, cerrar };
}
/** Confirmación dentro de la página (sin ventanas del navegador). */
function confirmar(titulo: string, texto: string, boton: string, alAceptar: () => Promise<void>) {
  const { f, cerrar } = cajon(titulo, `<div class="bloque confirmar"><p>${texto}</p>
    <div class="fila-btn"><button class="btn rojo" id="cf-si">${boton}</button><button class="btn" data-x>Cancelar</button></div></div>`);
  f.querySelector<HTMLButtonElement>('#cf-si')!.addEventListener('click', async (e) => {
    const b = e.currentTarget as HTMLButtonElement; b.disabled = true; b.textContent = 'Un momento…';
    try { await alAceptar(); cerrar(); } catch { b.disabled = false; b.textContent = boton; }
  });
}
const tel10 = (t: string) => t.replace(/\D/g, '').replace(/^52(?=\d{10}$)/, '');

// ---------------------------------------------------------------- secciones
type Pintor = (c: Ctx, cont: HTMLElement, refrescar: () => void) => Promise<void>;
const PINTORES: Record<string, Pintor> = {
  // ---------------- cuentas del panel
  async cuentas(c, cont, refrescar) {
    const [ctas, per, ses] = await Promise.all([cuentas(), tabla<Persona>('personal', 'nombre').catch(() => [] as Persona[]), dbp.auth.getSession()]);
    const miId = ses.data.session?.user.id;
    const q = buscaCta.toLowerCase();
    const vis = ctas.filter((x) => !q || `${x.nombre} ${x.email} ${ROL_CUENTA[x.rol]}`.toLowerCase().includes(q));
    cont.innerHTML = `<section class="tarjeta"><div class="aj-barra"><h3>Cuentas del panel (${ctas.length})</h3>
        <input type="search" id="cta-q" placeholder="Buscar nombre o correo" value="${esc(buscaCta)}"><button class="btn primario" id="cta-nueva">${I.mas(16)} Dar de alta</button></div>
      <p class="tenue chica"><b>Admin. Maestro</b>: todo (informes, voluntariado, control interno, ajustes y corregir partes cerrados). <b>Admin</b>: operación, unidades y capacitación.
        <b>Cabinero</b>: centro de mando, servicios y reportes. <b>Campo</b>: celular de una unidad. Las contraseñas son fijas y solo se cambian aquí. Con 5 contraseñas equivocadas la cuenta se bloquea 30 min y se avisa al Admin. Maestro.</p>
      <div class="tabla-caja"><table class="tabla"><thead><tr><th>Nombre</th><th>Correo (usuario)</th><th>Rol</th><th>Último acceso</th><th>Estado</th><th></th></tr></thead><tbody>
      ${vis.map((x) => `<tr><td><b>${esc(x.nombre)}</b>${x.superusuario ? ' <em class="pill p-gris">desarrollador</em>' : ''}</td><td class="chica">${esc(x.email ?? '—')}</td>
        <td>${ROL_CUENTA[x.rol] ?? x.rol}</td><td class="nw chica">${x.ultimo_acceso ? fecha(x.ultimo_acceso) : 'nunca'}</td>
        <td>${x.bloqueado ? '<em class="pill p-rojo">Bloqueada</em>' : '<em class="pill p-verde">Activa</em>'}</td>
        <td class="nw aj-acc">${x.bloqueado ? `<button class="btn chico" data-desbloq="${esc(x.email)}">Desbloquear</button>` : ''}
          <button class="btn chico" data-cuenta="${x.user_id}">Editar</button>
          ${x.user_id !== miId && !x.superusuario ? `<button class="btn chico btn-borrar" data-borrar-cta="${x.user_id}">Borrar</button>` : ''}</td></tr>`).join('')
        || '<tr><td colspan="6" class="tenue">Sin resultados.</td></tr>'}</tbody></table></div></section>`;
    const q$ = cont.querySelector<HTMLInputElement>('#cta-q')!;
    q$.addEventListener('input', () => { buscaCta = q$.value; const pos = q$.selectionStart; refrescarSuave(refrescar, () => { const n = document.getElementById('cta-q') as HTMLInputElement | null; n?.focus(); n?.setSelectionRange(pos, pos); }); });
    cont.querySelectorAll<HTMLButtonElement>('[data-desbloq]').forEach((b) => b.addEventListener('click', async () => {
      try { await desbloquearAcceso(b.dataset.desbloq!); c.aviso('Cuenta desbloqueada.'); refrescar(); } catch { c.aviso('No se pudo desbloquear.', true); }
    }));
    cont.querySelectorAll<HTMLButtonElement>('[data-borrar-cta]').forEach((b) => b.addEventListener('click', () => {
      const x = ctas.find((y) => y.user_id === b.dataset.borrarCta)!;
      confirmar('Borrar cuenta', `¿Borrar la cuenta de <b>${esc(x.nombre)}</b> (${esc(x.email ?? '')})? Ya no podrá entrar al panel. Sus registros pasados se conservan con su nombre. No se puede deshacer.`,
        'Sí, borrar cuenta', async () => {
          try { await borrarCuenta(x.user_id); c.aviso('Cuenta borrada.'); refrescar(); }
          catch (e) { c.aviso((e as Error).message === 'protegida' ? 'Esa cuenta no se puede borrar.' : 'No se pudo borrar.', true); throw e; }
        });
    }));
    const form = (x?: Cuenta) => {
      const sug = Array.from(crypto.getRandomValues(new Uint8Array(12)), (n) => 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'[n % 56]).join('');
      const conCorreo = per.filter((p) => p.activo && p.email && !ctas.some((y) => y.email === p.email));
      const { f, cerrar } = cajon(x ? `Editar cuenta: ${esc(x.nombre)}` : 'Alta de cuenta', `<form class="bloque" autocomplete="off">
        ${x ? `<p class="tenue">Usuario: <b>${esc(x.email ?? '')}</b></p>` : `${conCorreo.length ? `<label>Tomar los datos del personal <small>(opcional)</small><select id="cta-de"><option value="">— Elegir —</option>
          ${conCorreo.map((p) => `<option value="${p.id}">${esc(p.nombre)} · ${esc(p.cargo ?? '')}</option>`).join('')}</select></label>` : ''}
          <label>Correo (será su usuario)<input type="email" name="email" required autocomplete="off"></label>`}
        <label>Nombre (como aparece en el panel)<input name="nombre" required value="${esc(x?.nombre ?? '')}"></label>
        <label>Rol<select name="rol">${Object.entries(ROL_CUENTA).map(([k, t]) => `<option value="${k}" ${k === (x?.rol ?? 'guardia') ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
        <div class="rejilla-2"><label>Cargo<input name="cargo" value="${esc(x?.cargo ?? '')}" placeholder="Ej. Cabinero"></label><label>Unidad <small>(solo rol Campo)</small><input name="unidad" value="${esc(x?.unidad ?? '')}"></label></div>
        <label>${x ? 'Contraseña nueva <small>(vacía = no cambia)</small>' : 'Contraseña inicial'} <small>mín. 10 caracteres</small>
          <input name="password" class="clave-oculta visible" autocomplete="off" spellcheck="false" ${x ? '' : `value="${sug}" required`} minlength="10"></label>
        <p class="tenue chica">La contraseña es fija: la persona no la puede cambiar. Solo el Admin. Maestro la asigna o la cambia aquí.</p>
        <button class="btn primario">${x ? 'Guardar cambios' : 'Crear cuenta'}</button></form>`);
      f.querySelector<HTMLSelectElement>('#cta-de')?.addEventListener('change', (e) => {
        const p = per.find((y) => y.id === +(e.target as HTMLSelectElement).value); if (!p) return;
        const fm = f.querySelector('form')!; const set = (n: string, v: string) => { (fm.elements.namedItem(n) as HTMLInputElement).value = v; };
        set('email', p.email ?? ''); set('nombre', p.nombre); set('cargo', p.cargo ?? '');
        (fm.elements.namedItem('rol') as HTMLSelectElement).value = /maestro/i.test(p.cargo ?? '') ? 'admin' : /^admin/i.test(p.cargo ?? '') ? 'coordinador' : 'guardia';
      });
      f.querySelector('form')!.addEventListener('submit', async (e) => {
        e.preventDefault(); const d = Object.fromEntries(new FormData(e.target as HTMLFormElement)) as Record<string, string>;
        if (!d.password) delete d.password;
        try { await guardarCuenta({ ...d, user_id: x?.user_id }); cerrar(); c.aviso(x ? 'Cuenta actualizada.' : 'Cuenta creada.'); refrescar(); }
        catch (err) { c.aviso((err as Error).message === 'ya_existe' ? 'Ese correo ya tiene cuenta.' : 'No se pudo guardar la cuenta.', true); }
      });
    };
    cont.querySelector('#cta-nueva')!.addEventListener('click', () => form());
    cont.querySelectorAll<HTMLButtonElement>('[data-cuenta]').forEach((b) => b.addEventListener('click', () => form(ctas.find((x) => x.user_id === b.dataset.cuenta))));
  },

  // ---------------- oficiales y personal
  async personal(c, cont, refrescar) {
    const [personal, ofs] = await Promise.all([tabla<Persona>('personal', 'nombre'), oficiales().catch(() => [] as Oficial[])]);
    const enlaceDe = new Map(ofs.map((o) => [o.id, o]));
    const q = buscaPer.toLowerCase();
    const vis = personal.filter((p) => (filtroPer === 'inactivos' ? !p.activo : p.activo)
      && (filtroPer !== 'interno' || p.comunicacion_interna) && (filtroPer !== 'app' || p.reportes_app)
      && (!q || `${p.nombre} ${p.nombre_corto} ${p.cargo} ${p.telefono}`.toLowerCase().includes(q)));
    const FIL = [['todos', 'Activos'], ['interno', 'Comunicación interna'], ['app', 'Reportes app'], ['inactivos', 'Dados de baja']];
    cont.innerHTML = `<section class="tarjeta"><div class="aj-barra"><h3>Oficiales y personal</h3>
        <input type="search" id="per-q" placeholder="Buscar nombre o teléfono" value="${esc(buscaPer)}"><button class="btn primario" id="per-nueva">${I.mas(16)} Agregar oficial o persona</button></div>
      <div class="chips-sel" id="per-fil">${FIL.map(([k, t]) => `<button type="button" class="mchip ${filtroPer === k ? 'on' : ''}" data-fil="${k}">${t}
        <small>${k === 'todos' ? personal.filter((p) => p.activo).length : k === 'interno' ? personal.filter((p) => p.activo && p.comunicacion_interna).length
          : k === 'app' ? personal.filter((p) => p.activo && p.reportes_app).length : personal.filter((p) => !p.activo).length}</small></button>`).join('')}</div>
      <p class="tenue chica"><b>Comunicación interna = Sí</b>: recibe por Telegram privado el servicio completo y puede aparecer en el mapa. <b>Reportes app = Sí</b>: va en el grupo de reportes de la app.
        Los dos grupos se invitan en «Grupos de Telegram».</p>
      <div class="tabla-caja"><table class="tabla t-per"><thead><tr><th>Corto</th><th>Nombre</th><th>Cargo</th><th>Teléfono</th><th>Reportes app</th><th>Com. interna</th><th>Bot</th><th></th></tr></thead><tbody>
      ${vis.map((u) => { const o = enlaceDe.get(u.id); return `<tr class="${u.activo ? '' : 'inactivo'}"><td><b>${esc(u.nombre_corto ?? '')}</b></td><td>${esc(u.nombre)}</td><td class="chica">${esc(u.cargo ?? '')}</td>
        <td class="nw">${u.telefono ? `<a href="tel:${esc(u.telefono)}">${esc(u.telefono)}</a>` : '<span class="alerta-txt chica">falta</span>'}</td>
        <td><button class="btn chico sw ${u.reportes_app ? 'si' : ''}" data-tog="${u.id}" data-campo="reportes_app" data-val="${!u.reportes_app}" aria-pressed="${u.reportes_app}">${u.reportes_app ? 'Sí' : 'No'}</button></td>
        <td><button class="btn chico sw ${u.comunicacion_interna ? 'si' : ''}" data-tog="${u.id}" data-campo="comunicacion_interna" data-val="${!u.comunicacion_interna}" aria-pressed="${u.comunicacion_interna}">${u.comunicacion_interna ? 'Sí' : 'No'}</button></td>
        <td class="nw">${o ? (o.vinculado ? '<em class="pill p-verde">Vinculado</em>' : o.enlace ? `<button class="btn chico" data-enlace="${esc(o.enlace)}" data-quien="${esc(o.corto)}" data-tel="${esc(u.telefono ?? '')}">Enviar enlace</button>` : '') : ''}</td>
        <td class="nw aj-acc"><button class="btn chico" data-editar="${u.id}">Editar</button>
          <button class="btn chico" data-tog="${u.id}" data-campo="activo" data-val="${!u.activo}">${u.activo ? 'Dar de baja' : 'Reactivar'}</button>
          <button class="btn chico btn-borrar" data-borrar-per="${u.id}">Borrar</button></td></tr>`; }).join('') || '<tr><td colspan="8" class="tenue">Sin resultados.</td></tr>'}</tbody></table></div></section>
      <details class="tarjeta aj-det"><summary><b>Importar o agregar muchos a la vez</b> <small class="tenue">Excel o lista pegada</small></summary>
        <div class="bloque"><b>Importar la lista de personal (Excel)</b><span class="tenue chica">Columnas: Nombre corto, Nombre, Cargo, Reportes App (si/no), Comunicación interna (si/no), Teléfono y Email. Actualiza sin duplicar.</span>
          <div class="fila-btn"><input type="file" id="per-xls" accept=".xlsx,.xlsm"><label class="fila-check2"><input type="checkbox" id="per-baja"> Dar de baja a quien ya no aparezca</label><button class="btn" type="button" id="per-imp" disabled>Importar</button></div>
          <p id="per-res" class="tenue chica"></p></div>
        <form class="bloque" id="f-lote"><label>Pegar lista: un nombre por renglón; después de comas el cargo y el teléfono: «Juan Pérez, Bombero, 4731234567»
          <textarea name="lista" rows="5"></textarea></label><button class="btn">Agregar todos</button></form></details>`;
    const q$ = cont.querySelector<HTMLInputElement>('#per-q')!;
    q$.addEventListener('input', () => { buscaPer = q$.value; const pos = q$.selectionStart; refrescarSuave(refrescar, () => { const n = document.getElementById('per-q') as HTMLInputElement | null; n?.focus(); n?.setSelectionRange(pos, pos); }); });
    cont.querySelector('#per-fil')!.addEventListener('click', (e) => { const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-fil]'); if (!b) return; filtroPer = b.dataset.fil!; refrescar(); });
    cont.querySelectorAll<HTMLButtonElement>('[data-tog]').forEach((b) => b.addEventListener('click', async () => {
      b.disabled = true;
      try { await actualizar('personal', b.dataset.tog!, { [b.dataset.campo!]: b.dataset.val === 'true' }); refrescar(); } catch { c.aviso('No se pudo cambiar.', true); b.disabled = false; }
    }));
    cont.querySelectorAll<HTMLButtonElement>('[data-borrar-per]').forEach((b) => b.addEventListener('click', () => {
      const p = personal.find((y) => y.id === +b.dataset.borrarPer!)!;
      confirmar('Borrar del sistema', `¿Borrar a <b>${esc(p.nombre)}</b> del personal y de oficiales? Deja de recibir servicios por Telegram y sale del mapa.
        Los partes pasados conservan su nombre. Si solo deja de estar activo un tiempo, mejor usa «Dar de baja». No se puede deshacer.`, 'Sí, borrar', async () => {
        try { await borrarPersona(p.id); c.aviso('Persona borrada.'); refrescar(); } catch (e) { c.aviso('No se pudo borrar.', true); throw e; }
      });
    }));
    const form = (p?: Persona) => {
      const { f, cerrar } = cajon(p ? `Editar: ${esc(p.nombre)}` : 'Agregar oficial o persona', `<form class="bloque" autocomplete="off">
        <label>Nombre completo<input name="nombre" required value="${esc(p?.nombre ?? '')}" placeholder="Nombre(s) y apellidos"></label>
        <div class="rejilla-2"><label>Nombre corto <small>(como aparece en Telegram y el mapa)</small><input name="nombre_corto" required maxlength="24" value="${esc(p?.nombre_corto ?? '')}" placeholder="Ej. J. Pérez"></label>
          <label>Teléfono celular <small>(10 dígitos, obligatorio)</small><input name="telefono" required inputmode="tel" pattern="[0-9 ()+-]{10,16}" value="${esc(p?.telefono ?? '')}" placeholder="473 123 4567"></label></div>
        <div class="rejilla-2"><label>Cargo<input name="cargo" value="${esc(p?.cargo ?? '')}" placeholder="Ej. Oficial, Cabinero, Bombero"></label>
          <label>Correo <small>(si tendrá cuenta del panel)</small><input type="email" name="email" value="${esc(p?.email ?? '')}"></label></div>
        <label class="fila-check"><span><b>Comunicación interna</b><br><small class="tenue">Oficial: recibe servicios por Telegram privado y aparece en el mapa</small></span><input type="checkbox" name="comunicacion_interna" ${p?.comunicacion_interna ? 'checked' : ''}></label>
        <label class="fila-check"><span><b>Grupo de reportes de la app</b><br><small class="tenue">Recibe los reportes ciudadanos en el grupo</small></span><input type="checkbox" name="reportes_app" ${p?.reportes_app ? 'checked' : ''}></label>
        <p class="error-txt" id="per-err" hidden></p><button class="btn primario">${p ? 'Guardar cambios' : 'Agregar'}</button></form>`);
      f.querySelector('form')!.addEventListener('submit', async (e) => {
        e.preventDefault(); const fd = new FormData(e.target as HTMLFormElement); const g = (k: string) => String(fd.get(k) ?? '').trim();
        const tel = tel10(g('telefono')); const err = f.querySelector<HTMLElement>('#per-err')!;
        if (tel.length !== 10) { err.textContent = 'El teléfono debe tener 10 dígitos.'; err.hidden = false; return; }
        const fila = { nombre: g('nombre').replace(/\s+/g, ' '), nombre_corto: g('nombre_corto'), telefono: tel, cargo: g('cargo') || null, email: g('email').toLowerCase() || null,
          comunicacion_interna: fd.get('comunicacion_interna') === 'on', reportes_app: fd.get('reportes_app') === 'on' };
        try { if (p) await actualizar('personal', p.id, fila); else await insertar('personal', { ...fila, activo: true }); cerrar(); c.aviso(p ? 'Datos guardados.' : 'Agregado.'); refrescar(); }
        catch { err.textContent = 'No se pudo guardar (¿ya existe alguien con ese nombre?).'; err.hidden = false; }
      });
    };
    cont.querySelector('#per-nueva')!.addEventListener('click', () => form());
    cont.querySelectorAll<HTMLButtonElement>('[data-editar]').forEach((b) => b.addEventListener('click', () => form(personal.find((y) => y.id === +b.dataset.editar!))));
    cont.querySelectorAll<HTMLButtonElement>('[data-enlace]').forEach((b) => b.addEventListener('click', () => {
      const txt = `Hola ${b.dataset.quien}: abre este enlace UNA vez desde tu Telegram para recibir los servicios de cabina SIMUB: ${b.dataset.enlace}`;
      const tel = tel10(b.dataset.tel ?? '');
      const { f } = cajon(`Enlace del bot · ${esc(b.dataset.quien)}`, `<div class="bloque"><p>Es personal: envíalo por <b>chat privado</b>, no en grupos.</p>
        <textarea rows="4" readonly>${esc(txt)}</textarea><div class="fila-btn">
        ${tel.length === 10 ? `<a class="btn primario" target="_blank" rel="noopener" href="https://wa.me/52${tel}?text=${encodeURIComponent(txt)}">Enviar por WhatsApp</a>` : ''}
        <button class="btn" id="enl-copiar">Copiar</button><button class="btn" data-x>Cerrar</button></div></div>`);
      f.querySelector('#enl-copiar')!.addEventListener('click', async () => { try { await navigator.clipboard.writeText(txt); c.aviso('Copiado.'); } catch { f.querySelector('textarea')!.select(); } });
    }));
    activarImportarPersonal(c, cont, personal, refrescar);
  },

  // ---------------- grupos de Telegram
  async grupos(c, cont, refrescar) {
    const [cods, mg] = await Promise.all([codigos(), miembrosGrupos().catch(() => ({ alertas: [], interno: [] }))]);
    const vinc = (r: string) => cods.find((x) => x.rol === r)?.vinculado;
    const caja = (rol: 'alertas' | 'interno', titulo: string, criterio: string, xs: MiembroGrupo[]) => `<section class="tarjeta aj-gr"><div class="aj-barra"><h3>${titulo}</h3>
      ${vinc(rol) ? '<em class="pill p-verde">Grupo vinculado</em>' : '<em class="pill p-gris">Grupo sin vincular</em>'}</div>
      <p class="tenue chica">Deben estar quienes tienen <b>${criterio} = Sí</b> (${xs.length}). Telegram no permite que un bot agregue personas: se envía a cada quien una
        <b>invitación personal de un solo uso</b>. A quien ya abrió su enlace del bot le llega por Telegram; a los demás, por WhatsApp.</p>
      <form data-inv="${rol}"><div class="of-lista">${xs.map((p) => `<label class="of-item"><input type="checkbox" name="p" value="${p.id}" checked>
        <span><b>${esc(p.corto)}</b><small>${esc(p.nombre)} · ${esc(p.telefono ?? 'sin teléfono')} · ${p.vinculado ? 'recibe por Telegram' : 'por WhatsApp'}</small></span></label>`).join('')
        || '<p class="tenue">Nadie marcado todavía (se marca en «Oficiales y personal»).</p>'}</div>
      ${xs.length ? `<div class="fila-btn"><button class="btn primario" ${vinc(rol) ? '' : 'disabled title="Primero vincula el grupo"'}>Enviar invitaciones a los marcados</button></div>` : ''}</form>
      <div data-res="${rol}"></div></section>`;
    cont.innerHTML = `<section class="tarjeta"><h3>1. Vincular cada grupo (una sola vez)</h3>
        <p class="tenue chica">Agrega a <b>@SimubGtoBot</b> al grupo <b>como administrador</b> (con permiso de «Invitar usuarios»). Luego un administrador del grupo escribe <code>/vincular CÓDIGO</code> dentro del grupo.</p>
        <table class="tabla"><tbody>${cods.map((x) => `<tr><td>${ROL_CHAT[x.rol] ?? x.rol}</td><td><code>${esc(x.codigo)}</code></td><td>${x.vinculado ? '<em class="pill p-verde">Vinculado</em>' : '<em class="pill p-gris">Sin vincular</em>'}</td></tr>`).join('')}</tbody></table></section>
      <h3 class="aj-sub">2. Invitar al personal a cada grupo</h3>
      ${caja('alertas', 'Grupo de reportes de la app', 'Reportes App', mg.alertas)}${caja('interno', 'Grupo de comunicación interna', 'Comunicación interna', mg.interno)}`;
    cont.querySelectorAll<HTMLFormElement>('[data-inv]').forEach((f) => f.addEventListener('submit', async (e) => {
      e.preventDefault(); const rol = f.dataset.inv as 'alertas' | 'interno'; const ids = new FormData(f).getAll('p').map(Number);
      if (!ids.length) return c.aviso('Marca al menos a una persona.', true);
      const b = f.querySelector<HTMLButtonElement>('button.primario')!; b.disabled = true; b.textContent = 'Enviando…';
      try {
        const r = await invitarGrupo(rol, ids); const xs = [...mg.alertas, ...mg.interno];
        cont.querySelector<HTMLElement>(`[data-res="${rol}"]`)!.innerHTML = `<div class="bloque"><b>Invitaciones</b><ul class="aj-inv">${r.resultado.map((x) => {
          const tel = tel10(x.telefono ?? ''); const msg = `Hola ${x.nombre}: te invitan al grupo de SIMUB. Enlace personal, sirve una vez (7 días): ${x.enlace}`;
          return `<li><b>${esc(x.nombre)}</b> · ${x.enviado ? '<span class="ok-txt">enviada por Telegram</span>'
            : x.enlace ? (tel.length === 10 ? `<a class="btn chico primario" target="_blank" rel="noopener" href="https://wa.me/52${tel}?text=${encodeURIComponent(msg)}">Enviar por WhatsApp</a>` : `<code>${esc(x.enlace)}</code>`)
            : '<span class="alerta-txt">no se pudo crear</span>'}</li>`; }).join('')}</ul></div>`;
        void xs; b.disabled = false; b.textContent = 'Enviar invitaciones a los marcados';
      } catch (err) {
        const m = (err as Error).message;
        c.aviso(m === 'sin_grupo' ? 'Primero vincula el grupo.' : m === 'bot_sin_permiso' ? 'El bot no es administrador del grupo o no tiene permiso de invitar.' : 'No se pudieron enviar.', true);
        b.disabled = false; b.textContent = 'Enviar invitaciones a los marcados';
      }
    }));
    void refrescar;
  },

  async importar(c, cont) { cont.innerHTML = tarjetaImportar; activarImportar(c); },
  async respaldo(c, cont) { cont.innerHTML = tarjetaRespaldo(); activarRespaldo(c); },

  // ---------------- datos públicos de la estación
  async estacion(c, cont) {
    const cfg = await tabla<{ clave: string; valor: Record<string, unknown> }>('config_publica', 'clave');
    const v = Object.fromEntries(cfg.map((x) => [x.clave, x.valor])) as Record<string, Record<string, unknown>>;
    const campo = (grupo: string, k: string, etq: string, tipo = 'text', ayuda = '') => {
      const val = v[grupo]?.[k];
      return tipo === 'textarea' ? `<label>${etq}${ayuda ? ` <small>${ayuda}</small>` : ''}<textarea data-g="${grupo}" data-k="${k}" rows="3">${esc(val ?? '')}</textarea></label>`
        : tipo === 'checkbox' ? `<label class="fila-check"><span>${etq}</span><input type="checkbox" data-g="${grupo}" data-k="${k}" ${val ? 'checked' : ''}></label>`
        : `<label>${etq}${ayuda ? ` <small>${ayuda}</small>` : ''}<input data-g="${grupo}" data-k="${k}" value="${esc(Array.isArray(val) ? val.join(', ') : val ?? '')}"></label>`;
    };
    cont.innerHTML = `<form class="tarjeta" id="f-cfg"><h3>Datos de la estación (se ven en la app)</h3>
      <div class="rejilla-2">${campo('estacion', 'telefono', 'Teléfono de la estación', 'text', '10 dígitos; lo marca el botón «Llamar»')}${campo('estacion', 'horario', 'Horario de atención')}
      ${campo('estacion', 'direccion', 'Dirección')}${campo('estacion', 'correo', 'Correo de contacto')}</div>${campo('estacion', 'quienes_somos', 'Quiénes somos', 'textarea')}
      <h3>Donativos</h3><div class="rejilla-2">${campo('donativos', 'titular', 'Titular de la cuenta')}${campo('donativos', 'banco', 'Banco')}
      ${campo('donativos', 'clabe', 'CLABE (18 dígitos)')}${campo('donativos', 'concepto', 'Concepto sugerido')}
      ${campo('donativos', 'enlace_pago', 'Enlace de pago en línea', 'text', 'Mercado Pago, PayPal…')}${campo('donativos', 'montos', 'Montos sugeridos', 'text', 'separados por coma')}
      ${campo('donativos', 'contacto_recibo', 'Dónde pedir recibo')}${campo('donativos', 'recibo_deducible', 'Emitimos recibo deducible', 'checkbox')}</div>
      ${campo('donativos', 'voluntariado', 'Voluntariado: requisitos', 'textarea')}
      <h3>Revisiones de seguridad</h3><div class="rejilla-2">${campo('revisiones', 'dias', 'Días de visita')}${campo('revisiones', 'horario', 'Horario')}${campo('revisiones', 'costo', 'Costo')}</div>
      <div class="pie-parte"><button class="btn primario" type="submit">Guardar datos</button></div></form>`;
    cont.querySelector('#f-cfg')!.addEventListener('submit', async (e) => {
      e.preventDefault(); const nuevos: Record<string, Record<string, unknown>> = JSON.parse(JSON.stringify(v));
      cont.querySelectorAll<HTMLInputElement>('[data-g]').forEach((el) => {
        const g = el.dataset.g!, k = el.dataset.k!; nuevos[g] ??= {};
        nuevos[g][k] = el.type === 'checkbox' ? el.checked : k === 'montos' ? el.value.split(',').map((x) => Number(x.trim())).filter((n) => n > 0) : el.value.trim();
      });
      try { for (const [g, val] of Object.entries(nuevos)) await guardarConfig(g, val); c.aviso('Datos guardados. Ya se ven en la app.'); } catch { c.aviso('No se pudo guardar.', true); }
    });
  },

  // ---------------- catálogos
  async unidades(c, cont, refrescar) {
    const xs = await tabla<{ id: number; nombre: string; tipo: string | null; activa: boolean }>('unidades', 'nombre');
    cont.innerHTML = `<section class="tarjeta"><h3>Unidades (${xs.filter((u) => u.activa).length} activas)</h3>
      <form class="fila-btn aj-alta" data-nuevo="unidades"><input name="nombre" placeholder="Ej. M-03" required><input name="tipo" placeholder="Tipo (pipa, rescate…)"><button class="btn primario">Agregar</button></form>
      <ul class="cat">${xs.map((u) => `<li class="${u.activa ? '' : 'inactivo'}"><span>${esc(u.nombre)} <small>${esc(u.tipo ?? '')}</small></span>
      <button class="btn chico" data-tog-t="unidades" data-id="${u.id}" data-campo="activa" data-val="${!u.activa}">${u.activa ? 'Desactivar' : 'Activar'}</button></li>`).join('')}</ul></section>`;
    catalogo(c, cont, refrescar);
  },
  async colonias(c, cont, refrescar) {
    const xs = (await tabla<{ id: number; nombre: string; tipo: string | null; activa: boolean }>('colonias', 'nombre')).filter((x) => x.activa);
    cont.innerHTML = `<section class="tarjeta"><h3>Colonias y lugares frecuentes (${xs.length})</h3><p class="tenue chica">Además de las 3,433 de OpenStreetMap. Aparecen primero al escribir el lugar.</p>
      <form class="fila-btn aj-alta" data-nuevo="colonias"><input name="nombre" placeholder="Ej. Col. Nueva" required><select name="tipo"><option>Colonia</option><option>Fraccionamiento</option><option>Comunidad</option><option>Barrio</option><option>Vialidad</option><option>Otro</option></select><button class="btn primario">Agregar</button></form>
      <div class="chips-col">${xs.map((x) => `<span class="chip-col">${esc(x.nombre)}<button type="button" data-tog-t="colonias" data-id="${x.id}" data-campo="activa" data-val="false" aria-label="Quitar ${esc(x.nombre)}">✕</button></span>`).join('')}</div></section>`;
    catalogo(c, cont, refrescar);
  },
  async necesidades(c, cont, refrescar) {
    const xs = (await tabla<{ id: number; articulo: string; urgente: boolean; activa: boolean }>('necesidades', 'orden')).filter((n) => n.activa);
    cont.innerHTML = `<section class="tarjeta"><h3>Necesidades en especie</h3><p class="tenue chica">También se actualizan desde Telegram con /necesidades.</p>
      <form class="fila-btn aj-alta" data-nuevo="necesidades"><input name="articulo" placeholder="Ej. Guantes talla G" required><label class="fila-check"><input type="checkbox" name="urgente"> Urgente</label><button class="btn primario">Agregar</button></form>
      <ul class="cat">${xs.map((n) => `<li><span>${esc(n.articulo)} ${n.urgente ? '<em class="pill p-rojo">Urgente</em>' : ''}</span>
      <span><button class="btn chico" data-tog-t="necesidades" data-id="${n.id}" data-campo="urgente" data-val="${!n.urgente}">${n.urgente ? 'Normal' : 'Urgente'}</button>
      <button class="btn chico" data-tog-t="necesidades" data-id="${n.id}" data-campo="activa" data-val="false">Quitar</button></span></li>`).join('')}</ul></section>`;
    catalogo(c, cont, refrescar);
  },
  async noticias(c, cont, refrescar) {
    const xs = await tabla<{ id: string; titulo: string; visible: boolean; destacada: boolean; publicada_en: string }>('noticias', 'publicada_en');
    cont.innerHTML = `<section class="tarjeta"><h3>Noticias</h3><p class="tenue chica">Se publican desde Telegram con /noticia. Aquí se ocultan o se destaca una.</p>
      <ul class="cat">${xs.slice().reverse().slice(0, 30).map((n) => `<li class="${n.visible ? '' : 'inactivo'}"><span>${n.destacada ? '★ ' : ''}${esc(n.titulo)} <small>${fecha(n.publicada_en)}</small></span>
      <span>${n.visible ? `<button class="btn chico" data-dest="${n.id}">Destacar</button>` : ''}<button class="btn chico" data-tog-t="noticias" data-id="${n.id}" data-campo="visible" data-val="${!n.visible}">${n.visible ? 'Ocultar' : 'Mostrar'}</button></span></li>`).join('') || '<li class="tenue">Sin noticias.</li>'}</ul></section>`;
    cont.querySelectorAll<HTMLButtonElement>('[data-dest]').forEach((b) => b.addEventListener('click', async () => {
      try { for (const n of xs.filter((x) => x.destacada)) await actualizar('noticias', n.id, { destacada: false }); await actualizar('noticias', b.dataset.dest!, { destacada: true }); refrescar(); }
      catch { c.aviso('No se pudo cambiar.', true); }
    }));
    catalogo(c, cont, refrescar);
  },
  async produccion(c, cont) {
    cont.innerHTML = `<section class="tarjeta peligro"><h3>Preparar para producción (solo desarrollador)</h3>
      <p class="tenue">Borra los reportes, revisiones y servicios capturados en pruebas. El histórico importado se conserva. Queda en el control interno. No se puede deshacer.</p>
      <div class="fila-btn"><input id="confirma-limpiar" placeholder="Escribe BORRAR para confirmar"><button class="btn rojo" id="limpiar" type="button">Borrar datos de prueba</button></div></section>`;
    cont.querySelector('#limpiar')!.addEventListener('click', async () => {
      if ((cont.querySelector('#confirma-limpiar') as HTMLInputElement).value.trim().toUpperCase() !== 'BORRAR') return c.aviso('Escribe BORRAR para confirmar.', true);
      try { await accion({ accion: 'limpiar' }); c.aviso('Listo: se borraron los datos de prueba.'); } catch (e) { c.aviso(c.errores[(e as Error).message] ?? 'No se pudo borrar.', true); }
    });
  },
};

/** Altas y activar/desactivar en los catálogos sencillos. */
function catalogo(c: Ctx, cont: HTMLElement, refrescar: () => void) {
  cont.querySelectorAll<HTMLButtonElement>('[data-tog-t]').forEach((b) => b.addEventListener('click', async () => {
    try { await actualizar(b.dataset.togT!, b.dataset.id!, { [b.dataset.campo!]: b.dataset.val === 'true' }); refrescar(); } catch { c.aviso('No se pudo cambiar.', true); }
  }));
  cont.querySelectorAll<HTMLFormElement>('[data-nuevo]').forEach((f) => f.addEventListener('submit', async (e) => {
    e.preventDefault(); const fila: Record<string, unknown> = {};
    new FormData(f).forEach((v, k) => { fila[k] = k === 'urgente' ? true : String(v).trim(); });
    try { await insertar(f.dataset.nuevo!, fila); c.aviso('Agregado.'); refrescar(); } catch { c.aviso('No se pudo agregar (¿ya existe?).', true); }
  }));
}

let tBusca: number | undefined;
/** Para los buscadores: espera a que se deje de escribir y devuelve el foco al campo. */
function refrescarSuave(refrescar: () => void, despues: () => void) {
  clearTimeout(tBusca); tBusca = window.setTimeout(async () => { await refrescar(); setTimeout(despues, 0); }, 250);
}

function activarImportarPersonal(c: Ctx, cont: HTMLElement, personal: Persona[], refrescar: () => void) {
  let lista: Record<string, unknown>[] = [];
  const res = cont.querySelector<HTMLElement>('#per-res')!, imp = cont.querySelector<HTMLButtonElement>('#per-imp')!;
  cont.querySelector('#per-xls')!.addEventListener('change', async (e) => {
    const f = (e.target as HTMLInputElement).files?.[0]; if (!f) return;
    try {
      const { leerExcel } = await import('./excel');
      const filas = leerExcel(new Uint8Array(await f.arrayBuffer()))[0].filas;
      const norm = (x: unknown) => String(x ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
      const cab = filas.findIndex((r) => r.some((x) => /^nombre/.test(norm(x))));
      const h = filas[cab].map(norm); const col = (re: RegExp) => h.findIndex((x) => re.test(x));
      const cN = col(/^nombre$|^nombre completo|^nombre\(s\)/) >= 0 ? col(/^nombre$|^nombre completo|^nombre\(s\)/) : col(/^nombre(?! corto)/);
      const cK = col(/nombre corto|abreviado/), cC = col(/cargo|puesto|rango/), cR = col(/reportes? (de la )?app/), cI = col(/comunicacion interna|com\. interna/),
        cT = col(/telefono|celular/), cE = col(/e-?mail|correo/);
      const si = (x: unknown) => /^(si|sí|x|1|true|verdadero)$/i.test(String(x ?? '').trim());
      lista = filas.slice(cab + 1).map((r) => {
        const o: Record<string, unknown> = { nombre: String(r[cN] ?? '').replace(/\s+/g, ' ').trim() };
        if (cK >= 0) o.nombre_corto = String(r[cK] ?? '').trim() || null;
        o.cargo = cC >= 0 ? String(r[cC] ?? '').trim() || null : null;
        if (cR >= 0) o.reportes_app = si(r[cR]); if (cI >= 0) o.comunicacion_interna = si(r[cI]);
        if (cT >= 0) o.telefono = tel10(String(r[cT] ?? '')) || null;
        if (cE >= 0) o.email = String(r[cE] ?? '').trim().toLowerCase() || null;
        return o; }).filter((x) => String(x.nombre).length > 1);
      res.textContent = `${lista.length} personas leídas${cI >= 0 ? ` · ${lista.filter((x) => x.comunicacion_interna).length} con comunicación interna` : ''}.`;
      imp.disabled = !lista.length;
    } catch { res.textContent = 'No se pudo leer el archivo.'; }
  });
  imp.addEventListener('click', async () => {
    imp.disabled = true;
    const { error } = await dbp.from('personal').upsert(lista.map((x) => ({ ...x, activo: true })), { onConflict: 'nombre' });
    if (error) { c.aviso('No se pudo importar.', true); imp.disabled = false; return; }
    if (cont.querySelector<HTMLInputElement>('#per-baja')!.checked) {
      const nombres = new Set(lista.map((x) => String(x.nombre)));
      for (const p of personal.filter((x) => x.activo && !nombres.has(x.nombre))) await actualizar('personal', p.id, { activo: false });
    }
    c.aviso(`Lista de personal actualizada: ${lista.length} personas.`); refrescar();
  });
  cont.querySelector('#f-lote')!.addEventListener('submit', async (e) => {
    e.preventDefault(); const txt = String(new FormData(e.target as HTMLFormElement).get('lista') ?? '');
    const filas = txt.split(/\n+/).map((l) => l.split(',').map((x) => x.trim())).filter(([n]) => (n ?? '').length > 2)
      .map(([n, cargo, tel]) => ({ nombre: n, cargo: cargo || null, telefono: tel ? tel10(tel) : null }));
    let ok = 0; for (const f of filas) { try { await insertar('personal', f); ok++; } catch { /* repetido */ } }
    c.aviso(`Se agregaron ${ok} de ${filas.length}.`); refrescar();
  });
}
