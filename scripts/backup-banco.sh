#!/bin/sh
# Backup diário do banco do EntregaCerta.
# Roda às 02:00 de Salvador (05:00 UTC) pelo crontab do root. O PC do escritório
# (LIC-02) busca daqui às 07:30. Guarda 7 dias neste servidor.
#
# Grava primeiro num arquivo .parcial e só renomeia depois de conferir que ele
# abre no pg_restore: o PC nunca baixa um backup pela metade.
set -eu
DIR=/root/backups/entregacerta
DB=supabase-db-42nb6b0eoxmpg59ck8e2d9p1
DIA=$(TZ=America/Bahia date +%F)
FINAL="$DIR/banco-$DIA.dump"
PARCIAL="$DIR/.banco-$DIA.parcial"

log() { echo "$(TZ=America/Bahia date '+%F %T') $*" >> "$DIR/backup.log"; }
falhou() { log "FALHOU: $1"; rm -f "$PARCIAL"; exit 1; }

docker exec "$DB" pg_dump -U postgres -d postgres -Fc > "$PARCIAL" 2> "$DIR/.ultimo-erro.txt" \
  || falhou "pg_dump: $(head -c 300 "$DIR/.ultimo-erro.txt")"
TAM=$(stat -c %s "$PARCIAL")
[ "$TAM" -gt 1000000 ] || falhou "arquivo pequeno demais ($TAM bytes)"
docker exec -i "$DB" pg_restore -l < "$PARCIAL" > /dev/null 2>&1 \
  || falhou "arquivo gerado não abre no pg_restore"
mv "$PARCIAL" "$FINAL"
find "$DIR" -maxdepth 1 -name 'banco-*.dump' -mtime +7 -delete
log "ok $(basename "$FINAL") $TAM bytes"
