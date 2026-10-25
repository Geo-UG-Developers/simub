-- Contenido de ejemplo para la demostración (se puede borrar desde el panel).
insert into unidades (nombre, tipo) values ('Unidad 1', 'Pipa'), ('Unidad 2', 'Rescate'), ('Unidad 3', 'Pick-up')
on conflict do nothing;
insert into necesidades (articulo, urgente, orden)
select * from (values ('Guantes para incendio', true, 1), ('Botiquines de primeros auxilios', true, 2),
                      ('Combustible para unidades', false, 3), ('Agua embotellada', false, 4)) v
where not exists (select 1 from necesidades);
insert into noticias (categoria, titulo, texto, destacada, autor, avisada_en)
select * from (values
  ('aviso', 'Nueva app de SIMUB', 'Ya puedes reportar emergencias, seguir tu reporte en tiempo real y apoyar a tus bomberos voluntarios desde esta app. [Ejemplo]', true, 'SIMUB', now()),
  ('evento', 'Temporada decembrina: cuidado con la pirotecnia', 'Evita usar cohetes cerca de pastizales, cables o tanques de gas. Si ves un incendio, repórtalo. [Ejemplo]', false, 'SIMUB', now()),
  ('donacion', 'Colecta de equipo de protección', 'Estamos reuniendo guantes y botas para el personal voluntario. Revisa la sección Apoya. [Ejemplo]', false, 'SIMUB', now())) v
where not exists (select 1 from noticias);
