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
 * Onde cada token mora. Gestor e admin em localStorage (sobrevive ao F5 e a
 * fechar o navegador, até expirar em 12h — era o comportamento da sessão
 * antiga). Vendedor em sessionStorage: a tela de balcão mostra notas, CNPJs e
 * documentos de recebedor atrás de uma senha compartilhada pela equipe, então
 * fechar o navegador encerra a sessão e ninguém herda a de quem usou antes.
 */
function armazem(perfil: Perfil): Storage | null {
  try { return perfil === 'vendedor' ? sessionStorage : localStorage; }
  catch { return null; }
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
  const a = armazem(perfil);
  if (!a) return null;
  try {
    const t = a.getItem(CHAVE[perfil]);
    // Folga de 1 minuto: melhor pedir senha um pouco antes do que mandar um
    // token que o servidor vai recusar no meio de uma operação.
    if (t && Date.now() < expiraEm(t) - 60_000) return t;
    if (t) a.removeItem(CHAVE[perfil]);
  } catch { /* storage bloqueado: sem sessão, cai no login */ }
  return null;
}

export function sessaoValida(perfil: Perfil): boolean {
  return tokenDe(perfil) !== null;
}

export function encerrarSessao(perfil: Perfil) {
  try { armazem(perfil)?.removeItem(CHAVE[perfil]); } catch { }
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

// ── Login ────────────────────────────────────────────────────────────────────
/**
 * Pede o token ao servidor. Devolve true se entrou. Senha errada é 401 e não
 * grava nada; falha de rede devolve false também — sem servidor não há dado
 * para mostrar, então não existe mais "senha reserva" no navegador.
 */
export async function entrar(perfil: Perfil, senha: string): Promise<boolean> {
  if (!senha) return false;
  const url = import.meta.env.VITE_SUPABASE_URL;
  const chavePublica = import.meta.env.VITE_SUPABASE_ANON_KEY;
  try {
    const res = await fetch(`${url}/rest/v1/rpc/login_painel`, {
      method: 'POST',
      headers: {
        apikey: chavePublica,
        Authorization: `Bearer ${chavePublica}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ perfil, senha }),
    });
    if (!res.ok) return false;
    const { token } = await res.json();
    if (typeof token !== 'string' || expiraEm(token) <= Date.now()) return false;
    armazem(perfil)?.setItem(CHAVE[perfil], token);
    return true;
  } catch (e) {
    console.error('Login indisponível:', e);
    return false;
  }
}
