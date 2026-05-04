-- Adiciona last_location na tabela vehicles
-- Rodar no SQL Editor do Supabase Dashboard

alter table vehicles
  add column if not exists last_location jsonb default null;
