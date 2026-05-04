import React, { useState, useEffect, useMemo } from 'react';
import { db } from '../services/db';
import { Invoice, Driver, Vehicle, DeliveryStatus, DeliveryProof } from '../types';
import { Search, ChevronLeft, ChevronRight, Loader2, X, TrendingUp, Clock, CheckCircle, AlertTriangle, AlertOctagon, RotateCw, Package, ArrowUp, ArrowDown, ExternalLink, FileText, User, Map as MapIcon, Printer, ZoomIn, ZoomOut, Eye, EyeOff } from 'lucide-react';

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
  const [authenticated, setAuthenticated] = useState(false);
  const [passwordInput, setPasswordInput] = useState('');
  const [passwordError, setPasswordError] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // ── dados ──────────────────────────────────────────────────────────────────
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);

  // ── filtros ────────────────────────────────────────────────────────────────
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

  // ── paginação ──────────────────────────────────────────────────────────────
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  // ── comprovante ────────────────────────────────────────────────────────────
  const [viewingProof, setViewingProof] = useState<{ invoice: Invoice; proof: DeliveryProof } | null>(null);
  const [loadingProofId, setLoadingProofId] = useState<string | null>(null);
  const [zoomedImage, setZoomedImage] = useState<string | null>(null);
  const [zoomedScale, setZoomedScale] = useState(1);

  useEffect(() => {
    if (!authenticated) return;
    Promise.all([db.getInvoices(), db.getDrivers(), db.getVehicles()]).then(
      ([inv, drv, veh]) => { setInvoices(inv); setDrivers(drv); setVehicles(veh); setLoading(false); }
    );
  }, [authenticated]);

  const driverMap = useMemo(() => Object.fromEntries(drivers.map(d => [d.id, d.name])), [drivers]);
  const vehicleMap = useMemo(() => Object.fromEntries(vehicles.map(v => [v.id, `${v.plate} — ${v.model}`])), [vehicles]);

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
        matchesStart && matchesEnd && matchesDeliveryStart && matchesDeliveryEnd;
    });
  }, [invoices, searchTerm, filterDriver, filterVehicle, filterStatus, filterStartDate, filterEndDate, filterDeliveryStartDate, filterDeliveryEndDate]);

  const sorted = useMemo(() => {
    const items = [...filtered];
    items.sort((a: any, b: any) => {
      for (const { key, direction } of sortConfig) {
        let aValue = a[key];
        let bValue = b[key];
        if (key === 'driver_id') { aValue = drivers.find(d => d.id === a.driver_id)?.name || ''; bValue = drivers.find(d => d.id === b.driver_id)?.name || ''; }
        if (key === 'vehicle_id') { aValue = vehicles.find(v => v.id === a.vehicle_id)?.plate || ''; bValue = vehicles.find(v => v.id === b.vehicle_id)?.plate || ''; }
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

  useEffect(() => { setCurrentPage(1); }, [searchTerm, filterDriver, filterVehicle, filterStatus, filterStartDate, filterEndDate, filterDeliveryStartDate, filterDeliveryEndDate, sortConfig]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const paginated = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return sorted.slice(start, start + pageSize);
  }, [sorted, currentPage, pageSize]);

  // ── handlers ───────────────────────────────────────────────────────────────
  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    const configured = import.meta.env.VITE_SELLER_PASSWORD as string | undefined;
    if (configured && passwordInput === configured) {
      setAuthenticated(true);
      setPasswordError(false);
    } else {
      setPasswordError(true);
      setPasswordInput('');
    }
  };

  if (!authenticated) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex flex-col items-center justify-center p-4">
        <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl w-full max-w-sm overflow-hidden">
          <div className="bg-emerald-600 p-6 text-white">
            <div className="h-12 w-12 bg-white/20 rounded-xl flex items-center justify-center mb-3">
              <Package size={26} />
            </div>
            <h1 className="text-xl font-bold">Consulta de Pedidos</h1>
            <p className="text-emerald-100 text-sm mt-1">Visão do Vendedor</p>
          </div>
          <form onSubmit={handleLogin} className="p-6 space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase mb-1.5">
                Senha de acesso
              </label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={passwordInput}
                  onChange={e => { setPasswordInput(e.target.value); setPasswordError(false); }}
                  placeholder="Digite a senha"
                  autoFocus
                  className={`w-full px-3 py-2.5 pr-10 border rounded-lg text-sm outline-none transition-colors bg-white dark:bg-slate-700 text-slate-900 dark:text-white
                    ${passwordError
                      ? 'border-red-400 focus:ring-2 focus:ring-red-300'
                      : 'border-slate-300 dark:border-slate-600 focus:ring-2 focus:ring-emerald-500'}`}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(s => !s)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              {passwordError && (
                <p className="mt-1.5 text-xs text-red-500 flex items-center gap-1">
                  <AlertTriangle size={12} /> Senha incorreta.
                </p>
              )}
            </div>
            <button
              type="submit"
              className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-lg text-sm transition-colors"
            >
              Entrar
            </button>
            <button
              type="button"
              onClick={onBack}
              className="w-full py-2 text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 text-sm transition-colors"
            >
              Voltar
            </button>
          </form>
        </div>
      </div>
    );
  }

  const hasActiveFilter = !!(searchTerm || filterDriver || filterVehicle || filterStatus || filterStartDate || filterEndDate || filterDeliveryStartDate || filterDeliveryEndDate);

  const clearFilters = () => {
    setSearchTerm(''); setFilterDriver(''); setFilterVehicle(''); setFilterStatus('');
    setFilterStartDate(''); setFilterEndDate(''); setFilterDeliveryStartDate(''); setFilterDeliveryEndDate('');
  };

  const requestSort = (key: string) => {
    setSortConfig(prev => {
      const existing = prev.find(s => s.key === key);
      if (!existing) return [{ key, direction: 'asc' as const }, ...prev];
      if (existing.direction === 'asc') return prev.map(s => s.key === key ? { ...s, direction: 'desc' as const } : s);
      const remaining = prev.filter(s => s.key !== key);
      return remaining.length > 0 ? remaining : [{ key: 'created_at', direction: 'desc' as const }];
    });
  };

  const handleViewProof = async (invoice: Invoice) => {
    setLoadingProofId(invoice.id);
    try {
      const proof = await db.getProofByInvoiceId(invoice.id);
      if (!proof) { alert('Comprovante ainda não sincronizado ou não encontrado.'); return; }
      setViewingProof({ invoice, proof });
    } finally {
      setLoadingProofId(null);
    }
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
                  {paginated.map(inv => (
                    <tr key={inv.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors">
                      <td className="px-4 py-3 font-mono font-semibold text-slate-700 dark:text-slate-200 whitespace-nowrap">
                        {inv.number}
                        {inv.series && (
                          <span className="text-xs text-slate-400 dark:text-slate-500 ml-1">/{inv.series}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 max-w-[180px]">
                        <div className="font-medium text-slate-800 dark:text-slate-100 truncate">
                          {inv.customer_name}
                        </div>
                        <div className="text-xs text-slate-400 dark:text-slate-500 truncate">{inv.customer_doc}</div>
                      </td>
                      <td className="px-4 py-3 text-slate-700 dark:text-slate-300 whitespace-nowrap">
                        {formatCurrency(inv.value)}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-semibold ${STATUS_STYLE[inv.status]}`}>
                          {STATUS_ICON[inv.status]}
                          {STATUS_LABEL[inv.status] ?? inv.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-300 whitespace-nowrap max-w-[130px] truncate"
                          title={inv.driver_id ? (driverMap[inv.driver_id] ?? '') : ''}>
                        {inv.driver_id ? (driverMap[inv.driver_id] ?? '—') : '—'}
                      </td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-300 whitespace-nowrap max-w-[130px] truncate"
                          title={inv.vehicle_id ? (vehicleMap[inv.vehicle_id] ?? '') : ''}>
                        {inv.vehicle_id ? (vehicleMap[inv.vehicle_id] ?? '—') : '—'}
                      </td>
                      <td className="px-4 py-3 text-slate-500 dark:text-slate-400 whitespace-nowrap">
                        {formatDate(inv.created_at)}
                      </td>
                      <td className="px-4 py-3 text-slate-500 dark:text-slate-400 whitespace-nowrap">
                        {formatDate(inv.delivered_at)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
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
                          {(inv.status === 'DELIVERED' || inv.status === 'FAILED' || inv.status === 'ISSUE') && (
                            <button
                              onClick={() => handleViewProof(inv)}
                              disabled={loadingProofId === inv.id}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-colors disabled:opacity-50"
                            >
                              {loadingProofId === inv.id ? <Loader2 size={12} className="animate-spin" /> : <FileText size={12} />}
                              Comprovante
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="md:hidden divide-y divide-slate-100 dark:divide-slate-700">
              {paginated.map(inv => (
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
                      {(inv.status === 'DELIVERED' || inv.status === 'FAILED' || inv.status === 'ISSUE') && (
                        <button
                          onClick={() => handleViewProof(inv)}
                          disabled={loadingProofId === inv.id}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30 disabled:opacity-50"
                        >
                          {loadingProofId === inv.id ? <Loader2 size={12} className="animate-spin" /> : <FileText size={12} />}
                          Comprovante
                        </button>
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

            {/* Paginação */}
            <div className="px-4 py-3 border-t border-slate-100 dark:border-slate-700 flex flex-wrap items-center justify-between gap-3 bg-white dark:bg-slate-800">
              <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400 text-xs">
                <span>
                  {Math.min((currentPage - 1) * pageSize + 1, sorted.length)}–{Math.min(currentPage * pageSize, sorted.length)} de {sorted.length}
                </span>
                <select
                  value={pageSize}
                  onChange={e => { setPageSize(Number(e.target.value)); setCurrentPage(1); }}
                  className="ml-2 p-1 border border-slate-200 dark:border-slate-600 rounded-md bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {[25, 50, 100].map(n => <option key={n} value={n}>{n} / pág.</option>)}
                </select>
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => setCurrentPage(1)} disabled={currentPage === 1}
                  className="px-2 py-1 rounded text-xs text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed">«</button>
                <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1}
                  className="p-1 rounded text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed">
                  <ChevronLeft size={16} /></button>
                {Array.from({ length: totalPages }, (_, i) => i + 1)
                  .filter(p => p === 1 || p === totalPages || Math.abs(p - currentPage) <= 1)
                  .reduce<(number | '...')[]>((acc, p, i, arr) => {
                    if (i > 0 && typeof arr[i - 1] === 'number' && (p as number) - (arr[i - 1] as number) > 1) acc.push('...');
                    acc.push(p); return acc;
                  }, [])
                  .map((item, i) => item === '...'
                    ? <span key={`e${i}`} className="px-1 text-slate-400">…</span>
                    : <button key={item} onClick={() => setCurrentPage(item as number)}
                        className={`min-w-[28px] px-2 py-1 rounded text-xs font-medium ${currentPage === item ? 'bg-blue-600 text-white' : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'}`}
                      >{item}</button>
                  )}
                <button onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages}
                  className="p-1 rounded text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed">
                  <ChevronRight size={16} /></button>
                <button onClick={() => setCurrentPage(totalPages)} disabled={currentPage === totalPages}
                  className="px-2 py-1 rounded text-xs text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed">»</button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Modal Comprovante */}
      {viewingProof && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-3xl overflow-hidden max-h-[90vh] flex flex-col">

            {/* Header */}
            <div className={`p-5 text-white flex justify-between items-center ${
              viewingProof.proof.failure_reason ? 'bg-red-600 dark:bg-red-700' : 'bg-green-600 dark:bg-green-700'
            }`}>
              <div>
                <h3 className="font-bold flex items-center gap-2 text-lg">
                  <FileText size={22} />
                  {viewingProof.proof.failure_reason ? 'Devolução / Falha' : 'Comprovante de Entrega'}
                </h3>
                <p className="text-white/80 text-sm mt-1">
                  NF-e {viewingProof.invoice.number} • R$ {viewingProof.invoice.value.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                </p>
              </div>
              <button onClick={() => setViewingProof(null)} className="hover:bg-white/20 rounded-full p-2 transition-colors">
                <X size={24} />
              </button>
            </div>

            <div className="overflow-y-auto p-6 space-y-6">

              {/* Banner falha/devolução */}
              {viewingProof.proof.failure_reason && (
                <div className="border bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-800 dark:text-red-300 p-4 rounded-lg flex items-start gap-3">
                  <AlertTriangle className="shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold block mb-1">
                      {viewingProof.proof.return_type === 'PARTIAL' ? 'Devolução Parcial' : 'Devolução Total'}
                    </span>
                    <p className="text-sm">{viewingProof.proof.failure_reason}</p>
                    {viewingProof.proof.return_type === 'PARTIAL' && viewingProof.proof.return_items && (
                      <pre className="mt-2 text-sm whitespace-pre-wrap font-sans bg-white/50 dark:bg-black/20 p-2 rounded">
                        {viewingProof.proof.return_items}
                      </pre>
                    )}
                  </div>
                </div>
              )}

              {/* Recebedor + Operação */}
              <div className="grid md:grid-cols-2 gap-6">
                <div className="space-y-4">
                  <h4 className="font-bold text-slate-700 dark:text-slate-300 uppercase text-sm border-b dark:border-slate-700 pb-1">Dados do Recebedor</h4>
                  <div className="flex items-start gap-3">
                    <User className="text-slate-400 mt-1" size={18} />
                    <div>
                      <label className="block text-xs text-slate-500 dark:text-slate-400">Nome</label>
                      <span className="font-medium text-slate-800 dark:text-white text-lg">{viewingProof.proof.receiver_name}</span>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <FileText className="text-slate-400 mt-1" size={18} />
                    <div>
                      <label className="block text-xs text-slate-500 dark:text-slate-400">Documento (RG/CPF)</label>
                      <span className="font-medium text-slate-800 dark:text-white">{viewingProof.proof.receiver_doc}</span>
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  <h4 className="font-bold text-slate-700 dark:text-slate-300 uppercase text-sm border-b dark:border-slate-700 pb-1">Dados da Operação</h4>
                  <div className="flex items-start gap-3">
                    <Clock className="text-slate-400 mt-1" size={18} />
                    <div>
                      <label className="block text-xs text-slate-500 dark:text-slate-400">Data/Hora</label>
                      <span className="font-medium text-slate-800 dark:text-white">
                        {new Date(viewingProof.proof.delivered_at).toLocaleString('pt-BR')}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <MapIcon className="text-slate-400 mt-1" size={18} />
                    <div>
                      <label className="block text-xs text-slate-500 dark:text-slate-400">Localização (GPS)</label>
                      <span className="font-medium text-slate-800 dark:text-white block">
                        {viewingProof.proof.geo_lat ? `${viewingProof.proof.geo_lat}, ${viewingProof.proof.geo_long}` : 'Não capturado'}
                      </span>
                      {viewingProof.proof.geo_lat && (
                        <a
                          href={`https://www.google.com/maps?q=${viewingProof.proof.geo_lat},${viewingProof.proof.geo_long}`}
                          target="_blank" rel="noreferrer"
                          className="text-blue-600 dark:text-blue-400 hover:underline text-xs"
                        >
                          Ver no Google Maps
                        </a>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Imagens */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-4 border-t dark:border-slate-700">
                <div>
                  <h4 className="font-bold text-slate-700 dark:text-slate-300 uppercase text-sm mb-3">Assinatura Digital</h4>
                  <div className="border border-slate-200 dark:border-slate-600 rounded-lg bg-white p-2 h-40 flex items-center justify-center shadow-sm">
                    {viewingProof.proof.signature_data
                      ? <img src={viewingProof.proof.signature_data} alt="Assinatura" className="max-h-full max-w-full" />
                      : <span className="text-slate-400 italic text-sm">Não assinada</span>}
                  </div>
                </div>
                <div>
                  <h4 className="font-bold text-slate-700 dark:text-slate-300 uppercase text-sm mb-3">Foto / Evidência</h4>
                  <div
                    className="border border-slate-200 dark:border-slate-600 rounded-lg bg-slate-50 dark:bg-slate-900 h-40 flex items-center justify-center overflow-hidden shadow-sm cursor-pointer hover:ring-2 hover:ring-blue-400 transition-all"
                    onClick={() => { if (viewingProof.proof.photo_url) { setZoomedImage(viewingProof.proof.photo_url); setZoomedScale(1); } }}
                  >
                    {viewingProof.proof.photo_url
                      ? <img src={viewingProof.proof.photo_url} alt="Evidência" className="w-full h-full object-cover" />
                      : <span className="text-slate-400 italic text-sm">Sem foto</span>}
                  </div>
                </div>
                <div>
                  <h4 className="font-bold text-slate-700 dark:text-slate-300 uppercase text-sm mb-3">Canhoto Físico</h4>
                  <div
                    className="border border-slate-200 dark:border-slate-600 rounded-lg bg-slate-50 dark:bg-slate-900 h-40 flex items-center justify-center overflow-hidden shadow-sm cursor-pointer hover:ring-2 hover:ring-blue-400 transition-all"
                    onClick={() => { if (viewingProof.proof.photo_stub_url) { setZoomedImage(viewingProof.proof.photo_stub_url); setZoomedScale(1); } }}
                  >
                    {viewingProof.proof.photo_stub_url
                      ? <img src={viewingProof.proof.photo_stub_url} alt="Canhoto" className="w-full h-full object-cover" />
                      : <span className="text-slate-400 italic text-sm">Não anexado</span>}
                  </div>
                </div>
              </div>
            </div>

            {/* Rodapé */}
            <div className="bg-slate-50 dark:bg-slate-900 p-4 border-t dark:border-slate-700 flex justify-end gap-3">
              <button
                onClick={() => {
                  const w = window.open('', '_blank', 'width=900,height=800');
                  if (!w) return alert('Permita pop-ups para imprimir.');
                  const { invoice, proof } = viewingProof;
                  w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Comprovante NF-e ${invoice.number}</title>
                    <style>body{font-family:sans-serif;padding:24px;color:#1e293b}h1{font-size:20px;margin-bottom:4px}
                    .grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin:16px 0}
                    .label{font-size:11px;color:#64748b;text-transform:uppercase}
                    .value{font-size:15px;font-weight:600;margin-top:2px}
                    .imgs{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-top:16px}
                    .imgs img{width:100%;height:160px;object-fit:cover;border:1px solid #e2e8f0;border-radius:8px}
                    .imgs h4{font-size:11px;text-transform:uppercase;color:#64748b;margin-bottom:6px}
                    @media print{button{display:none}}</style></head><body>
                    <h1>Comprovante de Entrega Digital</h1>
                    <p style="color:#64748b;font-size:13px">NF-e ${invoice.number} • Série ${invoice.series} • Gerado em ${new Date().toLocaleString('pt-BR')}</p>
                    <div class="grid">
                      <div><div class="label">Recebedor</div><div class="value">${proof.receiver_name}</div></div>
                      <div><div class="label">Documento</div><div class="value">${proof.receiver_doc}</div></div>
                      <div><div class="label">Data/Hora</div><div class="value">${new Date(proof.delivered_at).toLocaleString('pt-BR')}</div></div>
                      <div><div class="label">GPS</div><div class="value">${proof.geo_lat ? `${proof.geo_lat}, ${proof.geo_long}` : 'Não capturado'}</div></div>
                    </div>
                    <div class="imgs">
                      <div><h4>Assinatura</h4>${proof.signature_data ? `<img src="${proof.signature_data}" style="height:150px;object-fit:contain" />` : '<p>Não assinada</p>'}</div>
                      <div><h4>Foto / Evidência</h4>${proof.photo_url ? `<img src="${proof.photo_url}" />` : '<p>Sem foto</p>'}</div>
                      <div><h4>Canhoto Físico</h4>${proof.photo_stub_url ? `<img src="${proof.photo_stub_url}" />` : '<p>Não anexado</p>'}</div>
                    </div>
                    <script>window.onload=()=>window.print()</script></body></html>`);
                  w.document.close();
                }}
                className="flex items-center gap-2 px-5 py-2 bg-slate-800 dark:bg-white text-white dark:text-slate-900 rounded-lg hover:bg-slate-700 transition-colors font-bold"
              >
                <Printer size={16} /> Imprimir / PDF
              </button>
              <button
                onClick={() => setViewingProof(null)}
                className="px-5 py-2 bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-lg hover:bg-slate-300 dark:hover:bg-slate-600 font-medium"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Zoom */}
      {zoomedImage && (
        <div className="fixed inset-0 z-[60] bg-black/90 flex flex-col items-center justify-center" onClick={() => setZoomedImage(null)}>
          <div className="flex gap-3 mb-3" onClick={e => e.stopPropagation()}>
            <button onClick={() => setZoomedScale(s => Math.min(s + 0.25, 4))} className="p-2 bg-white/10 hover:bg-white/20 rounded-lg text-white"><ZoomIn size={18} /></button>
            <button onClick={() => setZoomedScale(s => Math.max(s - 0.25, 0.5))} className="p-2 bg-white/10 hover:bg-white/20 rounded-lg text-white"><ZoomOut size={18} /></button>
            <button onClick={() => setZoomedImage(null)} className="p-2 bg-white/10 hover:bg-white/20 rounded-lg text-white"><X size={18} /></button>
          </div>
          <img
            src={zoomedImage}
            alt="Zoom"
            style={{ transform: `scale(${zoomedScale})`, transition: 'transform 0.2s' }}
            className="max-w-full max-h-[80vh] object-contain rounded-lg"
            onClick={e => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
};
