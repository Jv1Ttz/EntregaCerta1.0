#!/bin/sh
# Lista o que o backup do PC do escritorio (C:\EntregaCerta\backup-diario.ps1) precisa buscar.
# Fica aqui, e nao como comando passado pelo ssh, porque as aspas da consulta nao
# sobrevivem a passagem PowerShell 5.1 -> ssh.exe -> shell remoto.
set -eu
case "${1:-}" in
  banco)
    cd /root/backups/entregacerta && stat -c '%n|%s' banco-*.dump ;;
  fotos)
    docker exec supabase-db-42nb6b0eoxmpg59ck8e2d9p1 psql -U postgres -d postgres -tA -F'|' \
      -c "select name, coalesce(metadata->>'size','0') from storage.objects where bucket_id='delivery-proofs' order by name" ;;
  *)
    echo "uso: listar.sh banco|fotos" >&2; exit 2 ;;
esac
