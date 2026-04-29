import React, { useState, useEffect, useMemo } from 'react';
import { db } from '../services/db';
import { Invoice, Driver, Vehicle, DeliveryStatus } from '../types';
import { Search, ChevronLeft, Loader2, X, TrendingUp, Clock, CheckCircle, AlertTriangle, AlertOctagon, RotateCw, Package, ArrowUp, ArrowDown, ExternalLink } from 'lucide-react';

interface SellerViewProps {
  onBack: () => void;
}

const STATUS_LABEL: Record<string, string> = {
  [DeliveryStatus.PENDING]: 'Faturado',
  [DeliveryStatus.IN_PROGRESS]: 'Em Rota',
  [DeliveryStatus.DELIVERED]: 'Entregue',
  [DeliveryStatus.FAILED]: 'Devolvido',
  [DeliveryStatus.ISSUE]: 'Com Pendência (Avaria)',
  [DeliveryStatus.RETURNED]: 'Devolvida',
  FAILED_CONCLUDED: 'Devolução concluída',
  FAILED_CANCELLED: 'Devolução cancelada',
};

const STATUS_STYLE: Record<DeliveryStatus, string> = {
  [DeliveryStatus.PENDING]: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
  [DeliveryStatus.IN_PROGRESS]: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  [DeliveryStatus.DELIVERED]: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  [DeliveryStatus.FAILED]: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
  [DeliveryStatus.ISSUE]: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300',
  [DeliveryStatus.RETURNED]: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300',
};

const STATUS_ICON: Record<DeliveryStatus, React.ReactNode> = {
  [DeliveryStatus.PENDING]: <Clock size={12} />,
  [DeliveryStatus.IN_PROGRESS]: <TrendingUp size={12} />,
  [DeliveryStatus.DELIVERED]: <CheckCircle size={12} />,
  [DeliveryStatus.FAILED]: <AlertTriangle size={12} />,
  [DeliveryStatus.ISSUE]: <AlertOctagon size={12} />,
  [DeliveryStatus.RETURNED]: <RotateCw size={12} />,
};

const formatDate = (iso?: string | null) => {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  });
};

const formatCurrency = (value?: number) => {
  if (value == null) return '—';
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
};

export const SellerView: React.FC<SellerViewProps> = ({ onBack }) => {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);

  const [searchTerm, setSearchTerm] = useState('');
  const [filterDriver, setFilterDriver] = useState('');
  const [filterVehicle, setFilterVehicle] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterStartDate, setFilterStartDate] = useState('');
  const [filterEndDate, setFilterEndDate] = useState('');
  const [filterDeliveryStartDate, setFilterDeliveryStartDate] = useState('');
  const [filterDeliveryEndDate, setFilterDeliveryEndDate] = useState('');
  const [sortConfig, setSortConfig] = useState<Array<{ key: string; direction: 'asc' | 'desc' }>>([
    { key: 'created_at', direction: 'desc' },
  ]);
  useEffect(() => {
    Promise.all([db.getInvoices(), db.getDrivers(), db.getVehicles()]).then(
      ([inv, drv, veh]) => {
        setInvoices(inv);
        setDrivers(drv);
        setVehicles(veh);
        setLoading(false);
      }
    );
  }, []);

  const driverMap = useMemo(
    () => Object.fromEntries(drivers.map(d => [d.id, d.name])),
    [drivers]
  );

  const vehicleMap = useMemo(
    () => Object.fromEntries(vehicles.map(v => [v.id, `${v.plate} — ${v.model}`])),
    [vehicles]
  );

  const hasActiveFilter = !!(searchTerm || filterDriver || filterVehicle || filterStatus || filterStartDate || filterEndDate || filterDeliveryStartDate || filterDeliveryEndDate);

  const clearFilters = () => {
    setSearchTerm('');
    setFilterDriver('');
    setFilterVehicle('');
    setFilterStatus('');
    setFilterStartDate('');
    setFilterEndDate('');
    setFilterDeliveryStartDate('');
    setFilterDeliveryEndDate('');
  };

  const filtered = useMemo(() => {
    return invoices.filter(inv => {
      const searchLower = searchTerm.toLowerCase();
      const matchesSearch = !searchTerm || (
        inv.number.includes(searchLower) ||
        inv.customer_name.toLowerCase().includes(searchLower) ||
        inv.value.toString().includes(searchLower) ||
        inv.access_key.includes(searchLower)
      );

      const matchesDriver = !filterDriver || inv.driver_id === filterDriver;
      const matchesVehicle = !filterVehicle || inv.vehicle_id === filterVehicle;
      const matchesStatus = !filterStatus || (
        filterStatus === 'FAILED_CONCLUDED'
          ? (inv.status === 'FAILED' && inv.return_final_status === 'CONCLUDED')
          : filterStatus === 'FAILED_CANCELLED'
            ? (inv.status === 'FAILED' && inv.return_final_status === 'CANCELLED')
            : inv.status === filterStatus
      );

      const invoiceDate = inv.created_at.split('T')[0];
      const matchesStart = !filterStartDate || invoiceDate >= filterStartDate;
      const matchesEnd = !filterEndDate || invoiceDate <= filterEndDate;

      const deliveryDate = inv.delivered_at ? inv.delivered_at.split('T')[0] : null;
      const matchesDeliveryStart = !filterDeliveryStartDate || (deliveryDate && deliveryDate >= filterDeliveryStartDate);
      const matchesDeliveryEnd = !filterDeliveryEndDate || (deliveryDate && deliveryDate <= filterDeliveryEndDate);

      return matchesSearch && matchesDriver && matchesVehicle && matchesStatus &&
        matchesStart && matchesEnd &&
        matchesDeliveryStart && matchesDeliveryEnd;
    });
  }, [invoices, searchTerm, filterDriver, filterVehicle, filterStatus, filterStartDate, filterEndDate, filterDeliveryStartDate, filterDeliveryEndDate]);

  const sorted = useMemo(() => {
    const items = [...filtered];
    items.sort((a: any, b: any) => {
      for (const { key, direction } of sortConfig) {
        let aValue = a[key];
        let bValue = b[key];
        if (key === 'driver_id') {
          aValue = drivers.find(d => d.id === a.driver_id)?.name || '';
          bValue = drivers.find(d => d.id === b.driver_id)?.name || '';
        }
        if (key === 'vehicle_id') {
          aValue = vehicles.find(v => v.id === a.vehicle_id)?.plate || '';
          bValue = vehicles.find(v => v.id === b.vehicle_id)?.plate || '';
        }
        if (!aValue && !bValue) continue;
        if (!aValue) return 1;
        if (!bValue) return -1;
        if (aValue < bValue) return direction === 'asc' ? -1 : 1;
        if (aValue > bValue) return direction === 'asc' ? 1 : -1;
      }
      return 0;
    });
    return items;
  }, [filtered, sortConfig, drivers, vehicles]);

  const requestSort = (key: string) => {
    setSortConfig(prev => {
      const existing = prev.find(s => s.key === key);
      if (!existing) return [{ key, direction: 'asc' as const }, ...prev];
      if (existing.direction === 'asc') return prev.map(s => s.key === key ? { ...s, direction: 'desc' as const } : s);
      const remaining = prev.filter(s => s.key !== key);
      return remaining.length > 0 ? remaining : [{ key: 'created_at', direction: 'desc' as const }];
    });
  };

  const SortIcon = ({ colKey }: { colKey: string }) => {
    const s = sortConfig.find(s => s.key === colKey);
    if (!s) return null;
    return (
      <>
        {s.direction === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />}
        {sortConfig.length > 1 && (
          <span className="text-[10px] text-blue-300">{sortConfig.indexOf(s) + 1}</span>
        )}
      </>
    );
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 transition-colors duration-300">
      {/* Header */}
      <div className="bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 sticky top-0 z-10 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center gap-4">
          <button
            onClick={onBack}
            className="p-2 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
          >
            <ChevronLeft size={20} />
          </button>
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 bg-emerald-100 dark:bg-emerald-900/30 rounded-lg flex items-center justify-center text-emerald-600 dark:text-emerald-400">
              <Package size={20} />
            </div>
            <div>
              <h1 className="text-lg font-bold text-slate-800 dark:text-white leading-tight">
                Consulta de Pedidos
              </h1>
              <p className="text-xs text-slate-500 dark:text-slate-400">Visão do Vendedor</p>
            </div>
          </div>
          <div className="ml-auto text-xs text-slate-400 dark:text-slate-500 font-mono">
            {loading ? '...' : `${filtered.length} de ${invoices.length} notas`}
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-6 space-y-4">
        {/* Filtros — mesmo padrão do gestor */}
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4 space-y-3 shadow-sm">
          <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">

            {/* 1. Busca texto */}
            <div className="relative col-span-2 md:col-span-2 xl:col-span-1">
              <Search className="absolute left-3 top-2.5 text-slate-400 h-4 w-4" />
              <input
                type="text"
                placeholder="Buscar..."
                className="w-full pl-9 p-2 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-md text-sm outline-none focus:ring-2 focus:ring-blue-500 text-slate-900 dark:text-white"
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
              />
            </div>

            {/* 2. Motorista */}
            <div className="col-span-1">
              <select
                className="w-full p-2 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-md text-sm outline-none focus:ring-2 focus:ring-blue-500 text-slate-700 dark:text-slate-200"
                value={filterDriver}
                onChange={e => setFilterDriver(e.target.value)}
              >
                <option value="">Motorista</option>
                {drivers.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>

            {/* 3. Veículo */}
            <div className="col-span-1">
              <select
                className="w-full p-2 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-md text-sm outline-none focus:ring-2 focus:ring-blue-500 text-slate-700 dark:text-slate-200"
                value={filterVehicle}
                onChange={e => setFilterVehicle(e.target.value)}
              >
                <option value="">Veículo</option>
                {vehicles.map(v => <option key={v.id} value={v.id}>{v.plate}</option>)}
              </select>
            </div>

            {/* 4. Status */}
            <div className="col-span-1">
              <select
                className="w-full p-2 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-md text-sm outline-none focus:ring-2 focus:ring-blue-500 text-slate-700 dark:text-slate-200"
                value={filterStatus}
                onChange={e => setFilterStatus(e.target.value)}
              >
                <option value="">Status</option>
                <option value="PENDING">Faturado</option>
                <option value="IN_PROGRESS">Em Rota</option>
                <option value="DELIVERED">Entregue</option>
                <option value="FAILED">Devolvido</option>
                <option value="FAILED_CONCLUDED">Devolução concluída</option>
                <option value="FAILED_CANCELLED">Devolução cancelada</option>
                <option value="ISSUE">Com Pendência (Avaria)</option>
              </select>
            </div>

            {/* 5. Emissão De / Até (cinza) */}
            <div className="flex gap-2 items-center col-span-2 md:col-span-2 xl:col-span-2 bg-slate-50 dark:bg-slate-900/50 p-1 rounded-lg border border-slate-200 dark:border-slate-700">
              <div className="relative flex-1 min-w-0">
                <span className="absolute -top-2 left-2 bg-slate-50 dark:bg-slate-800 px-1 text-[10px] text-slate-400 font-bold z-10 uppercase">Emissão De</span>
                <input
                  type="date"
                  className="w-full p-1.5 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-md text-sm outline-none focus:ring-2 focus:ring-blue-500 text-slate-700 dark:text-slate-200"
                  value={filterStartDate}
                  onChange={e => setFilterStartDate(e.target.value)}
                />
              </div>
              <div className="relative flex-1 min-w-0">
                <span className="absolute -top-2 left-2 bg-slate-50 dark:bg-slate-800 px-1 text-[10px] text-slate-400 font-bold z-10 uppercase">Até</span>
                <input
                  type="date"
                  className="w-full p-1.5 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-md text-sm outline-none focus:ring-2 focus:ring-blue-500 text-slate-700 dark:text-slate-200"
                  value={filterEndDate}
                  onChange={e => setFilterEndDate(e.target.value)}
                />
              </div>
            </div>

            {/* 6. Entrega De / Até (azul) */}
            <div className="flex gap-2 items-center col-span-2 md:col-span-2 xl:col-span-2 bg-blue-50 dark:bg-blue-900/20 p-1 rounded-lg border border-blue-100 dark:border-blue-800">
              <div className="relative flex-1 min-w-0">
                <span className="absolute -top-2 left-2 bg-blue-50 dark:bg-slate-800 px-1 text-[10px] text-blue-500 dark:text-blue-300 font-bold z-10 uppercase">Entrega De</span>
                <input
                  type="date"
                  className="w-full p-1.5 bg-white dark:bg-slate-800 border border-blue-200 dark:border-blue-700 rounded-md text-sm outline-none focus:ring-2 focus:ring-blue-500 text-slate-700 dark:text-slate-200"
                  value={filterDeliveryStartDate}
                  onChange={e => setFilterDeliveryStartDate(e.target.value)}
                />
              </div>
              <div className="relative flex-1 min-w-0">
                <span className="absolute -top-2 left-2 bg-blue-50 dark:bg-slate-800 px-1 text-[10px] text-blue-500 dark:text-blue-300 font-bold z-10 uppercase">Até</span>
                <input
                  type="date"
                  className="w-full p-1.5 bg-white dark:bg-slate-800 border border-blue-200 dark:border-blue-700 rounded-md text-sm outline-none focus:ring-2 focus:ring-blue-500 text-slate-700 dark:text-slate-200"
                  value={filterDeliveryEndDate}
                  onChange={e => setFilterDeliveryEndDate(e.target.value)}
                />
              </div>
            </div>

          </div>

          {hasActiveFilter && (
            <button
              onClick={clearFilters}
              className="text-xs text-red-500 hover:underline flex items-center gap-1"
            >
              <X size={12} /> Limpar todos os filtros
            </button>
          )}
        </div>

        {/* Tabela */}
        {loading ? (
          <div className="flex flex-col items-center justify-center py-24 gap-3 text-slate-400">
            <Loader2 size={32} className="animate-spin text-emerald-500" />
            <span className="text-sm">Carregando notas...</span>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 gap-3 text-slate-400 dark:text-slate-500">
            <Package size={40} className="opacity-30" />
            <span className="text-sm">Nenhuma nota encontrada com os filtros atuais.</span>
          </div>
        ) : (
          <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden shadow-sm">
            {/* Desktop table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-white uppercase bg-slate-700 dark:bg-slate-900 sticky top-0 z-10 shadow-md">
                  <tr>
                    <th className="px-4 py-3 cursor-pointer hover:bg-slate-600 select-none rounded-tl-lg" onClick={() => requestSort('number')}>
                      <div className="flex items-center gap-1">Nº Nota <SortIcon colKey="number" /></div>
                    </th>
                    <th className="px-4 py-3 cursor-pointer hover:bg-slate-600 select-none" onClick={() => requestSort('customer_name')}>
                      <div className="flex items-center gap-1">Cliente <SortIcon colKey="customer_name" /></div>
                    </th>
                    <th className="px-4 py-3 cursor-pointer hover:bg-slate-600 select-none" onClick={() => requestSort('value')}>
                      <div className="flex items-center gap-1">Valor <SortIcon colKey="value" /></div>
                    </th>
                    <th className="px-4 py-3 cursor-pointer hover:bg-slate-600 select-none" onClick={() => requestSort('status')}>
                      <div className="flex items-center gap-1">Status <SortIcon colKey="status" /></div>
                    </th>
                    <th className="px-4 py-3 cursor-pointer hover:bg-slate-600 select-none" onClick={() => requestSort('driver_id')}>
                      <div className="flex items-center gap-1">Motorista <SortIcon colKey="driver_id" /></div>
                    </th>
                    <th className="px-4 py-3 cursor-pointer hover:bg-slate-600 select-none" onClick={() => requestSort('vehicle_id')}>
                      <div className="flex items-center gap-1">Veículo <SortIcon colKey="vehicle_id" /></div>
                    </th>
                    <th className="px-4 py-3 cursor-pointer hover:bg-slate-600 select-none" onClick={() => requestSort('created_at')}>
                      <div className="flex items-center gap-1">Entrada <SortIcon colKey="created_at" /></div>
                    </th>
                    <th className="px-4 py-3 cursor-pointer hover:bg-slate-600 select-none" onClick={() => requestSort('delivered_at')}>
                      <div className="flex items-center gap-1">Realização <SortIcon colKey="delivered_at" /></div>
                    </th>
                    <th className="px-4 py-3 rounded-tr-lg" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                  {sorted.map(inv => (
                    <tr key={inv.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors">
                      <td className="px-4 py-3 font-mono font-semibold text-slate-700 dark:text-slate-200">
                        {inv.number}
                        {inv.series && (
                          <span className="text-xs text-slate-400 dark:text-slate-500 ml-1">/{inv.series}</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-800 dark:text-slate-100 truncate max-w-[200px]">
                          {inv.customer_name}
                        </div>
                        <div className="text-xs text-slate-400 dark:text-slate-500">{inv.customer_doc}</div>
                      </td>
                      <td className="px-4 py-3 text-slate-700 dark:text-slate-300 whitespace-nowrap">
                        {formatCurrency(inv.value)}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-semibold ${STATUS_STYLE[inv.status]}`}>
                          {STATUS_ICON[inv.status]}
                          {STATUS_LABEL[inv.status] ?? inv.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                        {inv.driver_id ? (driverMap[inv.driver_id] ?? '—') : '—'}
                      </td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                        {inv.vehicle_id ? (vehicleMap[inv.vehicle_id] ?? '—') : '—'}
                      </td>
                      <td className="px-4 py-3 text-slate-500 dark:text-slate-400 whitespace-nowrap">
                        {formatDate(inv.created_at)}
                      </td>
                      <td className="px-4 py-3 text-slate-500 dark:text-slate-400 whitespace-nowrap">
                        {formatDate(inv.delivered_at)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {inv.pdf_url && (
                          <a
                            href={inv.pdf_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/30 transition-colors"
                          >
                            <ExternalLink size={12} /> PDF
                          </a>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="md:hidden divide-y divide-slate-100 dark:divide-slate-700">
              {filtered.map(inv => (
                <div key={inv.id} className="p-4 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono font-bold text-slate-800 dark:text-white">
                      Nº {inv.number}
                      {inv.series && <span className="text-slate-400 dark:text-slate-500">/{inv.series}</span>}
                    </span>
                    <div className="flex items-center gap-2">
                      <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-semibold ${STATUS_STYLE[inv.status]}`}>
                        {STATUS_ICON[inv.status]}
                        {STATUS_LABEL[inv.status] ?? inv.status}
                      </span>
                      {inv.pdf_url && (
                        <a
                          href={inv.pdf_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/30"
                        >
                          <ExternalLink size={12} /> PDF
                        </a>
                      )}
                    </div>
                  </div>
                  <div className="text-sm font-medium text-slate-700 dark:text-slate-200 truncate">
                    {inv.customer_name}
                  </div>
                  <div className="text-xs text-slate-400 dark:text-slate-500">{inv.customer_doc}</div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-slate-500 dark:text-slate-400 pt-1">
                    <span><span className="font-semibold text-slate-600 dark:text-slate-300">Valor:</span> {formatCurrency(inv.value)}</span>
                    <span><span className="font-semibold text-slate-600 dark:text-slate-300">Entrada:</span> {formatDate(inv.created_at)}</span>
                    <span><span className="font-semibold text-slate-600 dark:text-slate-300">Motorista:</span> {inv.driver_id ? (driverMap[inv.driver_id] ?? '—') : '—'}</span>
                    <span><span className="font-semibold text-slate-600 dark:text-slate-300">Realização:</span> {formatDate(inv.delivered_at)}</span>
                    <span className="col-span-2"><span className="font-semibold text-slate-600 dark:text-slate-300">Veículo:</span> {inv.vehicle_id ? (vehicleMap[inv.vehicle_id] ?? '—') : '—'}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

    </div>
  );
};
