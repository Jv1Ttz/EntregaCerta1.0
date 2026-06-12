import React, { useState, useEffect, useCallback } from 'react';
import { db } from '../services/db';
import { Zone } from '../types';
import {
  ChevronLeft, Plus, Trash2, Pencil, Check, X, Loader2,
  MousePointer2, Hexagon, PenLine, Move,
} from 'lucide-react';
import Map, { Marker, NavigationControl, Source, Layer } from 'react-map-gl';
import 'mapbox-gl/dist/mapbox-gl.css';

const MAPBOX_TOKEN = (import.meta.env.VITE_MAPBOX_TOKEN as string) || '';
const CENTER = { lat: -12.931685, lng: -38.512682 };

const ZONE_COLORS = [
  '#3b82f6', '#ef4444', '#22c55e', '#f59e0b',
  '#8b5cf6', '#ec4899', '#06b6d4', '#f97316',
  '#84cc16', '#14b8a6',
];

/** Centróide aproximado de um polígono (média dos vértices) */
function centroid(coords: { lat: number; lng: number }[]) {
  return {
    lat: coords.reduce((s, p) => s + p.lat, 0) / coords.length,
    lng: coords.reduce((s, p) => s + p.lng, 0) / coords.length,
  };
}

type LatLng = { lat: number; lng: number };

/** Distância (em graus) de um ponto P ao segmento A→B — projeção limitada ao trecho */
function distPointToSegment(p: LatLng, a: LatLng, b: LatLng): number {
  const A = p.lng - a.lng;
  const B = p.lat - a.lat;
  const C = b.lng - a.lng;
  const D = b.lat - a.lat;
  const lenSq = C * C + D * D;
  let t = lenSq !== 0 ? (A * C + B * D) / lenSq : 0;
  t = Math.max(0, Math.min(1, t)); // limita à extensão do segmento
  const dLng = p.lng - (a.lng + t * C);
  const dLat = p.lat - (a.lat + t * D);
  return Math.sqrt(dLng * dLng + dLat * dLat);
}

/**
 * Insere um novo ponto na posição mais natural do polígono:
 * encontra a aresta (incluindo a de fechamento) mais próxima do clique
 * e coloca o ponto entre os dois vértices dela.
 */
function insertOnNearestEdge(points: LatLng[], novo: LatLng): LatLng[] {
  if (points.length < 2) return [...points, novo];
  let bestIdx = points.length;
  let bestDist = Infinity;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length]; // % fecha o polígono (última→primeira)
    const d = distPointToSegment(novo, a, b);
    if (d < bestDist) { bestDist = d; bestIdx = i + 1; }
  }
  const next = [...points];
  next.splice(bestIdx, 0, novo);
  return next;
}

interface Props { onBack: () => void; }

export const ZonasView: React.FC<Props> = ({ onBack }) => {
  const [zones, setZones] = useState<Zone[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // ── Draw mode ────────────────────────────────────────────────────────────
  const [drawing, setDrawing] = useState(false);
  const [draftPoints, setDraftPoints] = useState<{ lat: number; lng: number }[]>([]);
  const [draftColor, setDraftColor] = useState(ZONE_COLORS[0]);

  // ── Naming dialog ────────────────────────────────────────────────────────
  const [namingZone, setNamingZone] = useState(false);
  const [draftName, setDraftName] = useState('');

  // ── Inline rename ────────────────────────────────────────────────────────
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');

  // ── Edit polygon mode ────────────────────────────────────────────────────
  const [editingPolygonId, setEditingPolygonId] = useState<string | null>(null);
  const [editingPolygonColor, setEditingPolygonColor] = useState(ZONE_COLORS[0]);

  useEffect(() => {
    db.getZones().then(z => { setZones(z); setLoading(false); });
  }, []);

  // ── Draw helpers ─────────────────────────────────────────────────────────

  const startDraw = () => {
    const usedColors = zones.map(z => z.color);
    const next = ZONE_COLORS.find(c => !usedColors.includes(c)) ?? ZONE_COLORS[zones.length % ZONE_COLORS.length];
    setDraftColor(next);
    setDraftPoints([]);
    setDrawing(true);
    setEditingPolygonId(null);
  };

  const cancelDraw = () => {
    setDrawing(false);
    setDraftPoints([]);
    setNamingZone(false);
    setDraftName('');
  };

  const handleMapClick = useCallback((e: { lngLat: { lat: number; lng: number } }) => {
    if (namingZone) return;
    const { lng, lat } = e.lngLat;

    if (editingPolygonId) {
      // Não adiciona ponto se o clique foi perto de um vértice existente
      // (usuário provavelmente estava clicando no marcador)
      const tooClose = draftPoints.some(p =>
        Math.abs(p.lat - lat) < 0.0008 && Math.abs(p.lng - lng) < 0.0008
      );
      if (!tooClose) setDraftPoints(prev => insertOnNearestEdge(prev, { lat, lng }));
      return;
    }

    if (drawing) {
      setDraftPoints(prev => [...prev, { lat, lng }]);
    }
  }, [drawing, namingZone, editingPolygonId, draftPoints]);

  const closeDraft = () => {
    if (draftPoints.length < 3) return;
    setNamingZone(true);
    setDraftName('');
  };

  const saveZone = async () => {
    if (!draftName.trim() || draftPoints.length < 3) return;
    setSaving(true);
    try {
      const newZone = await db.createZone({ name: draftName.trim(), color: draftColor, coordinates: draftPoints });
      setZones(prev => [...prev, newZone]);
      cancelDraw();
    } finally { setSaving(false); }
  };

  // ── Edit polygon helpers ─────────────────────────────────────────────────

  const startEditPolygon = (zone: Zone) => {
    setEditingPolygonId(zone.id);
    setEditingPolygonColor(zone.color);
    setDraftPoints([...zone.coordinates]);
    setDrawing(false);
    setNamingZone(false);
    setEditingId(null);
  };

  const cancelEditPolygon = () => {
    setEditingPolygonId(null);
    setDraftPoints([]);
  };

  const saveEditPolygon = async () => {
    if (!editingPolygonId || draftPoints.length < 3) return;
    setSaving(true);
    try {
      await db.updateZone(editingPolygonId, {
        coordinates: draftPoints,
        color: editingPolygonColor,
      });
      setZones(prev => prev.map(z =>
        z.id === editingPolygonId
          ? { ...z, coordinates: draftPoints, color: editingPolygonColor }
          : z
      ));
      cancelEditPolygon();
    } finally { setSaving(false); }
  };

  const handleVertexDrag = useCallback((idx: number, lat: number, lng: number) => {
    setDraftPoints(prev => prev.map((p, i) => i === idx ? { lat, lng } : p));
  }, []);

  const handleDeleteVertex = (idx: number) => {
    setDraftPoints(prev => prev.filter((_, i) => i !== idx));
  };

  const handleUndoLastVertex = () => {
    setDraftPoints(prev => prev.slice(0, -1));
  };

  // ── CRUD helpers ─────────────────────────────────────────────────────────

  const deleteZone = async (id: string) => {
    if (editingPolygonId === id) cancelEditPolygon();
    await db.deleteZone(id);
    setZones(prev => prev.filter(z => z.id !== id));
  };

  const startEdit = (zone: Zone) => { setEditingId(zone.id); setEditingName(zone.name); };

  const saveEdit = async () => {
    if (!editingId || !editingName.trim()) return;
    await db.updateZone(editingId, { name: editingName.trim() });
    setZones(prev => prev.map(z => z.id === editingId ? { ...z, name: editingName.trim() } : z));
    setEditingId(null);
  };

  // ── GeoJSON helpers ───────────────────────────────────────────────────────

  const toGeoJson = (coords: { lat: number; lng: number }[], close = true) => {
    const pts = coords.map(p => [p.lng, p.lat]);
    if (close && pts.length >= 3) pts.push(pts[0]);
    return {
      type: 'Feature' as const,
      geometry: { type: 'Polygon' as const, coordinates: [pts] },
      properties: {},
    };
  };

  // ── Derivados ─────────────────────────────────────────────────────────────

  const editingZone = editingPolygonId ? zones.find(z => z.id === editingPolygonId) : null;
  const isEditingPolygon = !!editingPolygonId;
  const mapCursor = (drawing && !namingZone) || isEditingPolygon ? 'crosshair' : 'default';

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="h-screen overflow-hidden bg-slate-50 dark:bg-slate-900 flex flex-col">

      {/* Header */}
      <div className="bg-indigo-600 text-white px-5 py-3 flex items-center gap-4 shadow-lg shrink-0">
        <button onClick={onBack} className="p-2 rounded-lg hover:bg-white/20 transition-colors">
          <ChevronLeft size={20} />
        </button>
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-white/20 rounded-lg flex items-center justify-center">
            <Hexagon size={20} />
          </div>
          <div>
            <h1 className="font-bold text-lg leading-tight">Zonas de Entrega</h1>
            <p className="text-indigo-200 text-xs">Defina regiões geográficas para agrupar entregas</p>
          </div>
        </div>
        <div className="ml-auto text-indigo-200 text-sm">
          {zones.length} zona{zones.length !== 1 ? 's' : ''} cadastrada{zones.length !== 1 ? 's' : ''}
        </div>
      </div>

      <div className="flex flex-1 min-h-0">

        {/* ── Painel esquerdo ─────────────────────────────────────────────── */}
        <div className="w-72 shrink-0 border-r border-slate-200 dark:border-slate-700 flex flex-col bg-white dark:bg-slate-800">

          {/* Controles */}
          <div className="p-4 border-b border-slate-200 dark:border-slate-700 shrink-0">

            {/* ── Modo: editar polígono ── */}
            {isEditingPolygon && (
              <div className="space-y-3">
                {/* Cabeçalho do modo */}
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: editingPolygonColor }} />
                  <span className="text-sm font-bold text-slate-700 dark:text-slate-200 truncate flex-1">
                    {editingZone?.name}
                  </span>
                  <span className="text-[10px] font-bold uppercase tracking-wide text-indigo-500 bg-indigo-50 dark:bg-indigo-900/30 px-1.5 py-0.5 rounded">
                    Editando
                  </span>
                </div>

                {/* Seletor de cor */}
                <div>
                  <p className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-2">Cor da zona</p>
                  <div className="flex flex-wrap gap-1.5">
                    {ZONE_COLORS.map(c => (
                      <button key={c} onClick={() => setEditingPolygonColor(c)}
                        className="w-6 h-6 rounded-full border-2 transition-all"
                        style={{
                          backgroundColor: c,
                          borderColor: editingPolygonColor === c ? '#1e293b' : 'transparent',
                          transform: editingPolygonColor === c ? 'scale(1.2)' : 'scale(1)',
                        }} />
                    ))}
                  </div>
                </div>

                {/* Contagem de vértices */}
                <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400
                  bg-slate-50 dark:bg-slate-700/50 rounded-lg px-3 py-2">
                  <span>{draftPoints.length} vértice{draftPoints.length !== 1 ? 's' : ''}</span>
                  {draftPoints.length > 3 && (
                    <button onClick={handleUndoLastVertex}
                      className="text-orange-500 hover:text-orange-600 font-medium transition-colors cursor-pointer">
                      ↩ Desfazer último
                    </button>
                  )}
                </div>

                {/* Instrução */}
                <p className="text-xs text-slate-400 dark:text-slate-500 text-center leading-relaxed">
                  Arraste os vértices para movê-los.<br />
                  Clique no mapa para adicionar pontos.<br />
                  Clique em × para remover um vértice.
                </p>

                {/* Botões */}
                <div className="flex gap-2">
                  <button onClick={saveEditPolygon}
                    disabled={draftPoints.length < 3 || saving}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2 px-3
                      bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed
                      text-white font-bold rounded-lg text-sm transition-colors">
                    {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                    Salvar
                  </button>
                  <button onClick={cancelEditPolygon}
                    className="flex items-center justify-center px-3 py-2 rounded-lg text-sm
                      bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600
                      text-slate-600 dark:text-slate-300 transition-colors">
                    <X size={14} />
                  </button>
                </div>
              </div>
            )}

            {/* ── Modo: desenhar nova zona ── */}
            {!isEditingPolygon && !drawing && (
              <button onClick={startDraw}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5
                  bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-lg text-sm transition-colors">
                <Plus size={16} /> Nova Zona
              </button>
            )}

            {!isEditingPolygon && drawing && (
              <div className="space-y-3">
                {/* Seletor de cor */}
                <div>
                  <p className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-2">Cor da zona</p>
                  <div className="flex flex-wrap gap-1.5">
                    {ZONE_COLORS.map(c => (
                      <button key={c} onClick={() => setDraftColor(c)}
                        className="w-6 h-6 rounded-full border-2 transition-all"
                        style={{
                          backgroundColor: c,
                          borderColor: draftColor === c ? '#1e293b' : 'transparent',
                          transform: draftColor === c ? 'scale(1.2)' : 'scale(1)',
                        }} />
                    ))}
                  </div>
                </div>

                {/* Contagem de pontos */}
                <p className="text-sm text-slate-500 dark:text-slate-400 text-center">
                  {draftPoints.length === 0
                    ? 'Clique no mapa para começar'
                    : `${draftPoints.length} ponto${draftPoints.length !== 1 ? 's' : ''} marcado${draftPoints.length !== 1 ? 's' : ''}`}
                </p>

                <div className="flex gap-2">
                  <button onClick={closeDraft} disabled={draftPoints.length < 3}
                    className="flex-1 flex items-center justify-center gap-1 py-2 px-3
                      bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed
                      text-white font-bold rounded-lg text-sm transition-colors">
                    <Check size={14} /> Fechar Polígono
                  </button>
                  <button onClick={cancelDraw}
                    className="flex items-center justify-center px-3 py-2 rounded-lg text-sm
                      bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600
                      text-slate-600 dark:text-slate-300 transition-colors">
                    <X size={14} />
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Lista de zonas — oculta durante edição de polígono */}
          {!isEditingPolygon && (
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {loading ? (
                <div className="flex justify-center py-8">
                  <Loader2 size={24} className="animate-spin text-indigo-400" />
                </div>
              ) : zones.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full gap-3 text-slate-400 text-center py-12">
                  <Hexagon size={40} className="opacity-30" />
                  <p className="text-sm">Nenhuma zona criada ainda.<br />Clique em "Nova Zona" e<br />desenhe no mapa.</p>
                </div>
              ) : zones.map(zone => (
                <div key={zone.id}
                  className="flex items-center gap-2 px-3 py-2.5 rounded-lg border
                    bg-slate-50 dark:bg-slate-700/50 border-slate-200 dark:border-slate-600">
                  <div className="w-3.5 h-3.5 rounded-full shrink-0" style={{ backgroundColor: zone.color }} />
                  {editingId === zone.id ? (
                    <input autoFocus value={editingName}
                      onChange={e => setEditingName(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') setEditingId(null); }}
                      className="flex-1 text-sm bg-white dark:bg-slate-800 border border-indigo-300 rounded px-2 py-0.5 outline-none focus:ring-1 focus:ring-indigo-400" />
                  ) : (
                    <span className="flex-1 text-sm font-medium text-slate-700 dark:text-slate-200 truncate">{zone.name}</span>
                  )}
                  {editingId === zone.id ? (
                    <button onClick={saveEdit} className="text-green-500 hover:text-green-600 shrink-0 cursor-pointer">
                      <Check size={14} />
                    </button>
                  ) : (
                    <>
                      {/* Renomear */}
                      <button onClick={() => startEdit(zone)} title="Renomear zona"
                        className="text-slate-400 hover:text-indigo-500 transition-colors shrink-0 cursor-pointer">
                        <Pencil size={13} />
                      </button>
                      {/* Editar polígono */}
                      <button onClick={() => startEditPolygon(zone)} title="Editar forma da zona"
                        className="text-slate-400 hover:text-violet-500 transition-colors shrink-0 cursor-pointer">
                        <PenLine size={13} />
                      </button>
                      {/* Deletar */}
                      <button onClick={() => deleteZone(zone.id)} title="Excluir zona"
                        className="text-slate-400 hover:text-red-500 transition-colors shrink-0 cursor-pointer">
                        <Trash2 size={13} />
                      </button>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Lista reduzida durante edição — mostra só a zona sendo editada */}
          {isEditingPolygon && (
            <div className="flex-1 overflow-y-auto p-3">
              <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wide mb-2 px-1">
                Outras zonas
              </p>
              <div className="space-y-1.5 opacity-40 pointer-events-none select-none">
                {zones.filter(z => z.id !== editingPolygonId).map(zone => (
                  <div key={zone.id}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg border
                      bg-slate-50 dark:bg-slate-700/50 border-slate-200 dark:border-slate-600">
                    <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: zone.color }} />
                    <span className="text-xs font-medium text-slate-600 dark:text-slate-300 truncate">{zone.name}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Dica de uso */}
          {zones.length > 0 && !drawing && !isEditingPolygon && (
            <div className="p-3 border-t border-slate-200 dark:border-slate-700 shrink-0">
              <p className="text-xs text-slate-400 dark:text-slate-500 text-center">
                Zonas são reutilizadas automaticamente<br />na tela de Roteirização.
              </p>
            </div>
          )}
        </div>

        {/* ── Mapa ────────────────────────────────────────────────────────── */}
        <div className="flex-1 relative min-h-0" style={{ cursor: mapCursor }}>

          {/* Banner — modo desenho */}
          {drawing && !namingZone && (
            <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10 pointer-events-none
              bg-indigo-600 text-white text-sm font-semibold px-4 py-2 rounded-full shadow-lg
              flex items-center gap-2">
              <MousePointer2 size={15} />
              Clique para marcar os vértices · Mínimo 3 pontos
            </div>
          )}

          {/* Banner — modo edição polígono */}
          {isEditingPolygon && (
            <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10 pointer-events-none
              bg-violet-600 text-white text-sm font-semibold px-4 py-2 rounded-full shadow-lg
              flex items-center gap-2">
              <Move size={15} />
              Arraste os vértices · Clique no mapa para adicionar
            </div>
          )}

          {/* Dialog de nome */}
          {namingZone && (
            <div className="absolute inset-0 z-20 bg-black/30 flex items-center justify-center">
              <div className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl p-6 w-80
                border border-slate-200 dark:border-slate-700">
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-4 h-4 rounded-full shrink-0" style={{ backgroundColor: draftColor }} />
                  <h3 className="font-bold text-slate-800 dark:text-white">Nomear zona</h3>
                </div>
                <input autoFocus value={draftName}
                  onChange={e => setDraftName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') saveZone(); if (e.key === 'Escape') setNamingZone(false); }}
                  placeholder="Ex: Zona Norte, Litoral, Centro..."
                  className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600
                    bg-white dark:bg-slate-900 text-slate-900 dark:text-white
                    rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-400 mb-4" />
                <div className="flex gap-2">
                  <button onClick={() => setNamingZone(false)}
                    className="flex-1 py-2 rounded-lg text-sm font-medium transition-colors
                      bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600
                      text-slate-600 dark:text-slate-300">
                    Voltar
                  </button>
                  <button onClick={saveZone} disabled={!draftName.trim() || saving}
                    className="flex-1 py-2 rounded-lg text-sm font-bold transition-colors
                      bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50
                      text-white flex items-center justify-center gap-2">
                    {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                    Salvar Zona
                  </button>
                </div>
              </div>
            </div>
          )}

          <Map
            initialViewState={{ latitude: CENTER.lat, longitude: CENTER.lng, zoom: 11 }}
            style={{ width: '100%', height: '100%' }}
            mapStyle="mapbox://styles/mapbox/streets-v12"
            mapboxAccessToken={MAPBOX_TOKEN}
            onClick={handleMapClick}
          >
            <NavigationControl position="bottom-right" />

            {/* ── Zonas salvas ── */}
            {zones.map(zone => {
              if (zone.coordinates.length < 3) return null;
              const isBeingEdited = zone.id === editingPolygonId;

              // Durante edição, mostra o rascunho (draftPoints) em vez das coords salvas
              const coords = isBeingEdited ? draftPoints : zone.coordinates;
              const color = isBeingEdited ? editingPolygonColor : zone.color;
              if (coords.length < 3) return null;

              return (
                <React.Fragment key={zone.id}>
                  <Source type="geojson" data={toGeoJson(coords)}>
                    <Layer type="fill" paint={{
                      'fill-color': color,
                      'fill-opacity': isBeingEdited ? 0.12 : 0.18,
                    }} />
                    <Layer type="line" paint={{
                      'line-color': color,
                      'line-width': isBeingEdited ? 2 : 2.5,
                      ...(isBeingEdited ? { 'line-dasharray': [3, 2] } : {}),
                    }} />
                  </Source>

                  {/* Label centrado — oculto durante edição da própria zona */}
                  {!isBeingEdited && (() => {
                    const c = centroid(coords);
                    return (
                      <Marker latitude={c.lat} longitude={c.lng} anchor="center">
                        <div className="px-2 py-0.5 rounded-full text-white text-[11px] font-bold shadow-md pointer-events-none select-none"
                          style={{ backgroundColor: color }}>
                          {zone.name}
                        </div>
                      </Marker>
                    );
                  })()}
                </React.Fragment>
              );
            })}

            {/* ── Vértices arrastáveis (modo edição de polígono) ── */}
            {isEditingPolygon && draftPoints.map((p, i) => (
              <Marker
                key={`edit-vertex-${i}`}
                latitude={p.lat}
                longitude={p.lng}
                anchor="center"
                draggable
                onDragEnd={(e: { lngLat: { lat: number; lng: number } }) =>
                  handleVertexDrag(i, e.lngLat.lat, e.lngLat.lng)
                }
              >
                <div
                  className="relative group"
                  onClick={e => e.stopPropagation()}
                >
                  {/* Número do vértice */}
                  <div
                    className="w-5 h-5 rounded-full border-2 border-white shadow-lg
                      flex items-center justify-center text-white text-[9px] font-bold
                      cursor-grab active:cursor-grabbing"
                    style={{ backgroundColor: editingPolygonColor }}
                  >
                    {i + 1}
                  </div>

                  {/* Botão deletar — aparece no hover */}
                  {draftPoints.length > 3 && (
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDeleteVertex(i); }}
                      title="Remover vértice"
                      className="absolute -top-2.5 -right-2.5 w-4 h-4 rounded-full
                        bg-red-500 hover:bg-red-600 text-white border border-white shadow
                        text-[10px] leading-none flex items-center justify-center
                        opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer z-10"
                    >
                      ×
                    </button>
                  )}
                </div>
              </Marker>
            ))}

            {/* ── Polígono em rascunho (nova zona) ── */}
            {drawing && draftPoints.length >= 2 && (
              <Source type="geojson" data={toGeoJson(draftPoints, draftPoints.length >= 3)}>
                <Layer type="fill" paint={{ 'fill-color': draftColor, 'fill-opacity': 0.15 }} />
                <Layer type="line" paint={{ 'line-color': draftColor, 'line-width': 2, 'line-dasharray': [2, 1.5] }} />
              </Source>
            )}

            {/* Pontos do rascunho (nova zona) */}
            {drawing && draftPoints.map((p, i) => (
              <Marker key={i} latitude={p.lat} longitude={p.lng} anchor="center">
                <div className="w-3 h-3 rounded-full border-2 border-white shadow"
                  style={{ backgroundColor: draftColor }} />
              </Marker>
            ))}
          </Map>
        </div>
      </div>
    </div>
  );
};
