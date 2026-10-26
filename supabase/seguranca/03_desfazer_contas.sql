-- Desfaz 03_contas_vendedores.sql e volta ao estado de depois do 02 (corte):
-- qualquer token de painel, inclusive a senha compartilhada de vendedor, vê
-- tudo. A tabela vendedor_contas FICA (com as senhas que já foram criadas),
-- para reaplicar o 03 sem obrigar ninguém a criar senha de novo.

begin;

drop policy if exists painel_tudo  on public.invoices;
drop policy if exists vendedor_le  on public.invoices;
create policy painel_tudo on public.invoices for all to authenticated using (true) with check (true);

drop policy if exists painel_tudo on public.delivery_proofs;
drop policy if exists vendedor_le on public.delivery_proofs;
create policy painel_tudo on public.delivery_proofs for all to authenticated using (true) with check (true);

drop policy if exists painel_tudo on public.notifications;
create policy painel_tudo on public.notifications for all to authenticated using (true) with check (true);

drop policy if exists painel_le on public.activity_logs;
create policy "log pode ser lido" on public.activity_logs for select to public using (true);

drop policy if exists painel_tudo on public.zones;
create policy zones_select on public.zones for select to public using (true);
create policy zones_insert on public.zones for insert to public with check (true);
create policy zones_update on public.zones for update to public using (true);
create policy zones_delete on public.zones for delete to public using (true);

drop policy if exists painel_tudo on public.saved_labels;
create policy "Admin full access" on public.saved_labels for all to public using (true) with check (true);

drop policy if exists app_motorista_le      on public.vehicles;
drop policy if exists app_motorista_posicao on public.vehicles;
drop policy if exists painel_tudo           on public.vehicles;
drop policy if exists vendedor_le           on public.vehicles;
alter table public.vehicles disable row level security;

grant insert, select, update on public.etiqueta_expedicao to authenticated;
grant all on public.fotos_a_apagar, public.fotos_a_migrar to authenticated;

drop policy if exists vendedor_arquivos on storage.objects;
drop policy if exists painel_arquivos   on storage.objects;
create policy painel_arquivos on storage.objects
  for all to authenticated
  using (bucket_id = 'delivery-proofs') with check (bucket_id = 'delivery-proofs');

revoke execute on function public.login_vendedor(text, text)   from anon, authenticated;
revoke execute on function public.vendedor_status(text)        from anon, authenticated;

commit;

notify pgrst, 'reload schema';
