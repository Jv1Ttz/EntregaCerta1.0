-- ============================================================================
-- Fase A, passo 2 de 2 — O CORTE. Daqui em diante a chave pública (anon), que
-- vai dentro do site e do APK e que qualquer visitante obtém, deixa de abrir a
-- base inteira.
--
-- PRÉ-REQUISITOS, nesta ordem (senão quebra produção):
--   1. 01_login_e_papeis.sql aplicado
--   2. agente de impressão + vigia mandando o token deles (C:\EntregaCerta)
--   3. Apps Script de ingestão mandando o token dele
--   4. site novo publicado (login emitindo token)
-- Aplicar FORA do horário de entregas. Desfazer: 02_desfazer_corte.sql.
--
-- O LIMITE DESTE CORTE, dito com todas as letras: o APK 1.6, que está nos
-- celulares, não tem login de verdade — ele lê com a chave pública e confere a
-- senha do motorista lendo a coluna drivers.password. Então anon continua
-- precisando enxergar:
--   • as notas ATRIBUÍDAS a motorista que estão em andamento ou fecharam há
--     até 3 dias (o histórico do app fica curto até o 1.7);
--   • todas as colunas dessas notas (o 1.6 pede select=*: negar uma coluna
--     derruba a consulta inteira);
--   • a tabela de motoristas com a senha.
-- O que sai da vista pública: as ~5.000 notas antigas, as notas ainda sem
-- motorista (a chegada de cada NF), os comprovantes antigos, o XML de todas,
-- os logs, e a capacidade de ALTERAR qualquer campo que o motorista não altera.
-- O fechamento completo vem com o APK 1.7 (token por motorista).
-- ============================================================================

begin;

-- ── Higiene: nada disso é usado pela API e anon nunca deveria ter ────────────
revoke truncate, trigger, references on all tables in schema public from anon;

-- ── Tabelas que o app do motorista não usa: só quem tem login ───────────────
revoke all on public.app_credenciais        from anon;
revoke all on public.carga_prefatura_manual from anon;
revoke all on public.foto_migracao_drive    from anon;
revoke all on public.fotos_a_apagar         from anon;
revoke all on public.fotos_a_migrar         from anon;
revoke all on public.saved_labels           from anon;
revoke all on public.zones                  from anon;
revoke all on public.etiqueta_expedicao     from anon;

-- ── Log de atividades: o motorista grava (baixa, devolução), nunca lê ───────
revoke select, update on public.activity_logs from anon;

-- ── Notas ───────────────────────────────────────────────────────────────────
alter table public.invoices enable row level security;

create policy painel_tudo on public.invoices
  for all to authenticated using (true) with check (true);

create policy ingestao_le       on public.invoices for select to ingestao using (true);
create policy ingestao_cria     on public.invoices for insert to ingestao with check (true);
create policy ingestao_completa on public.invoices for update to ingestao using (true) with check (true);

-- O que o APK 1.6 precisa ver. "3 dias" cobre a tela de rota e o fechamento do
-- dia (finishRoute busca as entregues de hoje) com folga para um fim de semana.
create policy app_motorista_le on public.invoices
  for select to anon
  using (
    driver_id is not null
    and deleted_at is null
    and (status in ('PENDING', 'IN_PROGRESS')
         or coalesce(delivered_at, created_at) > now() - interval '3 days')
  );

create policy app_motorista_baixa on public.invoices
  for update to anon
  using (
    driver_id is not null
    and deleted_at is null
    and (status in ('PENDING', 'IN_PROGRESS')
         or coalesce(delivered_at, created_at) > now() - interval '3 days')
  )
  with check (driver_id is not null);

-- Motorista não cria nota, e só altera o que a baixa altera (levantado no
-- código do 1.6: saveProof, markNotDelivered, startRoute, finishRoute,
-- updateInvoiceStatus). Endereço, valor, cliente, PDF: fora de alcance.
revoke insert, update on public.invoices from anon;
grant update (status, delivered_at, return_value, last_failure_reason, route_id)
  on public.invoices to anon;

-- ── Comprovantes de entrega (nome e documento de quem recebeu, assinatura) ──
alter table public.delivery_proofs enable row level security;

create policy painel_tudo on public.delivery_proofs
  for all to authenticated using (true) with check (true);

-- Só o comprovante de nota que o motorista ainda enxerga. A subconsulta roda
-- como anon, então herda o mesmo recorte da policy de invoices.
create policy app_motorista on public.delivery_proofs
  for all to anon
  using (exists (select 1 from public.invoices i where i.id = invoice_id))
  with check (exists (select 1 from public.invoices i where i.id = invoice_id));

-- ── Notificações: motorista lê as suas e avisa o gestor ─────────────────────
alter table public.notifications enable row level security;

create policy painel_tudo on public.notifications
  for all to authenticated using (true) with check (true);

-- Só as NÃO LIDAS: é o que o app busca (consumeNotifications). Sem isso a
-- chave pública leria as ~6 mil notificações antigas de todos os motoristas.
create policy app_motorista_le on public.notifications
  for select to anon using (recipient_id like 'd-%' and read = false);
create policy app_motorista_marca_lida on public.notifications
  for update to anon using (recipient_id like 'd-%' and read = false) with check (recipient_id like 'd-%');
create policy app_motorista_avisa on public.notifications
  for insert to anon with check (true);

revoke update on public.notifications from anon;
grant update (read) on public.notifications to anon;

-- ── Motoristas e veículos: só a localização e o início de rota ──────────────
-- SELECT continua aberto em drivers porque o 1.6 confere a senha no aparelho.
revoke insert, delete, update on public.drivers from anon;
grant update (last_location, updated_at, route_started_at) on public.drivers to anon;

revoke insert, delete, update on public.vehicles from anon;
grant update (last_location) on public.vehicles to anon;

-- ── Funções que anon não tem por que chamar ─────────────────────────────────
revoke execute on function public.excluir_nota_definitivo(text, text) from anon, public;
revoke execute on function public.delete_old_activity_logs              from anon, public;

-- ── Arquivos: fotos de canhoto, assinaturas e XMLs ──────────────────────────
-- Antes, anon listava e abria o bucket inteiro. Agora: sobe foto nova, e só
-- relê o que subiu há pouco (o upload com upsert precisa ler). XML de nota
-- nunca, e nada antigo.
drop policy if exists delivery_proofs_insert on storage.objects;
drop policy if exists delivery_proofs_select on storage.objects;
drop policy if exists delivery_proofs_update on storage.objects;

create policy painel_arquivos on storage.objects
  for all to authenticated
  using (bucket_id = 'delivery-proofs') with check (bucket_id = 'delivery-proofs');

create policy app_motorista_sobe on storage.objects
  for insert to anon
  with check (bucket_id = 'delivery-proofs' and name not like 'xml-notas/%');

create policy app_motorista_rele on storage.objects
  for select to anon
  using (bucket_id = 'delivery-proofs' and name not like 'xml-notas/%'
         and created_at > now() - interval '3 days');

create policy app_motorista_regrava on storage.objects
  for update to anon
  using (bucket_id = 'delivery-proofs' and name not like 'xml-notas/%'
         and created_at > now() - interval '3 days')
  with check (bucket_id = 'delivery-proofs' and name not like 'xml-notas/%');

commit;

notify pgrst, 'reload schema';
