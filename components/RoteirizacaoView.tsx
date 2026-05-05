import React, { useState, useEffect, useRef } from 'react';
import { db } from '../services/db';
import { Invoice, Vehicle } from '../types';
import {
  Route, Truck, Loader2, CheckCircle, Package,
  ChevronLeft, GripVertical, MapPin, AlertTriangle, Plus, X, Ban, Undo2,
} from 'lucide-react';
import Map, { Marker, NavigationControl, Source, Layer } from 'react-map-gl';
import 'mapbox-gl/dist/mapbox-gl.css';

const MAPBOX_TOKEN = (import.meta.env.VITE_MAPBOX_TOKEN as string) || '';
const ROT_ORIGIN = { lat: -12.931685, lng: -38.512682 };
const ROUTE_COLORS = ['#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#f97316'];

// ── Algoritmos ──────────────────────────────────────────────────────────────

function geoDistance(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  return Math.sqrt((a.lat - b.lat) ** 2 + (a.lng - b.lng) ** 2);
}

/**
 * Divide as notas em k setores geográficos balanceados.
 *
 * Estratégia: ordena as notas pelo ângulo polar em relação à origem (ponto
 * de partida da empresa) e corta em k fatias contíguas de tamanho igual.
 * Isso garante:
 *  • Nenhum cluster vazio (k-means falha quando as notas são geograficamente
 *    próximas, pois os centroides iniciais colidem e todo mundo vai pro
 *    cluster 0).
 *  • Cada veículo cobre uma "fatia" diferente da cidade.
 *  • Distribuição balanceada: diferença de no máximo 1 nota entre veículos.
 */
function assignToSectors(
  invoices: Invoice[],
  k: number,
  origin: { lat: number; lng: number },
): Invoice[][] {
  if (k <= 0 || invoices.length === 0) return [];
  if (k >= invoices.length) return invoices.map(inv => [inv]);

  // Ordena por ângulo polar em relação à origem
  const sorted = [...invoices].sort((a, b) => {
    const angA = Math.atan2(a.lat! - origin.lat, a.lng! - origin.lng);
    const angB = Math.atan2(b.lat! - origin.lat, b.lng! - origin.lng);
    return angA - angB;
  });

  // Divide em k fatias contíguas
  const clusters: Invoice[][] = Array.from({ length: k }, () => []);
  sorted.forEach((inv, i) => {
    clusters[Math.floor((i * k) / sorted.length)].push(inv);
  });
  return clusters;
}

function nearestNeighborOrder(invoices: Invoice[], origin: { lat: number; lng: number }): Invoice[] {
  const result: Invoice[] = [];
  const remaining = [...invoices];
  let current = origin;
  while (remaining.length > 0) {
    let min = Infinity, idx = 0;
    remaining.forEach((inv, i) => { const d = geoDistance(current, { lat: inv.lat!, lng: inv.lng! }); if (d < min) { min = d; idx = i; } });
    const [nearest] = remaining.splice(idx, 1);
    result.push(nearest);
    current = { lat: nearest.lat!, lng: nearest.lng! };
  }
  return result;
}

async function geocodeInvoice(invoice: Invoice): Promise<Invoice> {
  if (invoice.lat && invoice.lng) return invoice;
  try {
    const clean = invoice.customer_address.split('||')[0];
    const q = encodeURIComponent(`${clean}, Brasil`);
    const res = await fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${q}.json?access_token=${MAPBOX_TOKEN}&limit=1`);
    const data = await res.json();
    if (data.features?.length > 0) {
      const [lng, lat] = data.features[0].center;
      await db.updateInvoiceLocation(invoice.id, lat, lng);
      return { ...invoice, lat, lng };
    }
  } catch { /* silencioso */ }
  return invoice;
}

// ── Tipos de drag ───────────────────────────────────────────────────────────

interface DragState {
  invId: string;
  /** ID do veículo de origem, ou 'UNASSIGNED' quando vem do pool */
  fromVehicleId: string;
}

// ── Componente ──────────────────────────────────────────────────────────────

interface Props { onBack: () => void; }

export const RoteirizacaoView: React.FC<Props> = ({ onBack }) => {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [rotDate, setRotDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [selectedVehicles, setSelectedVehicles] = useState<string[]>([]);
  const [plan, setPlan] = useState<Record<string, Invoice[]>>({});
  const [generating, setGenerating] = useState(false);
  const [confirming, setConfirming] = useState(false);

  /** ID da nota do pool que está com o seletor de veículo aberto */
  const [addingInvId, setAddingInvId] = useState<string | null>(null);

  /** IDs das notas excluídas da roteirização (não entram no cálculo) */
  const [excludedIds, setExcludedIds] = useState<string[]>([]);
  const [showExcluded, setShowExcluded] = useState(false);

  // Drag state — ref evita re-render durante o drag
  const dragRef = useRef<DragState | null>(null);
  const [dragOverVehicleId, setDragOverVehicleId] = useState<string | null>(null);
  const [dragOverInvId, setDragOverInvId] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([db.getInvoices(), db.getVehicles()]).then(([inv, veh]) => {
      setInvoices(inv); setVehicles(veh); setLoading(false);
    });
  }, []);

  const dayInvoices = invoices.filter(inv =>
    inv.created_at?.startsWith(rotDate) && inv.status === 'PENDING' && !inv.deleted_at
  );
  const hasPlan = Object.keys(plan).length > 0;
  const assignedIds = new Set(Object.values(plan).flat().map(i => i.id));
  // Notas disponíveis para rota (excluídas ficam de fora)
  const eligibleInvoices = dayInvoices.filter(inv => !excludedIds.includes(inv.id));
  const unassigned = eligibleInvoices.filter(inv => !assignedIds.has(inv.id));
  const excludedInvoices = dayInvoices.filter(inv => excludedIds.includes(inv.id));

  const handleToggleVehicle = (vehicleId: string) => {
    setSelectedVehicles(prev => prev.includes(vehicleId) ? prev.filter(id => id !== vehicleId) : [...prev, vehicleId]);
    setPlan({});
  };

  const handleGenerate = async () => {
    if (selectedVehicles.length === 0 || dayInvoices.length === 0) return;
    setGenerating(true);
    try {
      const geocoded = await Promise.all(eligibleInvoices.map(geocodeInvoice));
      setInvoices(prev => prev.map(inv => geocoded.find(g => g.id === inv.id) ?? inv));
      const withCoords = geocoded.filter(inv => inv.lat && inv.lng);
      if (withCoords.length === 0) return;
      const clusters = assignToSectors(withCoords, selectedVehicles.length, ROT_ORIGIN);
      const newPlan: Record<string, Invoice[]> = {};
      selectedVehicles.forEach((vId, i) => { newPlan[vId] = nearestNeighborOrder(clusters[i] ?? [], ROT_ORIGIN); });
      setPlan(newPlan);
    } finally { setGenerating(false); }
  };

  // ── Handlers manuais ─────────────────────────────────────────────────────

  /** Remove nota de um veículo, voltando para o pool de não atribuídas */
  const handleRemoveInvoice = (invId: string, vehicleId: string) => {
    setPlan(prev => ({
      ...prev,
      [vehicleId]: (prev[vehicleId] ?? []).filter(i => i.id !== invId),
    }));
  };

  /** Exclui nota da roteirização (sai do plano se estava atribuída) */
  const handleExclude = (invId: string) => {
    setExcludedIds(prev => [...prev, invId]);
    setAddingInvId(null);
    // Remove do plano caso já estivesse atribuída a algum veículo
    setPlan(prev => {
      const next = { ...prev };
      for (const vId of Object.keys(next)) {
        next[vId] = next[vId].filter(i => i.id !== invId);
      }
      return next;
    });
  };

  /** Restaura nota excluída de volta ao pool de não atribuídas */
  const handleRestore = (invId: string) => {
    setExcludedIds(prev => prev.filter(id => id !== invId));
  };

  /** Adiciona nota do pool (não atribuída) a um veículo (vai para o final) */
  const handleAddToVehicle = (invId: string, vehicleId: string) => {
    const inv = dayInvoices.find(i => i.id === invId);
    if (!inv) return;
    setPlan(prev => ({
      ...prev,
      [vehicleId]: [...(prev[vehicleId] ?? []), inv],
    }));
    setAddingInvId(null);
  };

  // ── Drag handlers ────────────────────────────────────────────────────────

  const onDragStart = (invId: string, fromVehicleId: string) => {
    dragRef.current = { invId, fromVehicleId };
    setAddingInvId(null);
  };

  const onDragEnd = () => {
    dragRef.current = null;
    setDragOverVehicleId(null);
    setDragOverInvId(null);
  };

  const onDragOverColumn = (e: React.DragEvent, vehicleId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverVehicleId(vehicleId);
    setDragOverInvId(null);
  };

  const onDragOverCard = (e: React.DragEvent, vehicleId: string, invId: string) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    setDragOverVehicleId(vehicleId);
    setDragOverInvId(invId);
  };

  /** Resolve o invoice a partir da origem (veículo ou pool) */
  const resolveInv = (drag: DragState): Invoice | undefined => {
    if (drag.fromVehicleId === 'UNASSIGNED') {
      return dayInvoices.find(i => i.id === drag.invId);
    }
    return (plan[drag.fromVehicleId] ?? []).find(i => i.id === drag.invId);
  };

  const onDropColumn = (e: React.DragEvent, toVehicleId: string) => {
    e.preventDefault();
    const drag = dragRef.current;
    if (!drag) return;
    setDragOverVehicleId(null);
    setDragOverInvId(null);

    setPlan(prev => {
      const inv = resolveInv(drag);
      if (!inv) return prev;

      if (drag.fromVehicleId === 'UNASSIGNED') {
        return { ...prev, [toVehicleId]: [...(prev[toVehicleId] ?? []), inv] };
      }

      if (drag.fromVehicleId === toVehicleId) {
        // Reordenar: mover para o final
        const list = [...(prev[toVehicleId] ?? [])];
        const srcIdx = list.findIndex(i => i.id === drag.invId);
        if (srcIdx === -1) return prev;
        list.push(list.splice(srcIdx, 1)[0]);
        return { ...prev, [toVehicleId]: list };
      }

      const from = [...(prev[drag.fromVehicleId] ?? [])];
      const to = [...(prev[toVehicleId] ?? [])];
      const srcIdx = from.findIndex(i => i.id === drag.invId);
      if (srcIdx === -1) return prev;
      from.splice(srcIdx, 1);
      to.push(inv);
      return { ...prev, [drag.fromVehicleId]: from, [toVehicleId]: to };
    });
    dragRef.current = null;
  };

  const onDropCard = (e: React.DragEvent, toVehicleId: string, targetInvId: string) => {
    e.preventDefault();
    e.stopPropagation();
    const drag = dragRef.current;
    if (!drag || drag.invId === targetInvId) return;
    setDragOverVehicleId(null);
    setDragOverInvId(null);

    setPlan(prev => {
      const inv = resolveInv(drag);
      if (!inv) return prev;

      if (drag.fromVehicleId === 'UNASSIGNED') {
        const toList = [...(prev[toVehicleId] ?? [])];
        const targetIdx = toList.findIndex(i => i.id === targetInvId);
        toList.splice(targetIdx < 0 ? toList.length : targetIdx, 0, inv);
        return { ...prev, [toVehicleId]: toList };
      }

      const fromList = [...(prev[drag.fromVehicleId] ?? [])];
      const srcIdx = fromList.findIndex(i => i.id === drag.invId);
      if (srcIdx === -1) return prev;
      fromList.splice(srcIdx, 1);

      if (drag.fromVehicleId === toVehicleId) {
        const targetIdx = fromList.findIndex(i => i.id === targetInvId);
        fromList.splice(targetIdx < 0 ? fromList.length : targetIdx, 0, inv);
        return { ...prev, [toVehicleId]: fromList };
      }

      const toList = [...(prev[toVehicleId] ?? [])];
      const targetIdx = toList.findIndex(i => i.id === targetInvId);
      toList.splice(targetIdx < 0 ? toList.length : targetIdx, 0, inv);
      return { ...prev, [drag.fromVehicleId]: fromList, [toVehicleId]: toList };
    });
    dragRef.current = null;
  };

  // ── Confirmar ────────────────────────────────────────────────────────────

  const handleConfirm = async () => {
    setConfirming(true);
    try {
      await Promise.all(
        Object.entries(plan).map(([vehicleId, invs]) =>
          db.assignVehicleToInvoices(vehicleId, invs.map(i => i.id))
        )
      );
      onBack();
    } finally { setConfirming(false); }
  };

  // ── Render ───────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="h-screen bg-slate-50 dark:bg-slate-900 flex items-center justify-center">
        <Loader2 size={32} className="animate-spin text-violet-500" />
      </div>
    );
  }

  return (
    <div className="h-screen overflow-hidden bg-slate-50 dark:bg-slate-900 flex flex-col">

      {/* Header */}
      <div className="bg-violet-600 text-white px-5 py-3 flex items-center gap-4 shadow-lg shrink-0">
        <button onClick={onBack} className="p-2 rounded-lg hover:bg-white/20 transition-colors">
          <ChevronLeft size={20} />
        </button>
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-white/20 rounded-lg flex items-center justify-center">
            <Route size={20} />
          </div>
          <div>
            <h1 className="font-bold text-lg leading-tight">Roteirização</h1>
            <p className="text-violet-200 text-xs">Distribua e ordene as entregas automaticamente</p>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <input
            type="date" value={rotDate}
            onChange={e => { setRotDate(e.target.value); setPlan({}); }}
            className="px-3 py-1.5 rounded-lg bg-white/20 border border-white/30 text-white text-sm outline-none focus:ring-2 focus:ring-white/50"
          />
          <span className="text-violet-200 text-sm font-medium">
            {eligibleInvoices.length} notas elegíveis
            {excludedInvoices.length > 0 && (
              <span className="ml-1 text-violet-300 text-xs">({excludedInvoices.length} excluídas)</span>
            )}
          </span>
          {hasPlan && (
            <button onClick={handleConfirm} disabled={confirming}
              className="flex items-center gap-2 px-5 py-2 bg-green-500 hover:bg-green-400 disabled:opacity-60 text-white font-bold rounded-lg text-sm transition-colors shadow-md">
              {confirming
                ? <><Loader2 size={14} className="animate-spin" /> Salvando...</>
                : <><CheckCircle size={14} /> Confirmar e Atribuir</>}
            </button>
          )}
        </div>
      </div>

      {/* Corpo */}
      <div className="flex flex-1 min-h-0">

        {/* Painel esquerdo */}
        <div className="w-80 shrink-0 border-r border-slate-200 dark:border-slate-700 flex flex-col bg-white dark:bg-slate-800">

          {/* Seletor de veículos */}
          <div className="p-4 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 shrink-0">
            <p className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-2">Selecionar veículos</p>
            <div className="space-y-1.5 max-h-44 overflow-y-auto pr-1">
              {vehicles.map(v => {
                const sel = selectedVehicles.includes(v.id);
                const colorIdx = selectedVehicles.indexOf(v.id);
                const color = sel ? ROUTE_COLORS[colorIdx % ROUTE_COLORS.length] : '#94a3b8';
                return (
                  <button key={v.id} onClick={() => handleToggleVehicle(v.id)}
                    className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all border ${
                      sel ? 'bg-violet-50 dark:bg-violet-900/30 border-violet-300 dark:border-violet-700 text-violet-700 dark:text-violet-300'
                          : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-violet-200'
                    }`}>
                    <div className="w-3 h-3 rounded-full border-2 shrink-0 transition-all"
                      style={sel ? { backgroundColor: color, borderColor: color } : { borderColor: '#cbd5e1' }} />
                    <Truck size={13} style={{ color }} />
                    <span className="font-mono">{v.plate}</span>
                    <span className="text-xs text-slate-400 truncate flex-1 text-left">{v.model}</span>
                  </button>
                );
              })}
            </div>
            <button onClick={handleGenerate}
              disabled={generating || selectedVehicles.length === 0 || dayInvoices.length === 0}
              className="mt-3 w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold rounded-lg text-sm transition-colors">
              {generating
                ? <><Loader2 size={14} className="animate-spin" /> Calculando rotas...</>
                : <><Route size={14} /> Gerar Roteiro</>}
            </button>
          </div>

          {/* Colunas dos veículos + pool — scrollável */}
          <div className="flex-1 overflow-y-auto p-3 space-y-3">
            {!hasPlan && !generating && (
              <div className="flex flex-col items-center justify-center h-full gap-3 text-slate-400 dark:text-slate-600 text-center py-12">
                <Route size={40} className="opacity-30" />
                <p className="text-sm">Selecione os veículos e<br />clique em Gerar Roteiro</p>
              </div>
            )}

            {/* Colunas por veículo */}
            {selectedVehicles.map((vehicleId, idx) => {
              const v = vehicles.find(x => x.id === vehicleId);
              const color = ROUTE_COLORS[idx % ROUTE_COLORS.length];
              const notes = plan[vehicleId] ?? [];
              const isOver = dragOverVehicleId === vehicleId;

              return (
                <div key={vehicleId}
                  onDragOver={e => onDragOverColumn(e, vehicleId)}
                  onDragLeave={() => { if (dragOverVehicleId === vehicleId && !dragOverInvId) setDragOverVehicleId(null); }}
                  onDrop={e => onDropColumn(e, vehicleId)}
                  className="rounded-lg border-2 transition-all"
                  style={{ borderColor: isOver ? color : color + '50', boxShadow: isOver ? `0 0 0 2px ${color}40` : 'none' }}
                >
                  {/* Header */}
                  <div className="flex items-center gap-2 px-3 py-2 rounded-t-md" style={{ backgroundColor: color + '18' }}>
                    <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: color }} />
                    <Truck size={13} style={{ color }} />
                    <span className="font-bold text-sm text-slate-700 dark:text-slate-200 font-mono">{v?.plate}</span>
                    <span className="text-xs text-slate-400 truncate flex-1">{v?.model}</span>
                    <span className="text-xs font-bold shrink-0" style={{ color }}>{notes.length} paradas</span>
                  </div>

                  {/* Cards das notas */}
                  <div className="p-2 space-y-1 min-h-[52px]">
                    {notes.length === 0 && (
                      <div className={`text-center text-xs py-3 rounded border-2 border-dashed transition-colors ${
                        isOver ? 'text-violet-500 border-violet-300 bg-violet-50 dark:bg-violet-900/20' : 'text-slate-400 border-slate-200 dark:border-slate-700'
                      }`}>
                        {isOver ? 'Solte aqui' : 'Arraste notas aqui'}
                      </div>
                    )}
                    {notes.map((inv, order) => {
                      const isCardOver = dragOverInvId === inv.id && dragOverVehicleId === vehicleId;
                      return (
                        <div key={inv.id}
                          draggable
                          onDragStart={() => onDragStart(inv.id, vehicleId)}
                          onDragEnd={onDragEnd}
                          onDragOver={e => onDragOverCard(e, vehicleId, inv.id)}
                          onDrop={e => onDropCard(e, vehicleId, inv.id)}
                          className={`group flex items-center gap-1.5 px-2 py-1.5 rounded border cursor-grab active:cursor-grabbing select-none transition-all ${
                            isCardOver
                              ? 'border-t-2 bg-violet-50 dark:bg-violet-900/20 border-violet-400 shadow-sm'
                              : 'bg-white dark:bg-slate-700 border-slate-200 dark:border-slate-600 hover:shadow-sm'
                          }`}
                        >
                          <GripVertical size={11} className="text-slate-300 dark:text-slate-500 shrink-0" />
                          <span
                            className="w-5 h-5 rounded-full flex items-center justify-center text-white text-[10px] font-bold shrink-0"
                            style={{ backgroundColor: color }}
                          >
                            {order + 1}
                          </span>

                          {/* Conteúdo — duas linhas */}
                          <div className="min-w-0 flex-1 overflow-hidden">
                            <div className="flex items-center gap-1">
                              <span className="text-[10px] font-mono text-slate-400 shrink-0">NF {inv.number}</span>
                              <span className="text-[10px] text-slate-300 dark:text-slate-500">·</span>
                              <span className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 shrink-0">
                                R${inv.value.toLocaleString('pt-BR', { minimumFractionDigits: 0 })}
                              </span>
                            </div>
                            <p className="text-xs font-medium text-slate-700 dark:text-slate-200 truncate leading-tight">
                              {inv.customer_name}
                            </p>
                          </div>

                          {/* Botões — aparecem no hover */}
                          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all shrink-0">
                            <button
                              onMouseDown={e => e.stopPropagation()}
                              onClick={e => { e.stopPropagation(); handleRemoveInvoice(inv.id, vehicleId); }}
                              title="Mover para não atribuídas"
                              className="w-5 h-5 rounded-full flex items-center justify-center
                                bg-slate-100 hover:bg-slate-200 dark:bg-slate-600 dark:hover:bg-slate-500
                                text-slate-500 dark:text-slate-300 transition-colors cursor-pointer"
                            >
                              <X size={11} />
                            </button>
                            <button
                              onMouseDown={e => e.stopPropagation()}
                              onClick={e => { e.stopPropagation(); handleExclude(inv.id); }}
                              title="Excluir da roteirização"
                              className="w-5 h-5 rounded-full flex items-center justify-center
                                bg-red-100 hover:bg-red-200 dark:bg-red-900/30 dark:hover:bg-red-800/50
                                text-red-500 dark:text-red-400 transition-colors cursor-pointer"
                            >
                              <Ban size={10} />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}

            {/* Pool de notas não atribuídas */}
            {hasPlan && unassigned.length > 0 && (
              <div className="rounded-lg border-2 border-dashed border-orange-300 dark:border-orange-700">
                {/* Header */}
                <div className="flex items-center gap-2 px-3 py-2 bg-orange-50 dark:bg-orange-900/20 rounded-t-md">
                  <AlertTriangle size={13} className="text-orange-500 shrink-0" />
                  <span className="text-xs font-bold text-orange-600 dark:text-orange-400 flex-1">Não atribuídas</span>
                  <span className="text-xs font-bold text-orange-500">{unassigned.length}</span>
                </div>
                <div className="p-2 space-y-1">
                  {unassigned.map(inv => (
                    <div key={inv.id}>
                      {/* Card da nota não atribuída */}
                      <div
                        draggable={selectedVehicles.length > 0}
                        onDragStart={() => onDragStart(inv.id, 'UNASSIGNED')}
                        onDragEnd={onDragEnd}
                        className="flex items-center gap-1.5 px-2 py-1.5 rounded border
                          bg-white dark:bg-slate-700 border-orange-200 dark:border-orange-800
                          select-none cursor-grab active:cursor-grabbing"
                      >
                        <GripVertical size={11} className="text-orange-300 shrink-0" />
                        <Package size={11} className="text-orange-400 shrink-0" />
                        <div className="min-w-0 flex-1 overflow-hidden">
                          <div className="flex items-center gap-1">
                            <span className="text-[10px] font-mono text-slate-400 shrink-0">NF {inv.number}</span>
                            <span className="text-[10px] text-slate-300 dark:text-slate-500">·</span>
                            <span className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 shrink-0">
                              R${inv.value.toLocaleString('pt-BR', { minimumFractionDigits: 0 })}
                            </span>
                          </div>
                          <p className="text-xs font-medium text-slate-700 dark:text-slate-200 truncate leading-tight">
                            {inv.customer_name}
                          </p>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          {selectedVehicles.length > 0 && (
                            <button
                              onClick={() => setAddingInvId(addingInvId === inv.id ? null : inv.id)}
                              title="Adicionar a um veículo"
                              className="w-5 h-5 rounded-full flex items-center justify-center
                                bg-violet-100 hover:bg-violet-200 dark:bg-violet-900/40 dark:hover:bg-violet-800/60
                                text-violet-600 dark:text-violet-400 transition-colors cursor-pointer"
                            >
                              {addingInvId === inv.id ? <X size={11} /> : <Plus size={11} />}
                            </button>
                          )}
                          <button
                            onClick={() => handleExclude(inv.id)}
                            title="Excluir da roteirização"
                            className="w-5 h-5 rounded-full flex items-center justify-center
                              bg-red-100 hover:bg-red-200 dark:bg-red-900/30 dark:hover:bg-red-800/50
                              text-red-500 dark:text-red-400 transition-colors cursor-pointer"
                          >
                            <Ban size={10} />
                          </button>
                        </div>
                      </div>

                      {/* Seletor de veículo inline */}
                      {addingInvId === inv.id && (
                        <div className="mt-1 mx-1 px-2 py-1.5 rounded bg-violet-50 dark:bg-violet-900/20 border border-violet-200 dark:border-violet-700">
                          <p className="text-[10px] text-violet-500 font-bold mb-1.5 uppercase tracking-wide">Adicionar ao veículo:</p>
                          <div className="flex flex-wrap gap-1">
                            {selectedVehicles.map((vId, idx) => {
                              const v = vehicles.find(x => x.id === vId);
                              const color = ROUTE_COLORS[idx % ROUTE_COLORS.length];
                              return (
                                <button key={vId}
                                  onClick={() => handleAddToVehicle(inv.id, vId)}
                                  className="flex items-center gap-1 px-2 py-1 rounded-full text-white text-[10px] font-bold
                                    hover:opacity-80 transition-opacity cursor-pointer"
                                  style={{ backgroundColor: color }}
                                >
                                  <Truck size={9} />
                                  {v?.plate}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
            {/* Notas excluídas da roteirização */}
            {excludedInvoices.length > 0 && (
              <div className="rounded-lg border-2 border-dashed border-slate-300 dark:border-slate-600">
                {/* Header clicável para colapsar */}
                <button
                  onClick={() => setShowExcluded(v => !v)}
                  className="w-full flex items-center gap-2 px-3 py-2 bg-slate-100 dark:bg-slate-700/60 rounded-t-md hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
                >
                  <Ban size={13} className="text-slate-400 shrink-0" />
                  <span className="text-xs font-bold text-slate-500 dark:text-slate-400 flex-1 text-left">
                    Excluídas da rota
                  </span>
                  <span className="text-xs font-bold text-slate-400 mr-1">{excludedInvoices.length}</span>
                  <span className="text-[10px] text-slate-400">{showExcluded ? '▲' : '▼'}</span>
                </button>

                {showExcluded && (
                  <div className="p-2 space-y-1">
                    {excludedInvoices.map(inv => (
                      <div key={inv.id}
                        className="flex items-center gap-1.5 px-2 py-1.5 rounded border
                          bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-600
                          opacity-60"
                      >
                        <Ban size={11} className="text-slate-400 shrink-0" />
                        <div className="min-w-0 flex-1 overflow-hidden">
                          <div className="flex items-center gap-1">
                            <span className="text-[10px] font-mono text-slate-400 shrink-0">NF {inv.number}</span>
                            <span className="text-[10px] text-slate-300 dark:text-slate-500">·</span>
                            <span className="text-[10px] font-semibold text-slate-400 shrink-0">
                              R${inv.value.toLocaleString('pt-BR', { minimumFractionDigits: 0 })}
                            </span>
                          </div>
                          <p className="text-xs font-medium text-slate-500 dark:text-slate-400 truncate leading-tight">
                            {inv.customer_name}
                          </p>
                        </div>
                        <button
                          onClick={() => handleRestore(inv.id)}
                          title="Restaurar para a roteirização"
                          className="w-5 h-5 rounded-full flex items-center justify-center shrink-0
                            bg-green-100 hover:bg-green-200 dark:bg-green-900/30 dark:hover:bg-green-800/50
                            text-green-600 dark:text-green-400 transition-colors cursor-pointer opacity-100"
                        >
                          <Undo2 size={10} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Mapa */}
        <div className="flex-1 relative min-h-0">
          {generating && (
            <div className="absolute inset-0 z-10 bg-white/70 dark:bg-slate-900/70 backdrop-blur-sm flex flex-col items-center justify-center gap-3">
              <Loader2 size={36} className="animate-spin text-violet-600" />
              <p className="text-sm font-semibold text-slate-600 dark:text-slate-300">Calculando melhor rota...</p>
            </div>
          )}

          <Map
            initialViewState={{ latitude: ROT_ORIGIN.lat, longitude: ROT_ORIGIN.lng, zoom: 11 }}
            style={{ width: '100%', height: '100%' }}
            mapStyle="mapbox://styles/mapbox/streets-v12"
            mapboxAccessToken={MAPBOX_TOKEN}
          >
            <NavigationControl position="bottom-right" />

            {/* Origem */}
            <Marker latitude={ROT_ORIGIN.lat} longitude={ROT_ORIGIN.lng} anchor="center">
              <div className="w-6 h-6 rounded-full bg-slate-800 border-2 border-white shadow-lg flex items-center justify-center">
                <div className="w-2.5 h-2.5 rounded-full bg-white" />
              </div>
            </Marker>

            {/* Linhas de rota */}
            {hasPlan && selectedVehicles.map((vehicleId, idx) => {
              const notes = plan[vehicleId] ?? [];
              const color = ROUTE_COLORS[idx % ROUTE_COLORS.length];
              const coords = [[ROT_ORIGIN.lng, ROT_ORIGIN.lat], ...notes.filter(n => n.lat && n.lng).map(n => [n.lng!, n.lat!])];
              if (coords.length < 2) return null;
              return (
                <Source key={vehicleId} type="geojson" data={{ type: 'Feature' as const, geometry: { type: 'LineString' as const, coordinates: coords }, properties: {} }}>
                  <Layer type="line" paint={{ 'line-color': color, 'line-width': 3, 'line-dasharray': [2, 1.5] }} />
                </Source>
              );
            })}

            {/* Marcadores */}
            {hasPlan && selectedVehicles.map((vehicleId, idx) => {
              const notes = plan[vehicleId] ?? [];
              const color = ROUTE_COLORS[idx % ROUTE_COLORS.length];
              return notes.filter(n => n.lat && n.lng).map((inv, order) => (
                <Marker key={inv.id} latitude={inv.lat!} longitude={inv.lng!} anchor="bottom">
                  <div className="flex flex-col items-center">
                    <div className="mb-0.5 px-1.5 py-0.5 text-white text-[9px] font-bold rounded shadow" style={{ backgroundColor: color }}>{order + 1}</div>
                    <div className="w-6 h-6 rounded-full border-2 border-white shadow-md flex items-center justify-center" style={{ backgroundColor: color }}>
                      <Package size={11} className="text-white" />
                    </div>
                  </div>
                </Marker>
              ));
            })}
          </Map>

          {/* Legenda */}
          {hasPlan && (
            <div className="absolute top-4 left-4 bg-white/95 dark:bg-slate-800/95 backdrop-blur rounded-xl shadow-lg p-4 space-y-2 border border-slate-200 dark:border-slate-700">
              <p className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1">Legenda</p>
              {selectedVehicles.map((vehicleId, idx) => {
                const v = vehicles.find(x => x.id === vehicleId);
                const color = ROUTE_COLORS[idx % ROUTE_COLORS.length];
                return (
                  <div key={vehicleId} className="flex items-center gap-2.5 text-xs">
                    <div className="w-7 h-1.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
                    <span className="font-mono font-bold text-slate-700 dark:text-slate-200">{v?.plate}</span>
                    <span className="text-slate-400">{(plan[vehicleId] ?? []).length} paradas</span>
                  </div>
                );
              })}
              {unassigned.length > 0 && (
                <div className="flex items-center gap-2.5 text-xs pt-1.5 border-t border-slate-200 dark:border-slate-600">
                  <AlertTriangle size={12} className="text-orange-400 shrink-0" />
                  <span className="text-orange-500">{unassigned.length} sem veículo</span>
                </div>
              )}
              <div className="flex items-center gap-2.5 text-xs pt-1.5 border-t border-slate-200 dark:border-slate-600">
                <div className="w-4 h-4 rounded-full bg-slate-800 border border-white shrink-0" />
                <span className="text-slate-500">Ponto de origem</span>
              </div>
            </div>
          )}

          {/* Estado vazio */}
          {!hasPlan && !generating && (
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              <div className="bg-white/80 dark:bg-slate-800/80 backdrop-blur rounded-2xl p-8 text-center shadow-sm border border-slate-200 dark:border-slate-700">
                <MapPin size={40} className="mx-auto mb-3 text-violet-300" />
                <p className="text-sm font-semibold text-slate-500 dark:text-slate-400">
                  O mapa de rotas aparece aqui<br />após gerar o roteiro
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
