import { createClient } from '@supabase/supabase-js';
import { tokenEmUso, avisarSessaoRecusada } from './sessao';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseKey, {
  // Painel aberto → token do login daquele painel; fora dele (tela inicial, app
  // do motorista) → chave pública. O banco decide o que cada um enxerga.
  accessToken: async () => {
    const token = tokenEmUso();
    if (token) return token;
    // Painel aberto mas a sessão venceu enquanto estava na tela: volta para o
    // login em vez de seguir com a chave pública e mostrar um painel vazio.
    avisarSessaoRecusada();
    return supabaseKey;
  },
  global: {
    fetch: async (input, init) => {
      const res = await fetch(input, init);
      // 401 com token de painel = servidor recusou a sessão (expirada ou
      // inválida). Sem isso o painel ficaria vazio sem explicação.
      if (res.status === 401 && tokenEmUso()) avisarSessaoRecusada();
      return res;
    },
  },
});
