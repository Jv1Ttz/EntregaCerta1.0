-- ============================================================================
-- "Manter conectado" na tela do vendedor.
--
-- Com conta individual (e não mais a senha compartilhada do balcão), faz
-- sentido o vendedor não precisar entrar toda vez: login_vendedor passa a
-- aceitar `lembrar`, que estica o token de 12h para 30 dias.
--
-- Token longo só é aceitável porque continua revogável no servidor:
--   • desativar a conta corta na hora (vendedor_pode_ver lê a tabela);
--   • NOVO: zerar ou trocar a senha derruba as sessões abertas. O token leva o
--     instante em que a senha foi definida (claim senha_em) e a policy só
--     aceita se ainda for o mesmo.
-- Tokens emitidos antes disto não têm senha_em: o vendedor entra de novo uma
-- vez e pronto.
-- ============================================================================

begin;

drop function if exists public.login_vendedor(text, text);

create or replace function public.login_vendedor(usuario text, senha text, lembrar boolean default false)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  conta   public.vendedor_contas;
  segredo text;
  agora   bigint;
begin
  select * into conta from vendedor_contas c
   where c.usuario = lower(trim(login_vendedor.usuario)) and c.ativo;

  if conta.usuario is null or senha is null or senha = '' then
    perform pg_sleep(0.5);
    raise sqlstate 'PT401' using message = 'Usuário ou senha inválidos';
  end if;

  if conta.senha_hash is null then
    if length(senha) < 8 or lower(senha) = conta.usuario then
      raise sqlstate 'PT400' using message = 'A senha precisa ter pelo menos 8 caracteres e não pode ser o usuário';
    end if;
    update vendedor_contas
       set senha_hash = crypt(senha, gen_salt('bf')), senha_definida_em = now()
     where vendedor_contas.usuario = conta.usuario
    returning * into conta;
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
      'role',     'authenticated',
      'perfil',   'vendedor',
      'usuario',  conta.usuario,
      'nome',     conta.nome,
      've_tudo',  conta.ve_tudo,
      'senha_em', floor(extract(epoch from conta.senha_definida_em))::bigint::text,
      'iss',      'entregacerta',
      'iat',      agora,
      'exp',      agora + case when lembrar then 30 * 86400 else 12 * 3600 end
    ), segredo),
    'nome', conta.nome,
    've_tudo', conta.ve_tudo
  );
end;
$$;

revoke all on function public.login_vendedor(text, text, boolean) from public;
grant execute on function public.login_vendedor(text, text, boolean) to anon, authenticated;

-- Mesma regra de antes + a senha do token tem que ser a senha atual da conta.
create or replace function public.vendedor_pode_ver(nome_vendedor text)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select case
    when public.jwt_claim('perfil') is distinct from 'vendedor' then false
    when public.jwt_claim('usuario') is null then true   -- senha compartilhada antiga (transição)
    else exists (
      select 1 from public.vendedor_contas c
       where c.usuario = public.jwt_claim('usuario')
         and c.ativo
         and c.senha_definida_em is not null
         and public.jwt_claim('senha_em') = floor(extract(epoch from c.senha_definida_em))::bigint::text
         and (c.ve_tudo or upper(trim(coalesce(nome_vendedor, ''))) = any (c.nomes_nf))
    )
  end
$$;

commit;

notify pgrst, 'reload schema';
