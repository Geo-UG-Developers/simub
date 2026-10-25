-- SIMUB · El administrador ve en el panel los códigos para vincular los grupos de Telegram.
create or replace function panel_codigos() returns jsonb
language sql stable security definer set search_path = public, extensions as $$
  select coalesce(jsonb_agg(jsonb_build_object('rol', rol, 'codigo', codigo, 'vinculado', chat_id is not null,
    'vinculado_en', vinculado_en) order by rol), '[]')
  from chats where mi_rol() = 'admin'
$$;
grant execute on function panel_codigos() to authenticated;
