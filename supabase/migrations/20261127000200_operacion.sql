-- SIMUB · Operación: turnos día/noche, guardia del turno, grupo interno de Telegram, app de campo
-- (evidencias, posición de unidades, personal en escena y comando de incidentes), inspección y mantenimiento
-- de unidades, inventario y caducidades, puntos de agua/accesos/preplanes, capacitación y alertas.

-- ------------------------------------------------------------ turnos (08:00–19:59 día · 20:00–07:59 noche)
create or replace function turno_de(t timestamptz) returns text language sql stable as $$
  select case when extract(hour from t at time zone 'America/Mexico_City') between 8 and 19 then 'dia' else 'noche' end
$$;
-- La noche que empieza a las 20:00 pertenece a la fecha en que empezó.
create or replace function fecha_turno(t timestamptz) returns date language sql stable as $$
  select ((t at time zone 'America/Mexico_City') - interval '8 hours')::date
$$;

create table guardias (
  id        bigserial primary key,
  fecha     date not null,
  turno     text not null check (turno in ('dia', 'noche')),
  jefe      text,
  personal  text[] not null default '{}',
  registro  text,
  en        timestamptz not null default now(),
  unique (fecha, turno)
);
alter table guardias enable row level security;
revoke all on guardias from anon, authenticated;

alter table servicios add column if not exists turno text;
alter table servicios add column if not exists recursos jsonb not null default '{}';   -- agua_litros, espuma_litros, extintores…
alter table servicios add column if not exists perimetro jsonb;                        -- GeoJSON del área afectada
alter table servicios add column if not exists sci jsonb not null default '{}';        -- comando de incidentes
alter table servicios add column if not exists tg_chat_id bigint;
alter table servicios add column if not exists tg_message_id bigint;

-- Turno y jefe de guardia se llenan solos.
create or replace function trg_servicio_turno() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare t timestamptz := coalesce(new.h_reporte, new.h_despacho, (new.fecha + time '12:00') at time zone 'America/Mexico_City');
begin
  new.turno := turno_de(t);
  if new.jefe_guardia is null and new.origen <> 'historico' then
    select jefe into new.jefe_guardia from guardias where fecha = fecha_turno(t) and turno = turno_de(t);
  end if;
  return new;
end $$;
create trigger servicios_turno before insert or update of h_reporte, h_despacho, fecha, jefe_guardia on servicios
  for each row execute function trg_servicio_turno();
update servicios set turno = turno_de(coalesce(h_reporte, h_despacho, (fecha + time '12:00') at time zone 'America/Mexico_City'));

create or replace function panel_guardia() returns jsonb
language sql stable security definer set search_path = public, extensions as $$
  select jsonb_build_object('fecha', fecha_turno(now()), 'turno', turno_de(now()),
    'jefe', g.jefe, 'personal', coalesce(to_jsonb(g.personal), '[]'), 'registro', g.registro, 'en', g.en)
  from (select 1) x left join guardias g on g.fecha = fecha_turno(now()) and g.turno = turno_de(now())
  where mi_rol() is not null
$$;
-- Jefe de guardia y pase de lista del turno en curso.
create or replace function panel_guardia_guardar(p_jefe text, p_personal text[]) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  if mi_rol() is null or mi_rol() = 'campo' then raise exception 'sin_permiso' using errcode = '42501'; end if;
  insert into guardias (fecha, turno, jefe, personal, registro)
  values (fecha_turno(now()), turno_de(now()), nullif(trim(p_jefe), ''), coalesce(p_personal, '{}'), quien_soy())
  on conflict (fecha, turno) do update set jefe = excluded.jefe, personal = excluded.personal, registro = excluded.registro, en = now();
  -- servicios del turno sin jefe de guardia: se completan
  update servicios set jefe_guardia = nullif(trim(p_jefe), '')
   where jefe_guardia is null and origen <> 'historico' and turno = turno_de(now())
     and fecha_turno(coalesce(h_reporte, creado_en)) = fecha_turno(now());
  perform auditar('guardia', 'guardias', fecha_turno(now()) || ' ' || turno_de(now()), jsonb_build_object('jefe', p_jefe, 'personal', p_personal));
  return panel_guardia();
end $$;

-- ------------------------------------------------------------ grupo interno de Telegram
alter table chats drop constraint if exists chats_rol_check;
alter table chats add constraint chats_rol_check check (rol in ('alertas', 'comunicacion', 'respaldo', 'interno'));
insert into chats (rol) values ('interno') on conflict do nothing;

create table voy (
  servicio_id uuid not null references servicios(id) on delete cascade,
  tg_user     bigint not null,
  nombre      text,
  en          timestamptz not null default now(),
  primary key (servicio_id, tg_user)
);
alter table voy enable row level security;
revoke all on voy from anon, authenticated;

-- Datos para el mensaje del grupo interno (solo el servidor).
create or replace function datos_servicio_tg(p_id uuid) returns jsonb
language sql stable security definer set search_path = public, extensions as $$
  select to_jsonb(s) - 'firmas' - 'personas' - 'vehiculos' - 'creado_por' || jsonb_build_object(
    'clase', c.nombre, 'grupo', c.grupo,
    'voy', coalesce((select jsonb_agg(v.nombre order by v.en) from voy v where v.servicio_id = s.id), '[]'),
    'ultima', (select b.texto from bitacora b where b.servicio_id = s.id order by b.en desc limit 1))
  from servicios s join catalogo_servicios c on c.id = s.clasificacion where s.id = p_id
$$;
revoke execute on function datos_servicio_tg(uuid) from public, anon, authenticated;

-- Resumen del turno que termina (08:00 y 20:00).
create or replace function resumen_turno(p_fecha date, p_turno text) returns jsonb
language sql stable security definer set search_path = public, extensions as $$
  with s as (select * from servicios where estado <> 'anulado' and turno = p_turno
             and fecha_turno(coalesce(h_reporte, creado_en)) = p_fecha and origen <> 'historico')
  select jsonb_build_object('fecha', p_fecha, 'turno', p_turno,
    'jefe', (select jefe from guardias where fecha = p_fecha and turno = p_turno),
    'total', (select count(*) from s),
    'por_tipo', coalesce((select jsonb_object_agg(n, k) from (select c.nombre n, count(*) k from s join catalogo_servicios c on c.id = s.clasificacion group by 1) x), '{}'),
    'activos', (select count(*) from servicios where estado = 'activo'),
    'sin_parte', (select count(*) from s where jefe_servicio is null and estado = 'cerrado'),
    'fuera_servicio', coalesce((select jsonb_agg(nombre || coalesce(' (' || nota || ')', '')) from unidades where activa and estado = 'fuera_servicio'), '[]'))
$$;
revoke execute on function resumen_turno(date, text) from public, anon, authenticated;

-- ------------------------------------------------------------ app de campo
alter table miembros_panel add column if not exists unidad text;   -- cuenta de unidad (celular o tableta a bordo)
alter table bitacora add column if not exists lat double precision;
alter table bitacora add column if not exists lon double precision;

create table evidencias (
  id          uuid primary key default gen_random_uuid(),
  servicio_id uuid not null references servicios(id) on delete cascade,
  ruta        text not null,
  tipo        text not null default 'foto' check (tipo in ('foto', 'video')),
  nota        text,
  lat         double precision,
  lon         double precision,
  autor       text,
  en          timestamptz not null default now()
);
create table posiciones (
  unidad      text primary key,
  lat         double precision not null,
  lon         double precision not null,
  precision_m int,
  servicio_id uuid references servicios(id) on delete set null,
  autor       text,
  en          timestamptz not null default now()
);
create table en_escena (
  id          bigserial primary key,
  servicio_id uuid not null references servicios(id) on delete cascade,
  persona     text not null,
  asignacion  text,
  entra       timestamptz not null default now(),
  sale        timestamptz,
  aire_inicio timestamptz,
  aire_min    int check (aire_min between 5 and 120),
  registro    text
);
alter table evidencias enable row level security;
alter table posiciones enable row level security;
alter table en_escena enable row level security;
revoke all on evidencias, posiciones, en_escena from anon, authenticated;

-- Bitácora con ubicación (los hitos desde el celular guardan dónde se marcaron).
drop function if exists panel_bitacora(uuid, text, text);
create or replace function panel_bitacora(p_servicio uuid, p_texto text, p_hito text default null,
  p_lat double precision default null, p_lon double precision default null) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_txt text := nullif(trim(p_texto), ''); s servicios%rowtype;
begin
  if mi_rol() is null then raise exception 'sin_permiso' using errcode = '42501'; end if;
  select * into s from servicios where id = p_servicio for update;
  if not found then raise exception 'no_existe' using errcode = 'P0002'; end if;
  if p_hito is not null then
    if p_hito not in ('despacho', 'llegada', 'disponible', 'base') then raise exception 'hito_invalido' using errcode = '22023'; end if;
    execute format('update servicios set h_%s = coalesce(h_%s, now()), actualizado_en = now() where id = $1', p_hito, p_hito) using p_servicio;
    v_txt := coalesce(v_txt, case p_hito when 'despacho' then 'Despacho de unidad(es)' when 'llegada' then 'Llegada a la escena'
                                         when 'disponible' then 'Unidad disponible' else 'Llegada a la base' end);
  end if;
  if v_txt is null then raise exception 'texto_vacio' using errcode = '22023'; end if;
  insert into bitacora (servicio_id, texto, autor, lat, lon) values (p_servicio, left(v_txt, 1000), quien_soy(), p_lat, p_lon);
  return jsonb_build_object('ok', true);
end $$;
grant execute on function panel_bitacora(uuid, text, text, double precision, double precision) to authenticated;

-- Cambios parciales desde el campo (no pisa lo demás del parte).
create or replace function panel_servicio_parcial(p_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare s servicios%rowtype;
begin
  select * into s from servicios where id = p_id for update;
  if not found then raise exception 'no_existe' using errcode = 'P0002'; end if;
  if not puede_editar(s) then raise exception 'bloqueado' using errcode = '42501'; end if;
  update servicios set
    recursos = case when p ? 'recursos' then coalesce(recursos, '{}') || (p->'recursos') else recursos end,
    perimetro = case when p ? 'perimetro' then p->'perimetro' else perimetro end,
    area_afectada = case when p ? 'area_afectada' then nullif(p->>'area_afectada', '') else area_afectada end,
    personas = case when p ? 'personas' then p->'personas' else personas end,
    vehiculos = case when p ? 'vehiculos' then p->'vehiculos' else vehiculos end,
    sci = case when p ? 'sci' then coalesce(sci, '{}') || (p->'sci') else sci end,
    observaciones = case when p ? 'nota_obs' then concat_ws(E'\n', observaciones, p->>'nota_obs') else observaciones end,
    lat = coalesce(lat, nullif(p->>'lat', '')::float8), lon = coalesce(lon, nullif(p->>'lon', '')::float8),
    editado_por = quien_soy(), actualizado_en = now()
  where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

create or replace function panel_posicion(p_unidad text, p_lat double precision, p_lon double precision, p_precision int, p_servicio uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if mi_rol() is null then raise exception 'sin_permiso' using errcode = '42501'; end if;
  insert into posiciones (unidad, lat, lon, precision_m, servicio_id, autor, en)
  values (p_unidad, p_lat, p_lon, p_precision, p_servicio, quien_soy(), now())
  on conflict (unidad) do update set lat = excluded.lat, lon = excluded.lon, precision_m = excluded.precision_m,
    servicio_id = excluded.servicio_id, autor = excluded.autor, en = now();
end $$;

create or replace function panel_evidencia(p_servicio uuid, p_ruta text, p_tipo text, p_nota text, p_lat double precision, p_lon double precision) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_id uuid;
begin
  if mi_rol() is null then raise exception 'sin_permiso' using errcode = '42501'; end if;
  insert into evidencias (servicio_id, ruta, tipo, nota, lat, lon, autor) values (p_servicio, p_ruta, coalesce(p_tipo, 'foto'), nullif(trim(p_nota), ''), p_lat, p_lon, quien_soy())
  returning id into v_id;
  insert into bitacora (servicio_id, texto, autor, lat, lon) values (p_servicio, 'Evidencia agregada' || coalesce(': ' || nullif(trim(p_nota), ''), ''), quien_soy(), p_lat, p_lon);
  return jsonb_build_object('id', v_id);
end $$;

-- Personal en escena (conteo) y tiempo de aire de los equipos de respiración.
create or replace function panel_escena(p_servicio uuid, p_accion text, p_persona text, p_asignacion text default null, p_aire_min int default null, p_id bigint default null) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  if mi_rol() is null then raise exception 'sin_permiso' using errcode = '42501'; end if;
  if p_accion = 'entra' then
    insert into en_escena (servicio_id, persona, asignacion, registro) values (p_servicio, trim(p_persona), nullif(trim(p_asignacion), ''), quien_soy());
  elsif p_accion = 'sale' then
    update en_escena set sale = now(), aire_inicio = null where id = p_id and servicio_id = p_servicio and sale is null;
  elsif p_accion = 'aire' then
    update en_escena set aire_inicio = now(), aire_min = coalesce(p_aire_min, 30) where id = p_id and servicio_id = p_servicio and sale is null;
  elsif p_accion = 'aire_fin' then
    update en_escena set aire_inicio = null where id = p_id and servicio_id = p_servicio;
  else raise exception 'accion_invalida' using errcode = '22023'; end if;
  insert into bitacora (servicio_id, texto, autor) values (p_servicio,
    case p_accion when 'entra' then 'En escena: ' || trim(p_persona) || coalesce(' · ' || nullif(trim(p_asignacion), ''), '')
                  when 'sale' then 'Sale de la escena: ' || coalesce((select persona from en_escena where id = p_id), '')
                  when 'aire' then 'Inicia equipo de respiración (' || coalesce(p_aire_min, 30) || ' min): ' || coalesce((select persona from en_escena where id = p_id), '')
                  else 'Termina equipo de respiración: ' || coalesce((select persona from en_escena where id = p_id), '') end, quien_soy());
  return jsonb_build_object('ok', true);
end $$;

-- Lo que ve el celular de campo: servicios de su unidad (o todos los activos si no tiene unidad).
create or replace function panel_campo() returns jsonb
language sql stable security definer set search_path = public, extensions as $$
  with yo as (select unidad from miembros_panel where user_id = auth.uid())
  select jsonb_build_object(
    'unidad', (select unidad from yo),
    'servicios', coalesce((select jsonb_agg(_servicio_json(s) || jsonb_build_object(
        'clase', c.nombre, 'color', c.color,
        'escena', coalesce((select jsonb_agg(to_jsonb(e) order by e.entra) from en_escena e where e.servicio_id = s.id), '[]'),
        'evidencias', coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'ruta', v.ruta, 'tipo', v.tipo, 'nota', v.nota, 'autor', v.autor, 'en', v.en) order by v.en)
                                from evidencias v where v.servicio_id = s.id), '[]'),
        'bitacora', coalesce((select jsonb_agg(jsonb_build_object('texto', b.texto, 'autor', b.autor, 'en', b.en) order by b.en desc)
                              from (select * from bitacora b where b.servicio_id = s.id order by b.en desc limit 8) b), '[]'))
        order by s.estado = 'activo' desc, s.h_reporte desc)
      from servicios s join catalogo_servicios c on c.id = s.clasificacion
      where (s.estado = 'activo' or (s.estado = 'cerrado' and s.actualizado_en > now() - interval '24 hours'))
        and s.origen <> 'historico'
        and ((select unidad from yo) is null or (select unidad from yo) = any (s.unidades))), '[]'))
  where mi_rol() is not null
$$;

-- ------------------------------------------------------------ unidades: inspección, mantenimiento, inventario
create table inspecciones (
  id         bigserial primary key,
  unidad     text not null,
  fecha      date not null default fecha_turno(now()),
  turno      text not null default turno_de(now()),
  km         numeric,
  horas_bomba numeric,
  checklist  jsonb not null default '{}',     -- {"Aceite": "ok" | "falla" | "na", …}
  scba       jsonb not null default '[]',     -- [{"equipo": "1", "psi": 4200, "ok": true}]
  fallas     text[] not null default '{}',
  critica    boolean not null default false,
  notas      text,
  fotos      text[] not null default '{}',
  autor      text default quien_soy(),
  user_id    uuid default auth.uid(),
  en         timestamptz not null default now()
);
create index inspecciones_unidad_idx on inspecciones (unidad, en desc);
create table mantenimientos (
  id            bigserial primary key,
  unidad        text not null,
  tipo          text not null,
  fecha         date not null default hoy_local(),
  km            numeric,
  costo         numeric,
  notas         text,
  proximo_fecha date,
  proximo_km    numeric,
  autor         text default quien_soy(),
  en            timestamptz not null default now()
);
create table inventario (
  id          bigserial primary key,
  articulo    text not null,
  categoria   text,
  ubicacion   text not null default 'Estación',
  cantidad    int not null default 1 check (cantidad >= 0),
  caducidad   date,
  estado      text not null default 'bueno' check (estado in ('bueno', 'regular', 'dañado', 'baja')),
  notas       text,
  actualizado_en timestamptz not null default now()
);
create table capacitaciones (
  id            bigserial primary key,
  titulo        text not null,
  tipo          text not null default 'curso' check (tipo in ('curso', 'práctica', 'certificación', 'plática')),
  fecha         date not null default hoy_local(),
  horas         numeric not null default 1 check (horas >= 0),
  instructor    text,
  participantes text[] not null default '{}',
  vigencia      date,
  notas         text,
  autor         text default quien_soy(),
  en            timestamptz not null default now()
);
-- Mapa operativo: agua, accesos, puntos de reunión, preplanes de inmuebles y riesgos.
create table puntos (
  id         bigserial primary key,
  tipo       text not null check (tipo in ('hidrante', 'toma_agua', 'presa', 'pipa', 'acceso', 'reunion', 'inmueble', 'riesgo')),
  nombre     text not null,
  lat        double precision not null check (lat between -90 and 90),
  lon        double precision not null check (lon between -180 and 180),
  datos      jsonb not null default '{}',
  notas      text,
  activo     boolean not null default true,
  autor      text default quien_soy(),
  actualizado_en timestamptz not null default now()
);

do $$ declare t text;
begin
  foreach t in array array['inspecciones', 'mantenimientos', 'inventario', 'capacitaciones', 'puntos'] loop
    execute format('alter table %1$s enable row level security', t);
    execute format('revoke all on %1$s from anon, authenticated', t);
    execute format('grant select, insert, update, delete on %1$s to authenticated', t);
    execute format('grant usage on sequence %1$s_id_seq to authenticated', t);
    execute format('create policy %1$s_leer on %1$s for select to authenticated using (mi_rol() is not null)', t);
    execute format('create policy %1$s_editar on %1$s for update to authenticated using (mi_rol() in (''admin'', ''coordinador'')) with check (mi_rol() in (''admin'', ''coordinador''))', t);
    execute format('create policy %1$s_borrar on %1$s for delete to authenticated using (mi_rol() in (''admin'', ''coordinador''))', t);
    if t <> 'inspecciones' then
      execute format('create trigger %1$s_auditoria after insert or update or delete on %1$s for each row execute function trg_auditar()', t);
    end if;
  end loop;
end $$;
-- Inspecciones las registra cualquiera del personal (cabina o campo); lo demás, admin y coordinación.
create policy inspecciones_nueva on inspecciones for insert to authenticated with check (mi_rol() is not null);
create policy mantenimientos_nuevo on mantenimientos for insert to authenticated with check (mi_rol() in ('admin', 'coordinador'));
create policy inventario_nuevo on inventario for insert to authenticated with check (mi_rol() in ('admin', 'coordinador'));
create policy capacitaciones_nueva on capacitaciones for insert to authenticated with check (mi_rol() in ('admin', 'coordinador'));
create policy puntos_nuevo on puntos for insert to authenticated with check (mi_rol() in ('admin', 'coordinador'));

-- Falla crítica en la inspección → la unidad pasa sola a «fuera de servicio».
create or replace function trg_inspeccion_critica() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  if new.critica then
    update unidades set estado = case when estado = 'en_servicio' then estado else 'fuera_servicio' end,
      nota = left('Inspección: ' || array_to_string(new.fallas, ', '), 120), actualizado_en = now()
    where nombre = new.unidad;
  end if;
  return new;
end $$;
create trigger inspecciones_critica after insert on inspecciones for each row execute function trg_inspeccion_critica();

-- ------------------------------------------------------------ alertas para el Centro de mando
create or replace function panel_alertas() returns jsonb
language sql stable security definer set search_path = public, extensions as $$
  select jsonb_build_object(
    'sin_inspeccion', coalesce((select jsonb_agg(u.nombre order by u.nombre) from unidades u where u.activa and u.estado <> 'fuera_servicio'
        and not exists (select 1 from inspecciones i where i.unidad = u.nombre and i.fecha = fecha_turno(now()) and i.turno = turno_de(now()))), '[]'),
    'caducidades', coalesce((select jsonb_agg(jsonb_build_object('articulo', articulo, 'ubicacion', ubicacion, 'caducidad', caducidad) order by caducidad)
        from inventario where caducidad is not null and caducidad <= hoy_local() + 30 and estado <> 'baja'), '[]'),
    'mantenimiento', coalesce((select jsonb_agg(jsonb_build_object('unidad', unidad, 'tipo', tipo, 'proximo', proximo_fecha) order by proximo_fecha)
        from (select distinct on (unidad, tipo) * from mantenimientos order by unidad, tipo, fecha desc) m
        where m.proximo_fecha is not null and m.proximo_fecha <= hoy_local() + 15), '[]'),
    'certificaciones', coalesce((select jsonb_agg(jsonb_build_object('titulo', titulo, 'vigencia', vigencia) order by vigencia)
        from capacitaciones where tipo = 'certificación' and vigencia is not null and vigencia <= hoy_local() + 30), '[]'),
    'sin_firma', (select count(*) from servicios where estado = 'cerrado' and not bloqueado and origen <> 'historico'
        and coalesce(h_base, actualizado_en) < now() - interval '24 hours'))
  where mi_rol() is not null
$$;

-- Centro de mando: agrega posiciones de unidades, guardia del turno y alertas.
create or replace function panel_mando() returns jsonb
language sql stable security definer set search_path = public, extensions as $$
  select jsonb_build_object(
    'servicios', coalesce((select jsonb_agg(_servicio_json(s) || jsonb_build_object('bitacora',
        coalesce((select jsonb_agg(jsonb_build_object('texto', b.texto, 'autor', b.autor, 'en', b.en) order by b.en desc)
                  from (select * from bitacora b where b.servicio_id = s.id order by b.en desc limit 4) b), '[]'),
        'escena', (select count(*) from en_escena e where e.servicio_id = s.id and e.sale is null),
        'voy', coalesce((select jsonb_agg(v.nombre order by v.en) from voy v where v.servicio_id = s.id), '[]'))
        order by s.h_reporte nulls last, s.creado_en) from servicios s where s.estado = 'activo'), '[]'),
    'unidades', coalesce((select jsonb_agg(jsonb_build_object('id', u.id, 'nombre', u.nombre, 'tipo', u.tipo, 'estado', u.estado,
        'nota', u.nota, 'servicio_id', u.servicio_id, 'desde', u.actualizado_en,
        'folio', (select s.folio from servicios s where s.id = u.servicio_id)) order by u.nombre) from unidades u where u.activa), '[]'),
    'pendientes', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'folio', r.folio, 'tipo', r.tipo, 'estado', r.estado,
        'referencia', r.referencia, 'creado_en', r.creado_en, 'resumen', r.detalles->'resumen') order by r.creado_en)
        from reportes r where r.estado not in ('cerrado', 'falso') and not exists (select 1 from servicios s where s.reporte_id = r.id)), '[]'),
    'posiciones', coalesce((select jsonb_agg(to_jsonb(p)) from posiciones p where p.en > now() - interval '30 minutes'), '[]'),
    'guardia', panel_guardia(),
    'alertas', panel_alertas(),
    'hoy', (select count(*) from servicios where fecha = hoy_local() and estado <> 'anulado'))
  where mi_rol() is not null
$$;

-- Conteos con turno (para el desglose día/noche del informe).
create or replace function panel_conteos(p_anio int) returns jsonb
language sql stable security definer set search_path = public, extensions as $$
  select jsonb_build_object(
    'conteos', coalesce((select jsonb_agg(jsonb_build_object('c', c, 'mes', mes, 'n', n)) from (
      select case when falsa_alarma then 'falsa' else clasificacion end c, extract(month from fecha)::int mes, count(*) n
      from servicios where anio = p_anio and estado <> 'anulado' group by 1, 2) x), '[]'),
    'turnos', coalesce((select jsonb_agg(jsonb_build_object('mes', mes, 'turno', turno, 'n', n)) from (
      select extract(month from fecha)::int mes, coalesce(turno, 'sin dato') turno, count(*) n
      from servicios where anio = p_anio and estado <> 'anulado' group by 1, 2) y), '[]'),
    'apoyos', coalesce((select jsonb_object_agg(k, n) from (
      select k, count(*) n from servicios s, jsonb_object_keys(s.apoyos) k
      where s.anio = p_anio and s.estado <> 'anulado' group by k) y), '{}'),
    'minutos_promedio', (select round(avg(extract(epoch from h_base - h_despacho) / 60)) from servicios
                         where anio = p_anio and estado <> 'anulado' and h_base > h_despacho and h_base - h_despacho < interval '24 hours'))
  where mi_rol() is not null
$$;

-- Lista mensual: agrega el turno.
create or replace function panel_servicios(p_desde date, p_hasta date) returns jsonb
language sql stable security definer set search_path = public, extensions as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'anio', s.anio, 'folio', s.folio, 'estado', s.estado, 'origen', s.origen,
    'clasificacion', s.clasificacion, 'especificacion', s.especificacion, 'falsa_alarma', s.falsa_alarma, 'fecha', s.fecha, 'turno', s.turno,
    'h_reporte', s.h_reporte, 'h_despacho', s.h_despacho, 'h_llegada', s.h_llegada, 'h_base', s.h_base,
    'colonia', s.colonia, 'lugar', s.lugar, 'lat', s.lat, 'lon', s.lon, 'area_afectada', s.area_afectada, 'medio', s.medio,
    'unidades', s.unidades, 'personal_num', s.personal_num, 'apoyos', s.apoyos, 'capturo', s.capturo,
    'con_parte', s.jefe_servicio is not null, 'firmado', s.bloqueado)
    order by s.anio, s.folio), '[]')
  from servicios s
  where mi_rol() is not null and s.fecha >= p_desde and s.fecha < p_hasta
$$;

-- Horas por persona: capacitaciones + guardias (12 h por turno en el pase de lista).
create or replace function panel_horas(p_anio int) returns jsonb
language sql stable security definer set search_path = public, extensions as $$
  select coalesce(jsonb_agg(jsonb_build_object('persona', persona, 'capacitacion', cap, 'guardias', gua, 'horas_guardia', gua * 12) order by persona), '[]')
  from (
    select persona, sum(cap) cap, sum(gua) gua from (
      select unnest(participantes) persona, horas cap, 0 gua from capacitaciones where extract(year from fecha) = p_anio
      union all
      select unnest(personal), 0, 1 from guardias where extract(year from fecha) = p_anio) z group by persona) x
  where mi_rol() in ('admin', 'coordinador')
$$;

-- NASA FIRMS (focos de calor): la llave gratuita la guarda el admin; la lee solo el servidor.
create or replace function panel_guardar_firms(p_llave text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not es_admin() then raise exception 'solo_admin' using errcode = '42501'; end if;
  insert into config_privada (clave, valor) values ('firms', jsonb_build_object('llave', trim(p_llave)))
  on conflict (clave) do update set valor = excluded.valor;
  perform auditar('llave_firms', 'config_privada', 'firms', null);
  return jsonb_build_object('ok', true);
end $$;

-- ------------------------------------------------------------ evidencias: almacenamiento privado
do $$
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('evidencias', 'evidencias', false, 26214400, array['image/jpeg', 'image/webp', 'image/png', 'video/mp4', 'video/quicktime', 'video/webm'])
    on conflict (id) do nothing;
    execute 'drop policy if exists evidencias_leer on storage.objects';
    execute $p$ create policy evidencias_leer on storage.objects for select to authenticated using (bucket_id = 'evidencias' and public.mi_rol() is not null) $p$;
    execute 'drop policy if exists evidencias_subir on storage.objects';
    execute $p$ create policy evidencias_subir on storage.objects for insert to authenticated with check (bucket_id = 'evidencias' and public.mi_rol() is not null) $p$;
  end if;
end $$;

-- Limpieza de pruebas también borra lo de campo.
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
  delete from posiciones;
  delete from inspecciones;
  delete from guardias;
  delete from noticias where texto like '%[Ejemplo]%';
  delete from tg_borradores;
  perform setval('folio_reporte', 1, false);
  perform setval('folio_revision', 1, false);
  perform auditar('datos_de_prueba_borrados', null, null, jsonb_build_object('reportes', n_rep, 'revisiones', n_rev, 'servicios', n_srv));
  return jsonb_build_object('reportes', n_rep, 'revisiones', n_rev, 'servicios', n_srv, 'fotos', to_jsonb(v_fotos));
end $$;

grant execute on function panel_guardia(), panel_guardia_guardar(text, text[]), panel_servicio_parcial(uuid, jsonb),
  panel_posicion(text, double precision, double precision, int, uuid), panel_evidencia(uuid, text, text, text, double precision, double precision),
  panel_escena(uuid, text, text, text, int, bigint), panel_campo(), panel_alertas(), panel_horas(int), panel_guardar_firms(text) to authenticated;

-- El nombre de quien está conectado se usa como valor por omisión en tablas nuevas.
grant execute on function quien_soy() to authenticated;

-- Parte: también trae evidencias y personal en escena.
create or replace function panel_servicio(p_id uuid) returns jsonb
language sql stable security definer set search_path = public, extensions as $$
  select _servicio_json(s) || jsonb_build_object(
    'bitacora', coalesce((select jsonb_agg(jsonb_build_object('texto', b.texto, 'autor', b.autor, 'en', b.en, 'lat', b.lat, 'lon', b.lon) order by b.en)
                          from bitacora b where b.servicio_id = s.id), '[]'),
    'escena', coalesce((select jsonb_agg(to_jsonb(e) order by e.entra) from en_escena e where e.servicio_id = s.id), '[]'),
    'evidencias', coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'ruta', v.ruta, 'tipo', v.tipo, 'nota', v.nota, 'autor', v.autor, 'en', v.en) order by v.en)
                            from evidencias v where v.servicio_id = s.id), '[]'),
    'voy', coalesce((select jsonb_agg(v.nombre order by v.en) from voy v where v.servicio_id = s.id), '[]'),
    'reporte_folio', (select r.folio from reportes r where r.id = s.reporte_id))
  from servicios s where s.id = p_id and mi_rol() is not null
$$;

create or replace function panel_yo() returns jsonb
language sql stable security definer set search_path = public, extensions as $$
  select jsonb_build_object('rol', m.rol, 'nombre', coalesce(m.nombre, ''), 'cargo', m.cargo, 'super', m.superusuario, 'unidad', m.unidad,
    'alertas_vinculado', exists (select 1 from chats where rol = 'alertas' and chat_id is not null))
  from miembros_panel m where m.user_id = auth.uid()
$$;
