import React, { useState, useEffect, useRef, useMemo } from 'react';
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

/** Cores distintas para cada veículo no roteiro (independente da cor da zona) */
const VEHICLE_COLORS = [
  '#4f46e5', // indigo
  '#dc2626', // red
  '#16a34a', // green
  '#d97706', // amber
  '#7c3aed', // violet
  '#0891b2', // cyan
  '#be185d', // pink
  '#15803d', // green-dark
];
function getVehicleColor(globalIdx: number) {
  return VEHICLE_COLORS[globalIdx % VEHICLE_COLORS.length];
}

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

interface RouteInfo {
  coords: number[][];
  distanceM: number; // metros
  durationS: number; // segundos
}

/**
 * Busca rota pelas ruas usando Mapbox Directions API.
 * Suporta mais de 25 waypoints dividindo em chunks encadeados.
 * Retorna coords + distância total (m) + duração total (s).
 */
async function fetchRoadRoute(waypoints: { lat: number; lng: number }[]): Promise<RouteInfo> {
  const empty: RouteInfo = { coords: [], distanceM: 0, durationS: 0 };
  if (waypoints.length < 2) return empty;

  const MAX_WP = 25;
  const allCoords: number[][] = [];
  let totalDist = 0;
  let totalDur = 0;
  let start = 0;

  while (start < waypoints.length - 1) {
    const chunk = waypoints.slice(start, start + MAX_WP);
    const coordStr = chunk.map(p => `${p.lng},${p.lat}`).join(';');
    try {
      const res = await fetch(
        `https://api.mapbox.com/directions/v5/mapbox/driving/${coordStr}` +
        `?geometries=geojson&overview=full&access_token=${MAPBOX_TOKEN}`
      );
      const data = await res.json();
      const route = data.routes?.[0];
      if (route) {
        const coords: number[][] = route.geometry?.coordinates ?? [];
        allCoords.push(...(allCoords.length > 0 ? coords.slice(1) : coords));
        totalDist += route.distance ?? 0;
        totalDur  += route.duration ?? 0;
      }
    } catch { /* silencioso — fallback para linha reta */ }
    start += MAX_WP - 1;
  }
  return { coords: allCoords, distanceM: totalDist, durationS: totalDur };
}

/**
 * Divide notas entre n veículos respeitando co-localização:
 * notas no mesmo endereço (lat/lng idênticos) ficam sempre no mesmo veículo.
 */
function splitRespectingLocations(invoices: Invoice[], n: number): Invoice[][] {
  if (n <= 1) return [invoices];

  // Agrupa notas consecutivas no mesmo local
  const groups: Invoice[][] = [];
  for (const inv of invoices) {
    const last = groups[groups.length - 1];
    if (last && last[0].lat === inv.lat && last[0].lng === inv.lng
        && inv.lat != null && inv.lng != null) {
      last.push(inv);
    } else {
      groups.push([inv]);
    }
  }

  // Divide os grupos evenly e depois achata cada fatia
  const splitGroups = splitEvenly(groups, n);
  return splitGroups.map(gs => gs.flat());
}

/** Divide um array em n partes aproximadamente iguais */
function splitEvenly<T>(arr: T[], n: number): T[][] {
  if (n <= 1) return [arr];
  const result: T[][] = [];
  const base = Math.floor(arr.length / n);
  const extra = arr.length % n;
  let cursor = 0;
  for (let i = 0; i < n; i++) {
    const size = base + (i < extra ? 1 : 0);
    result.push(arr.slice(cursor, cursor + size));
    cursor += size;
  }
  return result.filter(c => c.length > 0);
}

function fmtDist(meters: number): string {
  return `${(meters / 1000).toFixed(1)} km`;
}

function fmtDur(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  if (h === 0) return `${m} min`;
  return `${h}h ${m < 10 ? '0' : ''}${m}min`;
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
  /** zoneVehicles: zoneId → lista de vehicleIds (suporte a múltiplos veículos) */
  const [zoneVehicles, setZoneVehicles] = useState<Record<string, string[]>>({});

  const [generating, setGenerating] = useState(false);
  const [confirming, setConfirming] = useState(false);
  /** Rota real pelas ruas por zona: coords + distância + duração */
  const [roadRoutes, setRoadRoutes] = useState<Record<string, RouteInfo>>({});
  const [fetchingRoutes, setFetchingRoutes] = useState(false);
  const [hoveredPinKey, setHoveredPinKey] = useState<string | null>(null);
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

  /**
   * Sempre que o plano ou os veículos mudam, re-busca as rotas pelas ruas.
   * Cada veículo tem sua própria rota partindo do ROT_ORIGIN.
   * Chave: `${zoneId}:${vehicleIdx}`
   */
  useEffect(() => {
    const isEmpty = Object.values(plan).every(invs => invs.length === 0);
    if (isEmpty) { setRoadRoutes({}); return; }

    setFetchingRoutes(true);
    const timer = setTimeout(async () => {
      try {
        const results: Record<string, RouteInfo> = {};
        // Usa os clusters já calculados pelo K-Means (via vaRef)
        await Promise.all(
          vaRef.current.map(async ({ routeKey, notes }) => {
            const withCoords = notes.filter(n => n.lat && n.lng);
            if (withCoords.length === 0) return;
            const waypoints = [ROT_ORIGIN, ...withCoords.map(n => ({ lat: n.lat!, lng: n.lng! }))];
            results[routeKey] = await fetchRoadRoute(waypoints);
          })
        );
        setRoadRoutes(results);
      } finally {
        setFetchingRoutes(false);
      }
    }, 600);

    return () => { clearTimeout(timer); setFetchingRoutes(false); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan, zoneVehicles]);

  // ── Derivados ─────────────────────────────────────────────────────────────

  // Todas as notas pendentes não excluídas — independente da data de importação
  const dayInvoices = invoices.filter(inv =>
    inv.status === 'PENDING' && !inv.deleted_at
  );

  /**
   * Lista plana de atribuições veículo→notas, com cor distinta por veículo.
   * Usa K-Means geográfico para zonas com múltiplos veículos.
   * Memoizado — só recalcula quando plan ou zoneVehicles mudam.
   */
  const vehicleAssignments = useMemo(() => {
    let globalIdx = 0;
    return zones.flatMap(zone => {
      const vIds  = zoneVehicles[zone.id] ?? [];
      const count = Math.max(vIds.length, 1);
      const notes = plan[zone.id] ?? [];
      const chunks = splitRespectingLocations(notes, count);
      return Array.from({ length: count }, (_, vi) => {
        const color = getVehicleColor(globalIdx++);
        return {
          zone,
          vi,
          vehicleId: vIds[vi] ?? '',
          notes: chunks[vi] ?? [],
          color,
          routeKey: `${zone.id}:${vi}`,
        };
      });
    });
  }, [plan, zoneVehicles, zones]);

  // Ref para o useEffect acessar vehicleAssignments sem dependência circular
  const vaRef = useRef(vehicleAssignments);
  vaRef.current = vehicleAssignments;
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
        vehicleAssignments
          .filter(va => va.vehicleId && va.notes.length > 0)
          .map(va => db.assignVehicleToInvoices(va.vehicleId, va.notes.map(i => i.id)))
      );
      onBack();
    } finally { setConfirming(false); }
  };

  const canConfirm = hasPlan &&
    vehicleAssignments.some(va => va.vehicleId && va.notes.length > 0);

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
          <div className="flex flex-col items-end">
            <label className="text-violet-300 text-[10px] font-bold uppercase tracking-wide mb-0.5">
              Data de entrega
            </label>
            <input type="date" value={rotDate}
              onChange={e => setRotDate(e.target.value)}
              className="px-3 py-1.5 rounded-lg bg-white/20 border border-white/30 text-white text-sm outline-none focus:ring-2 focus:ring-white/50" />
          </div>
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
              const routeInfo = roadRoutes[zone.id];

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

                  {/* Indicadores de distância e tempo */}
                  {routeInfo && routeInfo.distanceM > 0 && (
                    <div className="flex items-center gap-3 px-3 py-1.5 border-b border-slate-100 dark:border-slate-700"
                      style={{ backgroundColor: color + '0a' }}>
                      <span className="text-[11px] font-bold text-slate-600 dark:text-slate-300 flex items-center gap-1">
                        🛣️ {fmtDist(routeInfo.distanceM)}
                      </span>
                      <span className="text-[11px] text-slate-400">·</span>
                      <span className="text-[11px] font-bold text-slate-600 dark:text-slate-300 flex items-center gap-1">
                        ⏱ {fmtDur(routeInfo.durationS)}
                      </span>
                      {fetchingRoutes && (
                        <Loader2 size={10} className="animate-spin text-slate-300 ml-auto" />
                      )}
                    </div>
                  )}

                  {/* Seletores de veículos com cor por veículo */}
                  {(() => {
                    const zoneVAs = vehicleAssignments.filter(va => va.zone.id === zone.id);
                    const vIds = zoneVehicles[zone.id] ?? [];
                    const usedInZone = new Set(vIds.filter(Boolean));
                    return (
                      <div className="px-2 pt-2 space-y-1">
                        {zoneVAs.map(({ vi, vehicleId: vId, color: vColor, notes: vNotes }) => (
                          <div key={vi} className="flex items-center gap-1.5">
                            {/* Swatch de cor do veículo */}
                            <div className="w-2.5 h-2.5 rounded-full shrink-0 ring-1 ring-white/50"
                              style={{ backgroundColor: vColor }} />
                            <select
                              value={vId}
                              onChange={e => setZoneVehicles(prev => {
                                const cur = [...(prev[zone.id] ?? [])];
                                cur[vi] = e.target.value;
                                return { ...prev, [zone.id]: cur };
                              })}
                              className="flex-1 text-xs rounded-md border border-slate-200 dark:border-slate-600
                                bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-200
                                px-2 py-1.5 outline-none focus:ring-1"
                              style={{ '--tw-ring-color': vColor } as React.CSSProperties}>
                              <option value="">— Veículo {vi + 1} —</option>
                              {vehicles.map(v => (
                                <option key={v.id} value={v.id}
                                  disabled={usedInZone.has(v.id) && v.id !== vId}>
                                  {v.plate} — {v.model}
                                </option>
                              ))}
                            </select>
                            {/* Contagem de notas deste veículo */}
                            {hasPlan && vNotes.length > 0 && (
                              <span className="text-[10px] font-bold shrink-0 px-1 py-0.5 rounded"
                                style={{ backgroundColor: vColor + '22', color: vColor }}>
                                {vNotes.length}
                              </span>
                            )}
                            {/* Remover veículo */}
                            {vIds.length > 1 && (
                              <button
                                onClick={() => setZoneVehicles(prev => {
                                  const cur = (prev[zone.id] ?? []).filter((_, i) => i !== vi);
                                  return { ...prev, [zone.id]: cur };
                                })}
                                className="w-5 h-5 shrink-0 flex items-center justify-center rounded-full
                                  bg-red-100 hover:bg-red-200 text-red-500 transition-colors cursor-pointer">
                                <X size={10} />
                              </button>
                            )}
                          </div>
                        ))}

                        {/* Botão adicionar veículo */}
                        {notes.length > 1 && (zoneVehicles[zone.id] ?? []).length < vehicles.length && (
                          <button
                            onClick={() => setZoneVehicles(prev => ({
                              ...prev,
                              [zone.id]: [...(prev[zone.id] ?? ['']), ''],
                            }))}
                            className="w-full flex items-center justify-center gap-1 py-1 rounded-md text-[11px]
                              border border-dashed border-slate-300 dark:border-slate-600
                              text-slate-400 hover:text-violet-500 hover:border-violet-300
                              transition-colors cursor-pointer">
                            <Plus size={10} /> Adicionar veículo
                          </button>
                        )}
                      </div>
                    );
                  })()}

                  {/* Cards das notas com divisor por veículo */}
                  <div className="p-2 space-y-1 min-h-[52px]">
                    {notes.length === 0 && (
                      <div className={`text-center text-xs py-3 rounded border-2 border-dashed transition-colors ${
                        isOver ? 'text-violet-500 border-violet-300 bg-violet-50 dark:bg-violet-900/20'
                               : 'text-slate-400 border-slate-200 dark:border-slate-700'
                      }`}>
                        {isOver ? 'Solte aqui' : 'Sem notas nesta zona'}
                      </div>
                    )}
                    {(() => {
                      const zoneVAs = vehicleAssignments.filter(va => va.zone.id === zone.id);
                      const vCount = zoneVAs.length;
                      // Monta mapa invId → cor do veículo
                      const invColor: Record<string, string> = {};
                      zoneVAs.forEach(va => va.notes.forEach(n => { invColor[n.id] = va.color; }));
                      // Índices de início de cada grupo (para inserir divisor)
                      const splitStarts = new Set<number>();
                      if (vCount > 1) {
                        let acc = 0;
                        zoneVAs.forEach((va, i) => { if (i > 0) splitStarts.add(acc); acc += va.notes.length; });
                      }
                      return notes.map((inv, order) => {
                        const isCardOver = dragOverInvId === inv.id && dragOverZoneId === zone.id;
                        const badgeColor = invColor[inv.id] ?? color;
                        const vaForNote = zoneVAs.find(va => va.notes.some(n => n.id === inv.id));
                        return (
                          <React.Fragment key={inv.id}>
                            {splitStarts.has(order) && vaForNote && (
                              <div className="flex items-center gap-1.5 py-1">
                                <div className="flex-1 h-px" style={{ backgroundColor: vaForNote.color + '55' }} />
                                <span className="text-[9px] font-bold uppercase tracking-wide"
                                  style={{ color: vaForNote.color }}>
                                  Veículo {vaForNote.vi + 1}
                                </span>
                                <div className="flex-1 h-px" style={{ backgroundColor: vaForNote.color + '55' }} />
                              </div>
                            )}
                        <div
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
                            style={{ backgroundColor: badgeColor }}>
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
                          </React.Fragment>
                        );
                      });
                    })()}
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
              <p className="text-sm font-semibold text-slate-600 dark:text-slate-300">Geocodificando e distribuindo notas...</p>
            </div>
          )}
          {fetchingRoutes && !generating && (
            <div className="absolute bottom-16 left-1/2 -translate-x-1/2 z-10 pointer-events-none
              bg-slate-800/80 backdrop-blur text-white text-xs font-semibold
              px-3 py-1.5 rounded-full shadow-lg flex items-center gap-2">
              <Loader2 size={12} className="animate-spin" />
              Recalculando percursos pelas ruas...
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

            {/* Rotas e marcadores por veículo — cor distinta + offset lateral por veículo */}
            {hasPlan && vehicleAssignments.map(({ zone, vi, notes: vNotes, color: vColor, routeKey }) => {
              // ── Offset lateral para separar linhas sobrepostas ──
              const zoneVehicleCount = vehicleAssignments.filter(va => va.zone.id === zone.id).length;
              // Centraliza os offsets: ex. 2 veículos → [-4, +4], 3 → [-5, 0, +5]
              const lineOffset = zoneVehicleCount > 1
                ? (vi - (zoneVehicleCount - 1) / 2) * 5
                : 0;

              // ── Rota ──
              const road = roadRoutes[routeKey];
              const isRoad = !!(road && road.coords.length >= 2);
              const withCoords = vNotes.filter(n => n.lat && n.lng);
              const coords: number[][] = isRoad
                ? road.coords
                : [[ROT_ORIGIN.lng, ROT_ORIGIN.lat], ...withCoords.map(n => [n.lng!, n.lat!])];

              return (
                <React.Fragment key={routeKey}>
                  {/* Linha de rota */}
                  {coords.length >= 2 && (
                    <Source type="geojson" data={{
                      type: 'Feature' as const,
                      geometry: { type: 'LineString' as const, coordinates: coords },
                      properties: {},
                    }}>
                      {isRoad && (
                        <Layer type="line" paint={{
                          'line-color': '#000',
                          'line-width': 5,
                          'line-opacity': 0.07,
                          'line-offset': lineOffset,
                        }} />
                      )}
                      <Layer type="line" paint={{
                        'line-color': vColor,
                        'line-width': isRoad ? 4 : 3,
                        'line-offset': lineOffset,
                        ...(!isRoad ? { 'line-dasharray': [2, 1.5] } : {}),
                      }} />
                    </Source>
                  )}

                  {/* Marcadores — agrupados quando há múltiplas entregas no mesmo local */}
                  {(() => {
                    // Agrupa notas por coordenada exata, preservando invoice completa
                    const seen = new Set<string>();
                    const groups: {
                      key: string; lat: number; lng: number;
                      orders: number[]; invoices: Invoice[];
                    }[] = [];
                    withCoords.forEach((inv, order) => {
                      const key = `${inv.lat},${inv.lng}`;
                      if (seen.has(key)) {
                        const g = groups.find(g => g.key === key)!;
                        g.orders.push(order + 1);
                        g.invoices.push(inv);
                      } else {
                        seen.add(key);
                        groups.push({ key, lat: inv.lat!, lng: inv.lng!, orders: [order + 1], invoices: [inv] });
                      }
                    });

                    return groups.map(({ key, lat, lng, orders, invoices: groupInvs }) => {
                      const count = orders.length;
                      const label = count === 1
                        ? String(orders[0])
                        : `${orders[0]}–${orders[count - 1]}`;
                      const isHovered = hoveredPinKey === key;

                      return (
                        <Marker key={key} latitude={lat} longitude={lng} anchor="bottom">
                          <div
                            className="flex flex-col items-center relative"
                            onMouseEnter={() => setHoveredPinKey(key)}
                            onMouseLeave={() => setHoveredPinKey(null)}
                          >
                            {/* ── Tooltip ── */}
                            {isHovered && (
                              <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 z-50
                                bg-white dark:bg-slate-800 rounded-xl shadow-2xl
                                border border-slate-200 dark:border-slate-700
                                w-56 pointer-events-none"
                                style={{ filter: 'drop-shadow(0 4px 12px rgba(0,0,0,0.18))' }}>
                                {/* Cabeçalho */}
                                <div className="px-3 py-2 rounded-t-xl flex items-center gap-2"
                                  style={{ backgroundColor: vColor + '18', borderBottom: `2px solid ${vColor}30` }}>
                                  <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: vColor }} />
                                  <span className="text-[11px] font-bold text-slate-600 dark:text-slate-300">
                                    {count > 1 ? `${count} entregas neste local` : 'Entrega'}
                                  </span>
                                </div>

                                {/* Lista de notas */}
                                <div className="divide-y divide-slate-100 dark:divide-slate-700">
                                  {groupInvs.map((inv, i) => (
                                    <div key={inv.id} className="px-3 py-2">
                                      <div className="flex items-center gap-1.5 mb-0.5">
                                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded text-white"
                                          style={{ backgroundColor: vColor }}>
                                          #{orders[i]}
                                        </span>
                                        <span className="text-[10px] font-mono text-slate-400">NF {inv.number}</span>
                                      </div>
                                      <p className="text-xs font-semibold text-slate-700 dark:text-slate-200 leading-tight truncate">
                                        {inv.customer_name}
                                      </p>
                                      <p className="text-[10px] text-slate-400 mt-0.5 leading-tight truncate">
                                        {inv.customer_address.split('||')[0]}
                                      </p>
                                      <p className="text-[10px] font-semibold mt-0.5"
                                        style={{ color: vColor }}>
                                        R$ {inv.value.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                                      </p>
                                    </div>
                                  ))}
                                </div>

                                {/* Setinha apontando pro pino */}
                                <div className="absolute top-full left-1/2 -translate-x-1/2 w-0 h-0"
                                  style={{
                                    borderLeft: '6px solid transparent',
                                    borderRight: '6px solid transparent',
                                    borderTop: '6px solid white',
                                  }} />
                              </div>
                            )}

                            {/* Label de ordem */}
                            <div className="mb-0.5 px-1.5 py-0.5 text-white text-[9px] font-bold rounded shadow"
                              style={{ backgroundColor: vColor }}>{label}</div>

                            {/* Pino com efeito de pilha */}
                            <div className="relative">
                              {count >= 3 && (
                                <div className="absolute -bottom-1.5 -left-1.5 w-6 h-6 rounded-full border-2 border-white"
                                  style={{ backgroundColor: vColor, opacity: 0.3 }} />
                              )}
                              {count >= 2 && (
                                <div className="absolute -bottom-0.5 -left-0.5 w-6 h-6 rounded-full border-2 border-white"
                                  style={{ backgroundColor: vColor, opacity: 0.55 }} />
                              )}
                              <div className={`relative w-6 h-6 rounded-full border-2 border-white shadow-md
                                flex items-center justify-center transition-transform ${isHovered ? 'scale-125' : ''}`}
                                style={{ backgroundColor: vColor }}>
                                <Package size={11} className="text-white" />
                              </div>
                              {count > 1 && (
                                <div className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full
                                  bg-white border border-slate-200 shadow
                                  flex items-center justify-center text-[9px] font-bold"
                                  style={{ color: vColor }}>
                                  {count}
                                </div>
                              )}
                            </div>
                          </div>
                        </Marker>
                      );
                    });
                  })()}
                </React.Fragment>
              );
            })}
          </Map>

          {/* Legenda */}
          {hasPlan && (
            <div className="absolute top-4 left-4 bg-white/95 dark:bg-slate-800/95 backdrop-blur rounded-xl shadow-lg p-4 space-y-2 border border-slate-200 dark:border-slate-700">
              <p className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1">Veículos</p>
              {vehicleAssignments.map(({ zone, vi, vehicleId, notes: vNotes, color: vColor, routeKey }) => {
                const v = vehicles.find(x => x.id === vehicleId);
                const ri = roadRoutes[routeKey];
                return (
                  <div key={routeKey} className="space-y-0.5">
                    <div className="flex items-center gap-2 text-xs">
                      <div className="w-6 h-1.5 rounded-full shrink-0" style={{ backgroundColor: vColor }} />
                      <span className="font-bold text-slate-700 dark:text-slate-200 truncate">
                        {v ? v.plate : `Veículo ${vi + 1}`}
                      </span>
                      <span className="text-slate-400 shrink-0">{vNotes.length} paradas</span>
                    </div>
                    <div className="flex items-center gap-1.5 pl-8 text-[10px] text-slate-400">
                      <span className="truncate">{zone.name}</span>
                      {ri && ri.distanceM > 0 && (
                        <>
                          <span>·</span>
                          <span>{fmtDist(ri.distanceM)}</span>
                          <span>·</span>
                          <span>{fmtDur(ri.durationS)}</span>
                        </>
                      )}
                    </div>
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
