import React, { useState, useEffect, useMemo, useRef } from 'react';
import { db } from '../services/db';
import { Invoice, Driver, Vehicle, DeliveryStatus, DeliveryProof } from '../types';
import { isReturnProof, formatProofReason } from '../constants/returnReasons';
import { Search, ChevronLeft, ChevronRight, Loader2, X, TrendingUp, Clock, CheckCircle, AlertTriangle, AlertOctagon, RotateCw, Package, ArrowUp, ArrowDown, ExternalLink, FileText, User, Map as MapIcon, Printer, ZoomIn, ZoomOut, Eye, EyeOff, Truck, Satellite, Navigation2 } from 'lucide-react';
import Map, { Marker, NavigationControl, Source, Layer } from 'react-map-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
const MAPBOX_TOKEN = (import.meta.env.VITE_MAPBOX_TOKEN as string) || '';

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

/** Abre rastreamento SSW em nova aba com CNPJ e NF pré-preenchidos (fallback) */
const trackOnSSWFallback = (invoiceNumber: string) => {
  const form = document.createElement('form');
  form.action = 'https://ssw.inf.br/2/ssw_resultSSW';
  form.method = 'POST';
  form.target = '_blank';
  form.style.display = 'none';
  const add = (name: string, value: string) => {
    const input = document.createElement('input');
    input.type = 'hidden'; input.name = name; input.value = value;
    form.appendChild(input);
  };
  add('cnpj', '03326448000198');
  add('NR', invoiceNumber);
  document.body.appendChild(form);
  form.submit();
  document.body.removeChild(form);
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
  const [loginLoading, setLoginLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'notas' | 'frota'>('notas');
  const [fleetRefreshing, setFleetRefreshing] = useState(false);
  const [lastFleetSync, setLastFleetSync] = useState<Date | null>(null);
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null);
  const mapRef = useRef<any>(null);
  // Rastreio de nota específica (badge "Em Rota" ou clique no pacote): distância caminhão → entrega
  const [trackedInvoiceId, setTrackedInvoiceId] = useState<string | null>(null);
  const [trackedRoute, setTrackedRoute] = useState<{ distanceM: number; durationS: number; durationTypicalS?: number } | null>(null);

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

  // ── rastreamento SSW ───────────────────────────────────────────────────────
  const [sswModal, setSswModal] = useState<{
    open: boolean;
    invoice: Invoice | null;
    loading: boolean;
    events: Array<{ dataHora?: string; local?: string; localUnidade?: string; situacao?: string; ocorrencia?: string; [key: string]: any }>;
    raw: any;
    error: string | null;
  }>({ open: false, invoice: null, loading: false, events: [], raw: null, error: null });

  const openSSWTracking = async (inv: Invoice) => {
    setSswModal({ open: true, invoice: inv, loading: true, events: [], raw: null, error: null });
    try {
      const res = await fetch('https://ssw.inf.br/api/trackingdanfe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chave_nfe: inv.access_key }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const events =
        data?.documento?.tracking ??
        data?.rastreamento ??
        data?.ocorrencias ??
        data?.eventos ??
        (Array.isArray(data) ? data : []);
      setSswModal(prev => ({ ...prev, loading: false, events, raw: data }));
    } catch (err: any) {
      const isCors = err instanceof TypeError || err?.message?.includes('Failed to fetch');
      setSswModal(prev => ({
        ...prev,
        loading: false,
        error: isCors ? 'CORS_BLOCKED' : (err?.message || 'Erro desconhecido'),
      }));
    }
  };

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

  // Geocodifica notas pendentes de um veículo e atualiza o estado local
  const geocodeInvoice = async (invoice: Invoice): Promise<Invoice> => {
    if (invoice.lat && invoice.lng) return invoice;
    try {
      const clean = invoice.customer_address.split('||')[0];
      const query = encodeURIComponent(`${clean}, Brasil`);
      const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${query}.json?access_token=${MAPBOX_TOKEN}&limit=1`;
      const res = await fetch(url);
      const data = await res.json();
      if (data.features?.length > 0) {
        const [lng, lat] = data.features[0].center;
        return { ...invoice, lat, lng };
      }
    } catch { /* silencioso */ }
    return invoice;
  };

  const handleSelectVehicle = async (vehicleId: string, lat?: number, lng?: number, forceSelect = false) => {
    const willDeselect = !forceSelect && selectedVehicleId === vehicleId;
    setSelectedVehicleId(willDeselect ? null : vehicleId);
    // Encerra o rastreio ao desmarcar ou trocar para veículo diferente do da nota rastreada
    setTrackedInvoiceId(prev => {
      if (!prev || willDeselect) return null;
      const tInv = invoices.find(i => i.id === prev);
      return tInv?.vehicle_id === vehicleId ? prev : null;
    });
    if (willDeselect) return;
    if (lat && lng) mapRef.current?.flyTo({ center: [lng, lat], zoom: 13, duration: 1500 });
    const pending = invoices.filter(i =>
      i.vehicle_id === vehicleId &&
      (i.status === 'PENDING' || i.status === 'IN_PROGRESS')
    );
    const updated = await Promise.all(pending.map(geocodeInvoice));
    setInvoices(prev => prev.map(inv => updated.find(u => u.id === inv.id) ?? inv));
  };

  // Nota rastreada e veículo correspondente (derivados do estado atual)
  const trackedInv = trackedInvoiceId ? invoices.find(i => i.id === trackedInvoiceId) : null;
  const trackedVeh = trackedInv?.vehicle_id ? vehicles.find(v => v.id === trackedInv.vehicle_id) : null;

  // Rota com trânsito em tempo real (driving-traffic): caminhão → entrega rastreada
  useEffect(() => {
    const vLoc = trackedVeh?.last_location;
    if (activeTab !== 'frota' || !trackedInv?.lat || !trackedInv?.lng || !vLoc) {
      setTrackedRoute(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `https://api.mapbox.com/directions/v5/mapbox/driving-traffic/` +
          `${vLoc.lng},${vLoc.lat};${trackedInv.lng},${trackedInv.lat}` +
          `?geometries=geojson&overview=full&access_token=${MAPBOX_TOKEN}`
        );
        const data = await res.json();
        const route = data.routes?.[0];
        if (!cancelled && route) {
          setTrackedRoute({
            distanceM: route.distance ?? 0,
            durationS: route.duration ?? 0,
            durationTypicalS: route.duration_typical ?? undefined,
          });
        }
      } catch { /* mantém a última rota calculada */ }
    })();
    return () => { cancelled = true; };
  }, [activeTab, trackedInv?.lat, trackedInv?.lng, trackedVeh?.last_location?.lat, trackedVeh?.last_location?.lng]);

  // Clique no badge "Em Rota": abre a aba frota com o veículo da nota selecionado e rastreado
  const handleTrackInvoiceVehicle = (inv: Invoice) => {
    if (!inv.vehicle_id) return;
    const vehicle = vehicles.find(v => v.id === inv.vehicle_id);
    setTrackedInvoiceId(inv.id);
    setActiveTab('frota');
    // Aguarda a aba e o mapa montarem antes de selecionar/voar até o veículo
    setTimeout(() => {
      handleSelectVehicle(inv.vehicle_id!, vehicle?.last_location?.lat, vehicle?.last_location?.lng, true);
    }, 400);
  };

  // Refresh da frota (manual ou automático)
  const refreshFleet = async () => {
    setFleetRefreshing(true);
    try {
      const veh = await db.getVehicles();
      setVehicles(veh);
      setLastFleetSync(new Date());
    } finally {
      setFleetRefreshing(false);
    }
  };

  // Dispara refreshFleet a cada 60s quando a aba frota está ativa
  useEffect(() => {
    if (!authenticated || activeTab !== 'frota') return;
    refreshFleet(); // sincroniza imediatamente ao entrar na aba
    const interval = setInterval(refreshFleet, 60_000);
    return () => clearInterval(interval);
  }, [authenticated, activeTab]);

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
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginLoading(true);
    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
      const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
      const res = await fetch(`${supabaseUrl}/functions/v1/verify-seller-password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${supabaseKey}`,
        },
        body: JSON.stringify({ password: passwordInput }),
      });
      const data = await res.json();
      if (data.valid) {
        setAuthenticated(true);
        setPasswordError(false);
      } else {
        setPasswordError(true);
        setPasswordInput('');
      }
    } catch {
      setPasswordError(true);
      setPasswordInput('');
    } finally {
      setLoginLoading(false);
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
              disabled={loginLoading}
              className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white font-semibold rounded-lg text-sm transition-colors flex items-center justify-center gap-2"
            >
              {loginLoading ? <><Loader2 size={16} className="animate-spin" /> Verificando...</> : 'Entrar'}
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
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 transition-colors duration-300 overflow-x-hidden">
      {/* Header */}
      <div className="bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 sticky top-0 z-10 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center gap-4">
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
              <h1 className="text-lg font-bold text-slate-800 dark:text-white leading-tight">Visão do Vendedor</h1>
            </div>
          </div>

          {/* Abas */}
          <div className="flex items-center gap-1 ml-6 bg-slate-100 dark:bg-slate-700 p-1 rounded-lg">
            <button
              onClick={() => setActiveTab('notas')}
              className={`flex items-center gap-2 px-4 py-1.5 rounded-md text-sm font-medium transition-all ${activeTab === 'notas' ? 'bg-white dark:bg-slate-600 text-slate-800 dark:text-white shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}
            >
              <FileText size={15} /> Notas
            </button>
            <button
              onClick={() => { setTrackedInvoiceId(null); setActiveTab('frota'); }}
              className={`flex items-center gap-2 px-4 py-1.5 rounded-md text-sm font-medium transition-all ${activeTab === 'frota' ? 'bg-white dark:bg-slate-600 text-slate-800 dark:text-white shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}
            >
              <Satellite size={15} /> Frota
            </button>
          </div>

          <div className="ml-auto text-xs text-slate-400 dark:text-slate-500 font-mono">
            {activeTab === 'notas' && (loading ? '...' : `${filtered.length} de ${invoices.length} notas`)}
          </div>
        </div>
      </div>

      {/* Aba Frota */}
      {activeTab === 'frota' && (
        <div className="flex h-[calc(100vh-64px)]">
          {/* Lista lateral */}
          <div className="w-72 flex-shrink-0 border-r border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 flex flex-col overflow-y-auto">
            <div className="p-4 border-b border-slate-200 dark:border-slate-700">
              <div className="flex items-center justify-between">
                <h3 className="font-bold text-slate-800 dark:text-white flex items-center gap-2">
                  <Satellite size={18} className="text-blue-500" /> Frota em Tempo Real
                </h3>
                <button
                  onClick={refreshFleet}
                  disabled={fleetRefreshing}
                  title="Atualizar frota"
                  className="p-1.5 rounded-lg text-slate-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors disabled:opacity-50"
                >
                  <RotateCw size={15} className={fleetRefreshing ? 'animate-spin' : ''} />
                </button>
              </div>
              <p className="text-xs text-slate-400 mt-1">
                {lastFleetSync
                  ? `Última sync: ${lastFleetSync.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`
                  : 'Sincronizando...'}
              </p>
            </div>
            <div className="p-2 space-y-2">
              {vehicles.map(v => {
                const hasLocation = !!v.last_location;
                const lastUpdate = hasLocation ? new Date(v.last_location!.updated_at) : null;
                const isOnline = lastUpdate && (new Date().getTime() - lastUpdate.getTime() < 5 * 60 * 1000);
                const pendingCount = invoices.filter(i =>
                  i.vehicle_id === v.id &&
                  i.status !== 'DELIVERED' &&
                  i.status !== 'RETURNED' &&
                  i.status !== 'FAILED'
                ).length;
                const isSelected = selectedVehicleId === v.id;

                return (
                  <div
                    key={v.id}
                    onClick={() => {
                      if (isSelected) { setSelectedVehicleId(null); setTrackedInvoiceId(null); return; }
                      handleSelectVehicle(v.id, v.last_location?.lat, v.last_location?.lng);
                    }}
                    className={`p-3 rounded-lg border transition-all flex items-center justify-between cursor-pointer
                      ${isSelected
                        ? 'bg-blue-50 dark:bg-blue-900/30 border-blue-400 dark:border-blue-500 shadow-sm'
                        : hasLocation
                          ? 'hover:bg-slate-50 dark:hover:bg-slate-800 border-slate-100 dark:border-slate-700 hover:border-blue-200'
                          : 'opacity-50 border-transparent'}
                    `}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`w-9 h-9 rounded-full flex items-center justify-center text-white shadow-sm ${isSelected ? 'bg-blue-600 ring-2 ring-blue-300' : isOnline ? 'bg-blue-500' : 'bg-slate-400'}`}>
                        <Truck size={16} />
                      </div>
                      <div>
                        <span className="font-bold text-slate-700 dark:text-slate-200 text-sm block">{v.plate}</span>
                        <span className="text-xs text-slate-400 block">{v.model}</span>
                        <span className="text-[10px] text-slate-500 flex items-center gap-1 mt-0.5">
                          <div className={`w-1.5 h-1.5 rounded-full ${isOnline ? 'bg-green-500 animate-pulse' : 'bg-slate-300'}`} />
                          {isOnline ? 'Online' : 'Offline'}
                          {v.last_location?.speed_kmh !== undefined && isOnline && (
                            <span className="ml-1">{v.last_location.speed_kmh} km/h</span>
                          )}
                        </span>
                      </div>
                    </div>
                    <span className={`text-xs font-bold px-2 py-1 rounded ${pendingCount > 0 ? 'bg-orange-100 dark:bg-orange-900/40 text-orange-600 dark:text-orange-400' : 'bg-slate-100 dark:bg-slate-700 text-slate-400'}`}>
                      {pendingCount}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Mapa */}
          <div className="flex-1 relative">
            {/* Card de rastreio: distância e ETA com trânsito até a entrega */}
            {trackedInv && (
              <div className="absolute top-4 left-4 z-10 w-72 bg-white dark:bg-slate-900 rounded-xl shadow-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
                <div className="flex items-center justify-between gap-2 px-4 py-2.5 bg-blue-600 text-white">
                  <span className="flex items-center gap-2 text-sm font-bold">
                    <Navigation2 size={15} /> Rastreando entrega
                  </span>
                  <button
                    onClick={() => setTrackedInvoiceId(null)}
                    title="Parar de rastrear"
                    className="p-1 rounded-full hover:bg-white/20 transition-colors cursor-pointer"
                  >
                    <X size={14} />
                  </button>
                </div>
                <div className="px-4 py-3 space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-mono text-slate-400 shrink-0">NF {trackedInv.number}</span>
                    <span className="text-xs font-semibold text-slate-700 dark:text-slate-200 truncate">
                      {trackedInv.customer_name}
                    </span>
                  </div>
                  {!trackedVeh?.last_location ? (
                    <p className="text-xs text-orange-500 flex items-center gap-1.5">
                      <AlertTriangle size={13} /> Veículo sem sinal de GPS
                    </p>
                  ) : !trackedInv.lat || !trackedInv.lng ? (
                    <p className="text-xs text-orange-500 flex items-center gap-1.5">
                      <AlertTriangle size={13} /> Entrega sem coordenadas no mapa
                    </p>
                  ) : trackedRoute ? (() => {
                    const delayMin = trackedRoute.durationTypicalS
                      ? Math.round((trackedRoute.durationS - trackedRoute.durationTypicalS) / 60)
                      : 0;
                    const ratio = trackedRoute.durationTypicalS
                      ? trackedRoute.durationS / trackedRoute.durationTypicalS
                      : 1;
                    const traffic = ratio < 1.1
                      ? { label: 'Trânsito fluindo', dot: 'bg-green-500', text: 'text-green-600 dark:text-green-400' }
                      : ratio < 1.35
                      ? { label: 'Trânsito moderado', dot: 'bg-orange-500', text: 'text-orange-600 dark:text-orange-400' }
                      : { label: 'Trânsito intenso', dot: 'bg-red-500', text: 'text-red-600 dark:text-red-400' };
                    return (
                      <>
                        <div className="flex items-center gap-4">
                          <div>
                            <p className="text-lg font-black text-blue-600 dark:text-blue-400 leading-tight">
                              {(trackedRoute.distanceM / 1000).toFixed(1)} km
                            </p>
                            <p className="text-[10px] text-slate-400 uppercase tracking-wide font-bold">Distância</p>
                          </div>
                          <div>
                            <p className="text-lg font-black text-slate-700 dark:text-slate-200 leading-tight">
                              ~{Math.max(1, Math.round(trackedRoute.durationS / 60))} min
                            </p>
                            <p className="text-[10px] text-slate-400 uppercase tracking-wide font-bold">Com trânsito agora</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 pt-0.5">
                          <span className={`w-2 h-2 rounded-full ${traffic.dot} ${ratio >= 1.35 ? 'animate-pulse' : ''}`} />
                          <span className={`text-[11px] font-bold ${traffic.text}`}>{traffic.label}</span>
                          {delayMin >= 1 && (
                            <span className="text-[11px] text-slate-400">· +{delayMin} min de atraso</span>
                          )}
                        </div>
                      </>
                    );
                  })() : (
                    <p className="text-xs text-slate-400 flex items-center gap-1.5">
                      <Loader2 size={13} className="animate-spin" /> Calculando rota...
                    </p>
                  )}
                </div>
              </div>
            )}
            <Map
              ref={mapRef}
              initialViewState={{ latitude: -12.9777, longitude: -38.5016, zoom: 11 }}
              style={{ width: '100%', height: '100%' }}
              mapStyle="mapbox://styles/mapbox/streets-v12"
              mapboxAccessToken={MAPBOX_TOKEN}
            >
              <NavigationControl position="bottom-right" />
              {/* Marcadores de veículos */}
              {vehicles.map(v => {
                if (!v.last_location) return null;
                const isOnline = (new Date().getTime() - new Date(v.last_location.updated_at).getTime()) < 5 * 60 * 1000;
                const isSelected = selectedVehicleId === v.id;
                return (
                  <Marker
                    key={v.id}
                    latitude={v.last_location.lat}
                    longitude={v.last_location.lng}
                    anchor="bottom"
                  >
                    <div
                      className={`flex flex-col items-center cursor-pointer transition-transform duration-300 ${isSelected ? 'scale-125 z-50' : 'scale-100'}`}
                      onClick={() => {
                        if (isSelected) { setSelectedVehicleId(null); setTrackedInvoiceId(null); return; }
                        handleSelectVehicle(v.id, v.last_location!.lat, v.last_location!.lng);
                      }}
                    >
                      <div className="mb-1 px-2 py-0.5 bg-white/90 dark:bg-black/80 backdrop-blur text-slate-800 dark:text-white text-[10px] font-bold rounded shadow-sm border border-slate-200 whitespace-nowrap">
                        {v.plate}
                      </div>
                      <div className={`p-2 rounded-full shadow-xl border-2 border-white ${isSelected ? 'bg-blue-600 ring-4 ring-blue-400/40' : isOnline ? 'bg-blue-500' : 'bg-slate-400'}`}>
                        <Truck size={18} className="text-white" />
                      </div>
                    </div>
                  </Marker>
                );
              })}

              {/* Linha reta caminhão → entrega rastreada (distância real vem da Directions API) */}
              {trackedInv?.lat && trackedInv?.lng && trackedVeh?.last_location && (
                <Source type="geojson" data={{
                  type: 'Feature' as const,
                  geometry: {
                    type: 'LineString' as const,
                    coordinates: [
                      [trackedVeh.last_location.lng, trackedVeh.last_location.lat],
                      [trackedInv.lng, trackedInv.lat],
                    ],
                  },
                  properties: {},
                }}>
                  <Layer type="line" paint={{
                    'line-color': '#2563eb',
                    'line-width': 3,
                    'line-opacity': 0.8,
                    'line-dasharray': [2, 1.5],
                  }} />
                </Source>
              )}

              {/* Pins de notas pendentes do veículo selecionado */}
              {selectedVehicleId && (() => {
                const grouped: Record<string, Invoice[]> = {};
                invoices
                  .filter(inv =>
                    inv.vehicle_id === selectedVehicleId &&
                    inv.lat && inv.lng &&
                    inv.status !== 'DELIVERED' &&
                    inv.status !== 'RETURNED' &&
                    inv.status !== 'FAILED'
                  )
                  .forEach(inv => {
                    const key = `${inv.lat},${inv.lng}`;
                    if (!grouped[key]) grouped[key] = [];
                    grouped[key].push(inv);
                  });

                return Object.values(grouped).map((group, idx) => {
                  const main = group[0];
                  const count = group.length;
                  return (
                    <Marker key={`pin-${idx}`} latitude={main.lat!} longitude={main.lng!} anchor="bottom">
                      <div
                        className="group relative cursor-pointer"
                        onClick={() => setTrackedInvoiceId(prev =>
                          prev === main.id ? null : main.id
                        )}
                        title="Clique para ver a distância do caminhão"
                      >
                        {/* Pin */}
                        <div className={`relative flex items-center justify-center rounded-full shadow-md border-2 border-white transition-transform hover:scale-110
                          ${count > 1 ? 'bg-purple-600 w-8 h-8' : 'bg-orange-500 w-7 h-7 p-1.5'}`}
                        >
                          {count > 1
                            ? <span className="text-white font-bold text-xs">{count}</span>
                            : <Package size={14} className="text-white" />
                          }
                          {count > 1 && (
                            <div className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-orange-500 rounded-full border border-white" />
                          )}
                        </div>
                        {/* Tooltip */}
                        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 bg-slate-900 text-white text-[10px] p-2 rounded shadow-xl opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-[60]">
                          <div className="border-b border-slate-700 pb-1 mb-1">
                            <span className="font-bold block truncate text-xs text-yellow-400">{main.customer_name}</span>
                            <span className="opacity-70">{count} {count === 1 ? 'entrega' : 'entregas'} aqui</span>
                          </div>
                          <div className="max-h-24 overflow-y-auto space-y-1">
                            {group.map(inv => (
                              <div key={inv.id} className="flex justify-between items-center">
                                <span className="opacity-90 font-mono">NF {inv.number}</span>
                                <span className="text-green-400 font-bold">R$ {inv.value.toLocaleString('pt-BR')}</span>
                              </div>
                            ))}
                          </div>
                          {count > 1 && (
                            <div className="border-t border-slate-700 mt-1 pt-1 text-right font-bold text-green-300">
                              Total: R$ {group.reduce((acc, i) => acc + i.value, 0).toLocaleString('pt-BR')}
                            </div>
                          )}
                          <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-slate-900" />
                        </div>
                      </div>
                    </Marker>
                  );
                });
              })()}
            </Map>
          </div>
        </div>
      )}

      {/* Aba Notas */}
      {activeTab === 'notas' && (<div className="max-w-7xl mx-auto px-4 py-6 space-y-4">
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
                        {inv.status === DeliveryStatus.IN_PROGRESS && inv.vehicle_id ? (
                          <button
                            onClick={() => handleTrackInvoiceVehicle(inv)}
                            title="Ver veículo no mapa da frota"
                            className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-semibold cursor-pointer transition-all hover:ring-2 hover:ring-blue-400/60 hover:scale-105 ${STATUS_STYLE[inv.status]}`}
                          >
                            <Satellite size={12} />
                            Em Rota
                          </button>
                        ) : (
                          <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-semibold ${STATUS_STYLE[inv.status]}`}>
                            {STATUS_ICON[inv.status]}
                            {STATUS_LABEL[inv.status] ?? inv.status}
                          </span>
                        )}
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
                          {/* Rastrear no SSW — somente TRANSPORTADORA */}
                          {driverMap[inv.driver_id ?? '']?.toUpperCase() === 'TRANSPORTADORA' && (
                            <button
                              onClick={() => openSSWTracking(inv)}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium text-sky-600 dark:text-sky-400 hover:bg-sky-50 dark:hover:bg-sky-900/30 transition-colors"
                              title="Rastrear no SSW"
                            >
                              <ExternalLink size={12} /> SSW
                            </button>
                          )}
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
                      {inv.status === DeliveryStatus.IN_PROGRESS && inv.vehicle_id ? (
                        <button
                          onClick={() => handleTrackInvoiceVehicle(inv)}
                          title="Ver veículo no mapa da frota"
                          className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-semibold cursor-pointer transition-all hover:ring-2 hover:ring-blue-400/60 ${STATUS_STYLE[inv.status]}`}
                        >
                          <Satellite size={12} />
                          Em Rota
                        </button>
                      ) : (
                        <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-semibold ${STATUS_STYLE[inv.status]}`}>
                          {STATUS_ICON[inv.status]}
                          {STATUS_LABEL[inv.status] ?? inv.status}
                        </span>
                      )}
                      {/* Rastrear no SSW — somente TRANSPORTADORA */}
                      {driverMap[inv.driver_id ?? '']?.toUpperCase() === 'TRANSPORTADORA' && (
                        <button
                          onClick={() => openSSWTracking(inv)}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium text-sky-600 dark:text-sky-400 bg-sky-50 dark:bg-sky-900/30"
                        >
                          <ExternalLink size={12} /> SSW
                        </button>
                      )}
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
      </div>)}

      {/* Modal Rastreamento SSW */}
      {sswModal.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]">
            {/* Header */}
            <div className="p-4 bg-sky-600 dark:bg-sky-700 text-white flex justify-between items-center shrink-0">
              <div>
                <h3 className="font-bold flex items-center gap-2 text-lg">
                  <ExternalLink size={20} /> Rastreamento SSW
                </h3>
                {sswModal.invoice && (
                  <p className="text-sky-100 text-sm mt-0.5">
                    NF {sswModal.invoice.number} • {sswModal.invoice.customer_name}
                  </p>
                )}
              </div>
              <button onClick={() => setSswModal(prev => ({ ...prev, open: false }))} className="hover:bg-white/20 rounded-full p-1.5 transition-colors">
                <X size={20} />
              </button>
            </div>

            {/* Body */}
            <div className="overflow-y-auto p-5 flex-1">
              {/* Loading */}
              {sswModal.loading && (
                <div className="flex flex-col items-center justify-center py-12 gap-3">
                  <Loader2 className="animate-spin text-sky-500" size={36} />
                  <p className="text-slate-500 dark:text-slate-400 text-sm">Consultando SSW...</p>
                </div>
              )}

              {/* CORS bloqueado */}
              {!sswModal.loading && sswModal.error === 'CORS_BLOCKED' && (
                <div className="flex flex-col items-center gap-4 py-8 text-center">
                  <div className="bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-700 rounded-xl p-5 w-full">
                    <AlertTriangle className="text-amber-500 mx-auto mb-2" size={32} />
                    <p className="font-semibold text-amber-800 dark:text-amber-200">API bloqueada pelo navegador (CORS)</p>
                    <p className="text-amber-700 dark:text-amber-300 text-sm mt-1">
                      O SSW não permite consultas diretas do navegador. Clique abaixo para abrir o rastreamento no site deles.
                    </p>
                  </div>
                  <button
                    onClick={() => sswModal.invoice && trackOnSSWFallback(sswModal.invoice.number)}
                    className="flex items-center gap-2 px-5 py-2.5 bg-sky-600 hover:bg-sky-700 text-white rounded-lg font-medium transition-colors"
                  >
                    <ExternalLink size={16} /> Abrir no site SSW
                  </button>
                </div>
              )}

              {/* Outro erro */}
              {!sswModal.loading && sswModal.error && sswModal.error !== 'CORS_BLOCKED' && (
                <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-700 rounded-xl p-5 text-center">
                  <AlertOctagon className="text-red-500 mx-auto mb-2" size={28} />
                  <p className="font-semibold text-red-700 dark:text-red-300">Erro ao consultar SSW</p>
                  <p className="text-red-600 dark:text-red-400 text-xs mt-1 font-mono">{sswModal.error}</p>
                  <button
                    onClick={() => sswModal.invoice && trackOnSSWFallback(sswModal.invoice.number)}
                    className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-sky-600 hover:bg-sky-700 text-white rounded-lg text-sm mx-auto transition-colors"
                  >
                    <ExternalLink size={14} /> Abrir no site SSW
                  </button>
                </div>
              )}

              {/* Sem eventos */}
              {!sswModal.loading && !sswModal.error && sswModal.events.length === 0 && sswModal.raw !== null && (
                <div className="text-center py-10">
                  <Package className="mx-auto text-slate-300 dark:text-slate-600 mb-3" size={40} />
                  <p className="text-slate-500 dark:text-slate-400 font-medium">Nenhuma ocorrência encontrada</p>
                  <p className="text-slate-400 dark:text-slate-500 text-sm mt-1">A SSW ainda não registrou eventos para esta NF.</p>
                  <button
                    onClick={() => sswModal.invoice && trackOnSSWFallback(sswModal.invoice.number)}
                    className="mt-4 inline-flex items-center gap-2 px-4 py-2 border border-sky-500 text-sky-600 dark:text-sky-400 rounded-lg text-sm hover:bg-sky-50 dark:hover:bg-sky-900/30 transition-colors"
                  >
                    <ExternalLink size={14} /> Ver no site SSW
                  </button>
                </div>
              )}

              {/* Timeline de eventos */}
              {!sswModal.loading && !sswModal.error && sswModal.events.length > 0 && (
                <div>
                  {/* Info do documento */}
                  {sswModal.raw?.documento?.header && (() => {
                    const h = sswModal.raw.documento.header;
                    const previsao = sswModal.raw?.documento?.tracking?.slice().reverse()
                      .find((e: any) => e.descricao?.toLowerCase().includes('previsao de entrega'))
                      ?.descricao?.match(/(\d{2}\/\d{2}\/\d{2,4})/)?.[1];
                    return (
                      <div className="bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-lg p-3 mb-4 text-xs space-y-1">
                        {h.destinatario && <div><span className="text-slate-400">Destinatário:</span> <span className="font-medium text-slate-700 dark:text-slate-300">{h.destinatario}</span></div>}
                        {previsao && <div><span className="text-slate-400">Previsão de entrega:</span> <span className="font-semibold text-sky-600 dark:text-sky-400">{previsao}</span></div>}
                        {h.pedido && <div><span className="text-slate-400">Pedido:</span> <span className="font-medium text-slate-700 dark:text-slate-300">{h.pedido}</span></div>}
                      </div>
                    );
                  })()}
                  <p className="text-xs text-slate-400 dark:text-slate-500 mb-4 uppercase tracking-wide font-medium">
                    {sswModal.events.length} ocorrência{sswModal.events.length !== 1 ? 's' : ''}
                  </p>
                  {sswModal.events.map((evt, idx) => {
                    const isLast = idx === sswModal.events.length - 1;
                    const ocorrencia = evt.ocorrencia ?? evt.situacao ?? evt.status ?? '';
                    const descricao = evt.descricao ?? '';
                    const cidade = evt.cidade ?? evt.local ?? evt.localUnidade ?? '';
                    const dataHoraRaw = evt.data_hora ?? evt.dataHora ?? evt.data ?? '';
                    const dataHoraFmt = dataHoraRaw
                      ? new Date(dataHoraRaw).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
                      : '';
                    const isEntregue = /entregue|entrega realizada/i.test(ocorrencia);
                    const isNegativo = evt.tipo === 'Negativo' || /devolvido|recusado|nao entregue/i.test(ocorrencia);
                    const dotColor = isEntregue ? 'bg-emerald-500' : isNegativo ? 'bg-red-500' : idx === 0 ? 'bg-slate-400 dark:bg-slate-500' : 'bg-sky-500';
                    return (
                      <div key={idx} className="flex gap-3">
                        <div className="flex flex-col items-center">
                          <div className={`w-3 h-3 rounded-full mt-1 shrink-0 ${dotColor}`} />
                          {!isLast && <div className="w-0.5 bg-slate-200 dark:bg-slate-700 flex-1 my-1" />}
                        </div>
                        <div className={`flex-1 ${isLast ? 'pb-0' : 'pb-4'}`}>
                          <p className={`font-semibold text-sm ${isEntregue ? 'text-emerald-600 dark:text-emerald-400' : isNegativo ? 'text-red-600 dark:text-red-400' : 'text-slate-800 dark:text-slate-200'}`}>
                            {ocorrencia}
                          </p>
                          {descricao && <p className="text-xs text-slate-600 dark:text-slate-300 mt-0.5 leading-relaxed">{descricao}</p>}
                          <div className="flex items-center gap-2 mt-1">
                            {cidade && <span className="text-xs text-slate-400 dark:text-slate-500">{cidade}</span>}
                            {dataHoraFmt && <span className="text-xs text-slate-400 dark:text-slate-500">• {dataHoraFmt}</span>}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Footer */}
            {!sswModal.loading && !sswModal.error && sswModal.events.length > 0 && (
              <div className="p-4 border-t border-slate-200 dark:border-slate-700 shrink-0 flex justify-between items-center">
                <button
                  onClick={() => sswModal.invoice && openSSWTracking(sswModal.invoice)}
                  className="flex items-center gap-1.5 text-sm text-slate-500 dark:text-slate-400 hover:text-sky-600 dark:hover:text-sky-400 transition-colors"
                >
                  <RotateCw size={14} /> Atualizar
                </button>
                <button
                  onClick={() => sswModal.invoice && trackOnSSWFallback(sswModal.invoice.number)}
                  className="flex items-center gap-1.5 text-sm text-sky-600 dark:text-sky-400 hover:underline"
                >
                  <ExternalLink size={14} /> Abrir no SSW
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modal Comprovante */}
      {viewingProof && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-3xl overflow-hidden max-h-[90vh] flex flex-col">

            {/* Header */}
            <div className={`p-5 text-white flex justify-between items-center ${
              isReturnProof(viewingProof.proof) ? 'bg-red-600 dark:bg-red-700' : 'bg-green-600 dark:bg-green-700'
            }`}>
              <div>
                <h3 className="font-bold flex items-center gap-2 text-lg">
                  <FileText size={22} />
                  {isReturnProof(viewingProof.proof) ? 'Devolução / Falha' : 'Comprovante de Entrega'}
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
              {isReturnProof(viewingProof.proof) && (
                <div className="border bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-800 dark:text-red-300 p-4 rounded-lg flex items-start gap-3">
                  <AlertTriangle className="shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold block mb-1">
                      {viewingProof.proof.return_type === 'PARTIAL' ? 'Devolução Parcial' : 'Devolução Total'}
                    </span>
                    <p className="text-sm">{formatProofReason(viewingProof.proof)}</p>
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
