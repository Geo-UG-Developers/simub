-- Cuentas: cambio de contraseña obligatorio al primer ingreso, baja de cuentas y de personal, invitaciones a grupos.
alter table miembros_panel add column if not exists cambiar_clave boolean not null default false;

create or replace function panel_yo() returns jsonb
language sql stable security definer set search_path = public, extensions as $$
  select jsonb_build_object('rol', m.rol, 'nombre', coalesce(m.nombre, ''), 'cargo', m.cargo, 'super', m.superusuario, 'unidad', m.unidad,
    'cambiar_clave', m.cambiar_clave,
    'alertas_vinculado', exists (select 1 from chats where rol = 'alertas' and chat_id is not null))
  from miembros_panel m where m.user_id = auth.uid()
$$;

-- La llama quien acaba de poner su propia contraseña nueva.
create or replace function panel_clave_cambiada() returns void
language sql security definer set search_path = public, extensions as $$
  update miembros_panel set cambiar_clave = false where user_id = auth.uid();
$$;
grant execute on function panel_clave_cambiada() to authenticated;

-- Lista de cuentas con la marca de «debe cambiar su contraseña».
create or replace function panel_cuentas() returns jsonb
language sql stable security definer set search_path = public, extensions as $$
  select coalesce(jsonb_agg(jsonb_build_object('user_id', m.user_id, 'nombre', m.nombre, 'rol', m.rol, 'cargo', m.cargo, 'unidad', m.unidad,
    'superusuario', m.superusuario, 'email', u.email, 'ultimo_acceso', u.last_sign_in_at, 'cambiar_clave', m.cambiar_clave,
    'bloqueado', exists (select 1 from acceso_bloqueos b where b.email = lower(u.email) and b.hasta > now())) order by m.rol, m.nombre), '[]')
  from miembros_panel m left join auth.users u on u.id = m.user_id
  where es_admin() or es_super()
$$;

-- Baja de una persona del personal/oficiales (deja de recibir avisos y sale del mapa). Los servicios conservan el nombre escrito.
create or replace function panel_borrar_persona(p_id int) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare p personal%rowtype;
begin
  if not (es_admin() or es_super()) then raise exception 'solo_admin' using errcode = '42501'; end if;
  select * into p from personal where id = p_id;
  if not found then raise exception 'no_existe' using errcode = 'P0002'; end if;
  delete from posiciones where tipo = 'oficial' and autor = p.nombre;
  delete from personal where id = p_id;
  perform auditar('persona_borrada', 'personal', p.nombre, jsonb_build_object('nombre', p.nombre, 'cargo', p.cargo, 'telefono', p.telefono));
  return jsonb_build_object('ok', true);
end $$;
grant execute on function panel_borrar_persona(int) to authenticated;

-- Para invitar a los grupos: quién debe estar en cada uno (según Reportes App / Comunicación interna).
create or replace function panel_miembros_grupos() returns jsonb
language sql stable security definer set search_path = public, extensions as $$
  select jsonb_build_object(
    'alertas', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'nombre', nombre, 'corto', coalesce(nombre_corto, nombre), 'telefono', telefono,
        'vinculado', tg_chat_id is not null) order by coalesce(nombre_corto, nombre)) from personal where activo and reportes_app), '[]'),
    'interno', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'nombre', nombre, 'corto', coalesce(nombre_corto, nombre), 'telefono', telefono,
        'vinculado', tg_chat_id is not null) order by coalesce(nombre_corto, nombre)) from personal where activo and comunicacion_interna), '[]'))
  where es_admin() or es_super()
$$;
grant execute on function panel_miembros_grupos() to authenticated;
