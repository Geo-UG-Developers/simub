-- SIMUB · Datos reales entregados por la estación (formulario «SIMUB_datos_para_la_app», nov. 2026).
-- Solo datos públicos de la estación. Los datos personales del equipo NO van en este repositorio.

insert into config_publica (clave, valor) values ('estacion', '{}'), ('donativos', '{}'), ('revisiones', '{}')
on conflict (clave) do nothing;

update config_publica set actualizado_en = now(), valor = valor || '{
  "nombre": "Bomberos SIMUB Voluntarios, A.C.",
  "telefono": "4737346959", "telefono_texto": "473 734 6959",
  "whatsapp": "4731189164", "whatsapp_texto": "473 118 9164",
  "direccion": "Mezquite Mocho #1, Guanajuato, Gto.",
  "horario": "24 horas, los 7 días",
  "correo": "admonsimub@gmail.com",
  "fundacion": "27 de agosto de 2007",
  "voluntarios": 72,
  "zona": "Todo el municipio de Guanajuato y sus comunidades.",
  "no_atendemos": ["Alacranes", "Perros agresivos"],
  "redes": {"facebook": "https://www.facebook.com/bomberossimubvoluntarios",
            "instagram": "https://www.instagram.com/bomberos_simub_guanajuato",
            "tiktok": "https://www.tiktok.com/@bomberos_simub_gto"},
  "quienes_somos": "Desde el 27 de agosto de 2007 somos el cuerpo de bomberos de Guanajuato, Gto., y una Asociación Civil. Más de 70 voluntarios atienden todo el municipio de Guanajuato y sus comunidades, las 24 horas."
}'::jsonb where clave = 'estacion';

update config_publica set actualizado_en = now(), valor = valor || '{
  "titular": "SIMUB Voluntarios, A.C.", "banco": "BBVA",
  "clabe": "012210001105161634", "clabe_texto": "012 210 00110516163 4",
  "concepto": "Aportación voluntaria", "montos": [100, 200, 500],
  "recibo_deducible": false, "contacto_recibo": "admonsimub@gmail.com",
  "voluntariado": "Mayor de 18 años, preparatoria terminada o cursando, disponibilidad de horario y trabajar o estudiar."
}'::jsonb where clave = 'donativos';

update config_publica set actualizado_en = now(), valor = valor || '{
  "dias": "Lunes a domingo", "horario": "8:00 a 20:00",
  "costo": "La mayoría son gratuitas; en algunos casos se pide un donativo según la solicitud.",
  "anticipacion_dias": 15, "max_semana": 7,
  "tipos": ["Eventos", "Comercios", "Visto bueno NOM-002", "Simulacros", "Pláticas de prevención", "Capacitación de brigadas"]
}'::jsonb where clave = 'revisiones';

-- Unidades (folio de su Excel: M-01, U-08…). Las de ejemplo se quitan si no tienen servicios.
delete from unidades where nombre in ('Unidad 1', 'Unidad 2', 'Unidad 3');
insert into unidades (nombre, tipo) values
 ('M-01', 'Motobomba'), ('M-02', 'Motobomba'), ('T-03', 'Pipa'), ('U-04', 'Utilitaria'), ('M-05', 'Motobomba'),
 ('M-06', 'Utilitaria'), ('A-07', 'Ambulancia'), ('U-08', 'Utilitaria'), ('U-09', null), ('PR-10', null),
 ('PR-12', null), ('R-13', null), ('CI-14', null), ('E-15', null), ('M-16', null)
on conflict (nombre) do update set tipo = coalesce(unidades.tipo, excluded.tipo);

-- Necesidades reales en lugar de las de ejemplo.
delete from necesidades where articulo in ('Guantes para incendio', 'Botiquines de primeros auxilios', 'Combustible para unidades');
insert into necesidades (articulo, urgente, orden)
select v.* from (values ('Agua embotellada', false, 1), ('Bebidas hidratantes', false, 2), ('Insumos de limpieza y aseo', false, 3)) v(articulo, urgente, orden)
where not exists (select 1 from necesidades n where n.articulo = v.articulo and n.activa);

-- Noticia de lanzamiento (la pidió SIMUB en su formulario).
delete from noticias where texto like '%[Ejemplo]%';
insert into noticias (categoria, titulo, texto, destacada, autor, avisada_en)
select 'evento', 'Colecta de ropa y juguetes',
  'Del 23 de noviembre al 11 de diciembre de 2026 recibimos ropa y juguetes en la estación (Mezquite Mocho #1). '
  || 'El objetivo es llevar una sonrisa a las comunidades el 20 de diciembre. ¡Gracias por sumarte!', true, 'SIMUB', now()
where not exists (select 1 from noticias where titulo = 'Colecta de ropa y juguetes');
update noticias set destacada = (titulo = 'Colecta de ropa y juguetes') where exists (select 1 from noticias where titulo = 'Colecta de ropa y juguetes');
