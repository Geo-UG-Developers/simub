-- SIMUB · Oficiales a cargo (Telegram privado y ubicación en vivo), envíos por servicio,
-- acceso con límite de intentos, cuentas desde el panel y permisos del Admin. Maestro.
--
-- Permisos definitivos:
--   admin       = Admin. Maestro (Comandante): todo, incluidos informes, voluntariado, control interno, ajustes
--                 y corregir registros cerrados (o autorizar con su contraseña que otro los corrija).
--   coordinador = «Admin» (responsable de operación): como cabina, más revisiones, noticias, capacitación y mapa.
--   guardia     = cabinero.  campo = celular de unidad u oficial.

-- ------------------------------------------------------------ personal: datos de contacto y responsabilidades
alter table personal add column if not exists nombre_corto text;
alter table personal add column if not exists telefono text;
alter table personal add column if not exists email text;
alter table personal add column if not exists comunicacion_interna boolean not null default false;  -- oficial a cargo: recibe servicios
alter table personal add column if not exists reportes_app boolean not null default false;          -- debe estar en el grupo de reportes de la app
alter table personal add column if not exists tg_chat_id bigint;
alter table personal add column if not exists tg_codigo text unique default upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
alter table personal add column if not exists comparte_ubicacion boolean not null default false;
update personal set tg_codigo = upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)) where tg_codigo is null;
-- tg_chat_id y tg_codigo no se exponen al navegador: se leen por función.
revoke select on personal from authenticated;
grant select (id, nombre, cargo, activo, nombre_corto, telefono, email, comunicacion_interna, reportes_app, comparte_ubicacion) on personal to authenticated;

create or replace function panel_oficiales() returns jsonb
language sql stable security definer set search_path = public, extensions as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'nombre', p.nombre, 'corto', coalesce(p.nombre_corto, p.nombre), 'cargo', p.cargo,
    'telefono', p.telefono, 'vinculado', p.tg_chat_id is not null, 'comparte', p.comparte_ubicacion,
    'enlace', case when es_admin() or es_super() then 'https://t.me/SimubGtoBot?start=OF' || p.tg_codigo end) order by coalesce(p.nombre_corto, p.nombre)), '[]')
  from personal p where p.activo and p.comunicacion_interna and mi_rol() is not null
$$;

-- Envíos de cada servicio a oficiales (privado) y al grupo interno.
create table envios (
  id          bigserial primary key,
  servicio_id uuid not null references servicios(id) on delete cascade,
  destino     text not null check (destino in ('oficial', 'interno')),
  personal_id int references personal(id) on delete set null,
  nombre      text,
  por         text,
  en          timestamptz not null default now()
);
alter table envios enable row level security;
revoke all on envios from anon, authenticated;

-- Vinculación de un oficial con el bot (desde /start OF<código> en chat privado). Solo el servidor.
create or replace function vincular_oficial(p_codigo text, p_chat bigint) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare v_nombre text;
begin
  update personal set tg_chat_id = null where tg_chat_id = p_chat;
  update personal set tg_chat_id = p_chat where tg_codigo = upper(trim(p_codigo)) returning coalesce(nombre_corto, nombre) into v_nombre;
  return v_nombre;
end $$;
revoke execute on function vincular_oficial(text, bigint) from public, anon, authenticated;

-- Posiciones: unidades y oficiales.
alter table posiciones add column if not exists tipo text not null default 'unidad' check (tipo in ('unidad', 'oficial'));

-- ------------------------------------------------------------ acceso: límite de 5 intentos
create table acceso_intentos (
  id    bigserial primary key,
  email text not null,
  ok    boolean not null,
  en    timestamptz not null default now()
);
create index acceso_intentos_idx on acceso_intentos (lower(email), en desc);
create table acceso_bloqueos (
  email text primary key,
  hasta timestamptz not null,
  en    timestamptz not null default now()
);
alter table acceso_intentos enable row level security;
alter table acceso_bloqueos enable row level security;
revoke all on acceso_intentos, acceso_bloqueos from anon, authenticated;

-- Lo llama la función «acceso» del servidor. Devuelve si está bloqueado y cuántos fallos lleva.
create or replace function acceso_estado(p_email text) returns jsonb
language sql stable security definer set search_path = public, extensions as $$
  select jsonb_build_object(
    'bloqueado_hasta', (select hasta from acceso_bloqueos where email = lower(trim(p_email)) and hasta > now()),
    'fallos', (select count(*) from acceso_intentos where lower(email) = lower(trim(p_email)) and not ok and en > now() - interval '30 minutes'
               and en > coalesce((select max(en) from acceso_intentos where lower(email) = lower(trim(p_email)) and ok), '-infinity')))
$$;
create or replace function acceso_registrar(p_email text, p_ok boolean) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare e jsonb;
begin
  insert into acceso_intentos (email, ok) values (lower(trim(p_email)), p_ok);
  if p_ok then delete from acceso_bloqueos where email = lower(trim(p_email)); return '{}'::jsonb; end if;
  e := acceso_estado(p_email);
  if (e->>'fallos')::int >= 5 then
    insert into acceso_bloqueos (email, hasta) values (lower(trim(p_email)), now() + interval '30 minutes')
    on conflict (email) do update set hasta = excluded.hasta, en = now();
    insert into auditoria (quien, accion, tabla, registro, detalle) values ('sistema', 'acceso_bloqueado', 'acceso', lower(trim(p_email)), jsonb_build_object('fallos', e->'fallos'));
    return jsonb_build_object('bloqueado', true);
  end if;
  return jsonb_build_object('fallos', e->'fallos');
end $$;
revoke execute on function acceso_estado(text), acceso_registrar(text, boolean) from public, anon, authenticated;

create or replace function panel_desbloquear_acceso(p_email text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not (es_admin() or es_super()) then raise exception 'solo_admin' using errcode = '42501'; end if;
  delete from acceso_bloqueos where email = lower(trim(p_email));
  insert into acceso_intentos (email, ok) values (lower(trim(p_email)), true);
  perform auditar('acceso_desbloqueado', 'acceso', lower(trim(p_email)), null);
  return jsonb_build_object('ok', true);
end $$;

-- ------------------------------------------------------------ cuentas del panel (lista para Ajustes)
create or replace function panel_cuentas() returns jsonb
language sql stable security definer set search_path = public, extensions as $$
  select coalesce(jsonb_agg(jsonb_build_object('user_id', m.user_id, 'nombre', m.nombre, 'rol', m.rol, 'cargo', m.cargo, 'unidad', m.unidad,
    'superusuario', m.superusuario, 'email', u.email, 'ultimo_acceso', u.last_sign_in_at,
    'bloqueado', exists (select 1 from acceso_bloqueos b where b.email = lower(u.email) and b.hasta > now())) order by m.rol, m.nombre), '[]')
  from miembros_panel m left join auth.users u on u.id = m.user_id
  where es_admin() or es_super()
$$;

-- ------------------------------------------------------------ permisos de solo Admin. Maestro
create or replace function panel_conteos(p_anio int) returns jsonb
language sql stable security definer set search_path = public, extensions as $$
  select jsonb_build_object(
    'conteos', coalesce((select jsonb_agg(jsonb_build_object('c', c, 'mes', mes, 'n', n)) from (
      select case when falsa_alarma then 'falsa' else clasificacion end c, extract(month from fecha)::int mes, count(*) n
      from servicios where anio = p_anio and estado <> 'anulado' group by 1, 2) x), '[]'),
    'turnos', coalesce((select jsonb_agg(jsonb_build_object('mes', mes, 'turno', turno, 'n', n)) from (
      select extract(month from fecha)::int mes, coalesce(turno, 'sin dato') turno, count(*) n
      from servicios where anio = p_anio and estado <> 'anulado' group by 1, 2) y), '[]'),
    'dias', coalesce((select jsonb_agg(jsonb_build_object('fecha', fecha, 'n', n) order by fecha) from (
      select fecha, count(*) n from servicios where anio = p_anio and estado <> 'anulado' group by 1) z), '[]'),
    'apoyos', coalesce((select jsonb_object_agg(k, n) from (
      select k, count(*) n from servicios s, jsonb_object_keys(s.apoyos) k
      where s.anio = p_anio and s.estado <> 'anulado' group by k) y), '{}'),
    'minutos_promedio', (select round(avg(extract(epoch from h_base - h_despacho) / 60)) from servicios
                         where anio = p_anio and estado <> 'anulado' and h_base > h_despacho and h_base - h_despacho < interval '24 hours'))
  where es_admin() or es_super()
$$;
create or replace function panel_voluntarios() returns jsonb
language sql stable security definer set search_path = public, extensions as $$
  select coalesce(jsonb_agg(to_jsonb(v) - 'autor' order by v.creado_en desc), '[]') from voluntarios v where es_admin() or es_super()
$$;
create or replace function panel_voluntario_estado(p_id uuid, p_estado text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not (es_admin() or es_super()) then raise exception 'sin_permiso' using errcode = '42501'; end if;
  update voluntarios set estado = p_estado where id = p_id;
  return jsonb_build_object('ok', found);
end $$;
-- El informe de reportes de la app también es de Admin. Maestro.
create or replace function panel_informe_permiso() returns boolean language sql stable security definer set search_path = public, extensions as $$
  select es_admin() or es_super()
$$;

-- ------------------------------------------------------------ Centro de mando: envíos y posiciones de oficiales
create or replace function panel_mando() returns jsonb
language sql stable security definer set search_path = public, extensions as $$
  select jsonb_build_object(
    'servicios', coalesce((select jsonb_agg(_servicio_json(s) || jsonb_build_object('bitacora',
        coalesce((select jsonb_agg(jsonb_build_object('texto', b.texto, 'autor', b.autor, 'en', b.en) order by b.en desc)
                  from (select * from bitacora b where b.servicio_id = s.id order by b.en desc limit 4) b), '[]'),
        'escena', (select count(*) from en_escena e where e.servicio_id = s.id and e.sale is null),
        'voy', coalesce((select jsonb_agg(v.nombre order by v.en) from voy v where v.servicio_id = s.id), '[]'),
        'enviado_oficial', coalesce((select jsonb_agg(distinct e.nombre) from envios e where e.servicio_id = s.id and e.destino = 'oficial'), '[]'),
        'enviado_interno', exists (select 1 from envios e where e.servicio_id = s.id and e.destino = 'interno'))
        order by s.h_reporte nulls last, s.creado_en) from servicios s where s.estado = 'activo'), '[]'),
    'unidades', coalesce((select jsonb_agg(jsonb_build_object('id', u.id, 'nombre', u.nombre, 'tipo', u.tipo, 'estado', u.estado,
        'nota', u.nota, 'servicio_id', u.servicio_id, 'desde', u.actualizado_en,
        'folio', (select s.folio from servicios s where s.id = u.servicio_id)) order by u.nombre) from unidades u where u.activa), '[]'),
    'pendientes', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'folio', r.folio, 'tipo', r.tipo, 'estado', r.estado,
        'referencia', r.referencia, 'creado_en', r.creado_en, 'resumen', r.detalles->'resumen') order by r.creado_en)
        from reportes r where r.estado not in ('cerrado', 'falso') and not exists (select 1 from servicios s where s.reporte_id = r.id)), '[]'),
    'posiciones', coalesce((select jsonb_agg(to_jsonb(p) || jsonb_build_object('folio', (select s.folio from servicios s where s.id = p.servicio_id),
        'clase', (select c.nombre from servicios s join catalogo_servicios c on c.id = s.clasificacion where s.id = p.servicio_id)))
        from posiciones p where p.en > now() - interval '30 minutes'), '[]'),
    'guardia', panel_guardia(),
    'alertas', panel_alertas(),
    'hoy', (select count(*) from servicios where fecha = hoy_local() and estado <> 'anulado'))
  where mi_rol() is not null
$$;

grant execute on function panel_oficiales(), panel_desbloquear_acceso(text), panel_cuentas(), panel_informe_permiso() to authenticated;

-- ------------------------------------------------------------ Edición de partes cerrados: solo Admin. Maestro
-- Un cabinero puede llenar el parte mientras el servicio está activo y hasta 1 hora después de concluirlo.
-- Después, para corregir hace falta que el Admin. Maestro escriba su correo y contraseña en esa computadora:
-- eso deja una autorización de 30 minutos para ese folio y esa cuenta, anotada en el control interno.
create table autorizaciones (
  id          bigserial primary key,
  servicio_id uuid not null references servicios(id) on delete cascade,
  para        uuid not null,
  para_nombre text,
  por         uuid not null,
  por_nombre  text,
  hasta       timestamptz not null,
  en          timestamptz not null default now()
);
alter table autorizaciones enable row level security;
revoke all on autorizaciones from anon, authenticated;

create or replace function puede_editar(s servicios) returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select case
    when mi_rol() is null then false
    when es_admin() then true
    when s.estado = 'anulado' or s.origen = 'historico' then false
    when exists (select 1 from autorizaciones a where a.servicio_id = s.id and a.para = auth.uid() and a.hasta > now()) then true
    when s.bloqueado then false
    when s.estado = 'activo' then true
    else coalesce(s.h_base, s.actualizado_en) > now() - interval '1 hour' end
$$;

-- La llama la sesión temporal del Admin. Maestro (no la de quien edita).
create or replace function panel_autorizar(p_servicio uuid, p_para uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_para text; v_hasta timestamptz := now() + interval '30 minutes';
begin
  if not es_admin() then raise exception 'solo_admin' using errcode = '42501'; end if;
  select nombre into v_para from miembros_panel where user_id = p_para;
  if v_para is null then raise exception 'datos'; end if;
  insert into autorizaciones (servicio_id, para, para_nombre, por, por_nombre, hasta) values (p_servicio, p_para, v_para, auth.uid(), quien_soy(), v_hasta);
  perform auditar('edicion_autorizada', 'servicios', p_servicio::text, jsonb_build_object('para', v_para, 'hasta', v_hasta));
  insert into bitacora (servicio_id, texto, autor) values (p_servicio, 'Corrección autorizada para ' || v_para, quien_soy());
  return jsonb_build_object('hasta', v_hasta, 'para', v_para);
end $$;
grant execute on function panel_autorizar(uuid, uuid) to authenticated;
