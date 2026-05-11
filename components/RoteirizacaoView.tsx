import React, { useState, useEffect, useRef } from 'react';
import { db } from '../services/db';
import { Invoice, Vehicle, Zone } from '../types';
import {
  Route, Truck, Loader2, CheckCircle, Package,
  ChevronLeft, GripVertical, MapPin, AlertTriangle,
  Plus, X, Ban, Undo2, Hexagon,
} from 'lucide-react';
import Map, { Marker, NavigationControl, Source, Layer } from 'react-map-gl';
import 'mapbox-gl/dist/mapbox-gl.css';

const MAPBOX_TOKEN = (import.meta.env.VITE_MAPBOX_TOKEN as string) || '';
const ROT_ORIGIN = { lat: -12.931685, lng: -38.512682 };

// ── Algoritmos ──────────────────────────────────────────────────────────────

function geoDistance(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  return Math.sqrt((a.lat - b.lat) ** 2 + (a.lng - b.lng) ** 2);
}

/** Ray-casting: verifica se ponto está dentro de polígono */
function pointInPolygon(point: { lat: number; lng: number }, polygon: { lat: number; lng: number }[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].lng, yi = polygon[i].lat;
    const xj = polygon[j].lng, yj = polygon[j].lat;
    const intersect = ((yi > point.lat) !== (yj > point.lat))
      && (point.lng < (xj - xi) * (point.lat - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

/** Shoelace formula: área do polígono (em graus²). Menor valor = zona mais específica. */
function polygonArea(polygon: { lat: number; lng: number }[]): number {
  let area = 0;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    area += (polygon[j].lng + polygon[i].lng) * (polygon[j].lat - polygon[i].lat);
  }
  return Math.abs(area) / 2;
}

function nearestNeighborOrder(invoices: Invoice[], origin: { lat: number; lng: number }): Invoice[] {
  const result: Invoice[] = [];
  const remaining = [...invoices];
  let current = origin;
  while (remaining.length > 0) {
    let min = Infinity, idx = 0;
    remaining.forEach((inv, i) => {
      const d = geoDistance(current, { lat: inv.lat!, lng: inv.lng! });
      if (d < min) { min = d; idx = i; }
    });
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
  /** ID da zona de origem, 'UNASSIGNED' ou 'EXCLUDED' */
  fromZoneId: string;
}

// ── Componente ──────────────────────────────────────────────────────────────

interface Props {
  onBack: () => void;
  onNavigateToZones?: () => void;
}

export const RoteirizacaoView: React.FC<Props> = ({ onBack, onNavigateToZones }) => {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [zones, setZones] = useState<Zone[]>([]);
  const [loading, setLoading] = useState(true);
  const [rotDate, setRotDate] = useState(() => new Date().toISOString().split('T')[0]);

  /** plan: zoneId → Invoice[] */
  const [plan, setPlan] = useState<Record<string, Invoice[]>>({});
  /** zoneVehicles: zoneId → vehicleId selecionado */
  const [zoneVehicles, setZoneVehicles] = useState<Record<string, string>>({});

  const [generating, setGenerating] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [addingInvId, setAddingInvId] = useState<string | null>(null);
  const [excludedIds, setExcludedIds] = useState<string[]>([]);
  const [showExcluded, setShowExcluded] = useState(false);

  // Drag state
  const dragRef = useRef<DragState | null>(null);
  const [dragOverZoneId, setDragOverZoneId] = useState<string | null>(null);
  const [dragOverInvId, setDragOverInvId] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([db.getInvoices(), db.getVehicles(), db.getZones()]).then(([inv, veh, zon]) => {
      setInvoices(inv); setVehicles(veh); setZones(zon); setLoading(false);
    });
  }, []);

  // ── Derivados ─────────────────────────────────────────────────────────────

  const dayInvoices = invoices.filter(inv =>
    inv.created_at?.startsWith(rotDate) && inv.status === 'PENDING' && !inv.deleted_at
  );
  const hasPlan = Object.keys(plan).length > 0;
  const assignedIds = new Set(Object.values(plan).flat().map(i => i.id));
  const eligibleInvoices = dayInvoices.filter(inv => !excludedIds.includes(inv.id));
  const unassigned = eligibleInvoices.filter(inv => !assignedIds.has(inv.id));
  const excludedInvoices = dayInvoices.filter(inv => excludedIds.includes(inv.id));

  // ── Geração ───────────────────────────────────────────────────────────────

  const handleGenerate = async () => {
    if (zones.length === 0 || eligibleInvoices.length === 0) return;
    setGenerating(true);
    try {
      const geocoded = await Promise.all(eligibleInvoices.map(geocodeInvoice));
      setInvoices(prev => prev.map(inv => geocoded.find(g => g.id === inv.id) ?? inv));
      const withCoords = geocoded.filter(inv => inv.lat && inv.lng);

      // Pré-calcula área de cada zona — menor área = zona mais específica (aninhada)
      const zoneAreas: Record<string, number> = {};
      for (const z of zones) zoneAreas[z.id] = polygonArea(z.coordinates);

      const newPlan: Record<string, Invoice[]> = {};
      zones.forEach(z => { newPlan[z.id] = []; });

      for (const inv of withCoords) {
        const pt = { lat: inv.lat!, lng: inv.lng! };
        // Encontra todas as zonas que contêm este ponto
        const matching = zones.filter(z => pointInPolygon(pt, z.coordinates));
        if (matching.length === 0) continue; // ficará em "sem zona"
        // Zona mais específica = menor área
        const best = matching.reduce((a, b) =>
          (zoneAreas[a.id] ?? Infinity) <= (zoneAreas[b.id] ?? Infinity) ? a : b
        );
        newPlan[best.id].push(inv);
      }

      // Ordena cada zona pelo algoritmo do vizinho mais próximo
      for (const z of zones) {
        newPlan[z.id] = nearestNeighborOrder(newPlan[z.id], ROT_ORIGIN);
      }
      setPlan(newPlan);
      setZoneVehicles({});
    } finally { setGenerating(false); }
  };

  // ── Handlers manuais ──────────────────────────────────────────────────────

  const handleRemoveInvoice = (invId: string, zoneId: string) => {
    setPlan(prev => ({ ...prev, [zoneId]: (prev[zoneId] ?? []).filter(i => i.id !== invId) }));
  };

  const handleExclude = (invId: string) => {
    setExcludedIds(prev => [...prev, invId]);
    setAddingInvId(null);
    setPlan(prev => {
      const next = { ...prev };
      for (const zId of Object.keys(next)) next[zId] = next[zId].filter(i => i.id !== invId);
      return next;
    });
  };

  const handleRestore = (invId: string) => setExcludedIds(prev => prev.filter(id => id !== invId));

  const handleAddToZone = (invId: string, zoneId: string) => {
    const inv = dayInvoices.find(i => i.id === invId);
    if (!inv) return;
    setPlan(prev => ({ ...prev, [zoneId]: [...(prev[zoneId] ?? []), inv] }));
    setAddingInvId(null);
  };

  // ── Drag handlers ─────────────────────────────────────────────────────────

  const onDragStart = (invId: string, fromZoneId: string) => {
    dragRef.current = { invId, fromZoneId };
    setAddingInvId(null);
  };

  const onDragEnd = () => {
    dragRef.current = null;
    setDragOverZoneId(null);
    setDragOverInvId(null);
  };

  const onDragOverColumn = (e: React.DragEvent, zoneId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverZoneId(zoneId);
    setDragOverInvId(null);
  };

  const onDragOverCard = (e: React.DragEvent, zoneId: string, invId: string) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    setDragOverZoneId(zoneId);
    setDragOverInvId(invId);
  };

  const resolveInv = (drag: DragState): Invoice | undefined => {
    if (drag.fromZoneId === 'UNASSIGNED') return dayInvoices.find(i => i.id === drag.invId);
    return (plan[drag.fromZoneId] ?? []).find(i => i.id === drag.invId);
  };

  const onDropColumn = (e: React.DragEvent, toZoneId: string) => {
    e.preventDefault();
    const drag = dragRef.current;
    if (!drag) return;
    setDragOverZoneId(null); setDragOverInvId(null);

    setPlan(prev => {
      const inv = resolveInv(drag);
      if (!inv) return prev;
      if (drag.fromZoneId === 'UNASSIGNED') {
        return { ...prev, [toZoneId]: [...(prev[toZoneId] ?? []), inv] };
      }
      if (drag.fromZoneId === toZoneId) {
        const list = [...(prev[toZoneId] ?? [])];
        const idx = list.findIndex(i => i.id === drag.invId);
        if (idx === -1) return prev;
        list.push(list.splice(idx, 1)[0]);
        return { ...prev, [toZoneId]: list };
      }
      const from = [...(prev[drag.fromZoneId] ?? [])];
      const to = [...(prev[toZoneId] ?? [])];
      const idx = from.findIndex(i => i.id === drag.invId);
      if (idx === -1) return prev;
      from.splice(idx, 1);
      to.push(inv);
      return { ...prev, [drag.fromZoneId]: from, [toZoneId]: to };
    });
    dragRef.current = null;
  };

  const onDropCard = (e: React.DragEvent, toZoneId: string, targetInvId: string) => {
    e.preventDefault();
    e.stopPropagation();
    const drag = dragRef.current;
    if (!drag || drag.invId === targetInvId) return;
    setDragOverZoneId(null); setDragOverInvId(null);

    setPlan(prev => {
      const inv = resolveInv(drag);
      if (!inv) return prev;
      if (drag.fromZoneId === 'UNASSIGNED') {
        const toList = [...(prev[toZoneId] ?? [])];
        const tIdx = toList.findIndex(i => i.id === targetInvId);
        toList.splice(tIdx < 0 ? toList.length : tIdx, 0, inv);
        return { ...prev, [toZoneId]: toList };
      }
      const fromList = [...(prev[drag.fromZoneId] ?? [])];
      const srcIdx = fromList.findIndex(i => i.id === drag.invId);
      if (srcIdx === -1) return prev;
      fromList.splice(srcIdx, 1);
      if (drag.fromZoneId === toZoneId) {
        const tIdx = fromList.findIndex(i => i.id === targetInvId);
        fromList.splice(tIdx < 0 ? fromList.length : tIdx, 0, inv);
        return { ...prev, [toZoneId]: fromList };
      }
      const toList = [...(prev[toZoneId] ?? [])];
      const tIdx = toList.findIndex(i => i.id === targetInvId);
      toList.splice(tIdx < 0 ? toList.length : tIdx, 0, inv);
      return { ...prev, [drag.fromZoneId]: fromList, [toZoneId]: toList };
    });
    dragRef.current = null;
  };

  // ── Confirmar ─────────────────────────────────────────────────────────────

  const handleConfirm = async () => {
    setConfirming(true);
    try {
      await Promise.all(
        Object.entries(plan).map(([zoneId, invs]) => {
          const vehicleId = zoneVehicles[zoneId];
          if (!vehicleId || invs.length === 0) return Promise.resolve();
          return db.assignVehicleToInvoices(vehicleId, invs.map(i => i.id));
        })
      );
      onBack();
    } finally { setConfirming(false); }
  };

  const canConfirm = hasPlan && Object.entries(plan).some(([zId, invs]) => invs.length > 0 && zoneVehicles[zId]);

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="h-screen bg-slate-50 dark:bg-slate-900 flex items-center justify-center">
        <Loader2 size={32} className="animate-spin text-violet-500" />
      </div>
    );
  }

  // Estado: sem zonas cadastradas
  if (zones.length === 0) {
    return (
      <div className="h-screen bg-slate-50 dark:bg-slate-900 flex flex-col">
        <div className="bg-violet-600 text-white px-5 py-3 flex items-center gap-4 shadow-lg shrink-0">
          <button onClick={onBack} className="p-2 rounded-lg hover:bg-white/20 transition-colors">
            <ChevronLeft size={20} />
          </button>
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-white/20 rounded-lg flex items-center justify-center"><Route size={20} /></div>
            <div>
              <h1 className="font-bold text-lg leading-tight">Roteirização</h1>
              <p className="text-violet-200 text-xs">Distribua e ordene as entregas automaticamente</p>
            </div>
          </div>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center p-8">
          <Hexagon size={56} className="text-indigo-300 opacity-60" />
          <h2 className="text-xl font-bold text-slate-700 dark:text-white">Nenhuma zona cadastrada</h2>
          <p className="text-slate-500 dark:text-slate-400 max-w-sm">
            A roteirização usa zonas geográficas para agrupar as entregas por região.
            Cadastre pelo menos uma zona antes de gerar o roteiro.
          </p>
          <button onClick={onNavigateToZones}
            className="flex items-center gap-2 px-6 py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl transition-colors shadow-md">
            <Hexagon size={18} /> Ir para Zonas de Entrega
          </button>
        </div>
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
          <div className="w-9 h-9 bg-white/20 rounded-lg flex items-center justify-center"><Route size={20} /></div>
          <div>
            <h1 className="font-bold text-lg leading-tight">Roteirização</h1>
            <p className="text-violet-200 text-xs">Distribua e ordene as entregas automaticamente</p>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <input type="date" value={rotDate}
            onChange={e => { setRotDate(e.target.value); setPlan({}); setZoneVehicles({}); }}
            className="px-3 py-1.5 rounded-lg bg-white/20 border border-white/30 text-white text-sm outline-none focus:ring-2 focus:ring-white/50" />
          <span className="text-violet-200 text-sm font-medium">
            {eligibleInvoices.length} notas elegíveis
            {excludedInvoices.length > 0 && (
              <span className="ml-1 text-violet-300 text-xs">({excludedInvoices.length} excluídas)</span>
            )}
          </span>
          {canConfirm && (
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

          {/* Botão gerar */}
          <div className="p-4 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 shrink-0">
            <div className="flex items-center gap-2 mb-3">
              <Hexagon size={14} className="text-indigo-500" />
              <span className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                {zones.length} zona{zones.length !== 1 ? 's' : ''} ativas
              </span>
            </div>
            <button onClick={handleGenerate}
              disabled={generating || eligibleInvoices.length === 0}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5
                bg-violet-600 hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed
                text-white font-bold rounded-lg text-sm transition-colors">
              {generating
                ? <><Loader2 size={14} className="animate-spin" /> Calculando rotas...</>
                : <><Route size={14} /> Gerar Roteiro por Zonas</>}
            </button>
          </div>

          {/* Colunas + pool — scrollável */}
          <div className="flex-1 overflow-y-auto p-3 space-y-3">
            {!hasPlan && !generating && (
              <div className="flex flex-col items-center justify-center h-full gap-3 text-slate-400 dark:text-slate-600 text-center py-12">
                <Route size={40} className="opacity-30" />
                <p className="text-sm">Clique em Gerar Roteiro para<br />distribuir as notas por zona</p>
              </div>
            )}

            {/* Uma coluna por zona */}
            {zones.map(zone => {
              const notes = plan[zone.id] ?? [];
              const isOver = dragOverZoneId === zone.id;
              const color = zone.color;

              return (
                <div key={zone.id}
                  onDragOver={e => onDragOverColumn(e, zone.id)}
                  onDragLeave={() => { if (dragOverZoneId === zone.id && !dragOverInvId) setDragOverZoneId(null); }}
                  onDrop={e => onDropColumn(e, zone.id)}
                  className="rounded-lg border-2 transition-all"
                  style={{ borderColor: isOver ? color : color + '55', boxShadow: isOver ? `0 0 0 2px ${color}30` : 'none' }}>

                  {/* Header da zona */}
                  <div className="flex items-center gap-2 px-3 py-2 rounded-t-md" style={{ backgroundColor: color + '18' }}>
                    <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: color }} />
                    <span className="font-bold text-sm text-slate-700 dark:text-slate-200 flex-1 truncate">{zone.name}</span>
                    <span className="text-xs font-bold shrink-0" style={{ color }}>{notes.length} paradas</span>
                  </div>

                  {/* Seletor de veículo */}
                  <div className="px-2 pt-2">
                    <select
                      value={zoneVehicles[zone.id] ?? ''}
                      onChange={e => setZoneVehicles(prev => ({ ...prev, [zone.id]: e.target.value }))}
                      className="w-full text-xs rounded-md border border-slate-200 dark:border-slate-600
                        bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-200
                        px-2 py-1.5 outline-none focus:ring-1 focus:ring-violet-400">
                      <option value="">— Selecionar veículo —</option>
                      {vehicles.map(v => (
                        <option key={v.id} value={v.id}>{v.plate} — {v.model}</option>
                      ))}
                    </select>
                  </div>

                  {/* Cards das notas */}
                  <div className="p-2 space-y-1 min-h-[52px]">
                    {notes.length === 0 && (
                      <div className={`text-center text-xs py-3 rounded border-2 border-dashed transition-colors ${
                        isOver ? 'text-violet-500 border-violet-300 bg-violet-50 dark:bg-violet-900/20'
                               : 'text-slate-400 border-slate-200 dark:border-slate-700'
                      }`}>
                        {isOver ? 'Solte aqui' : 'Sem notas nesta zona'}
                      </div>
                    )}
                    {notes.map((inv, order) => {
                      const isCardOver = dragOverInvId === inv.id && dragOverZoneId === zone.id;
                      return (
                        <div key={inv.id}
                          draggable
                          onDragStart={() => onDragStart(inv.id, zone.id)}
                          onDragEnd={onDragEnd}
                          onDragOver={e => onDragOverCard(e, zone.id, inv.id)}
                          onDrop={e => onDropCard(e, zone.id, inv.id)}
                          className={`group flex items-center gap-1.5 px-2 py-1.5 rounded border
                            cursor-grab active:cursor-grabbing select-none transition-all ${
                            isCardOver
                              ? 'border-t-2 bg-violet-50 dark:bg-violet-900/20 border-violet-400 shadow-sm'
                              : 'bg-white dark:bg-slate-700 border-slate-200 dark:border-slate-600 hover:shadow-sm'
                          }`}>
                          <GripVertical size={11} className="text-slate-300 dark:text-slate-500 shrink-0" />
                          <span className="w-5 h-5 rounded-full flex items-center justify-center text-white text-[10px] font-bold shrink-0"
                            style={{ backgroundColor: color }}>
                            {order + 1}
                          </span>
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
                          {/* Botões — hover */}
                          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all shrink-0">
                            <button
                              onMouseDown={e => e.stopPropagation()}
                              onClick={e => { e.stopPropagation(); handleRemoveInvoice(inv.id, zone.id); }}
                              title="Mover para não atribuídas"
                              className="w-5 h-5 rounded-full flex items-center justify-center cursor-pointer
                                bg-slate-100 hover:bg-slate-200 dark:bg-slate-600 dark:hover:bg-slate-500
                                text-slate-500 dark:text-slate-300 transition-colors">
                              <X size={11} />
                            </button>
                            <button
                              onMouseDown={e => e.stopPropagation()}
                              onClick={e => { e.stopPropagation(); handleExclude(inv.id); }}
                              title="Excluir da roteirização"
                              className="w-5 h-5 rounded-full flex items-center justify-center cursor-pointer
                                bg-red-100 hover:bg-red-200 dark:bg-red-900/30 dark:hover:bg-red-800/50
                                text-red-500 dark:text-red-400 transition-colors">
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

            {/* Pool de não atribuídas */}
            {hasPlan && unassigned.length > 0 && (
              <div className="rounded-lg border-2 border-dashed border-orange-300 dark:border-orange-700">
                <div className="flex items-center gap-2 px-3 py-2 bg-orange-50 dark:bg-orange-900/20 rounded-t-md">
                  <AlertTriangle size={13} className="text-orange-500 shrink-0" />
                  <span className="text-xs font-bold text-orange-600 dark:text-orange-400 flex-1">Sem zona / Sem coordenada</span>
                  <span className="text-xs font-bold text-orange-500">{unassigned.length}</span>
                </div>
                <div className="p-2 space-y-1">
                  {unassigned.map(inv => (
                    <div key={inv.id}>
                      <div
                        draggable={zones.length > 0}
                        onDragStart={() => onDragStart(inv.id, 'UNASSIGNED')}
                        onDragEnd={onDragEnd}
                        className="flex items-center gap-1.5 px-2 py-1.5 rounded border
                          bg-white dark:bg-slate-700 border-orange-200 dark:border-orange-800
                          select-none cursor-grab active:cursor-grabbing">
                        <GripVertical size={11} className="text-orange-300 shrink-0" />
                        <Package size={11} className="text-orange-400 shrink-0" />
                        <div className="min-w-0 flex-1 overflow-hidden">
                          <div className="flex items-center gap-1">
                            <span className="text-[10px] font-mono text-slate-400 shrink-0">NF {inv.number}</span>
                            <span className="text-[10px] text-slate-300 dark:text-slate-500">·</span>
                            <span className="text-[10px] font-semibold text-slate-500 shrink-0">
                              R${inv.value.toLocaleString('pt-BR', { minimumFractionDigits: 0 })}
                            </span>
                          </div>
                          <p className="text-xs font-medium text-slate-700 dark:text-slate-200 truncate leading-tight">
                            {inv.customer_name}
                          </p>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button onClick={() => setAddingInvId(addingInvId === inv.id ? null : inv.id)}
                            title="Adicionar a uma zona"
                            className="w-5 h-5 rounded-full flex items-center justify-center cursor-pointer
                              bg-violet-100 hover:bg-violet-200 dark:bg-violet-900/40
                              text-violet-600 dark:text-violet-400 transition-colors">
                            {addingInvId === inv.id ? <X size={11} /> : <Plus size={11} />}
                          </button>
                          <button onClick={() => handleExclude(inv.id)}
                            title="Excluir da roteirização"
                            className="w-5 h-5 rounded-full flex items-center justify-center cursor-pointer
                              bg-red-100 hover:bg-red-200 dark:bg-red-900/30
                              text-red-500 dark:text-red-400 transition-colors">
                            <Ban size={10} />
                          </button>
                        </div>
                      </div>
                      {/* Seletor de zona inline */}
                      {addingInvId === inv.id && (
                        <div className="mt-1 mx-1 px-2 py-1.5 rounded bg-violet-50 dark:bg-violet-900/20 border border-violet-200 dark:border-violet-700">
                          <p className="text-[10px] text-violet-500 font-bold mb-1.5 uppercase tracking-wide">Adicionar à zona:</p>
                          <div className="flex flex-wrap gap-1">
                            {zones.map(zone => (
                              <button key={zone.id}
                                onClick={() => handleAddToZone(inv.id, zone.id)}
                                className="flex items-center gap-1 px-2 py-1 rounded-full text-white text-[10px] font-bold hover:opacity-80 transition-opacity cursor-pointer"
                                style={{ backgroundColor: zone.color }}>
                                {zone.name}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Notas excluídas */}
            {excludedInvoices.length > 0 && (
              <div className="rounded-lg border-2 border-dashed border-slate-300 dark:border-slate-600">
                <button onClick={() => setShowExcluded(v => !v)}
                  className="w-full flex items-center gap-2 px-3 py-2 bg-slate-100 dark:bg-slate-700/60
                    rounded-t-md hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors">
                  <Ban size={13} className="text-slate-400 shrink-0" />
                  <span className="text-xs font-bold text-slate-500 dark:text-slate-400 flex-1 text-left">Excluídas da rota</span>
                  <span className="text-xs font-bold text-slate-400 mr-1">{excludedInvoices.length}</span>
                  <span className="text-[10px] text-slate-400">{showExcluded ? '▲' : '▼'}</span>
                </button>
                {showExcluded && (
                  <div className="p-2 space-y-1">
                    {excludedInvoices.map(inv => (
                      <div key={inv.id} className="flex items-center gap-1.5 px-2 py-1.5 rounded border opacity-60
                        bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-600">
                        <Ban size={11} className="text-slate-400 shrink-0" />
                        <div className="min-w-0 flex-1 overflow-hidden">
                          <div className="flex items-center gap-1">
                            <span className="text-[10px] font-mono text-slate-400 shrink-0">NF {inv.number}</span>
                          </div>
                          <p className="text-xs font-medium text-slate-500 dark:text-slate-400 truncate leading-tight">{inv.customer_name}</p>
                        </div>
                        <button onClick={() => handleRestore(inv.id)} title="Restaurar"
                          className="w-5 h-5 rounded-full flex items-center justify-center shrink-0 cursor-pointer
                            bg-green-100 hover:bg-green-200 dark:bg-green-900/30
                            text-green-600 dark:text-green-400 transition-colors opacity-100">
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
              <p className="text-sm font-semibold text-slate-600 dark:text-slate-300">Geocodificando e calculando rotas...</p>
            </div>
          )}

          <Map
            initialViewState={{ latitude: ROT_ORIGIN.lat, longitude: ROT_ORIGIN.lng, zoom: 11 }}
            style={{ width: '100%', height: '100%' }}
            mapStyle="mapbox://styles/mapbox/streets-v12"
            mapboxAccessToken={MAPBOX_TOKEN}>
            <NavigationControl position="bottom-right" />

            {/* Origem */}
            <Marker latitude={ROT_ORIGIN.lat} longitude={ROT_ORIGIN.lng} anchor="center">
              <div className="w-6 h-6 rounded-full bg-slate-800 border-2 border-white shadow-lg flex items-center justify-center">
                <div className="w-2.5 h-2.5 rounded-full bg-white" />
              </div>
            </Marker>

            {/* Polígonos das zonas (sempre visíveis) */}
            {zones.map(zone => {
              if (zone.coordinates.length < 3) return null;
              const coords = [...zone.coordinates.map(p => [p.lng, p.lat]), [zone.coordinates[0].lng, zone.coordinates[0].lat]];
              return (
                <Source key={`zone-${zone.id}`} type="geojson" data={{
                  type: 'Feature' as const,
                  geometry: { type: 'Polygon' as const, coordinates: [coords] },
                  properties: {},
                }}>
                  <Layer type="fill" paint={{ 'fill-color': zone.color, 'fill-opacity': 0.08 }} />
                  <Layer type="line" paint={{ 'line-color': zone.color, 'line-width': 1.5, 'line-dasharray': [3, 2] }} />
                </Source>
              );
            })}

            {/* Linhas de rota por zona */}
            {hasPlan && zones.map(zone => {
              const notes = plan[zone.id] ?? [];
              const coords = [[ROT_ORIGIN.lng, ROT_ORIGIN.lat], ...notes.filter(n => n.lat && n.lng).map(n => [n.lng!, n.lat!])];
              if (coords.length < 2) return null;
              return (
                <Source key={`route-${zone.id}`} type="geojson" data={{
                  type: 'Feature' as const,
                  geometry: { type: 'LineString' as const, coordinates: coords },
                  properties: {},
                }}>
                  <Layer type="line" paint={{ 'line-color': zone.color, 'line-width': 3, 'line-dasharray': [2, 1.5] }} />
                </Source>
              );
            })}

            {/* Marcadores das notas */}
            {hasPlan && zones.map(zone => {
              const notes = plan[zone.id] ?? [];
              return notes.filter(n => n.lat && n.lng).map((inv, order) => (
                <Marker key={inv.id} latitude={inv.lat!} longitude={inv.lng!} anchor="bottom">
                  <div className="flex flex-col items-center">
                    <div className="mb-0.5 px-1.5 py-0.5 text-white text-[9px] font-bold rounded shadow"
                      style={{ backgroundColor: zone.color }}>{order + 1}</div>
                    <div className="w-6 h-6 rounded-full border-2 border-white shadow-md flex items-center justify-center"
                      style={{ backgroundColor: zone.color }}>
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
              <p className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1">Zonas</p>
              {zones.map(zone => {
                const v = vehicles.find(x => x.id === zoneVehicles[zone.id]);
                return (
                  <div key={zone.id} className="flex items-center gap-2.5 text-xs">
                    <div className="w-7 h-1.5 rounded-full shrink-0" style={{ backgroundColor: zone.color }} />
                    <span className="font-bold text-slate-700 dark:text-slate-200">{zone.name}</span>
                    <span className="text-slate-400">{(plan[zone.id] ?? []).length} paradas</span>
                    {v && <span className="text-slate-400 font-mono">· {v.plate}</span>}
                  </div>
                );
              })}
              {unassigned.length > 0 && (
                <div className="flex items-center gap-2.5 text-xs pt-1.5 border-t border-slate-200 dark:border-slate-600">
                  <AlertTriangle size={12} className="text-orange-400 shrink-0" />
                  <span className="text-orange-500">{unassigned.length} sem zona</span>
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
