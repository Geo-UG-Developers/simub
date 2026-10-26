# Respaldos

Cada domingo GitHub exporta la base de datos completa y la guarda **cifrada** durante 90 días
(Actions › «Respaldo semanal de la base» › la ejecución › *Artifacts*). Se puede correr a mano con **Run workflow**.

- El archivo se abre con la **contraseña de la base de datos** de Supabase (la misma del secreto `SUPABASE_DB_PASSWORD`).
  Si algún día se cambia esa contraseña, guarda la anterior: los respaldos viejos siguen usando la que tenían.
- Las **fotos** no van en el respaldo (están en Supabase Storage y se borran solas a los 6 meses).

## Restaurar (solo en caso de emergencia)

```bash
gpg -d respaldo_AAAA-MM-DD.tgz.gpg > respaldo.tgz     # pide la contraseña de la base
tar xzf respaldo.tgz                                  # esquema.sql y datos.sql
psql "postgresql://postgres:CONTRASEÑA@db.REF.supabase.co:5432/postgres" -f datos.sql
```
