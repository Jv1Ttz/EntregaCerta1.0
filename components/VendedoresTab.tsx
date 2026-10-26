import React, { useEffect, useState } from 'react';
import { db } from '../services/db';
import type { ContaVendedor } from '../types';
import { AlertCircle, Loader2, UserPlus, Pencil, Power, KeyRound, X } from 'lucide-react';

/**
 * Aba "Vendedores" da tela do Administrador: cria, edita, ativa/desativa e
 * zera a senha das contas de vendedor.
 *
 * Quem decide o que cada conta vê é o servidor (vendedor_contas + policies);
 * esta tela só edita a tabela, e cada função confere no servidor se o token é
 * de admin. Senha nenhuma passa por aqui: conta nova ou zerada fica
 * "aguardando 1ª senha", e o próprio vendedor cria a dele no primeiro acesso.
 */

type Formulario = { usuario: string; nome: string; ve_tudo: boolean; nomes: string; editando: boolean };
const VAZIO: Formulario = { usuario: '', nome: '', ve_tudo: false, nomes: '', editando: false };

const dataCurta = (iso?: string | null) => {
  if (!iso) return '';
  try { return new Date(iso).toLocaleDateString('pt-BR'); } catch { return ''; }
};

const mensagemDe = (e: any) => e?.message || 'Não foi possível salvar.';

export const VendedoresTab: React.FC = () => {
  const [contas, setContas] = useState<ContaVendedor[]>([]);
  const [nomesNasNotas, setNomesNasNotas] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);   // usuário com ação em andamento
  const [form, setForm] = useState<Formulario | null>(null);
  const [erroForm, setErroForm] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  const carregar = async () => {
    try {
      setErro(null);
      setContas(await db.listarVendedores());
    } catch (e: any) {
      setErro(e?.code === 'PT403' ? 'Só o Administrador pode ver as contas.' : 'Erro ao carregar as contas.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    carregar();
    db.nomesDeVendedorNasNotas().then(setNomesNasNotas);
  }, []);

  const acao = async (c: ContaVendedor, fazer: () => Promise<void>) => {
    try {
      setOcupado(c.usuario);
      await fazer();
      await carregar();
    } catch (e) {
      alert(mensagemDe(e));
    } finally {
      setOcupado(null);
    }
  };

  const salvar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form) return;
    setSalvando(true);
    setErroForm(null);
    try {
      await db.salvarVendedor({
        usuario: form.usuario,
        nome: form.nome,
        ve_tudo: form.ve_tudo,
        nomes_nf: form.nomes.split(',').map(n => n.trim()).filter(Boolean),
      });
      setForm(null);
      await carregar();
    } catch (err) {
      setErroForm(mensagemDe(err));
    } finally {
      setSalvando(false);
    }
  };

  if (loading) return (
    <div className="flex items-center justify-center py-16 gap-2 text-slate-400 text-sm">
      <Loader2 size={18} className="animate-spin" /> Carregando...
    </div>
  );

  if (erro) return (
    <div className="flex items-center gap-2 text-red-500 bg-red-50 dark:bg-red-900/20 px-3 py-2 rounded-md text-sm">
      <AlertCircle size={16} />{erro}
    </div>
  );

  const aguardando = contas.filter(c => c.ativo && !c.tem_senha).length;

  return (
    <div className="space-y-4">
      {aguardando > 0 && (
        <div className="flex items-start gap-2 text-amber-800 dark:text-amber-200 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 px-3 py-2 rounded-lg text-xs">
          <AlertCircle size={14} className="mt-0.5 shrink-0" />
          <span>
            {aguardando} conta(s) ativa(s) aguardando a primeira senha. Enquanto o vendedor não criar a dele,
            qualquer pessoa que saiba o usuário consegue criar no lugar. Deixe ativa só a conta de quem vai
            entrar agora.
          </span>
        </div>
      )}

      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-sm overflow-hidden">
        <div className="px-4 py-2 text-xs text-slate-500 dark:text-slate-400 border-b border-slate-100 dark:border-slate-700 flex justify-between items-center">
          <span>{contas.length} conta(s) de vendedor</span>
          <button
            onClick={() => { setForm({ ...VAZIO }); setErroForm(null); }}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30"
          >
            <UserPlus size={13} /> Novo vendedor
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-xs md:text-sm text-left text-slate-700 dark:text-slate-200">
            <thead className="bg-slate-100 dark:bg-slate-900 text-[11px] uppercase text-slate-500 dark:text-slate-400">
              <tr>
                <th className="px-3 py-2">Vendedor</th>
                <th className="px-3 py-2">Usuário</th>
                <th className="px-3 py-2">Vê as notas de</th>
                <th className="px-3 py-2 text-right">Notas</th>
                <th className="px-3 py-2">Situação</th>
                <th className="px-3 py-2 text-right">Ações</th>
              </tr>
            </thead>
            <tbody>
              {contas.map(c => (
                <tr key={c.usuario} className={`border-t border-slate-100 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/60 ${c.ativo ? '' : 'opacity-60'}`}>
                  <td className="px-3 py-2 font-semibold whitespace-nowrap">{c.nome}</td>
                  <td className="px-3 py-2 font-mono text-[11px]">{c.usuario}</td>
                  <td className="px-3 py-2 text-[11px] max-w-xs">
                    {c.ve_tudo ? <span className="font-semibold text-blue-600 dark:text-blue-400">Todas as notas</span> : c.nomes_nf.join(', ')}
                  </td>
                  <td className={`px-3 py-2 text-right tabular-nums ${!c.ve_tudo && c.notas === 0 ? 'text-red-500 font-semibold' : ''}`}
                      title={!c.ve_tudo && c.notas === 0 ? 'Nenhuma nota com esse nome — confira se está igual ao da NF' : undefined}>
                    {c.notas}
                  </td>
                  <td className="px-3 py-2 text-[11px] whitespace-nowrap">
                    {!c.ativo
                      ? <span className="rounded-full bg-slate-200 dark:bg-slate-700 px-2 py-0.5">Desativada</span>
                      : c.tem_senha
                        ? <span className="rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300 px-2 py-0.5">Ativa · senha criada {dataCurta(c.senha_definida_em)}</span>
                        : <span className="rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300 px-2 py-0.5">Aguardando 1ª senha</span>}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        disabled={ocupado === c.usuario}
                        onClick={() => { setForm({ usuario: c.usuario, nome: c.nome, ve_tudo: c.ve_tudo, nomes: c.nomes_nf.join(', '), editando: true }); setErroForm(null); }}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-50"
                      >
                        <Pencil size={12} /> Editar
                      </button>
                      <button
                        disabled={ocupado === c.usuario}
                        onClick={() => {
                          const msg = c.ativo
                            ? `Desativar ${c.nome}? O acesso dele é cortado na hora, mesmo se estiver com a tela aberta.`
                            : `Ativar ${c.nome}?${c.tem_senha ? '' : ' A conta ainda não tem senha: o próximo a entrar com este usuário cria a senha.'}`;
                          if (window.confirm(msg)) acao(c, () => db.ativarVendedor(c.usuario, !c.ativo));
                        }}
                        className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium disabled:opacity-50 ${c.ativo ? 'text-red-600 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/30' : 'text-green-600 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/30'}`}
                      >
                        <Power size={12} /> {c.ativo ? 'Desativar' : 'Ativar'}
                      </button>
                      <button
                        disabled={ocupado === c.usuario || !c.tem_senha}
                        title={c.tem_senha ? 'Para quando o vendedor esquecer a senha' : 'Ainda não tem senha'}
                        onClick={() => {
                          if (window.confirm(`Zerar a senha de ${c.nome}? Ele vai criar uma nova no próximo acesso — e até lá qualquer um que saiba o usuário pode criar no lugar dele.`)) {
                            acao(c, () => db.zerarSenhaVendedor(c.usuario));
                          }
                        }}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium text-amber-700 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-900/30 disabled:opacity-40"
                      >
                        <KeyRound size={12} /> Zerar senha
                      </button>
                      {ocupado === c.usuario && <Loader2 size={13} className="animate-spin text-slate-400" />}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {form && (
        <form onSubmit={salvar} className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-sm p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-slate-800 dark:text-white text-sm">
              {form.editando ? `Editar ${form.nome}` : 'Novo vendedor'}
            </h3>
            <button type="button" onClick={() => setForm(null)} className="text-slate-400 hover:text-slate-600"><X size={16} /></button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="text-xs text-slate-500 dark:text-slate-400">
              Usuário (para entrar)
              <input
                value={form.usuario}
                disabled={form.editando}
                onChange={e => setForm({ ...form, usuario: e.target.value.toLowerCase() })}
                placeholder="ex.: maria"
                className="mt-1 w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg text-sm bg-white dark:bg-slate-700 text-slate-900 dark:text-white disabled:opacity-60"
              />
            </label>
            <label className="text-xs text-slate-500 dark:text-slate-400">
              Nome
              <input
                value={form.nome}
                onChange={e => setForm({ ...form, nome: e.target.value })}
                placeholder="ex.: Maria Souza"
                className="mt-1 w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg text-sm bg-white dark:bg-slate-700 text-slate-900 dark:text-white"
              />
            </label>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
            <input type="checkbox" checked={form.ve_tudo} onChange={e => setForm({ ...form, ve_tudo: e.target.checked })} />
            Vê <b>todas</b> as notas (supervisor)
          </label>
          {!form.ve_tudo && (
            <label className="block text-xs text-slate-500 dark:text-slate-400">
              Vê as notas destes vendedores — o nome exatamente como aparece na NF, separados por vírgula
              <input
                value={form.nomes}
                onChange={e => setForm({ ...form, nomes: e.target.value })}
                placeholder="ex.: JOMAR, LICITACOES"
                list="nomes-nas-notas"
                className="mt-1 w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg text-sm bg-white dark:bg-slate-700 text-slate-900 dark:text-white"
              />
              <datalist id="nomes-nas-notas">
                {nomesNasNotas.map(n => <option key={n} value={n} />)}
              </datalist>
              {nomesNasNotas.length > 0 && (
                <span className="block mt-1 text-[11px] text-slate-400">Nomes que já apareceram nas notas: {nomesNasNotas.join(', ')}</span>
              )}
            </label>
          )}
          {!form.editando && (
            <p className="text-[11px] text-slate-400">A conta nasce <b>desativada</b>. Ative na hora de entregar o acesso ao vendedor — ele cria a própria senha no primeiro acesso.</p>
          )}
          {erroForm && (
            <p className="text-xs text-red-500 flex items-center gap-1"><AlertCircle size={12} /> {erroForm}</p>
          )}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setForm(null)} className="px-3 py-1.5 text-sm text-slate-500 hover:text-slate-700">Cancelar</button>
            <button type="submit" disabled={salvando} className="px-4 py-1.5 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-60 inline-flex items-center gap-2">
              {salvando && <Loader2 size={14} className="animate-spin" />} Salvar
            </button>
          </div>
        </form>
      )}
    </div>
  );
};
