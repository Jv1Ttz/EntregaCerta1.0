-- Desfaz 03s_contas_sem_corte.sql e devolve o acesso exatamente como estava
-- antes dele (levantado em 16/10/2026). A tabela vendedor_contas FICA, com as
-- senhas já criadas, para reaplicar sem obrigar ninguém a criar senha de novo.

begin;

drop policy if exists anon_como_antes   on public.invoices;
drop policy if exists ingestao_le       on public.invoices;
drop policy if exists ingestao_cria     on public.invoices;
drop policy if exists ingestao_completa on public.invoices;
drop policy if exists painel_tudo       on public.invoices;
drop policy if exists vendedor_le       on public.invoices;
alter table public.invoices disable row level security;

drop policy if exists anon_como_antes on public.delivery_proofs;
drop policy if exists painel_tudo     on public.delivery_proofs;
drop policy if exists vendedor_le     on public.delivery_proofs;
alter table public.delivery_proofs disable row level security;

drop policy if exists anon_como_antes on public.notifications;
drop policy if exists painel_tudo     on public.notifications;
alter table public.notifications disable row level security;

drop policy if exists anon_le   on public.activity_logs;
drop policy if exists painel_le on public.activity_logs;
create policy "log pode ser lido" on public.activity_logs for select to public using (true);

drop policy if exists anon_como_antes on public.zones;
drop policy if exists painel_tudo     on public.zones;
create policy zones_select on public.zones for select to public using (true);
create policy zones_insert on public.zones for insert to public with check (true);
create policy zones_update on public.zones for update to public using (true);
create policy zones_delete on public.zones for delete to public using (true);

drop policy if exists anon_como_antes on public.saved_labels;
drop policy if exists painel_tudo     on public.saved_labels;
create policy "Admin full access" on public.saved_labels for all to public using (true) with check (true);

drop policy if exists anon_como_antes on public.vehicles;
drop policy if exists painel_tudo     on public.vehicles;
drop policy if exists vendedor_le     on public.vehicles;
alter table public.vehicles disable row level security;

grant insert, select, update, references, trigger, truncate on public.etiqueta_expedicao to authenticated;
grant all on public.fotos_a_apagar, public.fotos_a_migrar to authenticated;

drop policy if exists painel_arquivos        on storage.objects;
drop policy if exists vendedor_arquivos      on storage.objects;
drop policy if exists delivery_proofs_insert on storage.objects;
drop policy if exists delivery_proofs_select on storage.objects;
drop policy if exists delivery_proofs_update on storage.objects;
create policy delivery_proofs_insert on storage.objects
  for insert to anon, authenticated with check (bucket_id = 'delivery-proofs');
create policy delivery_proofs_select on storage.objects
  for select to anon, authenticated using (bucket_id = 'delivery-proofs');
create policy delivery_proofs_update on storage.objects
  for update to anon, authenticated
  using (bucket_id = 'delivery-proofs') with check (bucket_id = 'delivery-proofs');

revoke execute on function public.login_vendedor(text, text) from anon, authenticated;
revoke execute on function public.vendedor_status(text)      from anon, authenticated;

commit;

notify pgrst, 'reload schema';
