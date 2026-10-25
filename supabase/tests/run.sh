#!/usr/bin/env bash
# Crea una base de datos limpia, aplica migraciones y semillas, y corre las pruebas.
# Requiere PostgreSQL 16. Uso: PGHOST=/tmp PGPORT=54322 ./supabase/tests/run.sh
set -euo pipefail
cd "$(dirname "$0")/.."
DB=simub_test
psql -U postgres -q -c "drop database if exists $DB" -c "create database $DB"
P="psql -U postgres -d $DB -q -v ON_ERROR_STOP=1"
$P -f tests/00_stub_supabase.sql
for f in migrations/*.sql; do $P -f "$f"; done
for f in seed/*.sql; do $P -f "$f" > /dev/null; done
$P -f tests/10_pruebas.sql
