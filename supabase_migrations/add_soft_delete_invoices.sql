-- Soft delete para a tabela invoices
-- Execute este script no SQL Editor do Supabase

alter table public.invoices
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by text,
  add column if not exists deleted_reason text;

