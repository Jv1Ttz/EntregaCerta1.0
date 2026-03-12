import React, { useEffect, useState } from 'react';
import { db } from '../services/db';
import type { Invoice } from '../types';
import { Trash2, AlertCircle } from 'lucide-react';

export const AdminAuditView: React.FC = () => {
  const [deletedInvoices, setDeletedInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        const data = await db.getDeletedInvoices();
        setDeletedInvoices(data);
      } catch (e: any) {
        console.error(e);
        setError('Erro ao carregar notas excluídas.');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const formatDateTime = (iso?: string | null) => {
    if (!iso) return '-';
    try {
      return new Date(iso).toLocaleString('pt-BR');
    } catch {
      return iso;
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 p-4 md:p-6">
      <div className="max-w-6xl mx-auto space-y-4">
        <header className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div>
            <h1 className="text-2xl md:text-3xl font-black text-slate-900 dark:text-white flex items-center gap-2">
              <Trash2 className="text-red-500" />
              Notas Excluídas
            </h1>
            <p className="text-xs md:text-sm text-slate-500 dark:text-slate-400">
              Visão de auditoria das notas removidas pelo gestor (soft delete).
            </p>
          </div>
        </header>

        {loading ? (
          <div className="flex items-center justify-center py-12 text-slate-500 text-sm">
            Carregando notas excluídas...
          </div>
        ) : error ? (
          <div className="flex items-center gap-2 text-red-500 bg-red-50 dark:bg-red-900/20 px-3 py-2 rounded-md text-sm">
            <AlertCircle size={16} />
            <span>{error}</span>
          </div>
        ) : deletedInvoices.length === 0 ? (
          <div className="mt-4 border border-dashed border-slate-300 dark:border-slate-700 rounded-lg p-6 text-center text-slate-500 dark:text-slate-400 text-sm">
            Nenhuma nota excluída encontrada.
          </div>
        ) : (
          <div className="mt-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-sm overflow-hidden">
            <div className="px-4 py-2 text-xs text-slate-500 dark:text-slate-400 border-b border-slate-100 dark:border-slate-700 flex justify-between">
              <span>Total de notas excluídas: {deletedInvoices.length}</span>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-xs md:text-sm text-left text-slate-700 dark:text-slate-200">
                <thead className="bg-slate-100 dark:bg-slate-900 text-[11px] md:text-xs uppercase text-slate-500 dark:text-slate-400">
                  <tr>
                    <th className="px-3 py-2">Data Exclusão</th>
                    <th className="px-3 py-2">NF</th>
                    <th className="px-3 py-2">Cliente</th>
                    <th className="px-3 py-2">Valor</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Motivo</th>
                  </tr>
                </thead>
                <tbody>
                  {deletedInvoices.map((inv) => (
                    <tr
                      key={inv.id}
                      className="border-t border-slate-100 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/60"
                    >
                      <td className="px-3 py-2 text-[11px] md:text-xs">
                        {formatDateTime(inv.deleted_at)}
                      </td>
                      <td className="px-3 py-2 font-semibold whitespace-nowrap">
                        {inv.number || '-'}
                      </td>
                      <td className="px-3 py-2 max-w-xs truncate">
                        {inv.customer_name}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {typeof inv.value === 'number'
                          ? inv.value.toLocaleString('pt-BR', {
                              style: 'currency',
                              currency: 'BRL',
                            })
                          : '-'}
                      </td>
                      <td className="px-3 py-2">
                        <span className="inline-flex items-center rounded-full bg-slate-100 dark:bg-slate-700 px-2 py-0.5 text-[10px] md:text-[11px] font-medium">
                          {inv.status}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-[11px] md:text-xs max-w-xs truncate">
                        {inv.deleted_reason || '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

