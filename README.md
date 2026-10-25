# SIMUB · Reporte de emergencias

App para **Bomberos SIMUB Voluntarios, A.C.** (Guanajuato capital), desarrollada sin costo por
**GEO UG Developers** (Universidad de Guanajuato / GeoUG).

- App ciudadana: https://geo-ug-developers.github.io/simub/
- Panel de la estación: https://geo-ug-developers.github.io/simub/panel.html
- Bot de Telegram: @SimubGtoBot

## Qué hace

| Parte | Para quién | Qué hace |
|---|---|---|
| App (PWA) | Ciudadanía | 6 tipos de emergencia con un solo formulario configurable, GPS, fotos, seguimiento en tiempo real, «Agregar información», revisiones de seguridad (citas), noticias y «Apoya a SIMUB». |
| Bot de Telegram | Estación | Alertas con foto y botones (Visto, En camino, En el lugar, Cerrar). Cerrar = admin del grupo + confirmación + 2 min para deshacer. Escala a un grupo de respaldo si nadie toca «Visto» en 10 min. Al cerrar, pide el parte de servicio. |
| Bot (grupo de comunicación) | Quien publica | `/noticia` paso a paso, `/destacar`, `/ocultar`, `/necesidades`. |
| Panel web | Estación | Tablero de guardia (alarma, pantalla siempre encendida), reportes, parte de servicio (PDF), agenda de revisiones, informe mensual (PDF/Excel) y ajustes (datos de la app, unidades, personal, noticias, necesidades, códigos de Telegram). |

## Estructura

```
supabase/migrations   esquema, funciones, seguridad (RLS), panel
supabase/seed         datos base (con [marcadores] a reemplazar) y ejemplos
supabase/functions    reportar · telegram · tareas (cada minuto) · avisos · panel
supabase/tests        pruebas de la base (PostgreSQL)
web/                  app ciudadana (index.html) y panel (panel.html) con Vite + TypeScript
web/src/formularios.ts  preguntas y opciones de cada tipo de reporte (editar aquí)
```

## Secretos (GitHub › Settings › Secrets › Actions)

`SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `SUPABASE_PROJECT_REF`, `TELEGRAM_BOT_TOKEN`.
La llave pública de Supabase la obtiene el flujo de GitHub al compilar; no hay que copiarla.

## Roles del panel (tabla `miembros_panel`)

- `admin`: todo, incluido cerrar reportes y ajustes.
- `coordinador`: agenda de revisiones, noticias y necesidades.
- `guardia`: tablero, marcar Visto / En camino / En el lugar y llenar partes.
