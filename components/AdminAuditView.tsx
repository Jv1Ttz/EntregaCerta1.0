import React, { useEffect, useState, useMemo } from 'react';
import { db } from '../services/db';
import type { Invoice, ActivityLog, ActivityLogEventType } from '../types';
import { Trash2, AlertCircle, ClipboardList, Filter, X, Loader2, Search, RotateCcw } from 'lucide-react';

// ─── Configuração dos tipos de evento ───────────────────────────────────────

const EVENT_CONFIG: Record<ActivityLogEventType, { label: string; color: string }> = {
  ASSIGNMENT:    { label: 'Atribuição',     color: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300' },
  STATUS_CHANGE: { label: 'Mudança Status', color: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300' },
  XML_IMPORT:    { label: 'Importação XML', color: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300' },
  SOFT_DELETE:   { label: 'Exclusão',       color: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300' },
};

const formatDateTime = (iso?: string | null) => {
  if (!iso) return '-';
  try { return new Date(iso).toLocaleString('pt-BR'); } catch { return iso ?? '-'; }
};

// ─── Aba: Notas Excluídas ────────────────────────────────────────────────────

const DeletedInvoicesTab: React.FC = () => {
  const [deletedInvoices, setDeletedInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [restoringId, setRestoringId] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        setDeletedInvoices(await db.getDeletedInvoices());
      } catch (e: any) {
        setError('Erro ao carregar notas excluídas.');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  if (loading) return (
    <div className="flex items-center justify-center py-16 gap-2 text-slate-400 text-sm">
      <Loader2 size={18} className="animate-spin" /> Carregando...
    </div>
  );

  if (error) return (
    <div className="flex items-center gap-2 text-red-500 bg-red-50 dark:bg-red-900/20 px-3 py-2 rounded-md text-sm">
      <AlertCircle size={16} />{error}
    </div>
  );

  if (deletedInvoices.length === 0) return (
    <div className="mt-4 border border-dashed border-slate-300 dark:border-slate-700 rounded-lg p-8 text-center text-slate-500 dark:text-slate-400 text-sm">
      Nenhuma nota excluída encontrada.
    </div>
  );

  return (
    <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-sm overflow-hidden">
      <div className="px-4 py-2 text-xs text-slate-500 dark:text-slate-400 border-b border-slate-100 dark:border-slate-700 flex justify-between items-center">
        <span>Total: {deletedInvoices.length} nota(s) excluída(s)</span>
        <span className="text-[10px] text-slate-400">Exclusão definitiva remove a nota e comprovantes do banco.</span>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-xs md:text-sm text-left text-slate-700 dark:text-slate-200">
          <thead className="bg-slate-100 dark:bg-slate-900 text-[11px] uppercase text-slate-500 dark:text-slate-400">
            <tr>
              <th className="px-3 py-2">Data Exclusão</th>
              <th className="px-3 py-2">NF</th>
              <th className="px-3 py-2">Cliente</th>
              <th className="px-3 py-2">Valor</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Motivo</th>
              <th className="px-3 py-2 text-right">Ações</th>
            </tr>
          </thead>
          <tbody>
            {deletedInvoices.map((inv) => (
              <tr key={inv.id} className="border-t border-slate-100 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/60">
                <td className="px-3 py-2 text-[11px]">{formatDateTime(inv.deleted_at)}</td>
                <td className="px-3 py-2 font-semibold whitespace-nowrap">{inv.number || '-'}</td>
                <td className="px-3 py-2 max-w-xs truncate">{inv.customer_name}</td>
                <td className="px-3 py-2 whitespace-nowrap">
                  {typeof inv.value === 'number' ? inv.value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '-'}
                </td>
                <td className="px-3 py-2">
                  <span className="inline-flex items-center rounded-full bg-slate-100 dark:bg-slate-700 px-2 py-0.5 text-[10px] font-medium">{inv.status}</span>
                </td>
                <td className="px-3 py-2 text-[11px] max-w-xs truncate">{inv.deleted_reason || '-'}</td>
                <td className="px-3 py-2 text-right">
                  <div className="flex items-center justify-end gap-1">
                    <button
                      disabled={restoringId === inv.id || deletingId === inv.id}
                      onClick={async () => {
                        if (!window.confirm(`Restaurar a NF ${inv.number || inv.id}? Ela voltará a aparecer na listagem normal.`)) return;
                        try {
                          setRestoringId(inv.id);
                          await db.restoreInvoice(inv.id);
                          setDeletedInvoices(prev => prev.filter(d => d.id !== inv.id));
                        } catch (e) {
                          alert('Erro ao restaurar nota.');
                        } finally {
                          setRestoringId(null);
                        }
                      }}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium text-green-600 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/30 disabled:opacity-50"
                    >
                      <RotateCcw size={12} />
                      {restoringId === inv.id ? 'Restaurando...' : 'Restaurar'}
                    </button>
                    <button
                      disabled={deletingId === inv.id || restoringId === inv.id}
                      onClick={async () => {
                        if (!window.confirm('Excluir definitivamente esta nota e seus comprovantes? Esta ação não pode ser desfeita.')) return;
                        try {
                          setDeletingId(inv.id);
                          await db.hardDeleteInvoice(inv.id);
                          setDeletedInvoices(prev => prev.filter(d => d.id !== inv.id));
                        } catch (e) {
                          alert('Erro ao excluir nota definitivamente.');
                        } finally {
                          setDeletingId(null);
                        }
                      }}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium text-red-600 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/30 disabled:opacity-50"
                    >
                      <Trash2 size={12} />
                      {deletingId === inv.id ? 'Excluindo...' : 'Excluir definitivo'}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// ─── Aba: Logs de Atividade ──────────────────────────────────────────────────

const ActivityLogsTab: React.FC = () => {
  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState<ActivityLogEventType | ''>('');
  const [filterStart, setFilterStart] = useState('');
  const [filterEnd, setFilterEnd] = useState('');
  const [search, setSearch] = useState('');

  const load = async () => {
    setLoading(true);
    const data = await db.getLogs({
      event_type: filterType || undefined,
      start: filterStart || undefined,
      end: filterEnd || undefined,
    });
    setLogs(data);
    setLoading(false);
  };

  useEffect(() => { load(); }, [filterType, filterStart, filterEnd]);

  const filtered = useMemo(() => {
    if (!search.trim()) return logs;
    const term = search.toLowerCase();
    return logs.filter(l => l.description.toLowerCase().includes(term) || l.actor.toLowerCase().includes(term));
  }, [logs, search]);

  const hasFilter = !!(filterType || filterStart || filterEnd || search);

  const clearFilters = () => {
    setFilterType('');
    setFilterStart('');
    setFilterEnd('');
    setSearch('');
  };

  return (
    <div className="space-y-4">
      {/* Filtros */}
      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-4 shadow-sm space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {/* Busca */}
          <div className="relative lg:col-span-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Buscar na descrição..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-8 p-2 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-md text-sm outline-none focus:ring-2 focus:ring-blue-500 text-slate-900 dark:text-white"
            />
          </div>

          {/* Tipo de evento */}
          <div className="relative">
            <Filter size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <select
              value={filterType}
              onChange={e => setFilterType(e.target.value as ActivityLogEventType | '')}
              className="w-full pl-8 p-2 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-md text-sm outline-none focus:ring-2 focus:ring-blue-500 text-slate-700 dark:text-slate-200 appearance-none"
            >
              <option value="">Todos os tipos</option>
              {(Object.keys(EVENT_CONFIG) as ActivityLogEventType[]).map(k => (
                <option key={k} value={k}>{EVENT_CONFIG[k].label}</option>
              ))}
            </select>
          </div>

          {/* Data De / Até */}
          <div className="flex gap-2 items-center bg-slate-50 dark:bg-slate-900/50 p-1 rounded-lg border border-slate-200 dark:border-slate-700">
            <div className="relative flex-1 min-w-0">
              <span className="absolute -top-2 left-2 bg-slate-50 dark:bg-slate-800 px-1 text-[10px] text-slate-400 font-bold z-10 uppercase">De</span>
              <input type="date" value={filterStart} onChange={e => setFilterStart(e.target.value)}
                className="w-full p-1.5 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-md text-sm outline-none focus:ring-2 focus:ring-blue-500 text-slate-700 dark:text-slate-200"
              />
            </div>
            <div className="relative flex-1 min-w-0">
              <span className="absolute -top-2 left-2 bg-slate-50 dark:bg-slate-800 px-1 text-[10px] text-slate-400 font-bold z-10 uppercase">Até</span>
              <input type="date" value={filterEnd} onChange={e => setFilterEnd(e.target.value)}
                className="w-full p-1.5 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-md text-sm outline-none focus:ring-2 focus:ring-blue-500 text-slate-700 dark:text-slate-200"
              />
            </div>
          </div>
        </div>

        {hasFilter && (
          <button onClick={clearFilters} className="text-xs text-red-500 hover:underline flex items-center gap-1">
            <X size={12} /> Limpar filtros
          </button>
        )}
      </div>

      {/* Tabela */}
      {loading ? (
        <div className="flex items-center justify-center py-16 gap-2 text-slate-400 text-sm">
          <Loader2 size={18} className="animate-spin" /> Carregando logs...
        </div>
      ) : filtered.length === 0 ? (
        <div className="border border-dashed border-slate-300 dark:border-slate-700 rounded-lg p-8 text-center text-slate-500 dark:text-slate-400 text-sm">
          Nenhum log encontrado com os filtros atuais.
        </div>
      ) : (
        <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-sm overflow-hidden">
          <div className="px-4 py-2 text-xs text-slate-500 dark:text-slate-400 border-b border-slate-100 dark:border-slate-700">
            {filtered.length} registro(s) encontrado(s)
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-xs md:text-sm text-left text-slate-700 dark:text-slate-200">
              <thead className="bg-slate-100 dark:bg-slate-900 text-[11px] uppercase text-slate-500 dark:text-slate-400">
                <tr>
                  <th className="px-4 py-2 whitespace-nowrap">Data / Hora</th>
                  <th className="px-4 py-2">Tipo</th>
                  <th className="px-4 py-2">Descrição</th>
                  <th className="px-4 py-2">Ator</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(log => (
                  <tr key={log.id} className="border-t border-slate-100 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/60">
                    <td className="px-4 py-2 whitespace-nowrap text-[11px] text-slate-500 dark:text-slate-400 font-mono">
                      {formatDateTime(log.created_at)}
                    </td>
                    <td className="px-4 py-2">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap ${EVENT_CONFIG[log.event_type]?.color ?? ''}`}>
                        {EVENT_CONFIG[log.event_type]?.label ?? log.event_type}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-slate-700 dark:text-slate-200">{log.description}</td>
                    <td className="px-4 py-2 text-slate-500 dark:text-slate-400">{log.actor}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

// ─── Componente Principal ────────────────────────────────────────────────────

export const AdminAuditView: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'deleted' | 'logs'>('logs');

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 p-4 md:p-6">
      <div className="max-w-6xl mx-auto space-y-4">
        <header>
          <h1 className="text-2xl md:text-3xl font-black text-slate-900 dark:text-white flex items-center gap-2">
            <ClipboardList className="text-blue-500" />
            Administrador
          </h1>
          <p className="text-xs md:text-sm text-slate-500 dark:text-slate-400">
            Auditoria do sistema — logs de atividade e notas excluídas.
          </p>
        </header>

        {/* Abas */}
        <div className="flex gap-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-1 shadow-sm w-fit">
          <button
            onClick={() => setActiveTab('logs')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeTab === 'logs'
                ? 'bg-blue-600 text-white shadow'
                : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
            }`}
          >
            Logs de Atividade
          </button>
          <button
            onClick={() => setActiveTab('deleted')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeTab === 'deleted'
                ? 'bg-red-600 text-white shadow'
                : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
            }`}
          >
            Notas Excluídas
          </button>
        </div>

        {activeTab === 'logs' ? <ActivityLogsTab /> : <DeletedInvoicesTab />}
      </div>
    </div>
  );
};
