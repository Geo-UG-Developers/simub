-- SIMUB · Permisos por cargo, control interno (sesiones, turnos, auditoría), firmas en el parte,
-- colonias para sugerir el lugar, respaldos desde el panel y solicitudes de voluntariado.
--
-- Permisos (miembros_panel.rol):
--   admin       Comandante y responsable de la app: ajustes, corregir registros cerrados, anular, importar, exportar.
--   coordinador Noticias, revisiones de seguridad, exportar informes. En los registros, igual que cabina.
--   guardia     Cabina: da de alta servicios, bitácora y parte mientras el servicio está en curso o en las
--               24 h siguientes, sin firmar. No entra a Ajustes ni corrige registros cerrados.
--   superusuario (marca aparte, solo el desarrollador): borra entradas de auditoría y datos de prueba.

alter table miembros_panel add column if not exists superusuario boolean not null default false;
alter table miembros_panel add column if not exists cargo text;

create or replace function es_admin() returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select coalesce((select rol = 'admin' from miembros_panel where user_id = auth.uid()), false)
$$;
create or replace function es_super() returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select coalesce((select superusuario from miembros_panel where user_id = auth.uid()), false)
$$;
grant execute on function es_admin(), es_super() to authenticated;

-- ------------------------------------------------------------ auditoría (cambios en ajustes y correcciones)
create table auditoria (
  id       bigserial primary key,
  en       timestamptz not null default clock_timestamp(),
  user_id  uuid,
  quien    text,
  accion   text not null,
  tabla    text,
  registro text,
  detalle  jsonb
);
create index auditoria_en_idx on auditoria (en desc);
alter table auditoria enable row level security;
revoke all on auditoria from anon, authenticated;

create or replace function auditar(p_accion text, p_tabla text, p_registro text, p_detalle jsonb) returns void
language sql security definer set search_path = public, extensions as $$
  insert into auditoria (user_id, quien, accion, tabla, registro, detalle)
  values (auth.uid(), quien_soy(), p_accion, p_tabla, p_registro, p_detalle)
$$;
revoke execute on function auditar(text, text, text, jsonb) from public, anon, authenticated;

-- Disparador genérico: guarda qué cambió (solo los campos distintos).
create or replace function trg_auditar() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare a jsonb := case when tg_op = 'INSERT' then '{}'::jsonb else to_jsonb(old) end;
        b jsonb := case when tg_op = 'DELETE' then '{}'::jsonb else to_jsonb(new) end;
        cambios jsonb;
begin
  if auth.uid() is null then return coalesce(new, old); end if;     -- migraciones y tareas del sistema
  select coalesce(jsonb_object_agg(k, jsonb_build_object('antes', a->k, 'despues', b->k)), '{}') into cambios
  from (select k from jsonb_object_keys(a || b) k where (a->k) is distinct from (b->k) and k not in ('actualizado_en')
          and not (tg_table_name = 'unidades' and k in ('estado', 'servicio_id', 'nota'))) x;
  if tg_op = 'UPDATE' and cambios = '{}'::jsonb then return new; end if;
  perform auditar(lower(tg_op), tg_table_name, coalesce(b->>'id', a->>'id', b->>'clave', a->>'clave', b->>'user_id', a->>'user_id'), cambios);
  return coalesce(new, old);
end $$;

do $$ declare t text;
begin
  foreach t in array array['config_publica', 'unidades', 'personal', 'necesidades', 'noticias', 'miembros_panel', 'catalogo_servicios'] loop
    execute format('drop trigger if exists %1$s_auditoria on %1$s', t);
    execute format('create trigger %1$s_auditoria after insert or update or delete on %1$s for each row execute function trg_auditar()', t);
  end loop;
end $$;
-- (El estado de las unidades lo cambia cabina a cada rato: eso no se audita, solo sus datos.)

-- ------------------------------------------------------------ sesiones y cambios de turno
create table sesiones (
  id        bigserial primary key,
  user_id   uuid not null,
  nombre    text,
  rol       text,
  equipo    text,
  inicio    timestamptz not null default now(),
  latido    timestamptz not null default now(),
  fin       timestamptz,
  motivo    text check (motivo in ('cierre', 'cambio_turno', 'inactividad', 'nueva_sesion')),
  turno_de  text
);
create index sesiones_user_idx on sesiones (user_id, inicio desc);
alter table sesiones enable row level security;
revoke all on sesiones from anon, authenticated;

create or replace function _cerrar_inactivas() returns void
language sql security definer set search_path = public, extensions as $$
  update sesiones set fin = latido, motivo = 'inactividad' where fin is null and latido < now() - interval '10 minutes'
$$;

create or replace function panel_sesion_iniciar(p_equipo text default null, p_anterior bigint default null) returns bigint
language plpgsql security definer set search_path = public, extensions as $$
declare v_id bigint; v_ant sesiones%rowtype;
begin
  if mi_rol() is null then raise exception 'sin_permiso' using errcode = '42501'; end if;
  perform _cerrar_inactivas();
  if p_anterior is not null then select * into v_ant from sesiones where id = p_anterior; end if;
  insert into sesiones (user_id, nombre, rol, equipo, turno_de)
  values (auth.uid(), quien_soy(), mi_rol()::text, left(p_equipo, 120), case when v_ant.user_id is distinct from auth.uid() then v_ant.nombre end)
  returning id into v_id;
  if v_ant.id is not null and v_ant.user_id is distinct from auth.uid() then
    perform auditar('cambio_turno', 'sesiones', v_id::text, jsonb_build_object('entrega', v_ant.nombre, 'recibe', quien_soy()));
  end if;
  return v_id;
end $$;

create or replace function panel_latido(p_sesion bigint) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  update sesiones set latido = now() where id = p_sesion and user_id = auth.uid() and fin is null;
  return jsonb_build_object('activa', found);
end $$;

create or replace function panel_sesion_cerrar(p_sesion bigint, p_motivo text default 'cierre') returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  update sesiones set fin = now(), latido = now(), motivo = case when p_motivo in ('cierre', 'cambio_turno', 'nueva_sesion') then p_motivo else 'cierre' end
   where id = p_sesion and user_id = auth.uid() and fin is null;
  return jsonb_build_object('ok', found);
end $$;

-- Control interno (admin): sesiones con duración y folios que capturó cada persona en su turno.
create or replace function panel_control(p_desde timestamptz, p_hasta timestamptz) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not es_admin() then raise exception 'sin_permiso' using errcode = '42501'; end if;
  perform _cerrar_inactivas();
  return jsonb_build_object(
    'sesiones', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'nombre', s.nombre, 'rol', s.rol, 'equipo', s.equipo,
        'inicio', s.inicio, 'fin', s.fin, 'motivo', s.motivo, 'turno_de', s.turno_de,
        'minutos', round(extract(epoch from coalesce(s.fin, s.latido) - s.inicio) / 60),
        'folios', coalesce((select jsonb_agg(v.anio || '-' || v.folio order by v.folio) from servicios v
                   where v.creado_por = s.user_id and v.origen <> 'historico' and v.creado_en between s.inicio and coalesce(s.fin, s.latido) + interval '1 minute'), '[]'))
        order by s.inicio desc) from sesiones s where s.inicio >= p_desde and s.inicio < p_hasta), '[]'),
    'auditoria', coalesce((select jsonb_agg(to_jsonb(a) - 'user_id' order by a.en desc)
        from (select * from auditoria where en >= p_desde and en < p_hasta order by en desc limit 500) a), '[]'),
    'super', es_super());
end $$;

-- Solo el desarrollador puede borrar entradas de auditoría, y el borrado queda anotado.
create or replace function panel_auditoria_borrar(p_ids bigint[]) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare n int;
begin
  if not es_super() then raise exception 'sin_permiso' using errcode = '42501'; end if;
  delete from auditoria where id = any (p_ids) and accion <> 'auditoria_borrada';
  get diagnostics n = row_count;
  perform auditar('auditoria_borrada', 'auditoria', null, jsonb_build_object('entradas', n));
  return jsonb_build_object('borradas', n);
end $$;

-- ------------------------------------------------------------ colonias (sugerencias para el lugar)
create table colonias (
  id     serial primary key,
  nombre text not null unique,
  tipo   text,
  activa boolean not null default true
);
alter table colonias enable row level security;
revoke all on colonias from anon, authenticated;
grant select, insert, update, delete on colonias to authenticated;
grant usage on sequence colonias_id_seq to authenticated;
create policy colonias_leer on colonias for select to authenticated using (mi_rol() is not null);
create policy colonias_editar on colonias for all to authenticated using (es_admin()) with check (es_admin());
create trigger colonias_auditoria after insert or update or delete on colonias for each row execute function trg_auditar();

insert into colonias (nombre, tipo) values
 ('Zona Centro', 'Colonia'), ('Yerbabuena', 'Colonia'), ('Lomas del Padre', 'Colonia'), ('Santa Teresa', 'Colonia'), ('Las Teresas', 'Colonia'),
 ('Arroyo Verde', 'Colonia'), ('Peñitas', 'Colonia'), ('Independencia', 'Colonia'), ('Marfil', 'Colonia'), ('Burócratas', 'Colonia'),
 ('Arboledas', 'Colonia'), ('El Mezquital', 'Colonia'), ('Puentecillas', 'Colonia'), ('Cúpulas', 'Colonia'), ('Mártires 22 de Abril', 'Colonia'),
 ('Linda Vista', 'Colonia'), ('Lomas de Marfil I', 'Colonia'), ('Lomas de Marfil II', 'Colonia'), ('Noria Alta', 'Colonia'), ('Nueva España', 'Colonia'),
 ('Tres Estrellas', 'Colonia'), ('Arroyo Blanco', 'Colonia'), ('Jalapita', 'Colonia'), ('Cocalecas', 'Colonia'), ('Mezquite Mocho', 'Colonia'),
 ('Villa Hermosa', 'Colonia'), ('Las Granjas', 'Colonia'), ('Pastita', 'Barrio'), ('San José de la Luz', 'Colonia'), ('Cerro del Cuarto', 'Colonia'),
 ('El Edén', 'Colonia'), ('Lomas de Santa Fe', 'Colonia'), ('Matavacas', 'Colonia'), ('Presa de la Olla', 'Colonia'), ('Las Trojes', 'Colonia'),
 ('San José de Cervera', 'Colonia'), ('Lomas de Cervera', 'Colonia'), ('Las Biznagas', 'Colonia'), ('Pueblito de Rocha', 'Colonia'), ('Presa de Rocha', 'Colonia'),
 ('El Campanario', 'Colonia'), ('Noche Buena', 'Colonia'), ('Marfil Tenería', 'Colonia'), ('Molineros', 'Colonia'), ('Tepetapa', 'Barrio'),
 ('Valenciana', 'Colonia'), ('Campuzano', 'Colonia'), ('Los Alcaldes', 'Colonia'), ('Los Pinos', 'Colonia'), ('Las Palomas', 'Colonia'),
 ('Balcones', 'Colonia'), ('Paso del Norte', 'Colonia'), ('Paso de Perules', 'Colonia'), ('Carbonera', 'Colonia'), ('Mineral de la Hacienda', 'Colonia'),
 ('Cumbres de Santa Fe', 'Colonia'), ('Colonial Guanajuato', 'Fraccionamiento'), ('San Javier', 'Colonia'), ('Cerro de la Bufa', 'Paraje'),
 ('Cerro de la Campana', 'Paraje'), ('Cerrito de la Cruz', 'Colonia'), ('El Zangarro', 'Colonia'), ('Ex Hacienda Santa Teresa', 'Colonia'),
 ('Manantial', 'Fraccionamiento'), ('Villas de Guanajuato', 'Fraccionamiento'), ('Villaseca', 'Fraccionamiento'), ('Real de la Mancha', 'Fraccionamiento'),
 ('Fraccionamiento Independencia', 'Fraccionamiento'), ('Fraccionamiento Arboledas', 'Fraccionamiento'), ('De El Arte', 'Fraccionamiento'),
 ('Cañada del Fresno', 'Fraccionamiento'), ('Fraccionamiento San José', 'Fraccionamiento'), ('Privada del Real', 'Fraccionamiento'),
 ('La Sauceda', 'Comunidad'), ('Tacubaya', 'Comunidad'), ('La Trinidad', 'Comunidad'), ('El Tejabán', 'Comunidad'), ('El Limón', 'Comunidad'),
 ('Santiaguillo', 'Comunidad'), ('Nuevo Santiaguillo', 'Comunidad'), ('El Maluco', 'Comunidad'), ('San José del Chapín', 'Comunidad'),
 ('Ciénega del Pedregal', 'Comunidad'), ('El Tinaco', 'Comunidad'), ('La Mora', 'Comunidad'), ('San Isidro', 'Comunidad'), ('El Aguacate', 'Comunidad'),
 ('Agua Zarca', 'Comunidad'), ('Cajones', 'Comunidad'), ('La Presita', 'Comunidad'), ('Solano', 'Comunidad'), ('Nuevo Solano', 'Comunidad'),
 ('San José de Tránsito', 'Comunidad'), ('San José de Llanos', 'Comunidad'), ('Capulín de Bustos', 'Comunidad'), ('Cañada de Bustos', 'Comunidad'),
 ('El Coyote', 'Comunidad'), ('El Microbio', 'Comunidad'), ('El Rodeo', 'Comunidad'), ('San José del Rodeo', 'Comunidad'), ('El Refugio', 'Comunidad'),
 ('Las Bateas', 'Comunidad'), ('Santa Catarina de Cuevas', 'Comunidad'), ('Cuevas', 'Comunidad'), ('Peña Grande', 'Comunidad'), ('Montecillo', 'Comunidad'),
 ('Av. Santa Fe', 'Vialidad'), ('Blvd. Euquerio Guerrero', 'Vialidad'), ('Acceso Diego Rivera', 'Vialidad'), ('Libramiento Norponiente', 'Vialidad'),
 ('Carr. Guanajuato–Juventino Rosas', 'Vialidad'), ('Carr. libre Guanajuato–Silao', 'Vialidad'), ('Carr. cuota Guanajuato–Silao', 'Vialidad'),
 ('Carr. Puentecillas', 'Vialidad'), ('Carr. Santa Teresa–Cuevas', 'Vialidad'), ('Carr. Guanajuato–Irapuato', 'Vialidad'), ('Camino al Cárcamo', 'Vialidad'),
 ('Base SIMUB', 'Otro')
on conflict (nombre) do nothing;

-- ------------------------------------------------------------ servicios: colonia, quién capturó, firmas y candado
alter table servicios add column if not exists colonia text;
alter table servicios add column if not exists capturo text;
alter table servicios add column if not exists editado_por text;
alter table servicios add column if not exists firmas jsonb not null default '{}';     -- {jefe_servicio: {nombre, imagen, en, registro}}
alter table servicios add column if not exists bloqueado boolean not null default false; -- firmado por el jefe de servicio
alter table servicios add column if not exists huella text;                             -- SHA-256 del parte al firmarse

-- ¿Puede quien está conectado modificar este servicio?
create or replace function puede_editar(s servicios) returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select case
    when mi_rol() is null then false
    when es_admin() then true
    when s.estado = 'anulado' or s.origen = 'historico' or s.bloqueado then false
    when s.estado = 'activo' then true
    else coalesce(s.h_base, s.actualizado_en) > now() - interval '24 hours' end
$$;

create or replace function _servicio_json(s servicios) returns jsonb
language sql stable security definer set search_path = public, extensions as $$
  select (to_jsonb(s) - 'creado_por') || jsonb_build_object('puede_editar', puede_editar(s))
$$;

create or replace function panel_guardar_servicio(p_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_id uuid := p_id; v_anio int; v_folio int; v_fecha date; v_quien text := quien_soy(); v_nuevo boolean := p_id is null;
  v_cls text := coalesce(nullif(p->>'clasificacion', ''), 'otros'); s servicios%rowtype;
begin
  if mi_rol() is null then raise exception 'sin_permiso' using errcode = '42501'; end if;
  if not exists (select 1 from catalogo_servicios where id = v_cls) then raise exception 'clasificacion_invalida' using errcode = '22023'; end if;
  v_fecha := coalesce(nullif(p->>'fecha', '')::date, (_ts(p, 'h_reporte') at time zone 'America/Mexico_City')::date, hoy_local());
  if v_nuevo then
    v_anio := extract(year from v_fecha)::int;
    perform pg_advisory_xact_lock(7311, v_anio);
    select coalesce(max(folio), 0) + 1 into v_folio from servicios where anio = v_anio;
    insert into servicios (anio, folio, clasificacion, fecha, creado_por, capturo, h_reporte)
    values (v_anio, v_folio, v_cls, v_fecha, auth.uid(), v_quien, coalesce(_ts(p, 'h_reporte'), now()))
    returning id into v_id;
  else
    select * into s from servicios where id = v_id for update;
    if not found then raise exception 'no_existe' using errcode = 'P0002'; end if;
    if s.estado = 'anulado' then raise exception 'anulado' using errcode = 'P0001'; end if;
    if not puede_editar(s) then raise exception 'bloqueado' using errcode = '42501'; end if;
    -- Corrección de un registro cerrado, firmado o histórico: queda en la auditoría.
    if s.bloqueado or s.origen = 'historico' or (s.estado <> 'activo' and coalesce(s.h_base, s.actualizado_en) <= now() - interval '24 hours') then
      perform auditar('servicio_corregido', 'servicios', s.anio || '-' || s.folio, jsonb_build_object('antes', to_jsonb(s) - 'firmas', 'cambios', p - 'firmas'));
    end if;
  end if;

  update servicios set
    clasificacion = v_cls,
    especificacion = nullif(trim(p->>'especificacion'), ''),
    falsa_alarma = coalesce((p->>'falsa_alarma')::boolean, false),
    fecha = v_fecha,
    h_reporte = coalesce(_ts(p, 'h_reporte'), h_reporte),
    h_despacho = _ts(p, 'h_despacho'), h_llegada = _ts(p, 'h_llegada'),
    h_disponible = _ts(p, 'h_disponible'), h_base = _ts(p, 'h_base'),
    km_salida = nullif(p->>'km_salida', '')::numeric, km_llegada = nullif(p->>'km_llegada', '')::numeric,
    colonia = nullif(trim(p->>'colonia'), ''),
    lugar = nullif(trim(p->>'lugar'), ''),
    lat = coalesce(nullif(p->>'lat', '')::float8, lat), lon = coalesce(nullif(p->>'lon', '')::float8, lon),
    area_afectada = nullif(trim(p->>'area_afectada'), ''),
    medio = nullif(trim(p->>'medio'), ''), reportante = nullif(trim(p->>'reportante'), ''), telefono = nullif(trim(p->>'telefono'), ''),
    unidades = coalesce(array(select distinct trim(x) from jsonb_array_elements_text(coalesce(p->'unidades', '[]')) x where trim(x) <> ''), '{}'),
    personal_num = nullif(p->>'personal_num', '')::int,
    tripulacion = coalesce(p->'tripulacion', '[]'), datos = coalesce(p->'datos', '{}'),
    vehiculos = coalesce(p->'vehiculos', '[]'), apoyos = coalesce(p->'apoyos', '{}'), personas = coalesce(p->'personas', '[]'),
    observaciones = nullif(trim(p->>'observaciones'), ''),
    jefe_servicio = nullif(trim(p->>'jefe_servicio'), ''), radio_operador = nullif(trim(p->>'radio_operador'), ''),
    jefe_guardia = nullif(trim(p->>'jefe_guardia'), ''),
    editado_por = case when v_nuevo then editado_por else v_quien end,
    actualizado_en = now()
  where id = v_id;

  insert into bitacora (servicio_id, texto, autor)
  values (v_id, case when v_nuevo then 'Servicio abierto' || coalesce(' · ' || nullif(p->>'medio', ''), '')
                     || coalesce(' · folio 911 ' || nullif(p->'datos'->>'folio_911', ''), '') else 'Parte de servicio actualizado' end, v_quien);
  perform _sincronizar_unidades(v_id);
  select anio, folio into v_anio, v_folio from servicios where id = v_id;
  return jsonb_build_object('id', v_id, 'anio', v_anio, 'folio', v_folio);
end $$;

-- Firma dibujada en pantalla (dedo o mouse). La del jefe de servicio cierra el parte para cabina.
create or replace function panel_firmar(p_servicio uuid, p_campo text, p_nombre text, p_imagen text, p_huella text default null) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare s servicios%rowtype;
begin
  select * into s from servicios where id = p_servicio for update;
  if not found then raise exception 'no_existe' using errcode = 'P0002'; end if;
  if p_campo not in ('jefe_servicio', 'radio_operador', 'jefe_guardia') then raise exception 'campo_invalido' using errcode = '22023'; end if;
  if not puede_editar(s) then raise exception 'bloqueado' using errcode = '42501'; end if;
  if p_imagen is not null and (p_imagen not like 'data:image/png;base64,%' or length(p_imagen) > 200000) then
    raise exception 'firma_invalida' using errcode = '22023';
  end if;
  if p_imagen is null then
    update servicios set firmas = firmas - p_campo where id = p_servicio;
  else
    update servicios set firmas = firmas || jsonb_build_object(p_campo, jsonb_build_object('nombre', nullif(trim(p_nombre), ''), 'imagen', p_imagen,
        'en', now(), 'registro', quien_soy())),
      bloqueado = bloqueado or p_campo = 'jefe_servicio',
      huella = case when p_campo = 'jefe_servicio' then p_huella else huella end,
      jefe_servicio = case when p_campo = 'jefe_servicio' then coalesce(nullif(trim(p_nombre), ''), jefe_servicio) else jefe_servicio end,
      radio_operador = case when p_campo = 'radio_operador' then coalesce(nullif(trim(p_nombre), ''), radio_operador) else radio_operador end,
      jefe_guardia = case when p_campo = 'jefe_guardia' then coalesce(nullif(trim(p_nombre), ''), jefe_guardia) else jefe_guardia end,
      actualizado_en = now()
    where id = p_servicio;
  end if;
  insert into bitacora (servicio_id, texto, autor) values (p_servicio,
    case when p_imagen is null then 'Firma retirada: ' else 'Firmado: ' end || replace(p_campo, '_', ' ') || coalesce(' · ' || nullif(trim(p_nombre), ''), ''), quien_soy());
  return jsonb_build_object('ok', true);
end $$;

-- El admin puede quitar el candado de un parte firmado para corregirlo (queda auditado).
create or replace function panel_desbloquear(p_servicio uuid, p_motivo text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare s servicios%rowtype;
begin
  if not es_admin() then raise exception 'solo_admin' using errcode = '42501'; end if;
  if nullif(trim(p_motivo), '') is null then raise exception 'texto_vacio' using errcode = '22023'; end if;
  update servicios set bloqueado = false, firmas = firmas - 'jefe_servicio', huella = null where id = p_servicio returning * into s;
  if not found then raise exception 'no_existe' using errcode = 'P0002'; end if;
  insert into bitacora (servicio_id, texto, autor) values (p_servicio, 'Parte desbloqueado para corrección: ' || trim(p_motivo), quien_soy());
  perform auditar('parte_desbloqueado', 'servicios', s.anio || '-' || s.folio, jsonb_build_object('motivo', trim(p_motivo)));
  return jsonb_build_object('ok', true);
end $$;

-- Reabrir: ahora solo admin (cabina y coordinación ya no mueven registros cerrados).
create or replace function panel_reabrir_servicio(p_servicio uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare s servicios%rowtype;
begin
  if not es_admin() then raise exception 'solo_admin' using errcode = '42501'; end if;
  update servicios set estado = 'activo', actualizado_en = now() where id = p_servicio and estado = 'cerrado' returning * into s;
  if not found then raise exception 'transicion_invalida' using errcode = 'P0001'; end if;
  insert into bitacora (servicio_id, texto, autor) values (p_servicio, 'Servicio reabierto', quien_soy());
  perform auditar('servicio_reabierto', 'servicios', s.anio || '-' || s.folio, null);
  perform _sincronizar_unidades(p_servicio);
  return jsonb_build_object('ok', true);
end $$;

create or replace function panel_anular_servicio(p_servicio uuid, p_motivo text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare s servicios%rowtype;
begin
  if not es_admin() then raise exception 'solo_admin' using errcode = '42501'; end if;
  if nullif(trim(p_motivo), '') is null then raise exception 'texto_vacio' using errcode = '22023'; end if;
  update servicios set estado = 'anulado', actualizado_en = now() where id = p_servicio and estado <> 'anulado' returning * into s;
  if not found then raise exception 'transicion_invalida' using errcode = 'P0001'; end if;
  insert into bitacora (servicio_id, texto, autor) values (p_servicio, 'Folio anulado: ' || trim(p_motivo), quien_soy());
  perform auditar('folio_anulado', 'servicios', s.anio || '-' || s.folio, jsonb_build_object('motivo', trim(p_motivo)));
  perform _sincronizar_unidades(p_servicio);
  return jsonb_build_object('ok', true);
end $$;

-- Importar: además deja constancia.
create or replace function panel_importar_registrar(p_resumen jsonb) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not es_admin() then raise exception 'solo_admin' using errcode = '42501'; end if;
  perform auditar('importacion_excel', 'servicios', null, p_resumen);
end $$;

-- Lista para la bitácora mensual (agrega colonia y quién capturó).
create or replace function panel_servicios(p_desde date, p_hasta date) returns jsonb
language sql stable security definer set search_path = public, extensions as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'anio', s.anio, 'folio', s.folio, 'estado', s.estado, 'origen', s.origen,
    'clasificacion', s.clasificacion, 'especificacion', s.especificacion, 'falsa_alarma', s.falsa_alarma, 'fecha', s.fecha,
    'h_reporte', s.h_reporte, 'h_despacho', s.h_despacho, 'h_llegada', s.h_llegada, 'h_base', s.h_base,
    'colonia', s.colonia, 'lugar', s.lugar, 'lat', s.lat, 'lon', s.lon, 'area_afectada', s.area_afectada, 'medio', s.medio,
    'unidades', s.unidades, 'personal_num', s.personal_num, 'apoyos', s.apoyos, 'capturo', s.capturo,
    'con_parte', s.jefe_servicio is not null, 'firmado', s.bloqueado)
    order by s.anio, s.folio), '[]')
  from servicios s
  where mi_rol() is not null and s.fecha >= p_desde and s.fecha < p_hasta
$$;

-- ------------------------------------------------------------ respaldo descargable (copia en la computadora)
create or replace function panel_respaldo(p_anio int) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare r jsonb;
begin
  if mi_rol() is null then raise exception 'sin_permiso' using errcode = '42501'; end if;
  r := jsonb_build_object(
    'generado', now(), 'anio', p_anio, 'por', quien_soy(), 'version', 1,
    'servicios', coalesce((select jsonb_agg(to_jsonb(s) - 'creado_por' order by s.folio) from servicios s where s.anio = p_anio), '[]'),
    'bitacora', coalesce((select jsonb_agg(jsonb_build_object('servicio', s.anio || '-' || s.folio, 'texto', b.texto, 'autor', b.autor, 'en', b.en) order by b.en)
                 from bitacora b join servicios s on s.id = b.servicio_id where s.anio = p_anio), '[]'),
    'revisiones', coalesce((select jsonb_agg(to_jsonb(v) - 'autor' - 'tg_chat_id' - 'tg_message_id' order by v.creado_en) from revisiones v
                 where extract(year from v.creado_en) = p_anio), '[]'),
    'reportes_app', coalesce((select jsonb_agg(jsonb_build_object('folio', x.folio, 'tipo', x.tipo, 'estado', x.estado, 'creado_en', x.creado_en,
                 'referencia', x.referencia, 'lat', x.lat, 'lon', x.lon, 'resumen', x.detalles->'resumen') order by x.creado_en)
                 from reportes x where extract(year from x.creado_en) = p_anio), '[]'),
    'unidades', coalesce((select jsonb_agg(to_jsonb(u) order by u.nombre) from unidades u), '[]'),
    'personal', coalesce((select jsonb_agg(to_jsonb(u) order by u.nombre) from personal u), '[]'),
    'colonias', coalesce((select jsonb_agg(u.nombre order by u.nombre) from colonias u), '[]'),
    'catalogo', coalesce((select jsonb_agg(to_jsonb(c) order by c.orden) from catalogo_servicios c), '[]'));
  perform auditar('respaldo_descargado', 'servicios', p_anio::text, jsonb_build_object('servicios', jsonb_array_length(r->'servicios')));
  return r;
end $$;

-- ------------------------------------------------------------ voluntariado (formulario de la app)
create table voluntarios (
  id          uuid primary key default gen_random_uuid(),
  autor       uuid not null,
  nombre      text not null check (length(nombre) between 3 and 120),
  edad        int not null check (edad between 18 and 80),
  telefono    text not null check (length(telefono) between 7 and 20),
  correo      text check (correo is null or correo ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  escolaridad text,
  ocupacion   text,
  disponibilidad text[] not null default '{}',
  motivo      text check (length(motivo) <= 1000),
  estado      text not null default 'nuevo' check (estado in ('nuevo', 'contactado', 'aceptado', 'descartado')),
  avisado_en  timestamptz,
  creado_en   timestamptz not null default now()
);
alter table voluntarios enable row level security;
revoke all on voluntarios from anon, authenticated;

create or replace function registrar_voluntario(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'sin_sesion' using errcode = '42501'; end if;
  if (select count(*) from voluntarios where autor = auth.uid() and creado_en > now() - interval '1 day') >= 2 then
    raise exception 'limite_reportes' using errcode = 'P0001';
  end if;
  insert into voluntarios (autor, nombre, edad, telefono, correo, escolaridad, ocupacion, disponibilidad, motivo)
  values (auth.uid(), trim(p->>'nombre'), (p->>'edad')::int, trim(p->>'telefono'), nullif(trim(p->>'correo'), ''),
    nullif(p->>'escolaridad', ''), nullif(p->>'ocupacion', ''),
    coalesce(array(select jsonb_array_elements_text(coalesce(p->'disponibilidad', '[]'))), '{}'), nullif(trim(p->>'motivo'), ''))
  returning id into v_id;
  return jsonb_build_object('id', v_id);
end $$;
grant execute on function registrar_voluntario(jsonb) to authenticated;

create or replace function panel_voluntarios() returns jsonb
language sql stable security definer set search_path = public, extensions as $$
  select coalesce(jsonb_agg(to_jsonb(v) - 'autor' order by v.creado_en desc), '[]') from voluntarios v
  where mi_rol() in ('admin', 'coordinador')
$$;
create or replace function panel_voluntario_estado(p_id uuid, p_estado text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  if mi_rol() not in ('admin', 'coordinador') then raise exception 'sin_permiso' using errcode = '42501'; end if;
  update voluntarios set estado = p_estado where id = p_id;
  return jsonb_build_object('ok', found);
end $$;
-- Para el aviso en Telegram (lo usa la tarea de cada minuto con la llave de servicio).
create or replace function voluntarios_por_avisar() returns setof voluntarios
language sql security definer set search_path = public, extensions as $$
  select * from voluntarios where avisado_en is null and creado_en > now() - interval '2 days' order by creado_en limit 10
$$;
revoke execute on function voluntarios_por_avisar() from public, anon, authenticated;

-- Conservación: solicitudes de voluntariado se borran a los 12 meses.
create or replace function aplicar_conservacion_voluntarios() returns int
language sql security definer set search_path = public, extensions as $$
  with x as (delete from voluntarios where creado_en < now() - interval '12 months' returning 1) select count(*)::int from x
$$;

-- ------------------------------------------------------------ preparar producción: solo el desarrollador
create or replace function limpiar_datos_prueba() returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_fotos text[]; n_rep int; n_rev int; n_srv int;
begin
  if not es_super() then raise exception 'sin_permiso' using errcode = '42501'; end if;
  select coalesce(array_agg(f), '{}') into v_fotos from (select unnest(r.fotos) f from reportes r) x;
  select count(*) into n_rep from reportes;
  select count(*) into n_rev from revisiones;
  select count(*) into n_srv from servicios where origen <> 'historico';
  update unidades set estado = 'disponible', servicio_id = null, nota = null, actualizado_en = now();
  delete from servicios where origen <> 'historico';
  delete from reportes;
  delete from revisiones;
  delete from noticias where texto like '%[Ejemplo]%';
  delete from tg_borradores;
  perform setval('folio_reporte', 1, false);
  perform setval('folio_revision', 1, false);
  perform auditar('datos_de_prueba_borrados', null, null, jsonb_build_object('reportes', n_rep, 'revisiones', n_rev, 'servicios', n_srv));
  return jsonb_build_object('reportes', n_rep, 'revisiones', n_rev, 'servicios', n_srv, 'fotos', to_jsonb(v_fotos));
end $$;

-- Panel: el «yo» ahora dice si es superusuario y su cargo.
create or replace function panel_yo() returns jsonb
language sql stable security definer set search_path = public, extensions as $$
  select jsonb_build_object('rol', m.rol, 'nombre', coalesce(m.nombre, ''), 'cargo', m.cargo, 'super', m.superusuario,
    'alertas_vinculado', exists (select 1 from chats where rol = 'alertas' and chat_id is not null))
  from miembros_panel m where m.user_id = auth.uid()
$$;

grant execute on function panel_sesion_iniciar(text, bigint), panel_latido(bigint), panel_sesion_cerrar(bigint, text), panel_control(timestamptz, timestamptz),
  panel_auditoria_borrar(bigint[]), panel_firmar(uuid, text, text, text, text), panel_desbloquear(uuid, text), panel_importar_registrar(jsonb),
  panel_respaldo(int), panel_voluntarios(), panel_voluntario_estado(uuid, text) to authenticated;
revoke execute on function _cerrar_inactivas(), aplicar_conservacion_voluntarios() from public, anon, authenticated;
