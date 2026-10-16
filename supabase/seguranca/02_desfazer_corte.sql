-- ============================================================================
-- Desfaz 02_corte_chave_publica.sql e devolve EXATAMENTE o acesso que existia
-- em 16/10/2026 (levantado no servidor antes do corte). Para usar se o app do
-- motorista, o agente ou a ingestão quebrarem depois do corte.
--
-- Reabre a base para a chave pública — é voltar ao problema, não consertá-lo.
-- Use só para destravar a operação e investigar.
-- ============================================================================

begin;

-- Notas, comprovantes, notificações: RLS desligado, como era
drop policy if exists painel_tudo         on public.invoices;
drop policy if exists ingestao_le         on public.invoices;
drop policy if exists ingestao_cria       on public.invoices;
drop policy if exists ingestao_completa   on public.invoices;
drop policy if exists app_motorista_le    on public.invoices;
drop policy if exists app_motorista_baixa on public.invoices;
alter table public.invoices disable row level security;

drop policy if exists painel_tudo   on public.delivery_proofs;
drop policy if exists app_motorista on public.delivery_proofs;
alter table public.delivery_proofs disable row level security;

drop policy if exists painel_tudo              on public.notifications;
drop policy if exists app_motorista_le         on public.notifications;
drop policy if exists app_motorista_marca_lida on public.notifications;
drop policy if exists app_motorista_avisa      on public.notifications;
alter table public.notifications disable row level security;

-- Grants de anon como estavam (DELETE já não existia nessas tabelas desde a fase 1)
grant insert, select, update on public.invoices       to anon;
grant insert, select, update on public.notifications  to anon;
grant select, update         on public.activity_logs  to anon;
grant all on public.drivers, public.vehicles to anon;
grant all on public.app_credenciais, public.carga_prefatura_manual, public.foto_migracao_drive,
             public.fotos_a_apagar, public.fotos_a_migrar, public.saved_labels, public.zones
  to anon;
grant insert, select, update on public.etiqueta_expedicao to anon;
grant truncate, trigger, references on all tables in schema public to anon;

grant execute on function public.excluir_nota_definitivo(text, text) to anon;
grant execute on function public.delete_old_activity_logs             to anon;

-- Arquivos: as três policies originais
drop policy if exists painel_arquivos        on storage.objects;
drop policy if exists app_motorista_sobe     on storage.objects;
drop policy if exists app_motorista_rele     on storage.objects;
drop policy if exists app_motorista_regrava  on storage.objects;

create policy delivery_proofs_insert on storage.objects
  for insert to anon, authenticated with check (bucket_id = 'delivery-proofs');
create policy delivery_proofs_select on storage.objects
  for select to anon, authenticated using (bucket_id = 'delivery-proofs');
create policy delivery_proofs_update on storage.objects
  for update to anon, authenticated
  using (bucket_id = 'delivery-proofs') with check (bucket_id = 'delivery-proofs');

commit;

notify pgrst, 'reload schema';
