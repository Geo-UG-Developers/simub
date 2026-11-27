-- Contraseñas fijas: las asigna y cambia solo el Admin. Maestro (o el responsable del sistema) desde Ajustes.
update miembros_panel set cambiar_clave = false;

-- Chats de Telegram de los Admin. Maestro vinculados al bot (para avisar bloqueos de cuentas). Solo el servidor.
create or replace function admins_telegram() returns bigint[]
language sql stable security definer set search_path = public, extensions as $$
  select coalesce(array_agg(distinct p.tg_chat_id), '{}')
  from miembros_panel m join auth.users u on u.id = m.user_id join personal p on lower(p.email) = lower(u.email)
  where m.rol = 'admin' and p.tg_chat_id is not null and p.activo
$$;
revoke execute on function admins_telegram() from public, anon, authenticated;
