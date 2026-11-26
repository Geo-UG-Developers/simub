# Respaldos

Cada día (3:41 a. m.) GitHub exporta la base de datos completa y la guarda **cifrada**:

- **Diaria**: 30 días (Actions › «Respaldo diario de la base» › la ejecución › *Artifacts*).
- **Semanal** (domingo): 90 días, en el mismo lugar.
- **Mensual** (día 1): sin vencimiento, en *Releases › Respaldos mensuales* (borrador: solo lo ven quienes administran el repositorio).
- Además, desde el panel (Ajustes › Copias de seguridad) se descarga una copia del año en Excel y en archivo completo, a mano o automática
  (diaria, semanal o mensual) en la computadora de la estación.

Se puede correr a mano con **Run workflow** (también deja copia en el release mensual).

- El archivo se abre con la **contraseña de la base de datos** de Supabase (la misma del secreto `SUPABASE_DB_PASSWORD`).
  Si algún día se cambia esa contraseña, guarda la anterior: los respaldos viejos siguen usando la que tenían.
- Las **fotos** no van en el respaldo (están en Supabase Storage y se borran solas a los 6 meses).

## Restaurar (solo en caso de emergencia)

```bash
gpg -d respaldo_AAAA-MM-DD.tgz.gpg > respaldo.tgz     # pide la contraseña de la base
tar xzf respaldo.tgz                                  # esquema.sql y datos.sql
psql "postgresql://postgres:CONTRASEÑA@db.REF.supabase.co:5432/postgres" -f datos.sql
```
