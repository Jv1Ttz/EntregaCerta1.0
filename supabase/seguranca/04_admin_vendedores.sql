-- ============================================================================
-- Gestão das contas de vendedor pela tela do Administrador.
--
-- Completa vendedor_ativar e vendedor_zerar_senha (03/03s) com listar e
-- cadastrar/editar. Tudo exige token de ADMIN — conferido aqui, no servidor:
-- esconder o botão na tela não protegeria nada.
--
-- vendedor_contas segue ilegível pela API; a lista sai por esta função, sem
-- hash de senha (só se a conta já tem senha ou não).
-- ============================================================================

begin;

create or replace function public.vendedor_listar()
returns table (
  usuario           text,
  nome              text,
  ve_tudo           boolean,
  nomes_nf          text[],
  ativo             boolean,
  tem_senha         boolean,
  senha_definida_em timestamptz,
  notas             bigint
)
language plpgsql stable security definer
set search_path = public
as $$
begin
  if public.jwt_claim('perfil') is distinct from 'admin' then
    raise sqlstate 'PT403' using message = 'Só o Administrador';
  end if;
  return query
    select c.usuario, c.nome, c.ve_tudo, c.nomes_nf, c.ativo,
           c.senha_hash is not null, c.senha_definida_em,
           -- Quantas notas a conta enxerga hoje: ajuda a notar um nome digitado
           -- diferente do que o ERP escreve (a conta fica com 0 notas).
           (select count(*) from invoices i
             where i.deleted_at is null
               and (c.ve_tudo or upper(trim(coalesce(i.vendedor, ''))) = any (c.nomes_nf)))
      from vendedor_contas c
     order by c.ativo desc, c.nome;
end;
$$;

-- Cria ou edita. Nunca mexe na senha nem no "ativo" de conta existente — isso
-- tem botão próprio. Conta NOVA nasce desativada: o admin ativa na hora de
-- entregar o acesso, porque até o vendedor criar a senha qualquer um que saiba
-- o usuário poderia criá-la por ele.
create or replace function public.vendedor_salvar(usuario text, nome text, ve_tudo boolean, nomes_nf text[])
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  u text := lower(trim(vendedor_salvar.usuario));
  nomes text[];
begin
  if public.jwt_claim('perfil') is distinct from 'admin' then
    raise sqlstate 'PT403' using message = 'Só o Administrador';
  end if;
  if u !~ '^[a-z0-9._-]{2,30}$' then
    raise sqlstate 'PT400' using message = 'Usuário: só letras minúsculas, números, ponto, traço ou sublinhado (2 a 30)';
  end if;
  if coalesce(trim(vendedor_salvar.nome), '') = '' then
    raise sqlstate 'PT400' using message = 'Informe o nome';
  end if;

  -- Normaliza como a comparação das policies: maiúsculas, sem espaço sobrando,
  -- sem vazios nem repetidos.
  select coalesce(array_agg(distinct x), '{}') into nomes
    from (select upper(regexp_replace(trim(n), '\s+', ' ', 'g')) x
            from unnest(coalesce(vendedor_salvar.nomes_nf, '{}')) n) t
   where x <> '';

  if not vendedor_salvar.ve_tudo and cardinality(nomes) = 0 then
    raise sqlstate 'PT400' using message = 'Informe ao menos um nome como aparece na NF, ou marque "vê todas"';
  end if;

  insert into vendedor_contas (usuario, nome, ve_tudo, nomes_nf, ativo)
  values (u, trim(vendedor_salvar.nome), vendedor_salvar.ve_tudo, nomes, false)
  on conflict on constraint vendedor_contas_pkey do update
     set nome = excluded.nome, ve_tudo = excluded.ve_tudo, nomes_nf = excluded.nomes_nf;
end;
$$;

revoke all on function public.vendedor_listar()                                 from public, anon;
revoke all on function public.vendedor_salvar(text, text, boolean, text[])      from public, anon;
grant execute on function public.vendedor_listar()                               to authenticated;
grant execute on function public.vendedor_salvar(text, text, boolean, text[])    to authenticated;

commit;

notify pgrst, 'reload schema';
