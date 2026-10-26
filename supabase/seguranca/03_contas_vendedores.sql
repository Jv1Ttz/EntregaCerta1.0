-- ============================================================================
-- Contas individuais de vendedor. APLICAR SÓ DEPOIS DO 02_corte_chave_publica:
-- este arquivo refina as policies que o 02 criou para "authenticated".
--
-- Até aqui a tela do vendedor tinha UMA senha compartilhada e mostrava todas
-- as notas. Agora cada vendedor tem usuário e senha próprios e o BANCO só
-- devolve as notas dele — filtrar na tela não serviria, a lição do Burp foi
-- justamente que o que a tela esconde o servidor ainda entrega.
--
-- Quem vê o quê fica numa tabela (vendedor_contas), não no código: dar a
-- alguém acesso às licitações, ou juntar dois nomes numa conta, é editar uma
-- linha. As policies leem a tabela a cada consulta, então desativar uma conta
-- corta o acesso NA HORA, sem esperar o token de 12h expirar.
--
-- O vínculo nota ↔ vendedor é o nome que o ERP escreve nas informações
-- adicionais da NF ("VENDEDOR - REINALDO - ..."), já gravado em
-- invoices.vendedor pela ingestão. Só existe a partir de 19/08/2026: nota
-- anterior não tem vendedor e só aparece para quem vê tudo.
-- ============================================================================

begin;

-- ── Correção de dado: "E-commerce" foi gravado como "E" ─────────────────────
-- A extração antiga parava no primeiro hífen. Corrige as notas já gravadas;
-- a ingestão é corrigida à parte (Apps Script).
update public.invoices
   set vendedor = 'E-commerce'
 where vendedor = 'E'
   and obs_nf ilike '%VENDEDOR - E-commerce%';

-- ── Contas ──────────────────────────────────────────────────────────────────
create table if not exists public.vendedor_contas (
  usuario           text primary key check (usuario = lower(usuario) and usuario ~ '^[a-z0-9._-]{2,30}$'),
  nome              text not null,
  ve_tudo           boolean not null default false,
  -- Nomes como o ERP escreve na NF, em MAIÚSCULAS. A comparação ignora caixa.
  nomes_nf          text[] not null default '{}',
  -- NULL = conta nova ou zerada: a primeira senha digitada vira a senha dela.
  -- A empresa controla quando liberar (cria a conta, ou zera, na hora de usar).
  senha_hash        text,
  ativo             boolean not null default true,
  criado_em         timestamptz not null default now(),
  senha_definida_em timestamptz
);

-- Ilegível pela API: nem anon nem painel leem hashes ou a lista de contas.
alter table public.vendedor_contas enable row level security;
revoke all on public.vendedor_contas from anon, authenticated, public;

insert into public.vendedor_contas (usuario, nome, ve_tudo, nomes_nf) values
  ('iuri',      'Iuri Oliveira de Jesus',      true,  '{IURI OLIVEIRA DE JESUS}'),
  ('jefferson', 'Jefferson Silva',             true,  '{JEFFERSON SILVA}'),
  ('jomar',     'Jomar',                       false, '{JOMAR,LICITACOES}'),
  ('reinaldo',  'Reinaldo',                    false, '{REINALDO}'),
  ('jumaria',   'Jumaria de Jesus Souza',      false, '{JUMARIA DE JESUS SOUZA}'),
  ('amaral',    'Amaral',                      false, '{AMARAL}'),
  ('guilherme', 'Guilherme',                   false, '{GUILHERME}'),
  ('elaine',    'Elaine',                      false, '{ELAINE}'),
  ('emerson',   'Emerson',                     false, '{EMERSON}'),
  ('tiago',     'Tiago Santos Nepomuceno',     false, '{TIAGO SANTOS NEPOMUCENO}'),
  ('carla',     'Carla Gomes',                 false, '{CARLA GOMES}'),
  ('clemison',  'Clemison',                    false, '{CLEMISON}'),
  ('premium',   'Premium Representações',      false, '{PREMIUM REPRESENTACOES LTDA}')
on conflict (usuario) do nothing;

-- ── Quem está pedindo ───────────────────────────────────────────────────────
-- O PostgREST põe as claims do token em request.jwt.claims a cada requisição.
create or replace function public.jwt_claim(chave text)
returns text language sql stable as $$
  select nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> chave
$$;

create or replace function public.eh_painel()
returns boolean language sql stable as $$
  select coalesce(public.jwt_claim('perfil') in ('gestor', 'admin'), false)
$$;

-- Security definer porque lê vendedor_contas, que é fechada para a API.
create or replace function public.vendedor_pode_ver(nome_vendedor text)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select case
    when public.jwt_claim('perfil') is distinct from 'vendedor' then false
    -- Senha compartilhada antiga (login_painel, sem usuário): vê tudo, como
    -- sempre viu. Só durante a transição — desligar = apagar a credencial
    -- 'vendedor' de app_credenciais.
    when public.jwt_claim('usuario') is null then true
    else exists (
      select 1 from public.vendedor_contas c
       where c.usuario = public.jwt_claim('usuario')
         and c.ativo
         and (c.ve_tudo or upper(trim(coalesce(nome_vendedor, ''))) = any (c.nomes_nf))
    )
  end
$$;

-- ── Login do vendedor ───────────────────────────────────────────────────────
-- A tela pergunta antes se a conta está esperando a primeira senha, para
-- mostrar "crie sua senha" (com confirmação) em vez de "digite sua senha".
create or replace function public.vendedor_status(usuario text)
returns text
language sql stable security definer
set search_path = public
as $$
  select case
    when c.usuario is null or not c.ativo then 'inexistente'
    when c.senha_hash is null then 'primeiro_acesso'
    else 'ativa'
  end
  from (select 1) _ left join public.vendedor_contas c on c.usuario = lower(trim(vendedor_status.usuario))
$$;

create or replace function public.login_vendedor(usuario text, senha text)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  conta  public.vendedor_contas;
  segredo text;
  agora  bigint;
begin
  select * into conta from vendedor_contas c
   where c.usuario = lower(trim(login_vendedor.usuario)) and c.ativo;

  if conta.usuario is null or senha is null or senha = '' then
    perform pg_sleep(0.5);
    raise sqlstate 'PT401' using message = 'Usuário ou senha inválidos';
  end if;

  if conta.senha_hash is null then
    -- Primeiro acesso: a senha digitada vira a senha da conta.
    if length(senha) < 8 or lower(senha) = conta.usuario then
      raise sqlstate 'PT400' using message = 'A senha precisa ter pelo menos 8 caracteres e não pode ser o usuário';
    end if;
    update vendedor_contas
       set senha_hash = crypt(senha, gen_salt('bf')), senha_definida_em = now()
     where vendedor_contas.usuario = conta.usuario;
  elsif conta.senha_hash <> crypt(senha, conta.senha_hash) then
    perform pg_sleep(0.5);
    raise sqlstate 'PT401' using message = 'Usuário ou senha inválidos';
  end if;

  segredo := current_setting('app.settings.jwt_secret', true);
  if segredo is null or segredo = '' then
    raise exception 'segredo de assinatura indisponível';
  end if;
  agora := extract(epoch from now())::bigint;

  return json_build_object(
    'token', sign(json_build_object(
      'role',    'authenticated',
      'perfil',  'vendedor',
      'usuario', conta.usuario,
      'nome',    conta.nome,
      've_tudo', conta.ve_tudo,
      'iss',     'entregacerta',
      'iat',     agora,
      'exp',     agora + 12 * 3600
    ), segredo),
    'nome', conta.nome,
    've_tudo', conta.ve_tudo
  );
end;
$$;

revoke all on function public.vendedor_status(text)        from public;
revoke all on function public.login_vendedor(text, text)   from public;
grant execute on function public.vendedor_status(text)      to anon, authenticated;
grant execute on function public.login_vendedor(text, text) to anon, authenticated;

-- ── Administração das contas (só o perfil admin) ────────────────────────────
create or replace function public.vendedor_zerar_senha(usuario text)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if public.jwt_claim('perfil') is distinct from 'admin' then
    raise sqlstate 'PT403' using message = 'Só o Administrador';
  end if;
  update vendedor_contas set senha_hash = null, senha_definida_em = null
   where vendedor_contas.usuario = lower(trim(vendedor_zerar_senha.usuario));
end;
$$;

create or replace function public.vendedor_ativar(usuario text, ativo boolean)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if public.jwt_claim('perfil') is distinct from 'admin' then
    raise sqlstate 'PT403' using message = 'Só o Administrador';
  end if;
  update vendedor_contas set ativo = vendedor_ativar.ativo
   where vendedor_contas.usuario = lower(trim(vendedor_ativar.usuario));
end;
$$;

revoke all on function public.vendedor_zerar_senha(text)       from public, anon;
revoke all on function public.vendedor_ativar(text, boolean)   from public, anon;
grant execute on function public.vendedor_zerar_senha(text)     to authenticated;
grant execute on function public.vendedor_ativar(text, boolean) to authenticated;

-- ── Policies: o token "authenticated" deixa de ser tudo-ou-nada ─────────────
-- O 02 deu acesso total a qualquer token de painel. Agora: gestor e admin
-- continuam com tudo; vendedor só LÊ, e só o que é dele.

-- Notas
drop policy if exists painel_tudo on public.invoices;
create policy painel_tudo on public.invoices
  for all to authenticated using (public.eh_painel()) with check (public.eh_painel());
create policy vendedor_le on public.invoices
  for select to authenticated using (public.vendedor_pode_ver(vendedor));

-- Comprovantes: os das notas que ele vê (a subconsulta herda o recorte acima)
drop policy if exists painel_tudo on public.delivery_proofs;
create policy painel_tudo on public.delivery_proofs
  for all to authenticated using (public.eh_painel()) with check (public.eh_painel());
create policy vendedor_le on public.delivery_proofs
  for select to authenticated
  using (exists (select 1 from public.invoices i where i.id = invoice_id));

-- Notificações, log, zonas, etiquetas salvas: assunto do painel
drop policy if exists painel_tudo on public.notifications;
create policy painel_tudo on public.notifications
  for all to authenticated using (public.eh_painel()) with check (public.eh_painel());

drop policy if exists "log pode ser lido" on public.activity_logs;
create policy painel_le on public.activity_logs
  for select to authenticated using (public.eh_painel());

drop policy if exists zones_select on public.zones;
drop policy if exists zones_insert on public.zones;
drop policy if exists zones_update on public.zones;
drop policy if exists zones_delete on public.zones;
create policy painel_tudo on public.zones
  for all to authenticated using (public.eh_painel()) with check (public.eh_painel());

drop policy if exists "Admin full access" on public.saved_labels;
create policy painel_tudo on public.saved_labels
  for all to authenticated using (public.eh_painel()) with check (public.eh_painel());

-- Veículos (aba Frota): o vendedor vê os que levaram ou levam nota dele —
-- assim a placa continua aparecendo no histórico das notas, e a tela mostra
-- no mapa só os que estão em rota com nota dele. O APK 1.6 (anon) segue lendo
-- todos e gravando a posição, como antes.
alter table public.vehicles enable row level security;
create policy app_motorista_le on public.vehicles for select to anon using (true);
create policy app_motorista_posicao on public.vehicles for update to anon using (true) with check (true);
create policy painel_tudo on public.vehicles
  for all to authenticated using (public.eh_painel()) with check (public.eh_painel());
create policy vendedor_le on public.vehicles
  for select to authenticated
  using (exists (select 1 from public.invoices i where i.vehicle_id = vehicles.id));

-- Views passam por cima de RLS (dono postgres). O site não usa nenhuma; só o
-- agente de impressão lê a dele, com papel próprio.
revoke all on public.etiqueta_expedicao, public.fotos_a_apagar, public.fotos_a_migrar
  from authenticated;

-- Arquivos: painel tudo; vendedor só lê fotos/assinatura/XML de nota que vê.
-- Caminhos: "<id da nota>/<tipo>.ext" e "xml-notas/<id da nota>.xml".
drop policy if exists painel_arquivos on storage.objects;
create policy painel_arquivos on storage.objects
  for all to authenticated
  using (bucket_id = 'delivery-proofs' and public.eh_painel())
  with check (bucket_id = 'delivery-proofs' and public.eh_painel());
create policy vendedor_arquivos on storage.objects
  for select to authenticated
  using (
    bucket_id = 'delivery-proofs'
    and exists (
      select 1 from public.invoices i
       where i.id = case when name like 'xml-notas/%'
                         then regexp_replace(split_part(name, '/', 2), '\.xml$', '')
                         else split_part(name, '/', 1) end
    )
  );

commit;

notify pgrst, 'reload schema';
