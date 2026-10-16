-- ============================================================================
-- Fase A, passo 1 de 2 — SÓ ACRESCENTA. Nada que funciona hoje deixa de
-- funcionar depois disto; pode ir ao ar em horário de operação.
--
-- O problema que a Fase A resolve: o login dos painéis era decidido pelo
-- navegador. A função devolvia true/false e o próprio site abria a tela — trocar
-- o false por true (Burp) abria o painel, e os dados vinham pela chave pública,
-- que é a mesma para qualquer visitante. O servidor nunca soube se houve login.
--
-- Agora o login emite um TOKEN assinado com o segredo do servidor. O PostgREST
-- confere a assinatura em toda requisição, sem código nosso no meio; quem não
-- tem token continua sendo "anon", e o passo 2 decide o que anon enxerga.
-- ============================================================================

-- ── Login dos painéis ───────────────────────────────────────────────────────
-- Mesmo hash bcrypt do verificar_senha (tabela app_credenciais, ilegível pela
-- API). Senha errada devolve HTTP 401 — PT401 é o jeito do PostgREST de definir
-- o status — e NENHUM token: não há corpo para adulterar.
create or replace function public.login_painel(perfil text, senha text)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  guardado text;
  segredo  text;
  agora    bigint;
  expira   bigint;
begin
  if perfil is null or perfil not in ('gestor', 'admin', 'vendedor')
     or senha is null or senha = '' then
    raise sqlstate 'PT401' using message = 'Senha inválida';
  end if;

  select hash into guardado from app_credenciais where chave = perfil;
  if guardado is null or guardado <> crypt(senha, guardado) then
    -- Freio barato contra tentativa em massa: cada erro custa meio segundo.
    perform pg_sleep(0.5);
    raise sqlstate 'PT401' using message = 'Senha inválida';
  end if;

  -- O PostgREST injeta o segredo em toda requisição (PGRST_APP_SETTINGS_JWT_SECRET).
  -- Fora dele — psql direto — não existe, e aí é melhor falhar do que assinar errado.
  segredo := current_setting('app.settings.jwt_secret', true);
  if segredo is null or segredo = '' then
    raise exception 'segredo de assinatura indisponível';
  end if;

  agora  := extract(epoch from now())::bigint;
  expira := agora + 12 * 3600;   -- mesma duração da sessão que o site já usava

  return json_build_object(
    'token', sign(
      json_build_object(
        'role',   'authenticated',
        'perfil', perfil,
        'iss',    'entregacerta',
        'iat',    agora,
        'exp',    expira
      ),
      segredo
    ),
    'expira_em', expira
  );
end;
$$;

revoke all on function public.login_painel(text, text) from public;
grant execute on function public.login_painel(text, text) to anon, authenticated;

-- ── Papéis dos robôs ────────────────────────────────────────────────────────
-- Quem não é pessoa recebe um papel próprio e o MÍNIMO que precisa, não o
-- "authenticated" dos painéis: se o token do PC do escritório vazar, ele só lê
-- etiquetas; se o do Apps Script vazar, ele só mexe em notas. E revogar é
-- tirar o grant do papel, sem trocar o segredo e derrubar todo mundo.
do $$
begin
  if not exists (select from pg_roles where rolname = 'agente_impressao') then
    create role agente_impressao nologin;
  end if;
  if not exists (select from pg_roles where rolname = 'ingestao') then
    create role ingestao nologin;
  end if;
end $$;

grant agente_impressao to authenticator;
grant ingestao         to authenticator;
grant usage on schema public to agente_impressao, ingestao;

-- Agente de impressão e vigia: só a view da etiqueta. A view é do postgres
-- (BYPASSRLS) e não é security_invoker, então lê as tabelas por conta própria —
-- o agente não precisa de grant nas tabelas de baixo.
grant select on public.etiqueta_expedicao to agente_impressao;

-- Ingestão por e-mail (Apps Script): procura a nota pela chave, cria, e
-- completa PDF/XML/vendedor de nota que já existe. Nada além de invoices.
grant select, insert, update on public.invoices to ingestao;

-- Emissão de token para os robôs. Só o postgres executa (psql no servidor),
-- recebendo o segredo como parâmetro porque fora do PostgREST ele não existe
-- em app.settings. O token sai direto para o arquivo de destino, nunca na tela.
create or replace function public.emitir_token_servico(papel text, segredo text, dias int default 730)
returns text
language plpgsql
set search_path = public, extensions
as $$
begin
  if papel not in ('agente_impressao', 'ingestao') then
    raise exception 'papel desconhecido: %', papel;
  end if;
  return sign(
    json_build_object(
      'role', papel,
      'iss',  'entregacerta',
      'iat',  extract(epoch from now())::bigint,
      'exp',  extract(epoch from now() + make_interval(days => dias))::bigint
    ),
    segredo
  );
end;
$$;

revoke all on function public.emitir_token_servico(text, text, int) from public, anon, authenticated;

notify pgrst, 'reload schema';
