/**
 * Sessão dos painéis — gestor, administrador e vendedor.
 *
 * Antes, o login era decidido no navegador: o servidor respondia true/false e o
 * próprio site abria a tela. Quem trocasse o false por true na resposta (Burp)
 * entrava, e os dados vinham pela chave pública, igual para qualquer visitante.
 *
 * Agora quem decide é o servidor: login_painel devolve um TOKEN assinado com o
 * segredo dele, ou HTTP 401 e nada. Esse token vai em toda requisição de dados
 * (ver supabaseClient.ts) e o banco só entrega o que é de painel a quem o
 * apresenta. Adulterar a tela não adianta mais: sem token ela abre vazia.
 *
 * Este módulo não importa o cliente do Supabase de propósito: o cliente é que
 * pergunta aqui qual token usar, e a dependência circular quebraria a carga.
 */

export type Perfil = 'gestor' | 'admin' | 'vendedor';

const CHAVE: Record<Perfil, string> = {
  gestor: 'ec-token-gestor',
  admin: 'ec-token-admin',
  vendedor: 'ec-token-vendedor',
};

/**
 * Onde cada token pode morar. Gestor e admin em localStorage (sobrevive ao F5 e
 * a fechar o navegador, até expirar em 12h). Vendedor em um dos dois: com
 * "manter conectado" vai para localStorage (token de 30 dias, a conta é dele);
 * sem, fica em sessionStorage e some ao fechar o navegador — para computador
 * compartilhado.
 */
function armazens(perfil: Perfil): Storage[] {
  const lista: Storage[] = [];
  try { lista.push(localStorage); } catch { }
  if (perfil === 'vendedor') { try { lista.push(sessionStorage); } catch { } }
  return lista;
}

/** Instante de expiração lido do próprio token — a fonte da verdade é ele. */
function expiraEm(token: string): number {
  try {
    const corpo = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return Number(JSON.parse(atob(corpo)).exp) * 1000;
  } catch {
    return 0;
  }
}

export function tokenDe(perfil: Perfil): string | null {
  for (const a of armazens(perfil)) {
    try {
      const t = a.getItem(CHAVE[perfil]);
      // Folga de 1 minuto: melhor pedir senha um pouco antes do que mandar um
      // token que o servidor vai recusar no meio de uma operação.
      if (t && Date.now() < expiraEm(t) - 60_000) return t;
      if (t) a.removeItem(CHAVE[perfil]);
    } catch { /* storage bloqueado: sem sessão, cai no login */ }
  }
  return null;
}

export function sessaoValida(perfil: Perfil): boolean {
  return tokenDe(perfil) !== null;
}

export function encerrarSessao(perfil: Perfil) {
  for (const a of armazens(perfil)) { try { a.removeItem(CHAVE[perfil]); } catch { } }
}

// ── Perfil em uso ────────────────────────────────────────────────────────────
// O site tem três painéis com senhas diferentes e pode ter mais de um logado no
// mesmo navegador. O token que vai nas requisições é o do painel ABERTO; fora
// de painel (tela inicial, app do motorista) não vai token nenhum.
let perfilEmUso: Perfil | null = null;

export function usarPerfil(perfil: Perfil | null) {
  perfilEmUso = perfil;
}

export function tokenEmUso(): string | null {
  return perfilEmUso ? tokenDe(perfilEmUso) : null;
}

// ── Expiração no meio do uso ─────────────────────────────────────────────────
// O servidor recusou o token (expirou, ou o segredo mudou). Apaga e avisa o App,
// que devolve para a tela de login em vez de deixar o painel vazio sem motivo.
export const EVENTO_SESSAO_EXPIRADA = 'ec-sessao-expirada';

export function avisarSessaoRecusada() {
  if (!perfilEmUso) return;
  encerrarSessao(perfilEmUso);
  window.dispatchEvent(new CustomEvent(EVENTO_SESSAO_EXPIRADA, { detail: perfilEmUso }));
}

// ── Chamada às funções de login do servidor ─────────────────────────────────
// Vai com a chave pública, sem token de painel: quem chama ainda não entrou.
async function chamarLogin(funcao: string, corpo: object): Promise<Response> {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const chavePublica = import.meta.env.VITE_SUPABASE_ANON_KEY;
  return fetch(`${url}/rest/v1/rpc/${funcao}`, {
    method: 'POST',
    headers: {
      apikey: chavePublica,
      Authorization: `Bearer ${chavePublica}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(corpo),
  });
}

/**
 * Grava o token. `duradouro` = localStorage (sobrevive a fechar o navegador);
 * senão sessionStorage, quando o perfil permite. Limpa o outro lugar antes, para
 * nunca sobrar um token velho competindo com o novo.
 */
function guardarToken(perfil: Perfil, token: unknown, duradouro = true): boolean {
  if (typeof token !== 'string' || expiraEm(token) <= Date.now()) return false;
  encerrarSessao(perfil);
  const [local, sessao] = armazens(perfil);
  try { ((duradouro || !sessao) ? local : sessao)?.setItem(CHAVE[perfil], token); }
  catch { return false; }
  return true;
}

// ── Login ────────────────────────────────────────────────────────────────────
/**
 * Pede o token ao servidor. Devolve true se entrou. Senha errada é 401 e não
 * grava nada; falha de rede devolve false também — sem servidor não há dado
 * para mostrar, então não existe mais "senha reserva" no navegador.
 */
export async function entrar(perfil: Perfil, senha: string): Promise<boolean> {
  if (!senha) return false;
  try {
    const res = await chamarLogin('login_painel', { perfil, senha });
    if (!res.ok) return false;
    const { token } = await res.json();
    return guardarToken(perfil, token);
  } catch (e) {
    console.error('Login indisponível:', e);
    return false;
  }
}

// ── Vendedor com conta própria ──────────────────────────────────────────────
// Cada vendedor tem usuário e senha, e o BANCO só devolve as notas dele (ver
// supabase/seguranca/03_contas_vendedores.sql). Conta nova, ou zerada pelo
// admin, ainda não tem senha: a primeira que o vendedor digitar vira a dele.

export type StatusVendedor = 'primeiro_acesso' | 'ativa' | 'inexistente';

/** Pergunta antes do login se a conta espera a primeira senha. null = sem rede. */
export async function statusVendedor(usuario: string): Promise<StatusVendedor | null> {
  try {
    const res = await chamarLogin('vendedor_status', { usuario });
    if (!res.ok) return null;
    return (await res.json()) as StatusVendedor;
  } catch {
    return null;
  }
}

/**
 * Entra como vendedor — ou, se a conta ainda não tem senha, cria a senha e
 * entra. Devolve null se deu certo, ou a mensagem para mostrar na tela.
 */
// Lembrar usuário e senha fica com o gerenciador de senhas do navegador (os
// campos do login estão marcados para ele). A sessão em si dura até fechar o
// navegador; o servidor ainda aceita `lembrar` (token de 30 dias), sem uso hoje.
export async function entrarVendedor(usuario: string, senha: string): Promise<string | null> {
  try {
    const res = await chamarLogin('login_vendedor', { usuario, senha });
    if (res.status === 401) return 'Usuário ou senha incorretos.';
    if (!res.ok) {
      // 400 = senha nova fraca demais; o servidor diz o porquê.
      const corpo = await res.json().catch(() => ({}));
      return corpo?.message || 'Não foi possível entrar. Tente de novo.';
    }
    const { token } = await res.json();
    return guardarToken('vendedor', token, false) ? null : 'Não foi possível entrar. Tente de novo.';
  } catch {
    return 'Sem conexão com o servidor.';
  }
}

/**
 * Quem está logado na tela do vendedor, lido do próprio token. Sem usuário =
 * senha compartilhada antiga (vê tudo, só durante a transição).
 */
export function vendedorLogado(): { usuario: string | null; nome: string | null; veTudo: boolean } | null {
  const t = tokenDe('vendedor');
  if (!t) return null;
  try {
    const c = JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return { usuario: c.usuario ?? null, nome: c.nome ?? null, veTudo: c.usuario ? Boolean(c.ve_tudo) : true };
  } catch {
    return null;
  }
}
