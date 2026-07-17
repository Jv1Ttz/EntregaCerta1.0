import React, { useState, useEffect, useRef, useMemo } from 'react';
import { db } from '../services/db';
import { sefazApi } from '../services/sefazApi';
import { Driver, Invoice, DeliveryStatus, Vehicle, DeliveryProof, AppNotification, InvoiceItem } from '../types';
import { isReturnProof, formatProofReason } from '../constants/returnReasons';
import { Truck, Upload, Map as MapIcon, FileText, AlertOctagon, CheckCircle, AlertTriangle, Clock, ScanBarcode, X, Search, Loader2, UserPlus, Users, PlusCircle, CheckSquare, Square, Satellite, ExternalLink, Trash2, Eye, Calendar, User, KeyRound, Settings, Navigation2, RefreshCw, Zap, Filter, Download, Maximize2, DollarSign, TrendingUp, TrendingDown, Award, Sun, Moon, Printer, UploadCloud, FileCheck, XCircle, LayoutDashboard, RotateCw, ZoomIn, ZoomOut, ArrowUp, ArrowDown, Package, Pencil, MoreVertical, Tag, Route, MapPin, GripVertical, ChevronLeft, ChevronRight } from 'lucide-react';
import { Html5QrcodeScanner } from 'html5-qrcode';
import { ToastContainer } from './ui/Toast';
import { LabelsView } from './LabelsView';

import Map, { Marker, NavigationControl, FullscreenControl, Source, Layer } from 'react-map-gl';
import type { MapRef } from 'react-map-gl';

import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css'; // Importante para o mapa não quebrar!

// Token lido da env (Vite). Nunca commit este token.
const MAPBOX_TOKEN = (import.meta.env.VITE_MAPBOX_TOKEN as string) || '';
mapboxgl.accessToken = MAPBOX_TOKEN;
mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN;

// ── Roteirização ────────────────────────────────────────────────────────────
const ROT_ORIGIN = { lat: -12.931685, lng: -38.512682 };
const ROUTE_COLORS = ['#3b82f6','#ef4444','#22c55e','#f59e0b','#8b5cf6','#ec4899','#06b6d4','#f97316'];

function geoDistance(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const dlat = a.lat - b.lat;
  const dlng = a.lng - b.lng;
  return Math.sqrt(dlat * dlat + dlng * dlng);
}

function kMeansClusters(invoices: Invoice[], k: number): Invoice[][] {
  if (k <= 0 || invoices.length === 0) return [];
  if (k >= invoices.length) return invoices.map(inv => [inv]);

  // Inicializa centroids espalhados
  const step = Math.floor(invoices.length / k);
  let centroids = Array.from({ length: k }, (_, i) => ({
    lat: invoices[i * step].lat!,
    lng: invoices[i * step].lng!,
  }));

  let clusters: Invoice[][] = [];
  let changed = true;
  let iter = 0;

  while (changed && iter < 100) {
    iter++;
    clusters = Array.from({ length: k }, () => [] as Invoice[]);
    for (const inv of invoices) {
      let minDist = Infinity;
      let nearest = 0;
      centroids.forEach((c, i) => {
        const d = geoDistance({ lat: inv.lat!, lng: inv.lng! }, c);
        if (d < minDist) { minDist = d; nearest = i; }
      });
      clusters[nearest].push(inv);
    }
    const newCentroids = clusters.map(cl =>
      cl.length === 0 ? { lat: 0, lng: 0 } : {
        lat: cl.reduce((s, p) => s + p.lat!, 0) / cl.length,
        lng: cl.reduce((s, p) => s + p.lng!, 0) / cl.length,
      }
    );
    changed = newCentroids.some((c, i) => geoDistance(c, centroids[i]) > 0.00001);
    centroids = newCentroids;
  }
  return clusters;
}

function nearestNeighborOrder(invoices: Invoice[], origin: { lat: number; lng: number }): Invoice[] {
  const result: Invoice[] = [];
  const remaining = [...invoices];
  let current = origin;
  while (remaining.length > 0) {
    let minDist = Infinity;
    let nearestIdx = 0;
    remaining.forEach((inv, i) => {
      const d = geoDistance(current, { lat: inv.lat!, lng: inv.lng! });
      if (d < minDist) { minDist = d; nearestIdx = i; }
    });
    const [nearest] = remaining.splice(nearestIdx, 1);
    result.push(nearest);
    current = { lat: nearest.lat!, lng: nearest.lng! };
  }
  return result;
}

interface AdminViewProps {
  toggleTheme?: () => void;
  theme?: string;
  onNavigate?: (view: string) => void;
}

export const AdminView: React.FC<AdminViewProps> = ({ toggleTheme, theme, onNavigate }) => {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [uploading, setUploading] = useState(false);
  const [processingKey, setProcessingKey] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [lastUpdate, setLastUpdate] = useState(new Date());
  const [selectedDriverId, setSelectedDriverId] = useState<string | null>(null);
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null);
  // Rastreio de nota específica (clique no badge "Em Rota"): rota caminhão → entrega
  const [trackedInvoiceId, setTrackedInvoiceId] = useState<string | null>(null);
  const [trackedRoute, setTrackedRoute] = useState<{ coords: number[][]; distanceM: number; durationS: number; durationTypicalS?: number } | null>(null);
  
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedInvoiceIds, setSelectedInvoiceIds] = useState<Set<string>>(new Set());
  // Paginação da tabela de gestão (filtros/busca continuam atuando sobre a lista completa)
  const [tablePage, setTablePage] = useState(1);
  const [tablePageSize, setTablePageSize] = useState(25);
  const [bulkDriver, setBulkDriver] = useState<string>("");
  const [bulkVehicle, setBulkVehicle] = useState<string>("");
  
  const [showAddDriver, setShowAddDriver] = useState(false);
  const [showAddVehicle, setShowAddVehicle] = useState(false);
  const [editingVehicleId, setEditingVehicleId] = useState<string | null>(null);
  const [newVehicleTara, setNewVehicleTara] = useState<string>('');
  const [newVehicleCubagem, setNewVehicleCubagem] = useState<string>('');
  const [newVehicleMaxWeight, setNewVehicleMaxWeight] = useState<string>('');
  const [showFleetMonitor, setShowFleetMonitor] = useState(false);
  const [showControladoria, setShowControladoria] = useState(false);
  const [controlDate, setControlDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [showSettings, setShowSettings] = useState(false);
  
  const [viewingProof, setViewingProof] = useState<{invoice: Invoice, proof: DeliveryProof} | null>(null);
  const [viewingManualProof, setViewingManualProof] = useState<Invoice | null>(null);
  const [zoomedImage, setZoomedImage] = useState<string | null>(null);
  const [zoomedScale, setZoomedScale] = useState(1);

  const [viewingIssue, setViewingIssue] = useState<{invoice: Invoice, proof: DeliveryProof} | null>(null);

  const [sortConfig, setSortConfig] = useState<Array<{ key: string; direction: 'asc' | 'desc' }>>([
    { key: 'created_at', direction: 'desc' }
  ]);

  const [zoomedRotation, setZoomedRotation] = useState(0);
  useEffect(() => {
    if (zoomedImage) {
      setZoomedRotation(0);
      setZoomedScale(1);
    }
  }, [zoomedImage]);
  
  const [notifications, setNotifications] = useState<AppNotification[]>([]);

  const [newDriverName, setNewDriverName] = useState('');
  const [newDriverPassword, setNewDriverPassword] = useState('');
  
  const [newVehiclePlate, setNewVehiclePlate] = useState('');
  const [newVehicleModel, setNewVehicleModel] = useState('');
  const [newAdminPassword, setNewAdminPassword] = useState('');

  const scannerRef = useRef<Html5QrcodeScanner | null>(null);

  const mapRef = useRef<any>(null); // <--- NOVO REF DO MAPA

  // Função para focar no motorista
  const flyToDriver = (lat: number, lng: number) => {
    mapRef.current?.flyTo({
      center: [lng, lat],
      zoom: 15,
      duration: 2000 // Animação de 2 segundos
    });
  };

  const fleetIntervalRef = useRef<number | null>(null);
  const notifIntervalRef = useRef<number | null>(null);

  

  const [showImportModal, setShowImportModal] = useState(false);
  const [importSummary, setImportSummary] = useState<{ total: number; success: number; duplicates: number; errors: number; details: string[] } | null>(null);
  const [isDragging, setIsDragging] = useState(false);


  // --- NOVOS ESTADOS DE FILTRO ---
  // Tabela: começa sem filtro de data (mostra todas as notas)
  // Dashboard: usa sempre o mês corrente (1º ao último dia)
  const getCurrentMonthRange = () => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);
    return { start, end };
  };
  const { start: monthStartStr, end: monthEndStr } = getCurrentMonthRange();

  const [filterDriver, setFilterDriver] = useState('');
  const [filterVehicle, setFilterVehicle] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterStartDate, setFilterStartDate] = useState('');  // vazio = sem filtro na tabela
  const [filterEndDate, setFilterEndDate] = useState('');

  // Filtro do Dashboard: sempre mês corrente
  const [dashStartDate, setDashStartDate] = useState(monthStartStr);
  const [dashEndDate, setDashEndDate] = useState(monthEndStr);
  const [filterDeliveryStartDate, setFilterDeliveryStartDate] = useState('');
  const [filterDeliveryEndDate, setFilterDeliveryEndDate] = useState('');

  const [modalRedeliver, setModalRedeliver] = useState<{open: boolean, invoice: Invoice | null}>({ open: false, invoice: null });
  const [modalEditValue, setModalEditValue] = useState<{open: boolean, invoice: Invoice | null, value: string}>({ open: false, invoice: null, value: '' });
  // Modal para finalizar devolução (concluir / cancelar)
  const [modalFinalize, setModalFinalize] = useState<{ open: boolean; invoice: Invoice | null; outcome: 'CONCLUDED' | 'CANCELLED' | null; note: string; loading?: boolean }>({ open: false, invoice: null, outcome: null, note: '', loading: false });
  const [openActionsRow, setOpenActionsRow] = useState<string | null>(null);

  // Modal de rastreamento SSW inline
  const [sswModal, setSswModal] = useState<{
    open: boolean;
    invoice: Invoice | null;
    loading: boolean;
    events: Array<{ data_hora?: string; cidade?: string; ocorrencia?: string; descricao?: string; tipo?: string; [key: string]: any }>;
    raw: any;
    error: string | null;
  }>({ open: false, invoice: null, loading: false, events: [], raw: null, error: null });

  const [activeSidebarSection, setActiveSidebarSection] = useState<'main' | 'etiquetas'>('main');
  // Modal de baixa manual (gestor)
  const [manualSettleModal, setManualSettleModal] = useState<{
    open: boolean;
    invoice: Invoice | null;
    status: 'DELIVERED' | 'FAILED';
    reason: string;
    loading?: boolean;
  }>({
    open: false,
    invoice: null,
    status: 'DELIVERED',
    reason: '',
    loading: false,
  });

  // ... outros useEffects ...

  // Calcula carga atual (peso/volume) de um veículo considerando as notas atribuídas
  const calculateVehicleLoad = (vehicleId: string, sourceInvoices: Invoice[] = invoices) => {
    const vehicle = vehicles.find(v => v.id === vehicleId);
    if (!vehicle) return null;

    // Se não tiver NENHUMA informação de capacidade, ignoramos qualquer alerta
    if (vehicle.tara == null && vehicle.cubagem == null && vehicle.max_weight == null) return null;

    const assigned = sourceInvoices.filter(inv => inv.vehicle_id === vehicleId);

    const totalWeight = assigned.reduce(
      (sum, inv) => sum + (inv.cargo_weight_gross || 0),
      0
    );

    const totalVolume = assigned.reduce(
      (sum, inv) => sum + (inv.cargo_volume_count || 0),
      0
    );

    return { vehicle, totalWeight, totalVolume };
  };

  // 👇 BLOQUEIO DE SCROLL DO BODY QUANDO MODAL ABRE 👇
  useEffect(() => {
    // Se qualquer um dos modais estiver aberto
    if (modalRedeliver.open || modalEditValue.open) {
      document.body.style.overflow = 'hidden'; // Trava o scroll do site
    } else {
      document.body.style.overflow = 'unset'; // Destrava
    }

    // Cleanup: Destrava se o componente for desmontado
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [modalRedeliver.open, modalEditValue.open]);

  // ... resto do código ...


  // 2. LÓGICA DE CÁLCULO (Recalcula sempre que as datas mudam)
  const dashboardData = useMemo(() => {
    return invoices.filter(inv => {
       // Pega apenas a data YYYY-MM-DD da nota
       const invoiceDate = inv.created_at.split('T')[0];
       
       // Verifica se está dentro do intervalo (se as datas estiverem preenchidas)
       const isAfterStart = !dashStartDate || invoiceDate >= dashStartDate;
       const isBeforeEnd = !dashEndDate || invoiceDate <= dashEndDate;
       
       return isAfterStart && isBeforeEnd;
    });
  }, [invoices, dashStartDate, dashEndDate]);

// ... (cálculos anteriores de totalDeliveredValue, etc)

  // 4. RANKING DE MOTORISTAS (Dinâmico e conectado ao filtro)
  const driverRanking = useMemo(() => {
    const stats: Record<string, { id: string; name: string; value: number; count: number }> = {};

    dashboardData.forEach(inv => {
      // Considera apenas entregas realizadas (DELIVERED)
      if (inv.status === 'DELIVERED' && inv.driver_id) {
        if (!stats[inv.driver_id]) {
          const drv = drivers.find(d => d.id === inv.driver_id);
          stats[inv.driver_id] = { 
            id: inv.driver_id, 
            name: drv ? drv.name : 'Desconhecido', 
            value: 0, 
            count: 0 
          };
        }
        stats[inv.driver_id].value += inv.value;
        stats[inv.driver_id].count += 1;
      }
    });

    // Transforma em lista, ordena por Valor (do maior para o menor) e pega o Top 5
    return Object.values(stats)
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  }, [dashboardData, drivers]);
  

  // 3. MÉTRICAS FINANCEIRAS E OPERACIONAIS (Baseadas no filtro acima)
  
    // 3. MÉTRICAS FINANCEIRAS E OPERACIONAIS (Atualizado)
  
  // R$ Total Devolvido (Prejuízo Real)
  const totalFailedValue = dashboardData
    .filter(i => i.status === 'FAILED')
    .reduce((acc, inv) => {
        // LÓGICA INTELIGENTE:
        // 1. Se existe 'return_value' no banco, usa ele (Cálculo preciso dos itens).
        // 2. Se não existe (notas antigas), assume que perdeu o valor total da nota.
        const actualLoss = (inv.return_value !== undefined && inv.return_value !== null)
            ? Number(inv.return_value)
            : inv.value;
            
        return acc + actualLoss;
    }, 0);

  // R$ Total Entregue (Sucesso Total + A parte "boa" das devoluções parciais)
  const totalDeliveredValue = dashboardData.reduce((acc, inv) => {
      // Cenário 1: Entregue 100%
      if (inv.status === 'DELIVERED') {
          return acc + Number(inv.value);
      } 
      // Cenário 2: Devolução Parcial (A diferença conta como entregue!)
      else if (inv.status === 'FAILED') {
          const loss = (inv.return_value !== undefined && inv.return_value !== null)
              ? Number(inv.return_value)
              : inv.value; // Se não tem dado, considera perda total
          
          // Ex: Nota de 1000, Perdeu 200. Então Entregou 800.
          const partialSuccess = Number(inv.value) - loss;
          // Garante que não some negativo
          return acc + Math.max(0, partialSuccess);
      }
      return acc;
  }, 0);

  // Contagens Simples
  const countPending = dashboardData.filter(i => i.status === 'PENDING').length;
  const countProgress = dashboardData.filter(i => i.status === 'IN_PROGRESS').length;
  const countDelivered = dashboardData.filter(i => i.status === 'DELIVERED').length;
  const countFailed = dashboardData.filter(i => i.status === 'FAILED').length;
  const countIssue = dashboardData.filter(i => i.status === 'ISSUE').length;

  // --- ESTADO PARA O MODAL DE CONFIRMAÇÃO ---
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    type: 'INVOICE' | 'BULK_INVOICE' | 'DRIVER' | 'VEHICLE' | null;
    id?: string; // ID do item a ser excluido (se for unitário)
    title: string;
    message: string;
  }>({ isOpen: false, type: null, title: '', message: '' });

  useEffect(() => {
    refreshData();
    notifIntervalRef.current = window.setInterval(async () => {
        const newNotifs = await db.consumeNotifications('ADMIN');
        if (newNotifs.length > 0) {
            setNotifications(prev => [...prev, ...newNotifs]);
            refreshData(); 
        }
    }, 5000);

    return () => {
        if (notifIntervalRef.current) clearInterval(notifIntervalRef.current);
        if (fleetIntervalRef.current) clearInterval(fleetIntervalRef.current);
    };
  }, []);
  
  // Dashboard já inicializa com mês corrente via useState; sem useEffect extra.

  useEffect(() => {
    if (showScanner) {
      const timer = setTimeout(() => {
        const scanner = new Html5QrcodeScanner(
          "reader",
          { 
            fps: 10, 
            // AQUI ESTÁ A MUDANÇA:
            // 1. qrbox: Mais largo (550px) e mais baixo (150px) para focar na barra
            qrbox: { width: 550, height: 150 }, 
            // 2. aspectRatio: 1.77 (aprox. 16:9) preenche a tela sem distorcer
            aspectRatio: 1.77,
            disableFlip: false 
          },
          false
        );
        scanner.render(onScanSuccess, onScanFailure);
        scannerRef.current = scanner;
      }, 100);
      return () => {
        clearTimeout(timer);
        if (scannerRef.current) scannerRef.current.clear().catch(console.error);
      };
    }
  }, [showScanner]);

  useEffect(() => {
    if (showScanner) {
      const timer = setTimeout(() => {
        // Limpa qualquer instancia anterior para evitar bugs
        if (scannerRef.current) {
          scannerRef.current.clear().catch(console.error);
        }

        const scanner = new Html5QrcodeScanner(
          "reader",
          { 
            fps: 10,
            // AQUI ESTÁ A MÁGICA PARA O CELULAR:
            // Em vez de números fixos, usamos uma função que calcula na hora
            qrbox: (viewfinderWidth, viewfinderHeight) => {
                // Largura: Ocupa 90% da largura da câmera (seja PC ou Celular)
                const width = Math.floor(viewfinderWidth * 0.9);
                
                // Altura: Fixa em 120px (bem fina, estilo leitor de mercado)
                // Isso cria as "bordas grossas" em cima e embaixo que você quer
                return { width: width, height: 120 };
            },
            aspectRatio: 1.0, // Mantém a proporção quadrada da câmera para caber bem na tela
            disableFlip: false 
          },
          false
        );
        
        scanner.render(onScanSuccess, onScanFailure);
        scannerRef.current = scanner;
      }, 100);

      return () => {
        clearTimeout(timer);
        if (scannerRef.current) scannerRef.current.clear().catch(console.error);
      };
    }
  }, [showScanner]);

  const refreshData = async () => {
    try {
      const [inv, drv, veh] = await Promise.all([
        db.getInvoices(),
        db.getDrivers(),
        db.getVehicles()
      ]);
      setInvoices(inv);
      setDrivers(drv);
      setVehicles(veh);
      setLastUpdate(new Date());
    } catch (e) {
      console.error("Erro ao atualizar dados:", e);
    }
  };

  // --- INÍCIO DO BLOCO (COLE APENAS UMA VEZ) ---

  // 1. Função Inteligente de Geocodificação
  const geocodeInvoice = async (invoice: Invoice) => {
    // Se já tem coordenadas, não gasta API, só devolve a nota
    if (invoice.lat && invoice.lng) return invoice;

    try {
      // Limpa o endereço para facilitar a busca (remove o "|| OBS" se houver)
      const cleanAddress = invoice.customer_address.split('||')[0]; 
      const query = encodeURIComponent(`${cleanAddress}, Brasil`);
      
      const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${query}.json?access_token=${MAPBOX_TOKEN}&limit=1`;
      
      const res = await fetch(url);
      const data = await res.json();

      if (data.features && data.features.length > 0) {
        const [lng, lat] = data.features[0].center;
        
        // Salva no banco para o futuro
        if (db.updateInvoiceLocation) {
             await db.updateInvoiceLocation(invoice.id, lat, lng);
        }
        
        return { ...invoice, lat, lng };
      }
    } catch (error) {
      console.error(`Erro ao localizar nota ${invoice.number}:`, error);
    }
    // Se falhar, devolve a nota sem GPS mesmo
    return invoice;
  };

  // 2a. Ação de Clique no Driver (legado — mantido para compatibilidade)
  const handleSelectDriver = async (driverId: string, driverLat: number, driverLng: number) => {
    setSelectedDriverId(driverId);
    mapRef.current?.flyTo({ center: [driverLng, driverLat], zoom: 14, duration: 2000 });
    const driverInvoices = invoices.filter(i =>
      i.driver_id === driverId &&
      (i.status === 'PENDING' || i.status === 'IN_PROGRESS')
    );
    const updatedInvoices = await Promise.all(driverInvoices.map(geocodeInvoice));
    setInvoices(prev => prev.map(inv => {
      const updated = updatedInvoices.find(u => u.id === inv.id);
      return updated || inv;
    }));
  };

  // 2b. Ação de Clique no Veículo — geocodifica notas por vehicle_id
  const handleSelectVehicle = async (vehicleId: string, lat?: number, lng?: number) => {
    setSelectedVehicleId(vehicleId);
    // Se trocou para um veículo diferente do da nota rastreada, encerra o rastreio
    setTrackedInvoiceId(prev => {
      if (!prev) return prev;
      const tInv = invoices.find(i => i.id === prev);
      return tInv?.vehicle_id === vehicleId ? prev : null;
    });
    if (lat && lng) {
      mapRef.current?.flyTo({ center: [lng, lat], zoom: 13, duration: 2000 });
    }
    const vehicleInvoices = invoices.filter(i =>
      i.vehicle_id === vehicleId &&
      (i.status === 'PENDING' || i.status === 'IN_PROGRESS')
    );
    const updatedInvoices = await Promise.all(vehicleInvoices.map(geocodeInvoice));
    setInvoices(prev => prev.map(inv => {
      const updated = updatedInvoices.find(u => u.id === inv.id);
      return updated || inv;
    }));
  };

  // --- FIM DO BLOCO ---

  // Nota rastreada e veículo correspondente (derivados do estado atual)
  const trackedInv = trackedInvoiceId ? invoices.find(i => i.id === trackedInvoiceId) : null;
  const trackedVeh = trackedInv?.vehicle_id ? vehicles.find(v => v.id === trackedInv.vehicle_id) : null;

  // Busca a rota pelas ruas (caminhão → entrega rastreada) e atualiza quando o GPS se move
  useEffect(() => {
    const vLoc = trackedVeh?.last_location;
    if (!showFleetMonitor || !trackedInv?.lat || !trackedInv?.lng || !vLoc) {
      setTrackedRoute(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        // Perfil "driving-traffic": ETA considera o trânsito em tempo real.
        // duration_typical = tempo sem trânsito, permite medir o atraso atual.
        const res = await fetch(
          `https://api.mapbox.com/directions/v5/mapbox/driving-traffic/` +
          `${vLoc.lng},${vLoc.lat};${trackedInv.lng},${trackedInv.lat}` +
          `?geometries=geojson&overview=full&access_token=${MAPBOX_TOKEN}`
        );
        const data = await res.json();
        const route = data.routes?.[0];
        if (!cancelled && route) {
          setTrackedRoute({
            coords: route.geometry?.coordinates ?? [],
            distanceM: route.distance ?? 0,
            durationS: route.duration ?? 0,
            durationTypicalS: route.duration_typical ?? undefined,
          });
        }
      } catch { /* mantém a última rota calculada */ }
    })();
    return () => { cancelled = true; };
  }, [showFleetMonitor, trackedInv?.lat, trackedInv?.lng, trackedVeh?.last_location?.lat, trackedVeh?.last_location?.lng]);

  // Atualiza as posições GPS dos veículos enquanto o monitor de frota está aberto
  // (query leve — só a tabela vehicles, sem baixar as notas)
  useEffect(() => {
    if (!showFleetMonitor) return;
    const syncFleet = async () => {
      try {
        const veh = await db.getVehicles();
        setVehicles(veh);
      } catch { /* mantém as posições atuais em caso de erro */ }
    };
    syncFleet(); // sincroniza imediatamente ao abrir o modal
    const interval = setInterval(syncFleet, 20_000);
    return () => clearInterval(interval);
  }, [showFleetMonitor]);

  // Abre o monitor de frota já com o veículo da nota selecionado (clique no badge "Em Rota")
  const handleTrackInvoiceVehicle = (inv: Invoice) => {
    if (!inv.vehicle_id) return;
    const vehicle = vehicles.find(v => v.id === inv.vehicle_id);
    setShowFleetMonitor(true);
    setTrackedInvoiceId(inv.id);
    // Aguarda o modal e o mapa montarem antes de selecionar/voar até o veículo
    setTimeout(() => {
      handleSelectVehicle(inv.vehicle_id!, vehicle?.last_location?.lat, vehicle?.last_location?.lng);
    }, 500);
  };

  // --- FUNÇÃO QUE EXECUTA A EXCLUSÃO REAL ---
  const handleConfirmDelete = async () => {
    if (!confirmModal.type) return;

    try {
      // 1. Exclusão de NOTA ÚNICA
      if (confirmModal.type === 'INVOICE' && confirmModal.id) {
        await db.deleteInvoice(confirmModal.id);
        const newSet = new Set(selectedInvoiceIds);
        if (newSet.has(confirmModal.id)) {
          newSet.delete(confirmModal.id);
          setSelectedInvoiceIds(newSet);
        }
      } 
      
      // 2. Exclusão em MASSA (Várias notas)
      else if (confirmModal.type === 'BULK_INVOICE') {
        const promises = Array.from(selectedInvoiceIds).map((id: string) => db.deleteInvoice(id));
        await Promise.all(promises);
        setSelectedInvoiceIds(new Set());
      }
      
      // 3. Exclusão de MOTORISTA
      else if (confirmModal.type === 'DRIVER' && confirmModal.id) {
        await db.deleteDriver(confirmModal.id);
      }
      
      // 4. Exclusão de VEÍCULO
      else if (confirmModal.type === 'VEHICLE' && confirmModal.id) {
        await db.deleteVehicle(confirmModal.id);
      }

      // Atualiza a tela e fecha o modal
      await refreshData();
      setConfirmModal({ ...confirmModal, isOpen: false });
      
    } catch (error) {
      console.error("Erro ao excluir:", error);
      alert("Erro ao tentar excluir. Verifique o console.");
    }
  };


  
  // --- LÓGICA DO DASHBOARD FINANCEIRO ---
  const financialStats = useMemo(() => {
    const deliveredInvoices = invoices.filter(i => i.status === 'DELIVERED');
    const failedInvoices = invoices.filter(i => i.status === 'FAILED');

    const totalDelivered = deliveredInvoices.reduce((acc, inv) => acc + (inv.value || 0), 0);
    const totalFailed = failedInvoices.reduce((acc, inv) => acc + (inv.value || 0), 0);
    
    const ranking = drivers.map(driver => {
      const driverDeliveries = deliveredInvoices.filter(i => i.driver_id === driver.id);
      const value = driverDeliveries.reduce((acc, inv) => acc + (inv.value || 0), 0);
      const count = driverDeliveries.length;
      return { id: driver.id, name: driver.name, value, count };
    })
    .filter(d => d.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

    return { totalDelivered, totalFailed, ranking };
  }, [invoices, drivers]);

  const removeNotification = (id: string) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
  };

  const onScanSuccess = (decodedText: string) => {
    const cleanKey = decodedText.replace(/\D/g, '');
    if (cleanKey.length === 44) {
      if (scannerRef.current) scannerRef.current.clear();
      setShowScanner(false);
      processAccessKey(cleanKey);
    }
  };

  const onScanFailure = () => {};

 const processAccessKey = async (key: string) => {
    setProcessingKey(true); // Ativa loading
    
    // Chama o serviço que criamos
    const response = await sefazApi.fetchNFeData(key);
    
    setProcessingKey(false); // Desativa loading

    if (response.success && response.data) {
      const newInvoice = response.data as Invoice;
      
      // Verifica duplicidade antes de salvar
      const exists = invoices.some(i => i.access_key === newInvoice.access_key);
      if (exists) {
        alert("Esta Nota Fiscal já está cadastrada no sistema.");
        return;
      }

      // Salva no Banco de Dados
      await db.addInvoice(newInvoice);
      refreshData();
      alert(`Nota Fiscal ${newInvoice.number} importada com sucesso!`);
      
    } else {
      alert(`Erro ao consultar: ${response.error}`);
    }
  };

 // --- NOVA LÓGICA DE IMPORTAÇÃO EM LOTE (DRAG & DROP) ---
  const processXMLFiles = async (files: FileList | File[]) => {
    setUploading(true);
    setImportSummary(null);

    const results = {
      total: files.length,
      success: 0,
      duplicates: 0,
      errors: 0,
      details: [] as string[]
    };

    const newInvoices: Invoice[] = [];
    const parser = new DOMParser();

    // Cria uma Promessa para cada arquivo (para ler tudo junto)
    const filePromises = Array.from(files).map((file) => {
      return new Promise<void>((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => {
          try {
            const text = e.target?.result as string;
            const xmlDoc = parser.parseFromString(text, "text/xml");

            // --- SUA LÓGICA ORIGINAL COMEÇA AQUI ---
            const getValue = (tagName: string, context: Document | Element = xmlDoc) => 
              context.getElementsByTagName(tagName)[0]?.textContent || "";

            const ide = xmlDoc.getElementsByTagName("ide")[0];
            const dest = xmlDoc.getElementsByTagName("dest")[0];
            const enderDest = dest?.getElementsByTagName("enderDest")[0];
            const total = xmlDoc.getElementsByTagName("total")[0];
            
            // O PULO DO GATO 🐱 (Mantido!)
            const entregaTag = xmlDoc.getElementsByTagName("entrega")[0];
            const addressSource = entregaTag ? entregaTag : enderDest;

            // Dados de transporte / volumes (peso, quantidade de volumes, tipo de embalagem)
            const transp = xmlDoc.getElementsByTagName("transp")[0];
            const volTags = transp?.getElementsByTagName("vol") ?? [];

            let cargoVolumeCount = 0;
            let cargoWeightNet = 0;
            let cargoWeightGross = 0;
            let cargoVolumeType: string | null = null;

            for (let i = 0; i < volTags.length; i++) {
              const vol = volTags[i];

              const qVolStr = getValue("qVol", vol);
              const pesoLStr = getValue("pesoL", vol);
              const pesoBStr = getValue("pesoB", vol);
              const esp = getValue("esp", vol);

              cargoVolumeCount += parseFloat(qVolStr || "0");
              cargoWeightNet += parseFloat(pesoLStr || "0");
              cargoWeightGross += parseFloat(pesoBStr || "0");

              if (!cargoVolumeType && esp) {
                cargoVolumeType = esp;
              }
            }

            // Dados Adicionais
            const infAdic = xmlDoc.getElementsByTagName("infAdic")[0];
            const infCpl = getValue("infCpl", infAdic); 

            if (!dest || !addressSource) throw new Error("XML sem destinatário/endereço");

            const nNF = getValue("nNF", ide);
            const serie = getValue("serie", ide);
            const vNF = getValue("vNF", total);
            const xNome = getValue("xNome", dest);
            const CNPJ = getValue("CNPJ", dest);
            const CPF = getValue("CPF", dest);
            
            // Endereço
            const xLgr = getValue("xLgr", addressSource);
            const nro = getValue("nro", addressSource);
            const xCpl = getValue("xCpl", addressSource);
            const xBairro = getValue("xBairro", addressSource);
            const xMun = getValue("xMun", addressSource);
            const UF = getValue("UF", addressSource);
            const CEP = getValue("CEP", addressSource);

            let formattedAddress = `${xLgr}, ${nro}${xCpl ? ` (${xCpl})` : ''} - ${xBairro}, ${xMun} - ${UF}`;
            if (infCpl && infCpl.trim().length > 0) {
               formattedAddress += ` || OBS/LOCAL: ${infCpl.toUpperCase()}`;
            }

// 👇👇👇 INÍCIO DA NOVA LÓGICA DE ITENS 👇👇👇
            const extractedItems: InvoiceItem[] = [];
            const detTags = xmlDoc.getElementsByTagName("det"); // Pega todas as tags <det>

            for (let i = 0; i < detTags.length; i++) {
                const det = detTags[i];
                const nItem = det.getAttribute("nItem") || String(i + 1);
                
                const prod = det.getElementsByTagName("prod")[0]; // Entra na tag <prod>
                
                if (prod) {
                  extractedItems.push({
                  itemIndex: nItem,
                  code: getValue("cProd", prod),
                  name: getValue("xProd", prod), // <--- O erro aponta aqui. Se "name" não existir no tipo, ele reclama.
                  quantity: parseFloat(getValue("qCom", prod) || "0"),
                  unit: getValue("uCom", prod),
                  value: parseFloat(getValue("vProd", prod) || "0")
                  });
                }
            }
            // 👆👆👆 FIM DA NOVA LÓGICA DE ITENS 👆👆👆

            let chNFe = getValue("chNFe");
            if (!chNFe) {
              const infNFe = xmlDoc.getElementsByTagName("infNFe")[0];
              const idAttr = infNFe?.getAttribute("Id");
              if (idAttr && idAttr.startsWith("NFe")) chNFe = idAttr.substring(3);
            }

            if (!nNF || !xNome) throw new Error("Dados incompletos");
            // --- FIM DA SUA LÓGICA ORIGINAL ---

            // VERIFICAÇÃO DE DUPLICIDADE
            // Verifica se já existe no banco (invoices) OU se já está na lista atual (newInvoices)
            const alreadyExists = invoices.some(i => i.access_key === chNFe) || newInvoices.some(i => i.access_key === chNFe);

            if (alreadyExists) {
                results.duplicates++;
                results.details.push(`⚠️ NF ${nNF}: Nota já lançada no sistema.`);
            } else {
                // Adiciona na fila para salvar
                newInvoices.push({
                  id: `inv-${Date.now()}-${Math.random()}`,
                  access_key: chNFe || `GEN${Date.now()}`, 
                  number: nNF,
                  series: serie || '0',
                  customer_name: xNome,
                  customer_doc: CNPJ || CPF || 'Não informado',
                  customer_address: formattedAddress,
                  customer_zip: CEP,
                  value: parseFloat(vNF || "0"),
                  status: DeliveryStatus.PENDING,
                  driver_id: null,
                  vehicle_id: null,
                  created_at: new Date().toISOString(),
                  cargo_volume_count: cargoVolumeCount || undefined,
                  cargo_volume_type: cargoVolumeType ?? null,
                  cargo_weight_net: cargoWeightNet || undefined,
                  cargo_weight_gross: cargoWeightGross || undefined,
                  items: extractedItems
                });
                results.success++;
            }
          } catch (error) {
            results.errors++;
            results.details.push(`❌ ${file.name}: Arquivo inválido ou erro de leitura.`);
          }
          resolve();
        };
        reader.readAsText(file);
      });
    });

    // Aguarda processar TODOS os arquivos
    await Promise.all(filePromises);

    // Salva os válidos no banco
    if (newInvoices.length > 0) {
        await Promise.all(newInvoices.map(inv => db.addInvoice(inv)));
        await refreshData();
    }

    if (results.success > 0) {
      await db.addLog('XML_IMPORT', `Importação XML: ${results.success} nota(s) importada(s), ${results.duplicates} duplicada(s), ${results.errors} erro(s)`);
    }

    setImportSummary(results); // Mostra o relatório
    setUploading(false);
  };

  const handleLogisticsUpdate = async (invoiceId: string, field: 'driver' | 'vehicle', value: string) => {
    const inv = invoices.find(i => i.id === invoiceId);
    if (!inv) return;

    const updatedInvoices = invoices.map(i => {
        if (i.id === invoiceId) {
            return {
                ...i,
                [field === 'driver' ? 'driver_id' : 'vehicle_id']: value || null
            }
        }
        return i;
    });
    setInvoices(updatedInvoices);

    // Se for alteração de veículo, checamos capacidade e, se aplicável, avisamos o gestor
    if (field === 'vehicle' && value) {
      const loadInfo = calculateVehicleLoad(value, updatedInvoices);
      if (loadInfo) {
        const { vehicle, totalWeight, totalVolume } = loadInfo;
        const estimatedTotalWeight = (vehicle.tara || 0) + totalWeight;

        // 1) Alerta por cubagem (somatório de volumes)
        if (vehicle.cubagem && totalVolume > vehicle.cubagem) {
          const message = `Veículo ${vehicle.plate} — Tara: ${vehicle.tara ?? 'n/d'} kg, carga estimada: ${totalWeight.toFixed(
            2
          )} kg (total aproximado: ${estimatedTotalWeight.toFixed(
            2
          )} kg). Atenção: a soma dos volumes (${totalVolume.toFixed(
            2
          )}) ultrapassa a cubagem cadastrada (${vehicle.cubagem} m³).`;

          setNotifications(prev => [
            ...prev,
            {
              id: `capacity-cubagem-${invoiceId}-${Date.now()}`,
              recipient_id: 'ADMIN',
              title: 'Alerta de cubagem do veículo',
              message,
              type: 'WARNING',
              read: false,
              timestamp: new Date().toISOString()
            }
          ]);
        }

        // 2) Alerta por peso máximo (PBT / lotação)
        if (vehicle.tara != null && vehicle.max_weight != null && estimatedTotalWeight > vehicle.max_weight) {
          const message = `Veículo ${vehicle.plate} — Peso total estimado ${estimatedTotalWeight.toFixed(
            2
          )} kg (Tara: ${vehicle.tara} kg + carga: ${totalWeight.toFixed(
            2
          )} kg) ultrapassa o peso máximo permitido (${vehicle.max_weight} kg).`;

          setNotifications(prev => [
            ...prev,
            {
              id: `capacity-peso-${invoiceId}-${Date.now()}`,
              recipient_id: 'ADMIN',
              title: 'Alerta de peso máximo do veículo',
              message,
              type: 'WARNING',
              read: false,
              timestamp: new Date().toISOString()
            }
          ]);
        }
      }
    }

    const newDriverId = field === 'driver' ? value : inv.driver_id;
    const newVehicleId = field === 'vehicle' ? value : inv.vehicle_id;

    await db.assignLogistics(invoiceId, newDriverId || null, newVehicleId || null);
    refreshData();
  };

 const filteredInvoices = useMemo(() => {
    return invoices.filter(inv => {
      // 1. Filtro de Texto
      const searchLower = searchTerm.toLowerCase();
      const matchesSearch = !searchTerm || (
        inv.number.includes(searchLower) ||
        inv.customer_name.toLowerCase().includes(searchLower) ||
        inv.value.toString().includes(searchLower) ||
        inv.access_key.includes(searchLower)
      );

      // 2. Filtro de Motorista & Veículo & Status
      const matchesDriver = !filterDriver || inv.driver_id === filterDriver;
      const matchesVehicle = !filterVehicle || inv.vehicle_id === filterVehicle;
      const matchesStatus = !filterStatus || (
        filterStatus === 'FAILED_CONCLUDED'
          ? (inv.status === 'FAILED' && inv.return_final_status === 'CONCLUDED')
          : filterStatus === 'FAILED_CANCELLED'
            ? (inv.status === 'FAILED' && inv.return_final_status === 'CANCELLED')
            : inv.status === filterStatus
      );

      // 3. Filtro de DATA DE EMISSÃO (Criação da Nota)
      const invoiceDate = inv.created_at.split('T')[0];
      const matchesStart = !filterStartDate || invoiceDate >= filterStartDate;
      const matchesEnd = !filterEndDate || invoiceDate <= filterEndDate;

      // 👇👇 4. NOVO FILTRO: DATA DE REALIZAÇÃO (Entrega/Baixa) 👇👇
      // Se a nota não tem data de entrega, ela não aparece se o filtro estiver ativo
      const deliveryDate = inv.delivered_at ? inv.delivered_at.split('T')[0] : null;
      
      const matchesDeliveryStart = !filterDeliveryStartDate || (deliveryDate && deliveryDate >= filterDeliveryStartDate);
      const matchesDeliveryEnd = !filterDeliveryEndDate || (deliveryDate && deliveryDate <= filterDeliveryEndDate);

      return matchesSearch && matchesDriver && matchesVehicle && matchesStatus && 
             matchesStart && matchesEnd && 
             matchesDeliveryStart && matchesDeliveryEnd; // <--- Adicionei aqui no final
    });
  }, [invoices, searchTerm, filterDriver, filterVehicle, filterStatus, filterStartDate, filterEndDate, filterDeliveryStartDate, filterDeliveryEndDate]); // <--- E aqui nas dependências

  // 2. Cole isso logo DEPOIS do 'filteredInvoices'
const sortedInvoices = useMemo(() => {
  const items = [...filteredInvoices];

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
}, [filteredInvoices, sortConfig, drivers, vehicles]);

// Volta para a página 1 sempre que filtros, busca ou ordenação mudam
useEffect(() => {
  setTablePage(1);
}, [searchTerm, filterDriver, filterVehicle, filterStatus, filterStartDate, filterEndDate, filterDeliveryStartDate, filterDeliveryEndDate, sortConfig, tablePageSize]);

// Apenas a EXIBIÇÃO é fatiada — filtros/busca/seleção atuam sobre a lista completa
const totalTablePages = Math.max(1, Math.ceil(sortedInvoices.length / tablePageSize));
const paginatedInvoices = useMemo(() => {
  const start = (tablePage - 1) * tablePageSize;
  return sortedInvoices.slice(start, start + tablePageSize);
}, [sortedInvoices, tablePage, tablePageSize]);

const requestSort = (key: string, _event: React.MouseEvent) => {
  setSortConfig(prev => {
    const existing = prev.find(s => s.key === key);
    if (!existing) {
      // Coluna inativa: entra como prioridade 1
      return [{ key, direction: 'asc' as const }, ...prev];
    }
    if (existing.direction === 'asc') {
      // ↑ → ↓
      return prev.map(s => s.key === key ? { ...s, direction: 'desc' as const } : s);
    }
    // ↓ → remove
    const remaining = prev.filter(s => s.key !== key);
    return remaining.length > 0 ? remaining : [{ key: 'created_at', direction: 'desc' as const }];
  });
};

  const toggleSelectAll = () => {
    if (selectedInvoiceIds.size > 0) {
      setSelectedInvoiceIds(new Set());
    } else {
      setSelectedInvoiceIds(new Set(filteredInvoices.map(i => i.id)));
    }
  };

  const toggleSelectOne = (id: string) => {
    const newSet = new Set(selectedInvoiceIds);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    setSelectedInvoiceIds(newSet);
  };

  // Substitua a função applyBulkAssignment antiga por esta:
  const applyBulkAssignment = async () => {
    if (selectedInvoiceIds.size === 0) return;
    if (!bulkDriver && !bulkVehicle) {
      alert("Selecione um motorista ou veículo para atribuir."); // Esse alert de validação podemos manter ou trocar por Toast de erro também
      return;
    }

    const promises: Promise<void>[] = [];
    selectedInvoiceIds.forEach(id => {
      const currentInv = invoices.find(i => i.id === id);
      if (currentInv) {
        const driverToSet = bulkDriver || currentInv.driver_id;
        const vehicleToSet = bulkVehicle || currentInv.vehicle_id;
        promises.push(db.assignLogistics(id, driverToSet, vehicleToSet));
      }
    });

    await Promise.all(promises);
    // Antes de recarregar os dados, simulamos como ficará a alocação para checar capacidade
    if (bulkVehicle) {
      const simulatedInvoices = invoices.map(inv => {
        if (selectedInvoiceIds.has(inv.id)) {
          return { ...inv, vehicle_id: bulkVehicle || inv.vehicle_id };
        }
        return inv;
      });

      const loadInfo = calculateVehicleLoad(bulkVehicle, simulatedInvoices);
      if (loadInfo) {
        const { vehicle, totalWeight, totalVolume } = loadInfo;
        const estimatedTotalWeight = (vehicle.tara || 0) + totalWeight;

        // 1) Alerta por cubagem (somatório de volumes)
        if (vehicle.cubagem && totalVolume > vehicle.cubagem) {
          const message = `Veículo ${vehicle.plate} — Tara: ${vehicle.tara ?? 'n/d'} kg, carga estimada: ${totalWeight.toFixed(
            2
          )} kg (total aproximado: ${estimatedTotalWeight.toFixed(
            2
          )} kg). Atenção: a soma dos volumes (${totalVolume.toFixed(
            2
          )}) ultrapassa a cubagem cadastrada (${vehicle.cubagem} m³).`;

          setNotifications(prev => [
            ...prev,
            {
              id: `capacity-bulk-cubagem-${bulkVehicle}-${Date.now()}`,
              recipient_id: 'ADMIN',
              title: 'Alerta de cubagem do veículo',
              message,
              type: 'WARNING',
              read: false,
              timestamp: new Date().toISOString()
            }
          ]);
        }

        // 2) Alerta por peso máximo (PBT / lotação)
        if (vehicle.tara != null && vehicle.max_weight != null && estimatedTotalWeight > vehicle.max_weight) {
          const message = `Veículo ${vehicle.plate} — Peso total estimado ${estimatedTotalWeight.toFixed(
            2
          )} kg (Tara: ${vehicle.tara} kg + carga: ${totalWeight.toFixed(
            2
          )} kg) ultrapassa o peso máximo permitido (${vehicle.max_weight} kg).`;

          setNotifications(prev => [
            ...prev,
            {
              id: `capacity-bulk-peso-${bulkVehicle}-${Date.now()}`,
              recipient_id: 'ADMIN',
              title: 'Alerta de peso máximo do veículo',
              message,
              type: 'WARNING',
              read: false,
              timestamp: new Date().toISOString()
            }
          ]);
        }
      }
    }

    refreshData();
    
    // Limpa a seleção
    setSelectedInvoiceIds(new Set());
    setBulkDriver("");
    setBulkVehicle("");

    // --- AQUI ESTÁ A MUDANÇA: TOAST EM VEZ DE ALERT 🍞 ---
    setNotifications(prev => [...prev, {
        id: `bulk-${Date.now()}`,
        recipient_id: 'ADMIN',
        title: 'Atribuição Concluída',
        message: 'Motoristas e veículos vinculados com sucesso.',
        type: 'SUCCESS',
        read: false,
        timestamp: new Date().toISOString()
    }]);
  };

  /** Abre rastreamento SSW em nova aba (fallback) */
  const trackOnSSW = (invoiceNumber: string) => {
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

  /** Busca rastreamento SSW via API e abre modal inline */
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
      const events = data?.documento?.tracking ?? data?.rastreamento ?? data?.ocorrencias ?? (Array.isArray(data) ? data : []);
      setSswModal(prev => ({ ...prev, loading: false, events, raw: data }));
    } catch (err: any) {
      const isCors = err instanceof TypeError || err?.message?.includes('Failed to fetch');
      setSswModal(prev => ({ ...prev, loading: false, error: isCors ? 'CORS_BLOCKED' : (err?.message || 'Erro desconhecido') }));
    }
  };

  const handleDeleteInvoice = (id: string) => {
    setConfirmModal({
      isOpen: true,
      type: 'INVOICE',
      id: id,
      title: 'Excluir Nota Fiscal?',
      message: 'Tem certeza que deseja remover esta nota fiscal do sistema? Esta ação é irreversível.'
    });
  };

  const handleBulkDelete = () => {
    if (selectedInvoiceIds.size === 0) return;
    setConfirmModal({
      isOpen: true,
      type: 'BULK_INVOICE',
      title: `Excluir ${selectedInvoiceIds.size} Notas?`,
      message: `Você está prestes a remover ${selectedInvoiceIds.size} notas fiscais selecionadas. Confirma a exclusão em massa?`
    });
  };

  const handleViewProof = async (invoice: Invoice) => {
    const proof = await db.getProofByInvoiceId(invoice.id);
    
    // Se não houver comprovante salvo, mas houver baixa manual registrada,
    // abrimos o modal específico de baixa manual (sem foto/assinatura).
    if (!proof) {
      if (invoice.last_failure_reason && invoice.last_failure_reason.includes('BAIXA MANUAL (GESTOR)')) {
        setViewingManualProof(invoice);
        return;
      }
      alert("Comprovante ainda não sincronizado ou não encontrado.");
      return;
    }

    // Separação inteligente:
    if (invoice.status === 'ISSUE') {
      setViewingIssue({ invoice, proof }); // Modal exclusivo de pendência
    } else {
      setViewingProof({ invoice, proof }); // Modal padrão de comprovante digital
    }
  };

  const handleCreateDriver = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newDriverName && newDriverPassword) {
      try {
        await db.addDriver({
          id: `d-${Date.now()}`,
          name: newDriverName,
          password: newDriverPassword
        });
        setNewDriverName('');
        setNewDriverPassword('');
        refreshData();
      } catch (error) {
        console.error(error);
        alert("Erro ao cadastrar motorista.");
      }
    }
  };

  const handleDeleteDriver = (id: string) => {
    setConfirmModal({
      isOpen: true,
      type: 'DRIVER',
      id: id,
      title: 'Remover Motorista?',
      message: 'Ao remover este motorista, todas as entregas vinculadas a ele voltarão para o status "Faturado".'
    });
  };

  const handleCreateVehicle = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newVehiclePlate && newVehicleModel) {
      try {
        const taraValue = newVehicleTara ? parseFloat(newVehicleTara.replace(',', '.')) : null;
        const cubagemValue = newVehicleCubagem ? parseFloat(newVehicleCubagem.replace(',', '.')) : null;
        const maxWeightValue = newVehicleMaxWeight ? parseFloat(newVehicleMaxWeight.replace(',', '.')) : null;

        if (editingVehicleId) {
          await db.updateVehicle(editingVehicleId, {
            plate: newVehiclePlate.toUpperCase(),
            model: newVehicleModel,
            tara: taraValue ?? undefined,
            cubagem: cubagemValue ?? undefined,
            max_weight: maxWeightValue ?? undefined
          });
        } else {
          await db.addVehicle({
            id: `v-${Date.now()}`,
            plate: newVehiclePlate.toUpperCase(),
            model: newVehicleModel,
            tara: taraValue ?? undefined,
            cubagem: cubagemValue ?? undefined,
            max_weight: maxWeightValue ?? undefined
          });
        }

        setNewVehiclePlate('');
        setNewVehicleModel('');
        setNewVehicleTara('');
        setNewVehicleCubagem('');
        setNewVehicleMaxWeight('');
        setEditingVehicleId(null);
        refreshData();
      } catch (error) {
        console.error(error);
        alert(editingVehicleId ? "Erro ao atualizar veículo." : "Erro ao cadastrar veículo.");
      }
    }
  };

  const handleDeleteVehicle = (id: string) => {
    setConfirmModal({
      isOpen: true,
      type: 'VEHICLE',
      id: id,
      title: 'Remover Veículo?',
      message: 'Deseja realmente remover este veículo da frota?'
    });
  };

  const handleUpdateAdminPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newAdminPassword) {
      await db.updateAdminPassword(newAdminPassword);
      setNewAdminPassword('');
      setShowSettings(false);
    }
  };

  // --- FUNÇÃO DE IMPRESSÃO EM NOVA JANELA (SEM BUGS) ---
  const handlePrintProof = () => {
    if (!viewingProof) return;

    // Abre uma janela em branco
    const printWindow = window.open('', '_blank', 'width=900,height=800');
    if (!printWindow) return alert("Por favor, permita pop-ups para imprimir.");

    const { invoice, proof } = viewingProof;

    // Cria o HTML limpo para impressão
    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Comprovante - EntregaCerta</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 40px; color: #333; max-width: 800px; margin: 0 auto; }
          .header { text-align: center; border-bottom: 2px solid #333; padding-bottom: 20px; margin-bottom: 30px; }
          .header h1 { margin: 0; font-size: 24px; text-transform: uppercase; }
          .header p { margin: 5px 0 0; color: #666; font-size: 14px; }
          
          .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 30px; margin-bottom: 30px; }
          .section-title { font-size: 12px; font-weight: bold; color: #888; text-transform: uppercase; border-bottom: 1px solid #eee; margin-bottom: 10px; padding-bottom: 5px; }
          .field { margin-bottom: 12px; }
          .label { font-size: 11px; color: #999; display: block; margin-bottom: 2px; }
          .value { font-size: 16px; font-weight: 500; display: block; }
          
          /* Estilo das Fotos */
          .evidence-box { 
            margin-top: 30px; 
            border: 1px solid #eee; 
            border-radius: 8px; 
            padding: 10px;
            page-break-inside: avoid; /* Evita cortar a foto ao meio */
          }
          .evidence-title { font-weight: bold; margin-bottom: 10px; display: block; text-align: center; background: #f9f9f9; padding: 5px; border-radius: 4px;}
          .evidence-img { 
            width: 100%; 
            height: 350px; /* Altura fixa para não estourar a folha */
            object-fit: contain; 
            display: block; 
            margin: 0 auto; 
          }
          
          .footer { margin-top: 50px; text-align: center; font-size: 10px; color: #ccc; border-top: 1px solid #eee; padding-top: 10px; }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>Comprovante de Entrega Digital</h1>
          <p>NF-e ${invoice.number} • Série ${invoice.series}</p>
          <p>Gerado em ${new Date().toLocaleString('pt-BR')}</p>
        </div>

        <div class="grid">
          <div>
            <div class="section-title">Dados do Recebedor</div>
            <div class="field"><span class="label">Nome</span><span class="value">${proof.receiver_name}</span></div>
            <div class="field"><span class="label">Documento</span><span class="value">${proof.receiver_doc}</span></div>
          </div>
          <div>
            <div class="section-title">Operação</div>
            <div class="field"><span class="label">Data da Baixa</span><span class="value">${new Date(proof.delivered_at).toLocaleString('pt-BR')}</span></div>
            <div class="field"><span class="label">GPS</span><span class="value">${proof.geo_lat ? `${proof.geo_lat}, ${proof.geo_long}` : 'Não capturado'}</span></div>
          </div>
        </div>

        <div class="evidence-box">
          <span class="evidence-title">1. Assinatura Digital</span>
          ${proof.signature_data 
            ? `<img src="${proof.signature_data}" class="evidence-img" style="height: 150px;" />` 
            : '<p style="text-align:center; padding: 50px; color:#999">Não assinada</p>'
          }
        </div>

        <div class="evidence-box">
          <span class="evidence-title">2. Foto do Local / Mercadoria</span>
          ${proof.photo_url 
            ? `<img src="${proof.photo_url}" class="evidence-img" />` 
            : '<p style="text-align:center; padding: 50px; color:#999">Sem foto</p>'
          }
        </div>

        ${(proof as any).photo_stub_url ? `
        <div class="evidence-box">
          <span class="evidence-title">3. Foto do Canhoto Físico</span>
          <img src="${(proof as any).photo_stub_url}" class="evidence-img" />
        </div>` : ''}

        <div class="footer">
          Sistema EntregaCerta v1.0 • Autenticação Digital
        </div>

        <script>
          // Manda imprimir assim que carregar as imagens
          window.onload = () => { setTimeout(() => window.print(), 500); }
        </script>
      </body>
      </html>
    `;

    printWindow.document.write(htmlContent);
    printWindow.document.close();
  };

  // ... (Cole logo APÓS a função handlePrintProof e ANTES de getStatusBadge)

  // 👇 1. Helper de Notificação (Para o código novo funcionar)
  const notify = (title: string, message: string, type: 'SUCCESS' | 'WARNING' | 'INFO' = 'INFO') => {
    setNotifications(prev => [...prev, {
        id: `alert-${Date.now()}-${Math.random()}`,
        recipient_id: 'ADMIN',
        title,
        message,
        type,
        read: false,
        timestamp: new Date().toISOString()
    }]);
  };

  // 👇 2. Suas Novas Funções de Reentrega
  // 1. ABRIR MODAL DE REENTREGA
  const handleRedeliver = (invoice: Invoice) => {
    setModalRedeliver({ open: true, invoice });
  };

  /** Finaliza o fluxo de devolução: concluída (não volta para motorista) ou cancelada (cliente desistiu). */
  // Abre modal de finalização (escolhendo CONCLUDED ou CANCELLED)
  const openFinalizeModal = (invoice: Invoice, outcome: 'CONCLUDED' | 'CANCELLED') => {
    setModalFinalize({ open: true, invoice, outcome, note: '', loading: false });
  };

  const confirmFinalize = async () => {
    if (!modalFinalize.invoice || !modalFinalize.outcome) return;
    setModalFinalize(prev => ({ ...prev, loading: true }));
    try {
      await db.finalizeReturn(modalFinalize.invoice.id, modalFinalize.outcome, modalFinalize.note);
      refreshData();
      notify(
        modalFinalize.outcome === 'CONCLUDED' ? 'Devolução concluída' : 'Devolução cancelada',
        `NF ${modalFinalize.invoice.number} encerrada. Histórico preservado.`,
        'SUCCESS'
      );
      setModalFinalize({ open: false, invoice: null, outcome: null, note: '', loading: false });
    } catch (e) {
      console.error(e);
      notify('Erro', 'Não foi possível finalizar a devolução.', 'WARNING');
      setModalFinalize(prev => ({ ...prev, loading: false }));
    }
  };

  // 2. AÇÃO REAL: CONFIRMAR REENTREGA (Chamada pelo botão do Modal)
  // 2. AÇÃO REAL: CONFIRMAR REENTREGA (Simplificada)
  const confirmRedeliveryAction = async () => {
    const invoice = modalRedeliver.invoice;
    if (!invoice) return;

    try {
        // Chamamos a função passando apenas o ID e as Tentativas
        await db.resetInvoiceForRedelivery(invoice.id, invoice.delivery_attempts || 0);
        
        notify("Sucesso", "Nota liberada para reentrega com valor original!", "SUCCESS");
        refreshData();
        setModalRedeliver({ open: false, invoice: null });
    } catch (error) {
        console.error(error);
        notify("Erro", "Falha ao resetar nota.", "WARNING");
    }
  };

  // 3. ABRIR MODAL DE EDITAR VALOR
  const handleEditValue = (invoice: Invoice) => {
    setModalEditValue({ open: true, invoice, value: invoice.value.toString() });
  };

  // 4. AÇÃO REAL: SALVAR NOVO VALOR (Chamada pelo botão do Modal)
  const saveNewValueAction = async () => {
    const invoice = modalEditValue.invoice;
    if (!invoice) return;

    const newValue = parseFloat(modalEditValue.value.replace(',', '.'));
    
    if (!isNaN(newValue) && newValue >= 0) {
        try {
            await db.updateInvoiceValue(invoice.id, newValue);
            refreshData();
            notify("Valor Atualizado", `Novo valor: R$ ${newValue.toFixed(2)}`, "SUCCESS");
            setModalEditValue({ open: false, invoice: null, value: '' }); // Fecha modal
        } catch (error) {
            console.error(error);
            notify("Erro", "Falha ao atualizar valor.", "WARNING");
        }
    } else {
        alert("Valor inválido."); // Esse alert simples pode ficar ou podemos usar notify
    }
  };

  // --- BAIXA MANUAL (GESTOR) ---
  const openManualSettleModal = (invoice: Invoice, status: 'DELIVERED' | 'FAILED') => {
    setManualSettleModal({
      open: true,
      invoice,
      status,
      reason: '',
      loading: false,
    });
  };

  const confirmManualSettle = async () => {
    if (!manualSettleModal.invoice) return;
    if (!manualSettleModal.reason.trim()) {
      alert('Informe o motivo da baixa manual.');
      return;
    }

    setManualSettleModal((prev) => ({ ...prev, loading: true }));
    try {
      await db.adminManualSettleInvoice(manualSettleModal.invoice.id, {
        status: manualSettleModal.status,
        reason: manualSettleModal.reason.trim(),
        lossValue: undefined,
      });

      notify(
        'Baixa manual aplicada',
        `NF ${manualSettleModal.invoice.number} marcada como ${
          manualSettleModal.status === 'DELIVERED' ? 'ENTREGUE' : 'DEVOLVIDA'
        } pelo gestor.`,
        'SUCCESS'
      );
      await refreshData();
      setManualSettleModal({
        open: false,
        invoice: null,
        status: 'DELIVERED',
        reason: '',
        loading: false,
      });
    } catch (e) {
      console.error(e);
      notify('Erro', 'Não foi possível aplicar a baixa manual.', 'WARNING');
      setManualSettleModal((prev) => ({ ...prev, loading: false }));
    }
  };

  // ... aqui embaixo deve estar o const getStatusBadge = ...

  // Função que define a cor e o texto das etiquetas (Completa). Recebe a nota para devoluções finalizadas.
  const getStatusBadge = (inv: Invoice) => {
    const status = inv.status;
    // Devolução finalizada: um único texto "Devolução concluída" ou "Devolução cancelada"
    if (status === DeliveryStatus.FAILED && inv.return_final_status === 'CONCLUDED') {
      return (
        <span className="inline-flex items-center whitespace-nowrap px-2 py-1 rounded-full text-sm font-bold border bg-emerald-100 dark:bg-emerald-900/30 text-emerald-800 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800">
          Devolução concluída
        </span>
      );
    }
    if (status === DeliveryStatus.FAILED && inv.return_final_status === 'CANCELLED') {
      return (
        <span className="inline-flex items-center whitespace-nowrap px-2 py-1 rounded-full text-sm font-bold border bg-slate-100 dark:bg-slate-700/50 text-slate-700 dark:text-slate-300 border-slate-300 dark:border-slate-600">
          Devolução cancelada
        </span>
      );
    }
    // DEFINIÇÃO DAS CORES (STYLES)
    const styles: Record<string, string> = {
      [DeliveryStatus.PENDING]: 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-400 border-yellow-200 dark:border-yellow-800',
      [DeliveryStatus.IN_PROGRESS]: 'bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-400 border-blue-200 dark:border-blue-800',
      [DeliveryStatus.DELIVERED]: 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-400 border-green-200 dark:border-green-800',
      [DeliveryStatus.FAILED]: 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-400 border-red-200 dark:border-red-800',
      [DeliveryStatus.RETURNED]: 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-400 border-red-200 dark:border-red-800',
      [DeliveryStatus.ISSUE]: 'bg-orange-100 dark:bg-orange-900/30 text-orange-800 dark:text-orange-400 border-orange-200 dark:border-orange-800',
    };
    const labels: Record<string, string> = {
      [DeliveryStatus.PENDING]: 'Faturada',
      [DeliveryStatus.IN_PROGRESS]: 'Em Rota',
      [DeliveryStatus.DELIVERED]: 'Entregue',
      [DeliveryStatus.FAILED]: 'Devolvido',
      [DeliveryStatus.RETURNED]: 'Devolvido',
      [DeliveryStatus.ISSUE]: 'Pendência',
    };
    // "Em Rota" com veículo atribuído: badge clicável que abre a frota no caminhão da nota
    if (status === DeliveryStatus.IN_PROGRESS && inv.vehicle_id) {
      return (
        <button
          onClick={() => handleTrackInvoiceVehicle(inv)}
          title="Ver veículo no mapa da frota"
          className={`inline-flex items-center gap-1.5 whitespace-nowrap px-2 py-1 rounded-full text-sm font-bold border cursor-pointer transition-all hover:ring-2 hover:ring-blue-400/60 hover:scale-105 ${styles[status]}`}
        >
          <Satellite size={13} />
          Em Rota
        </button>
      );
    }
    return (
      <span className={`inline-flex items-center whitespace-nowrap px-2 py-1 rounded-full text-sm font-bold border ${styles[status] || 'bg-slate-100 text-slate-800'}`}>
        {labels[status] || status}
      </span>
    );
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 transition-colors duration-300 flex flex-col overflow-x-hidden">
      <ToastContainer notifications={notifications} onRemove={removeNotification} />

      {/* Header */}
      <header className="bg-slate-900 dark:bg-black text-white p-4 shadow-md sticky top-0 z-30 border-b border-slate-700">
        <div className="max-w-7xl mx-auto px-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Truck className="h-6 w-6 text-blue-400" />
            <h1 className="text-xl font-bold tracking-tight">EntregaCerta <span className="text-slate-500 dark:text-slate-400 font-normal">| Gestão</span></h1>
          </div>
          <div className="flex items-center gap-4">
            {/* --- NOVO BOTÃO DE TEMA AQUI --- */}
            {toggleTheme && (
              <button 
                onClick={toggleTheme}/* */
                className="p-2 hover:bg-slate-800 rounded-full transition-colors text-slate-300 hover:text-yellow-400"
                title="Alternar Tema"
              >
                {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
              </button>
            )}
            {/* -------------------------------- */}
            <button onClick={refreshData} className="p-2 hover:bg-slate-800 rounded-full transition-colors text-slate-300 hover:text-white" title="Atualizar">
              <RefreshCw size={16} />
            </button>
            <div className="h-4 w-px bg-slate-700 mx-1"></div>
            <button 
              onClick={() => setShowSettings(true)}
              className="p-2 hover:bg-slate-800 rounded-full transition-colors text-slate-300 hover:text-white"
              title="Configurações"
            >
              <Settings size={20} />
            </button>
          </div>
        </div>
      </header>

      <div className="flex flex-1">

        {/* Sidebar — fixed para não sumir ao rolar a página */}
        <aside className="group fixed top-[57px] left-0 h-[calc(100vh-57px)] w-14 hover:w-52 bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-700 transition-all duration-300 ease-in-out overflow-hidden flex flex-col shrink-0 z-20 shadow-sm">
          <nav className="flex flex-col gap-1 p-2 pt-4">
            <button
              onClick={() => setActiveSidebarSection('main')}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg w-full text-left transition-colors ${
                activeSidebarSection === 'main'
                  ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400'
                  : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white'
              }`}
              title="Gestão"
            >
              <LayoutDashboard size={20} className="shrink-0" />
              <span className="text-sm font-medium whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity duration-200 delay-75">
                Gestão
              </span>
            </button>

            <div className="my-1 mx-3 border-t border-slate-100 dark:border-slate-700/60" />

            <button
              onClick={() => setActiveSidebarSection('etiquetas')}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg w-full text-left transition-colors ${
                activeSidebarSection === 'etiquetas'
                  ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400'
                  : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white'
              }`}
              title="Etiquetas"
            >
              <Tag size={20} className="shrink-0" />
              <span className="text-sm font-medium whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity duration-200 delay-75">
                Etiquetas
              </span>
            </button>
          </nav>
        </aside>

      {/* ml-14 = mesma largura do sidebar colapsado (w-14 = 56px) */}
      {/* min-w-0: sem isso, a tabela larga força o flex a estourar a largura da tela no mobile */}
      <main className="flex-1 min-w-0 ml-14 p-4 md:p-8 space-y-6 pb-20">

        {/* ===== MÓDULO ETIQUETAS ===== */}
        {activeSidebarSection === 'etiquetas' && (
          <LabelsView />
        )}

        {activeSidebarSection === 'main' && (<>

        {/* Actions Bar */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white dark:bg-slate-800 p-4 rounded-lg border border-slate-200 dark:border-slate-700 shadow-sm">
          <div>
            <h2 className="text-lg font-semibold text-slate-800 dark:text-white">Painel de Controle</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">Gerencie recursos e distribua cargas.</p>
          </div> 
          
          <div className="flex flex-wrap gap-2 w-full md:w-auto">
            <button onClick={() => { setTrackedInvoiceId(null); setShowFleetMonitor(true); }} className="flex items-center justify-center gap-2 px-3 py-2 bg-blue-50 dark:bg-blue-900/30 hover:bg-blue-100 dark:hover:bg-blue-900/50 text-blue-700 dark:text-blue-400 border border-blue-200 dark:border-blue-800 rounded-md transition-colors shadow-sm">
              <Satellite className="h-4 w-4" /> <span className="font-medium text-sm">Monitorar Frota</span>
            </button>
            
            <button onClick={() => setShowControladoria(true)} className="flex items-center justify-center gap-2 px-3 py-2 bg-white dark:bg-slate-700 hover:bg-slate-50 dark:hover:bg-slate-600 text-slate-700 dark:text-white border border-slate-300 dark:border-slate-600 rounded-md transition-colors shadow-sm">
              <LayoutDashboard className="h-4 w-4" /> <span className="font-medium text-sm">Controladoria</span>
            </button>

            <button onClick={() => onNavigate?.('ADMIN_ROUTING')} className="flex items-center justify-center gap-2 px-3 py-2 bg-violet-50 dark:bg-violet-900/30 hover:bg-violet-100 dark:hover:bg-violet-900/50 text-violet-700 dark:text-violet-400 border border-violet-200 dark:border-violet-800 rounded-md transition-colors shadow-sm">
              <Route className="h-4 w-4" /> <span className="font-medium text-sm">Roteirização</span>
            </button>

            <button onClick={() => onNavigate?.('ADMIN_ZONES')} className="flex items-center justify-center gap-2 px-3 py-2 bg-indigo-50 dark:bg-indigo-900/30 hover:bg-indigo-100 dark:hover:bg-indigo-900/50 text-indigo-700 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800 rounded-md transition-colors shadow-sm">
              <MapPin className="h-4 w-4" /> <span className="font-medium text-sm">Zonas</span>
            </button>

            <button onClick={() => setShowAddVehicle(true)} className="flex items-center justify-center gap-2 px-3 py-2 bg-white dark:bg-slate-700 hover:bg-slate-50 dark:hover:bg-slate-600 text-slate-700 dark:text-white border border-slate-300 dark:border-slate-600 rounded-md transition-colors shadow-sm">
              <Truck className="h-4 w-4" /> <span className="font-medium text-sm">Gerir Veículos</span>
            </button>
            
            <button onClick={() => setShowAddDriver(true)} className="flex items-center justify-center gap-2 px-3 py-2 bg-white dark:bg-slate-700 hover:bg-slate-50 dark:hover:bg-slate-600 text-slate-700 dark:text-white border border-slate-300 dark:border-slate-600 rounded-md transition-colors shadow-sm">
              <UserPlus className="h-4 w-4" /> <span className="font-medium text-sm">Gerir Motoristas</span>
            </button>

           <button 
              onClick={() => setShowImportModal(true)} 
              className="flex items-center justify-center gap-2 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md cursor-pointer transition-colors shadow-sm"
            >
              <UploadCloud className="h-4 w-4" />
              <span className="font-medium text-sm">Importar XML</span>
            </button>
          </div>
        </div>

        {/* Loading Overlay */}
        {processingKey && (
          <div className="fixed inset-0 z-[60] flex flex-col items-center justify-center bg-black/50 backdrop-blur-sm">
            <div className="bg-white dark:bg-slate-800 p-6 rounded-lg shadow-xl flex flex-col items-center">
              <Loader2 className="h-10 w-10 text-blue-600 animate-spin mb-4" />
              <h3 className="text-lg font-bold dark:text-white">Consultando SEFAZ...</h3>
            </div>
          </div>
        )}

        {/* --- FILTRO GERAL DO DASHBOARD (VISÃO GERAL) --- */}
        {/* Fica logo acima dos cards para fácil acesso */}
        <div className="bg-white dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm mb-6 flex flex-col md:flex-row md:items-center justify-between gap-4 animate-in slide-in-from-top-2">
            <div>
               <h2 className="font-bold text-slate-800 dark:text-white text-lg flex items-center gap-2">
                  <LayoutDashboard className="text-blue-600" /> Filtro Geral Dashboard
               </h2>
               <p className="text-xs text-slate-500">
                  {dashboardData.length} registros encontrados no período.
               </p>
            </div>

            {/* Campos de Data */}
            <div className="flex items-center gap-2 bg-white dark:bg-slate-900 p-2 rounded-lg border border-slate-200 dark:border-slate-700">
                <div className="flex items-center gap-2 px-2 border-r border-slate-200 dark:border-slate-700">
                   <Clock size={14} className="text-slate-500 dark:text-slate-400"/>
                   <span className="text-xs font-bold text-slate-500 uppercase">Período</span>
                </div>
                <input 
                    type="date" 
                    className="bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-blue-500 dark:text-white cursor-pointer"
                    value={dashStartDate}
                    onChange={(e) => setDashStartDate(e.target.value)}
                />
                <span className="text-slate-500 dark:text-slate-400">-</span>
                <input 
                    type="date" 
                    className="bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-blue-500 dark:text-white cursor-pointer"
                    value={dashEndDate}
                    onChange={(e) => setDashEndDate(e.target.value)}
                />
                
                {(dashStartDate || dashEndDate) && (
                    <button 
                        onClick={() => { setDashStartDate(''); setDashEndDate(''); }}
                        className="ml-2 p-1.5 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-md transition-colors"
                        title="Limpar Datas"
                    >
                        <XCircle size={16} />
                    </button>
                )}
            </div>
        </div>

        {/* --- 1. CARDS DE STATUS (MANTIDO) --- */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 mb-6">
           {[
             { label: 'Faturadas', count: countPending, icon: Clock, color: 'text-yellow-600 dark:text-yellow-400', bg: 'bg-yellow-50 dark:bg-yellow-900/20' },
             { label: 'Em Rota', count: countProgress, icon: Navigation2, color: 'text-blue-600 dark:text-blue-400', bg: 'bg-blue-50 dark:bg-blue-900/20' },
             { label: 'Entregues', count: countDelivered, icon: CheckCircle, color: 'text-green-600 dark:text-green-400', bg: 'bg-green-50 dark:bg-green-900/20' },
             { label: 'Devoluções', count: countFailed, icon: AlertTriangle, color: 'text-red-600 dark:text-red-400', bg: 'bg-red-50 dark:bg-red-900/20' },
             { label: 'Pendências', count: countIssue, icon: AlertOctagon, color: 'text-orange-600 dark:text-orange-400', bg: 'bg-orange-50 dark:bg-orange-900/20' },
           ].map((stat, idx) => (
             <div key={idx} className="bg-white dark:bg-slate-800 p-4 rounded-lg border border-slate-200 dark:border-slate-700 shadow-sm flex items-center justify-between hover:shadow-md transition-shadow">
               <div>
                 <p className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase">{stat.label}</p>
                 <p className="text-2xl font-bold text-slate-800 dark:text-white">{stat.count}</p>
               </div>
               <div className={`p-2 rounded-full ${stat.bg}`}>
                 <stat.icon className={`h-5 w-5 ${stat.color}`} />
               </div>
             </div>  
           ))}
        </div>

        {/* --- 2. DASHBOARD FINANCEIRO + RANKING (RESTAURADO) --- */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          
          {/* Card 1: Valor Entregue */}
          <div className="bg-white dark:bg-slate-800 p-6 rounded-lg border border-slate-200 dark:border-slate-700 shadow-sm relative overflow-hidden group">
             <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
               <DollarSign size={100} className="text-emerald-600 dark:text-emerald-400" />
             </div>
             <div>
               <p className="text-sm font-bold text-slate-500 dark:text-slate-400 uppercase flex items-center gap-2">
                 <TrendingUp size={16} className="text-emerald-500"/> Valor Entregue
               </p>
               <h3 className="text-3xl font-black text-slate-800 dark:text-white mt-2 tracking-tight">
                 {totalDeliveredValue.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
               </h3>
               <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Soma das notas baixadas no período.</p>
             </div>
          </div>

          {/* Card 2: Valor Devolvido */}
          <div className="bg-white dark:bg-slate-800 p-6 rounded-lg border border-slate-200 dark:border-slate-700 shadow-sm relative overflow-hidden group">
             <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
               <AlertTriangle size={100} className="text-red-600 dark:text-red-400" />
             </div>
             <div>
               <p className="text-sm font-bold text-slate-500 dark:text-slate-400 uppercase flex items-center gap-2">
                 <TrendingDown size={16} className="text-red-500"/> Valor Devolvido
               </p>
               <h3 className="text-3xl font-black text-slate-800 dark:text-white mt-2 tracking-tight">
                 {totalFailedValue.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
               </h3>
               <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Soma das falhas no período.</p>
             </div>
          </div>

          {/* Card 3: Ranking de Motoristas (RESTAURADO COM LÓGICA NOVA) */}
          <div className="bg-white dark:bg-slate-800 p-4 rounded-lg border border-slate-200 dark:border-slate-700 shadow-sm flex flex-col h-[200px]">
             <div className="flex items-center justify-between mb-4 border-b border-slate-100 dark:border-slate-700 pb-2">
               <h3 className="font-bold text-slate-700 dark:text-slate-200 flex items-center gap-2">
                 <Award className="text-orange-500" size={20}/> Top Motoristas
               </h3>
               <span className="text-[10px] bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 px-2 py-1 rounded font-bold">Por Entregas</span>
             </div>
             
             <div className="flex-1 overflow-y-auto space-y-3 pr-2 scrollbar-thin scrollbar-thumb-slate-200 dark:scrollbar-thumb-slate-600">
               {driverRanking.length === 0 ? (
                 <div className="h-full flex flex-col items-center justify-center text-slate-500 dark:text-slate-400 text-sm italic opacity-60">
                    <User size={24} className="mb-1"/>
                    <p>Sem dados no período</p>
                 </div>
               ) : (
                 driverRanking.map((driver, idx) => (
                   <div key={driver.id} className="flex items-center justify-between group">
                     <div className="flex items-center gap-3">
                       <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shadow-sm ${
                           idx === 0 ? 'bg-yellow-100 text-yellow-700 ring-2 ring-yellow-200' : 
                           idx === 1 ? 'bg-slate-200 text-slate-700' :
                           idx === 2 ? 'bg-orange-100 text-orange-800' :
                           'bg-slate-50 dark:bg-slate-700 text-slate-500 dark:text-slate-400'
                       }`}>
                         {idx + 1}
                       </div>
                       <div>
                         <p className="text-sm font-bold text-slate-700 dark:text-slate-200 leading-none">{driver.name}</p>
                         <p className="text-[10px] text-slate-500 font-medium mt-0.5">
                           {driver.count} {driver.count === 1 ? 'entrega' : 'entregas'} realizadas
                         </p>
                       </div>
                     </div>
                     <span className="text-[10px] font-mono text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-700/50 px-2 py-1 rounded">
                       {driver.value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                     </span>
                   </div>
                 ))
               )}
             </div>
          </div>
        </div>

        {/* Bulk Assignment Bar */}
        {selectedInvoiceIds.size > 0 && (
          <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 p-4 rounded-lg shadow-sm animate-in fade-in slide-in-from-top-2">
            <div className="flex flex-col md:flex-row items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <CheckSquare className="text-blue-600 dark:text-blue-400" />
                <span className="font-bold text-blue-900 dark:text-blue-100">{selectedInvoiceIds.size} itens selecionados</span>
              </div>
              <div className="flex flex-wrap gap-2 items-center w-full md:w-auto">
                <select 
                  className="bg-white dark:bg-slate-700 border border-blue-300 dark:border-slate-600 text-slate-900 dark:text-white text-sm rounded-md p-2 outline-none focus:ring-2 focus:ring-blue-500"
                  value={bulkDriver}
                  onChange={(e) => setBulkDriver(e.target.value)}
                >
                  <option value="">Atribuir Motorista...</option>
                  {drivers.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>

                <select 
                  className="bg-white dark:bg-slate-700 border border-blue-300 dark:border-slate-600 text-slate-900 dark:text-white text-sm rounded-md p-2 outline-none focus:ring-2 focus:ring-blue-500"
                  value={bulkVehicle}
                  onChange={(e) => setBulkVehicle(e.target.value)}
                >
                  <option value="">Atribuir Veículo...</option>
                  {vehicles.map(v => <option key={v.id} value={v.id}>{v.plate} - {v.model}</option>)}
                </select>

                <button 
                  onClick={applyBulkAssignment}
                  className="bg-blue-600 text-white px-4 py-2 rounded-md font-medium hover:bg-blue-700 transition-colors shadow-sm"
                >
                  Salvar
                </button>

                <div className="h-6 w-px bg-blue-300 dark:bg-blue-700 mx-2 hidden md:block"></div>

                <button 
                  onClick={handleBulkDelete}
                  className="bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800 px-4 py-2 rounded-md font-medium hover:bg-red-100 dark:hover:bg-red-900/50 transition-colors shadow-sm flex items-center gap-2"
                >
                  <Trash2 size={16} /> Excluir Selecionados
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Invoices Table */}
       {/* --- TABELA DE GESTÃO COM FILTROS AVANÇADOS --- */}
        <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 shadow-sm flex flex-col h-[calc(100vh-80px)] text-sm"> 
          {/* h-[calc...] faz a tabela ocupar o resto da tela sem ser infinita */}

          {/* CABEÇALHO E FILTROS */}
          <div className="p-4 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 space-y-4">
            
            <div className="flex justify-between items-center flex-wrap gap-2">
               <h3 className="font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-2">
                 <Filter size={18} /> Gestão de Cargas
               </h3>
               
               {/* Resumo rápido */}
               <span className="text-xs font-mono text-slate-500">
                 Mostrando {filteredInvoices.length} de {invoices.length} notas
               </span>
            </div>

           
            {/* ÁREA DE FILTROS (GRID OTIMIZADO V2 - DATA LARGA) */}
            {/* Mudamos xl:grid-cols-5 para xl:grid-cols-6 para dar espaço duplo à data */}
           {/* ÁREA DE FILTROS (GRID OTIMIZADO PARA 2 DATAS) */}
            {/* xl:grid-cols-8 permite encaixar tudo: 4 campos simples (1 col cada) + 2 datas duplas (2 cols cada) */}
            <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
               
               {/* 1. Busca Texto (1 Coluna) */}
               <div className="relative col-span-2 md:col-span-2 xl:col-span-1">
                 <Search className="absolute left-3 top-2.5 text-slate-500 dark:text-slate-400 h-4 w-4" />
                 <input 
                   type="text" 
                   placeholder="Buscar..." 
                   className="w-full pl-9 p-2 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-md text-sm outline-none focus:ring-2 focus:ring-blue-500 text-slate-900 dark:text-white"
                   value={searchTerm}
                   onChange={(e) => setSearchTerm(e.target.value)}
                 />
               </div>

               {/* 2. Filtro Motorista (1 Coluna) */}
               <div className="col-span-1">
                 <select 
                   className="w-full p-2 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-md text-sm outline-none focus:ring-2 focus:ring-blue-500 text-slate-700 dark:text-slate-200"
                   value={filterDriver}
                   onChange={(e) => setFilterDriver(e.target.value)}
                 >
                   <option value="">Motorista</option>
                   {drivers.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                 </select>
               </div>

               {/* 3. Filtro Veículo (1 Coluna) */}
               <div className="col-span-1">
                 <select 
                   className="w-full p-2 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-md text-sm outline-none focus:ring-2 focus:ring-blue-500 text-slate-700 dark:text-slate-200"
                   value={filterVehicle}
                   onChange={(e) => setFilterVehicle(e.target.value)}
                 >
                   <option value="">Veículo</option>
                   {vehicles.map(v => <option key={v.id} value={v.id}>{v.plate}</option>)}
                 </select>
               </div>

               {/* 4. Filtro Status (1 Coluna) */}
               <div className="col-span-1">
                 <select 
                   className="w-full p-2 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-md text-sm outline-none focus:ring-2 focus:ring-blue-500 text-slate-700 dark:text-slate-200"
                   value={filterStatus}
                   onChange={(e) => setFilterStatus(e.target.value)}
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

               {/* 5. Filtro Data EMISSÃO (2 Colunas - Cinza) */}
               {/* Visualmente agrupado com borda e fundo cinza para destacar */}
               <div className="flex gap-2 items-center col-span-2 md:col-span-2 xl:col-span-2 bg-slate-100 dark:bg-slate-800/60 p-1 rounded-lg border border-slate-200 dark:border-slate-700">
                 <div className="relative flex-1 min-w-0">
                    <span className="absolute -top-2 left-2 bg-slate-100 dark:bg-slate-800 px-1 text-[10px] text-slate-500 dark:text-slate-400 font-bold z-10 uppercase">Emissão De</span>
                    <input 
                      type="date"
                      className="w-full p-1.5 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-md text-sm outline-none focus:ring-2 focus:ring-blue-500 text-slate-700 dark:text-slate-200"
                      value={filterStartDate}
                      onChange={(e) => setFilterStartDate(e.target.value)}
                    />
                 </div>
                 
                 <div className="relative flex-1 min-w-0">
                    <span className="absolute -top-2 left-2 bg-slate-100 dark:bg-slate-800 px-1 text-[10px] text-slate-500 dark:text-slate-400 font-bold z-10 uppercase">Até</span>
                    <input 
                      type="date"
                      className="w-full p-1.5 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-md text-sm outline-none focus:ring-2 focus:ring-blue-500 text-slate-700 dark:text-slate-200"
                      value={filterEndDate}
                      onChange={(e) => setFilterEndDate(e.target.value)}
                    />
                 </div>
               </div>

               {/* 6. Filtro Data ENTREGA/REALIZAÇÃO (2 Colunas - Azul) */}
               {/* Visualmente agrupado com borda e fundo azulado para diferenciar da emissão */}
               <div className="flex gap-2 items-center col-span-2 md:col-span-2 xl:col-span-2 bg-blue-50 dark:bg-blue-900/20 p-1 rounded-lg border border-blue-100 dark:border-blue-800">
                 <div className="relative flex-1 min-w-0">
                    <span className="absolute -top-2 left-2 bg-blue-50 dark:bg-slate-800 px-1 text-[10px] text-blue-500 dark:text-blue-300 font-bold z-10 uppercase">Entrega De</span>
                    <input 
                      type="date"
                      className="w-full p-1.5 bg-white dark:bg-slate-800 border border-blue-200 dark:border-blue-700 rounded-md text-sm outline-none focus:ring-2 focus:ring-blue-500 text-slate-700 dark:text-slate-200"
                      value={filterDeliveryStartDate}
                      onChange={(e) => setFilterDeliveryStartDate(e.target.value)}
                    />
                 </div>
                 
                 <div className="relative flex-1 min-w-0">
                    <span className="absolute -top-2 left-2 bg-blue-50 dark:bg-slate-800 px-1 text-[10px] text-blue-500 dark:text-blue-300 font-bold z-10 uppercase">Até</span>
                    <input 
                      type="date"
                      className="w-full p-1.5 bg-white dark:bg-slate-800 border border-blue-200 dark:border-blue-700 rounded-md text-sm outline-none focus:ring-2 focus:ring-blue-500 text-slate-700 dark:text-slate-200"
                      value={filterDeliveryEndDate}
                      onChange={(e) => setFilterDeliveryEndDate(e.target.value)}
                    />
                 </div>
               </div>

            </div>
            
           {/* Botão limpar filtros */}
            {(searchTerm || filterDriver || filterVehicle || filterStatus || filterStartDate || filterEndDate) && (
                <button 
                  onClick={() => {
                      setSearchTerm('');
                      setFilterDriver('');
                      setFilterVehicle('');
                      setFilterStatus('');
                      setFilterStartDate(''); // Zera Início
                      setFilterEndDate('');   // Zera Fim
                      setFilterDeliveryStartDate('');
                      setFilterDeliveryEndDate('');
                  }}
                  className="text-xs text-red-500 hover:underline flex items-center gap-1"
                >
                    <X size={12} /> Limpar todos os filtros
                </button>
            )}
          </div>
          
          {/* TABELA COM SCROLL INTERNO (Resolve o Ponto 2) */}
          <div className="flex-1 min-w-0 overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm text-left text-slate-600 dark:text-slate-400">
              {/* CABEÇALHO DA TABELA COM CONTRASTE (Fundo Slate-700 / Texto Branco) */}
              <thead className="text-xs text-white uppercase bg-slate-700 dark:bg-slate-900 sticky top-0 z-10 shadow-md">
                <tr>
                  {/* Célula do Checkbox */}
                  <th className="px-6 py-4 w-10 bg-slate-700 dark:bg-slate-900 rounded-tl-lg"> {/* rounded-tl-lg arredonda o canto esquerdo */}
                    <button onClick={toggleSelectAll} className="flex items-center justify-center text-slate-300 hover:text-white transition-colors">
                      {selectedInvoiceIds.size > 0 && selectedInvoiceIds.size >= filteredInvoices.length && filteredInvoices.length > 0 ? <CheckSquare size={18} className="text-blue-400"/> : <Square size={18}/>}
                    </button>
                  </th>
                  
                  {/* Outras Colunas (Adicionei bg-slate-700 em todas para o sticky funcionar bem) */}
                 {/* CLICÁVEL: Nota/Data (Ordena pelo numero) */}
    <th className="px-6 py-4 cursor-pointer hover:bg-slate-600 select-none" onClick={(e) => requestSort('number', e as React.MouseEvent)}>
      <div className="flex items-center gap-1">
        Nota / Data
        {(() => { const s = sortConfig.find(s => s.key === 'number'); return s ? <>{s.direction === 'asc' ? <ArrowUp size={12}/> : <ArrowDown size={12}/>}{sortConfig.length > 1 && <span className="text-[10px] text-blue-300">{sortConfig.indexOf(s)+1}</span>}</> : null; })()}
      </div>
    </th>

    {/* CLICÁVEL: Cliente */}
    <th className="px-6 py-4 cursor-pointer hover:bg-slate-600 select-none" onClick={(e) => requestSort('customer_name', e)}>
      <div className="flex items-center gap-1">
        Cliente
        {(() => { const s = sortConfig.find(s => s.key === 'customer_name'); return s ? <>{s.direction === 'asc' ? <ArrowUp size={12}/> : <ArrowDown size={12}/>}{sortConfig.length > 1 && <span className="text-[10px] text-blue-300">{sortConfig.indexOf(s)+1}</span>}</> : null; })()}
      </div>
    </th>

    {/* CLICÁVEL: Status */}
    <th className="px-6 py-4 cursor-pointer hover:bg-slate-600 select-none" onClick={(e) => requestSort('status', e)}>
      <div className="flex items-center gap-1">
        Status
        {(() => { const s = sortConfig.find(s => s.key === 'status'); return s ? <>{s.direction === 'asc' ? <ArrowUp size={12}/> : <ArrowDown size={12}/>}{sortConfig.length > 1 && <span className="text-[10px] text-blue-300">{sortConfig.indexOf(s)+1}</span>}</> : null; })()}
      </div>
    </th>

    {/* CLICÁVEL: Valor */}
    <th className="px-6 py-4 cursor-pointer hover:bg-slate-600 select-none" onClick={(e) => requestSort('value', e)}>
      <div className="flex items-center gap-1">
        Valor
        {(() => { const s = sortConfig.find(s => s.key === 'value'); return s ? <>{s.direction === 'asc' ? <ArrowUp size={12}/> : <ArrowDown size={12}/>}{sortConfig.length > 1 && <span className="text-[10px] text-blue-300">{sortConfig.indexOf(s)+1}</span>}</> : null; })()}
      </div>
    </th>

    {/* CLICÁVEL: Realização */}
    <th className="px-6 py-4 cursor-pointer hover:bg-slate-600 select-none" onClick={(e) => requestSort('delivered_at', e)}>
      <div className="flex items-center gap-1">
        Realização
        {(() => { const s = sortConfig.find(s => s.key === 'delivered_at'); return s ? <>{s.direction === 'asc' ? <ArrowUp size={12}/> : <ArrowDown size={12}/>}{sortConfig.length > 1 && <span className="text-[10px] text-blue-300">{sortConfig.indexOf(s)+1}</span>}</> : null; })()}
      </div>
    </th>

    {/* CLICÁVEL: Motorista */}
    <th className="px-6 py-4 cursor-pointer hover:bg-slate-600 select-none" onClick={(e) => requestSort('vehicle_id', e)}>
      <div className="flex items-center gap-1">
        Motorista
        {(() => { const s = sortConfig.find(s => s.key === 'vehicle_id'); return s ? <>{s.direction === 'asc' ? <ArrowUp size={12}/> : <ArrowDown size={12}/>}{sortConfig.length > 1 && <span className="text-[10px] text-blue-300">{sortConfig.indexOf(s)+1}</span>}</> : null; })()}
      </div>
    </th>

    {/* CLICÁVEL: Veículo */}
    <th className="px-6 py-4 cursor-pointer hover:bg-slate-600 select-none" onClick={(e) => requestSort('driver_id', e)}>
      <div className="flex items-center gap-1">
        Veículo
        {(() => { const s = sortConfig.find(s => s.key === 'driver_id'); return s ? <>{s.direction === 'asc' ? <ArrowUp size={12}/> : <ArrowDown size={12}/>}{sortConfig.length > 1 && <span className="text-[10px] text-blue-300">{sortConfig.indexOf(s)+1}</span>}</> : null; })()}
      </div>
    </th>
                  {/* Célula de Ações (Canto direito arredondado) */}
                  <th className="px-6 py-4 text-center bg-slate-700 dark:bg-slate-900 rounded-tr-lg font-bold tracking-wider">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                {sortedInvoices.length === 0 ? (
                   <tr>
                     <td colSpan={7} className="px-6 py-12 text-center text-slate-500 dark:text-slate-400 flex flex-col items-center justify-center gap-2 w-full">
                       <Search size={32} className="opacity-20 mb-2"/>
                       <p>Nenhuma nota encontrada com os filtros atuais.</p>
                     </td>
                   </tr>
                ) : (
                  paginatedInvoices.map((inv) => (
                    <tr key={inv.id} className={`bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors ${selectedInvoiceIds.has(inv.id) ? 'bg-blue-50 dark:bg-blue-900/20' : ''}`}>
                      <td className="px-6 py-4">
                        <button onClick={() => toggleSelectOne(inv.id)} className="flex items-center justify-center text-slate-500 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400">
                          {selectedInvoiceIds.has(inv.id) ? <CheckSquare size={18} className="text-blue-600 dark:text-blue-400"/> : <Square size={18}/>}
                        </button>
                      </td>
                 <td className="px-6 py-4">
    <div className="flex flex-col justify-center">
        <div className="flex items-center gap-2">
            {/* Número da Nota */}
            <div className="font-medium text-slate-900 dark:text-white">
                {inv.number}-{inv.series}
            </div>

            {/* DEBUG VISUAL (Temporário: Se aparecer 'TESTE' aqui, o dado chegou!) */}
            {/* <span className="text-[8px] text-red-500">{inv.last_failure_reason}</span> */}

            {/* ✨ BADGE DE TENTATIVAS ✨ */}
            {/* Mostra se tiver tentativas > 1 OU se tiver motivo gravado (mesmo na 1ª tentativa),
                exceto quando a baixa foi feita manualmente pelo gestor. */}
            {(
              (
                (inv.delivery_attempts && inv.delivery_attempts > 1) ||
                inv.last_failure_reason
              ) &&
              !(inv.last_failure_reason && inv.last_failure_reason.includes('BAIXA MANUAL (GESTOR)'))
            ) && (
                <div 
                  className="group relative inline-block"
                  title={inv.last_failure_reason || "Motivo não registrado"}
                >
                    
                    {/* A Pílula Visual */}
                    <span className={`flex items-center gap-1 border text-[9px] uppercase tracking-wider font-bold px-2 py-0.5 rounded-full cursor-help transition-colors
                        ${inv.status === 'FAILED' 
                            ? 'bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-300 border-red-200 dark:border-red-700' 
                            : 'bg-purple-50 dark:bg-purple-900/30 text-purple-600 dark:text-purple-300 border-purple-200 dark:border-purple-700'}
                    `}>
                        <RefreshCw size={10} strokeWidth={3} className={inv.status === 'FAILED' ? 'text-red-500' : 'text-purple-500'} />
                        {/* Se for a 1ª vez mas já falhou, mostra "Devolvida". Senão mostra a tentativa */}
                        {inv.delivery_attempts && inv.delivery_attempts > 1 ? `${inv.delivery_attempts}ª Vez` : 'Devolvida'}
                    </span>

                    {/* O Tooltip */}
                    <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 w-64 p-3 bg-slate-800 dark:bg-slate-100 text-white dark:text-slate-900 text-xs rounded-lg shadow-xl opacity-0 group-hover:opacity-100 transition-all duration-200 pointer-events-none z-50 transform translate-y-1 group-hover:translate-y-0">
                        <div className="absolute left-1/2 -translate-x-1/2 top-full w-2 h-2 bg-slate-800 dark:bg-slate-100 rotate-45"></div>
                        
                        <div className="flex items-start gap-2">
                            <AlertTriangle size={14} className="text-red-400 dark:text-red-600 shrink-0 mt-0.5" />
                            <div>
                                <strong className="block text-purple-300 dark:text-purple-600 mb-0.5">Motivo da Devolução:</strong>
                                <span className="opacity-90 leading-tight block italic">
                                    {inv.last_failure_reason ? `"${inv.last_failure_reason}"` : "Motivo não informado pelo motorista."}
                                </span>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>

        {/* Data de Emissão */}
        <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
            {new Date(inv.created_at).toLocaleDateString('pt-BR')}
        </div>
    </div>
</td>
                      <td className="px-6 py-4 max-w-[200px]">
                        <div className="font-medium text-slate-900 dark:text-white truncate" title={inv.customer_name}>{inv.customer_name}</div>
                        <div className="text-xs text-slate-500 dark:text-slate-400 truncate" title={inv.customer_address}>{inv.customer_address}</div>
                      </td>
                      <td className="px-6 py-4">
                        {getStatusBadge(inv)}
                      </td>

                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                          {inv.value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                        </span>
                        {inv.original_value && inv.original_value !== inv.value && (
                          <span className="block text-[10px] text-slate-500 dark:text-slate-400 line-through">
                            {inv.original_value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                          </span>
                        )}
                      </td>

                      {/* 👇👇 NOVA CÉLULA DE DATA DE ENTREGA 👇👇 */}
                      <td className="px-6 py-4">
                        {inv.delivered_at ? (
                            <div className="flex flex-col">
                                {/* DATA */}
                                <span className="text-sm font-bold text-slate-700 dark:text-slate-300">
                                    {new Date(inv.delivered_at).toLocaleDateString('pt-BR')}
                                </span>
                                {/* HORA (Menorzinha) */}
                                <span className="text-[10px] text-slate-500 dark:text-slate-400 font-mono">
                                    {new Date(inv.delivered_at).toLocaleTimeString('pt-BR', {hour: '2-digit', minute:'2-digit'})}
                                </span>
                            </div>
                        ) : (
                            // Se não tiver data (Pendente ou Em Rota)
                            <span className="text-xs text-slate-500 dark:text-slate-400 opacity-50">--</span>
                        )}
                      </td>
                      {/* 👆👆👆👆👆👆👆👆👆👆👆👆👆👆👆👆👆👆👆👆 */}
                      
                      {/* Driver Selection */}
                      <td className="px-6 py-4">
                        <select 
                          className="bg-slate-50 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 text-slate-900 dark:text-white text-xs rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-full p-2"
                          value={inv.driver_id || ""}
                          onChange={(e) => handleLogisticsUpdate(inv.id, 'driver', e.target.value)}
                          disabled={inv.status === DeliveryStatus.DELIVERED}
                        >
                          <option value="">{drivers.length === 0 ? 'Sem motoristas' : 'Selecione...'}</option>
                          {drivers.map(d => (
                            <option key={d.id} value={d.id}>{d.name}</option>
                          ))}
                        </select>
                      </td>

                      {/* Vehicle Selection */}
                      <td className="px-6 py-4">
                        <select 
                          className="bg-slate-50 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 text-slate-900 dark:text-white text-xs rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-full p-2"
                          value={inv.vehicle_id || ""}
                          onChange={(e) => handleLogisticsUpdate(inv.id, 'vehicle', e.target.value)}
                          disabled={inv.status === DeliveryStatus.DELIVERED}
                        >
                          <option value="">{vehicles.length === 0 ? 'Sem veículos' : 'Selecione...'}</option>
                          {vehicles.map(v => (
                            <option key={v.id} value={v.id}>{v.plate} - {v.model}</option>
                          ))}
                        </select>
                      </td>

                      <td className="px-6 py-4 text-right">
                        <div className="relative inline-block text-left">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setOpenActionsRow((prev) => (prev === inv.id ? null : inv.id));
                            }}
                            className="inline-flex items-center justify-center w-9 h-9 rounded-full text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                            title="Mais ações"
                          >
                            <MoreVertical size={18} />
                          </button>

                          {openActionsRow === inv.id && (
                            <div className="origin-top-right absolute right-0 mt-2 w-56 rounded-lg shadow-lg bg-white dark:bg-slate-800 ring-1 ring-black/5 dark:ring-slate-700 z-30">
                              <div className="py-1 text-sm text-slate-700 dark:text-slate-200">
                                {/* Ações de Devolução */}
                                {inv.status === 'FAILED' && !inv.return_final_status && (
                                  <>
                                    <button
                                      onClick={() => handleRedeliver(inv)}
                                      className="w-full flex items-center gap-2 px-3 py-2 hover:bg-purple-50 dark:hover:bg-purple-900/40 text-purple-600 dark:text-purple-300"
                                    >
                                      <RefreshCw size={16} />
                                      <span>Disponibilizar para Reentrega</span>
                                    </button>
                                    <button
                                      onClick={() => openFinalizeModal(inv, 'CONCLUDED')}
                                      className="w-full flex items-center gap-2 px-3 py-2 hover:bg-emerald-50 dark:hover:bg-emerald-900/40 text-emerald-600 dark:text-emerald-300"
                                    >
                                      <CheckCircle size={16} />
                                      <span>Concluir Devolução</span>
                                    </button>
                                    <button
                                      onClick={() => openFinalizeModal(inv, 'CANCELLED')}
                                      className="w-full flex items-center gap-2 px-3 py-2 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300"
                                    >
                                      <XCircle size={16} />
                                      <span>Cancelar Devolução</span>
                                    </button>
                                  </>
                                )}

                                {/* Reentrega / Financeiro */}
                                {inv.status === 'PENDING' && (inv.delivery_attempts || 0) > 0 && (
                                  <button
                                    onClick={() => handleEditValue(inv)}
                                    className="w-full flex items-center gap-2 px-3 py-2 hover:bg-green-50 dark:hover:bg-green-900/40 text-green-600 dark:text-green-300"
                                  >
                                    <DollarSign size={16} />
                                    <span>Editar Valor de Reentrega</span>
                                  </button>
                                )}

                                {/* Baixa manual pelo gestor */}
                                {(inv.status === 'PENDING' || inv.status === 'IN_PROGRESS' || inv.status === 'ISSUE') && (
                                  <>
                                    <button
                                      onClick={() => openManualSettleModal(inv, 'DELIVERED')}
                                      className="w-full flex items-center gap-2 px-3 py-2 hover:bg-emerald-50 dark:hover:bg-emerald-900/40 text-emerald-600 dark:text-emerald-300"
                                    >
                                      <CheckCircle size={16} />
                                      <span>Baixa manual como Entregue</span>
                                    </button>
                                    <button
                                      onClick={() => openManualSettleModal(inv, 'FAILED')}
                                      className="w-full flex items-center gap-2 px-3 py-2 hover:bg-red-50 dark:hover:bg-red-900/40 text-red-600 dark:text-red-300"
                                    >
                                      <AlertTriangle size={16} />
                                      <span>Baixa manual como Devolvida</span>
                                    </button>
                                  </>
                                )}

                                {/* Comprovante / Pendência */}
                                {(inv.status === 'DELIVERED' || inv.status === 'FAILED' || inv.status === 'ISSUE') && (
                                  <button
                                    onClick={() => handleViewProof(inv)}
                                    className="w-full flex items-center gap-2 px-3 py-2 hover:bg-blue-50 dark:hover:bg-blue-900/40 text-blue-600 dark:text-blue-300"
                                  >
                                    <Eye size={16} />
                                    <span>Ver Detalhes / Comprovante</span>
                                  </button>
                                )}

                                {/* PDF da Nota */}
                                {inv.pdf_url && (
                                  <button
                                    onClick={() => window.open(inv.pdf_url, '_blank')}
                                    className="w-full flex items-center gap-2 px-3 py-2 hover:bg-red-50 dark:hover:bg-red-900/40 text-red-600 dark:text-red-300"
                                  >
                                    <FileText size={16} />
                                    <span>Visualizar PDF da Nota</span>
                                  </button>
                                )}

                                {/* Rastrear no SSW — somente para TRANSPORTADORA */}
                                {drivers.find(d => d.id === inv.driver_id)?.name?.toUpperCase() === 'TRANSPORTADORA' && (
                                  <button
                                    onClick={() => { openSSWTracking(inv); setOpenActionsRow(null); }}
                                    className="w-full flex items-center gap-2 px-3 py-2 hover:bg-sky-50 dark:hover:bg-sky-900/40 text-sky-600 dark:text-sky-300"
                                  >
                                    <ExternalLink size={16} />
                                    <span>Rastrear no SSW</span>
                                  </button>
                                )}

                                {/* Excluir */}
                                <button
                                  onClick={() => handleDeleteInvoice(inv.id)}
                                  className="w-full flex items-center gap-2 px-3 py-2 hover:bg-red-50 dark:hover:bg-red-900/40 text-red-600 dark:text-red-300 border-t border-slate-100 dark:border-slate-700 mt-1"
                                >
                                  <Trash2 size={16} />
                                  <span>Excluir Nota</span>
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Paginação — exibição fatiada; filtros e busca atuam sobre todas as notas */}
          {sortedInvoices.length > 0 && (
            <div className="px-4 py-3 border-t border-slate-100 dark:border-slate-700 flex flex-wrap items-center justify-between gap-3 bg-white dark:bg-slate-800 rounded-b-lg">
              <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400 text-xs">
                <span>
                  {Math.min((tablePage - 1) * tablePageSize + 1, sortedInvoices.length)}–{Math.min(tablePage * tablePageSize, sortedInvoices.length)} de {sortedInvoices.length}
                </span>
                <select
                  value={tablePageSize}
                  onChange={e => setTablePageSize(Number(e.target.value))}
                  className="ml-2 px-2 py-1 rounded border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-xs outline-none focus:ring-1 focus:ring-blue-400"
                >
                  <option value={25}>25 / página</option>
                  <option value={50}>50 / página</option>
                  <option value={100}>100 / página</option>
                </select>
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => setTablePage(1)} disabled={tablePage === 1}
                  className="px-2 py-1 rounded text-xs text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed">«</button>
                <button onClick={() => setTablePage(p => Math.max(1, p - 1))} disabled={tablePage === 1}
                  className="p-1 rounded text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed">
                  <ChevronLeft size={16} /></button>
                {Array.from({ length: totalTablePages }, (_, i) => i + 1)
                  .filter(p => p === 1 || p === totalTablePages || Math.abs(p - tablePage) <= 1)
                  .reduce<(number | '...')[]>((acc, p, i, arr) => {
                    if (i > 0 && typeof arr[i - 1] === 'number' && (p as number) - (arr[i - 1] as number) > 1) acc.push('...');
                    acc.push(p); return acc;
                  }, [])
                  .map((item, i) => item === '...'
                    ? <span key={`e${i}`} className="px-1 text-slate-500 dark:text-slate-400">…</span>
                    : <button key={item} onClick={() => setTablePage(item as number)}
                        className={`min-w-[28px] px-2 py-1 rounded text-xs font-medium ${tablePage === item ? 'bg-blue-600 text-white' : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'}`}
                      >{item}</button>
                  )}
                <button onClick={() => setTablePage(p => Math.min(totalTablePages, p + 1))} disabled={tablePage === totalTablePages}
                  className="p-1 rounded text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed">
                  <ChevronRight size={16} /></button>
                <button onClick={() => setTablePage(totalTablePages)} disabled={tablePage === totalTablePages}
                  className="px-2 py-1 rounded text-xs text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed">»</button>
              </div>
            </div>
          )}
        </div>

        </>)} {/* fim do bloco activeSidebarSection === 'main' */}

      </main>
      </div>

  {processingKey && (
        <div className="fixed inset-0 z-[60] flex flex-col items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-800 p-6 rounded-lg shadow-xl flex flex-col items-center">
             <Loader2 className="h-10 w-10 text-blue-600 animate-spin mb-4" />
             <h3 className="text-lg font-bold dark:text-white">Consultando SEFAZ...</h3>
             <p className="text-sm text-slate-500 dark:text-slate-400">Buscando dados da chave...</p>
          </div>
        </div>
      )}

      {/* Modal Rastreamento SSW */}
      {sswModal.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]">
            <div className="p-4 bg-sky-600 dark:bg-sky-700 text-white flex justify-between items-center shrink-0">
              <div>
                <h3 className="font-bold flex items-center gap-2 text-lg"><ExternalLink size={20} /> Rastreamento SSW</h3>
                {sswModal.invoice && <p className="text-sky-100 text-sm mt-0.5">NF {sswModal.invoice.number} • {sswModal.invoice.customer_name}</p>}
              </div>
              <button onClick={() => setSswModal(prev => ({ ...prev, open: false }))} className="hover:bg-white/20 rounded-full p-1.5 transition-colors"><X size={20} /></button>
            </div>

            <div className="overflow-y-auto p-5 flex-1">
              {sswModal.loading && (
                <div className="flex flex-col items-center justify-center py-12 gap-3">
                  <Loader2 className="animate-spin text-sky-500" size={36} />
                  <p className="text-slate-500 dark:text-slate-400 text-sm">Consultando SSW...</p>
                </div>
              )}

              {!sswModal.loading && sswModal.error === 'CORS_BLOCKED' && (
                <div className="flex flex-col items-center gap-4 py-8 text-center">
                  <div className="bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-700 rounded-xl p-5 w-full">
                    <AlertTriangle className="text-amber-500 mx-auto mb-2" size={32} />
                    <p className="font-semibold text-amber-800 dark:text-amber-200">API bloqueada pelo navegador (CORS)</p>
                    <p className="text-amber-700 dark:text-amber-300 text-sm mt-1">Clique abaixo para abrir o rastreamento no site SSW.</p>
                  </div>
                  <button onClick={() => sswModal.invoice && trackOnSSW(sswModal.invoice.number)} className="flex items-center gap-2 px-5 py-2.5 bg-sky-600 hover:bg-sky-700 text-white rounded-lg font-medium transition-colors">
                    <ExternalLink size={16} /> Abrir no site SSW
                  </button>
                </div>
              )}

              {!sswModal.loading && sswModal.error && sswModal.error !== 'CORS_BLOCKED' && (
                <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-700 rounded-xl p-5 text-center">
                  <AlertOctagon className="text-red-500 mx-auto mb-2" size={28} />
                  <p className="font-semibold text-red-700 dark:text-red-300">Erro ao consultar SSW</p>
                  <p className="text-red-600 dark:text-red-400 text-xs mt-1 font-mono">{sswModal.error}</p>
                  <button onClick={() => sswModal.invoice && trackOnSSW(sswModal.invoice.number)} className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-sky-600 hover:bg-sky-700 text-white rounded-lg text-sm mx-auto transition-colors">
                    <ExternalLink size={14} /> Abrir no site SSW
                  </button>
                </div>
              )}

              {!sswModal.loading && !sswModal.error && sswModal.events.length === 0 && sswModal.raw !== null && (
                <div className="text-center py-10">
                  <Package className="mx-auto text-slate-300 dark:text-slate-600 mb-3" size={40} />
                  <p className="text-slate-500 dark:text-slate-400 font-medium">Nenhuma ocorrência encontrada</p>
                  <p className="text-slate-400 dark:text-slate-500 text-sm mt-1">A SSW ainda não registrou eventos para esta NF.</p>
                  <button onClick={() => sswModal.invoice && trackOnSSW(sswModal.invoice.number)} className="mt-4 inline-flex items-center gap-2 px-4 py-2 border border-sky-500 text-sky-600 dark:text-sky-400 rounded-lg text-sm hover:bg-sky-50 dark:hover:bg-sky-900/30 transition-colors">
                    <ExternalLink size={14} /> Ver no site SSW
                  </button>
                </div>
              )}

              {!sswModal.loading && !sswModal.error && sswModal.events.length > 0 && (
                <div>
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

            {!sswModal.loading && !sswModal.error && sswModal.events.length > 0 && (
              <div className="p-4 border-t border-slate-200 dark:border-slate-700 shrink-0 flex justify-between items-center">
                <button onClick={() => sswModal.invoice && openSSWTracking(sswModal.invoice)} className="flex items-center gap-1.5 text-sm text-slate-500 dark:text-slate-400 hover:text-sky-600 dark:hover:text-sky-400 transition-colors">
                  <RefreshCw size={14} /> Atualizar
                </button>
                <button onClick={() => sswModal.invoice && trackOnSSW(sswModal.invoice.number)} className="flex items-center gap-1.5 text-sm text-sky-600 dark:text-sky-400 hover:underline">
                  <ExternalLink size={14} /> Abrir no SSW
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Barcode Scanner Modal */}
      {showScanner && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-2xl overflow-hidden relative">
            <div className="p-4 bg-slate-900 dark:bg-black text-white flex justify-between items-center">
              <h3 className="font-bold flex items-center gap-2"><ScanBarcode size={20}/> Leitura DANFE</h3>
              <button onClick={() => setShowScanner(false)} className="hover:bg-slate-700 rounded-full p-1"><X size={20}/></button>
            </div>
            <div className="p-4"><div id="reader" className="w-full"></div></div>
          </div>
        </div>
      )}

     {/* Proof Viewer Modal (finalized alternative + default) */}
      {/* Modal específico para devoluções encerradas (Concluded / Cancelled) */}
      {viewingProof && viewingProof.invoice.return_final_status && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-in fade-in duration-200">
           <div id="printable-proof" className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-3xl overflow-hidden max-h-[90vh] flex flex-col relative">
              <div className={`p-5 text-white flex justify-between items-center ${viewingProof.invoice.return_final_status === 'CONCLUDED' ? 'bg-emerald-600 dark:bg-emerald-700' : 'bg-slate-700 dark:bg-slate-900'}`}>
                  <div>
                     <h3 className="font-bold flex items-center gap-2 text-lg">
                       {viewingProof.invoice.return_final_status === 'CONCLUDED' ? <CheckCircle size={22}/> : <XCircle size={22} />}
                       Devolução Encerrada
                     </h3>
                     <p className="text-white/80 text-sm mt-1">
                        NF-e {viewingProof.invoice.number} • R$ {viewingProof.invoice.value.toLocaleString('pt-BR', {minimumFractionDigits: 2})}
                     </p>
                     <p className="text-white/80 text-xs mt-1">
                        {viewingProof.invoice.return_final_status === 'CONCLUDED' ? 'Concluída' : 'Cancelada'} em {viewingProof.invoice.return_finalized_at ? new Date(viewingProof.invoice.return_finalized_at).toLocaleString('pt-BR') : 'N/A'}
                     </p>
                  </div>
                  <button onClick={() => setViewingProof(null)} className="hover:bg-white/20 rounded-full p-2 transition-colors no-print">
                    <X size={24} />
                  </button>
              </div>

              <div className="overflow-y-auto p-6 space-y-4">
                <div className="bg-slate-50 dark:bg-slate-900 p-4 rounded border border-slate-200 dark:border-slate-700 space-y-3">
                  <h4 className="font-bold text-slate-700 dark:text-slate-200 mb-2">Resumo da Finalização</h4>
                  <div>
                    <p className="text-sm text-slate-600 dark:text-slate-300"><strong>Motivo registrado pelo motorista:</strong></p>
                    <pre className="whitespace-pre-wrap text-sm text-slate-800 dark:text-slate-200 bg-transparent mt-2">{formatProofReason(viewingProof.proof) || viewingProof.invoice.last_failure_reason || '—'}</pre>
                  </div>
                  <div>
                    <p className="text-sm text-slate-600 dark:text-slate-300"><strong>Observação do gestor:</strong></p>
                    <pre className="whitespace-pre-wrap text-sm text-slate-800 dark:text-slate-200 bg-transparent mt-2">{viewingProof.invoice.return_final_note || '—'}</pre>
                  </div>
                </div>

                {/* Mantém informações de comprovante, mas em leitura */}
                <div className="grid md:grid-cols-2 gap-6">
                  <div>
                    <h4 className="font-bold text-slate-700 dark:text-slate-300 uppercase text-sm border-b dark:border-slate-700 pb-1">Dados do Recebedor</h4>
                    <div className="mt-3 text-sm">
                      <div><strong>Nome:</strong> {viewingProof.proof.receiver_name || 'N/A'}</div>
                      <div><strong>Documento:</strong> {viewingProof.proof.receiver_doc || 'N/A'}</div>
                    </div>
                  </div>
                  <div>
                    <h4 className="font-bold text-slate-700 dark:text-slate-300 uppercase text-sm border-b dark:border-slate-700 pb-1">Dados da Operação</h4>
                    <div className="mt-3 text-sm">
                      <div><strong>Data/Hora:</strong> {viewingProof.proof.delivered_at ? new Date(viewingProof.proof.delivered_at).toLocaleString('pt-BR') : 'N/A'}</div>
                      <div><strong>GPS:</strong> {viewingProof.proof.geo_lat ? `${viewingProof.proof.geo_lat}, ${viewingProof.proof.geo_long}` : 'Não capturado'}</div>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-4 border-t dark:border-slate-700">
                  <div>
                    <h4 className="font-bold text-slate-700 dark:text-slate-300 uppercase text-sm mb-3">Assinatura</h4>
                    <div className="border rounded-lg bg-white p-2 h-40 flex items-center justify-center">
                      {viewingProof.proof.signature_data ? <img src={viewingProof.proof.signature_data} alt="Assinatura" className="max-h-full max-w-full" /> : <span className="text-slate-500 dark:text-slate-400 italic">Não disponível</span>}
                    </div>
                  </div>
                  <div>
                    <h4 className="font-bold text-slate-700 dark:text-slate-300 uppercase text-sm mb-3">Foto / Evidência</h4>
                    <div className="border rounded-lg bg-slate-50 h-40 flex items-center justify-center">
                      {viewingProof.proof.photo_url ? <img src={viewingProof.proof.photo_url} alt="Evidência" className="w-full h-full object-cover" /> : <span className="text-slate-500 dark:text-slate-400 italic">Não disponível</span>}
                    </div>
                  </div>
                  <div>
                    <h4 className="font-bold text-slate-700 dark:text-slate-300 uppercase text-sm mb-3">Canhoto</h4>
                    <div className="border rounded-lg bg-slate-50 h-40 flex items-center justify-center">
                      {viewingProof.proof.photo_stub_url ? <img src={viewingProof.proof.photo_stub_url} alt="Canhoto" className="w-full h-full object-cover" /> : <span className="text-slate-500 dark:text-slate-400 italic">Não disponível</span>}
                    </div>
                  </div>
                </div>
              </div>

              <div className="bg-slate-50 dark:bg-slate-900 p-4 border-t dark:border-slate-700 flex justify-end gap-3 no-print">
                <button 
                    onClick={handlePrintProof}
                    className="flex items-center gap-2 px-6 py-2 bg-slate-800 dark:bg-white text-white dark:text-slate-900 rounded-lg hover:bg-slate-700 transition-colors font-bold shadow-lg"
                >
                    <Printer size={18} /> Imprimir / PDF
                </button>
                <button onClick={() => setViewingProof(null)} className="px-6 py-2 bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-lg hover:brightness-95 font-medium">
                    Fechar
                </button>
              </div>
           </div>
        </div>
      )}

      {/* Proof Viewer Modal */}
      {viewingProof && !viewingProof.invoice.return_final_status && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-in fade-in duration-200">
           {/* ADICIONADO ID: printable-proof */}
           <div id="printable-proof" className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-3xl overflow-hidden max-h-[90vh] flex flex-col relative">
              
              {/* CABEÇALHO SÓ PARA IMPRESSÃO (Logotipo no Papel) */}
              <div className="hidden print:block p-8 border-b border-slate-300 mb-4">
                 <h1 className="text-2xl font-bold text-slate-900">EntregaCerta | Comprovante Digital</h1>
                 <p className="text-sm text-slate-500">Documento gerado eletronicamente em {new Date().toLocaleString()}</p>
              </div>

             {/* Cabeçalho Visual da Tela (Versão 2.0 - Com Pendência) */}
              <div className={`p-5 text-white flex justify-between items-center ${
                  viewingProof.invoice.status === 'ISSUE' ? 'bg-orange-600 dark:bg-orange-700' :
                  isReturnProof(viewingProof.proof) ? 'bg-red-600 dark:bg-red-700' :
                  'bg-green-600 dark:bg-green-700'
              }`}>
                  <div>
                     <h3 className="font-bold flex items-center gap-2 text-lg">
                       {/* Ícone muda se for Pendência */}
                       {viewingProof.invoice.status === 'ISSUE' ? <AlertOctagon size={22}/> : <FileText size={22} />}

                       {/* Texto muda conforme a situação */}
                       {viewingProof.invoice.status === 'ISSUE' ? 'Pendência Registrada' :
                        isReturnProof(viewingProof.proof) ? 'Devolução / Falha' : 'Comprovante de Entrega'}
                     </h3>
                     
                     <p className="text-white/80 text-sm mt-1">
                        NF-e {viewingProof.invoice.number} • R$ {viewingProof.invoice.value.toLocaleString('pt-BR', {minimumFractionDigits: 2})}
                     </p>
                  </div>

                  {/* Botão Fechar */}
                  <button onClick={() => setViewingProof(null)} className="hover:bg-white/20 rounded-full p-2 transition-colors no-print">
                    <X size={24} />
                  </button>
              </div>
              
              <div className="overflow-y-auto p-6 space-y-6">
                
                {/* Status Banner */}
                {/* STATUS BANNER (ATUALIZADO PARA SUPORTAR PARCIAL/TOTAL) */}
                {isReturnProof(viewingProof.proof) && (
                  <div className={`border p-4 rounded-lg flex items-start gap-3 ${viewingProof.proof.return_type === 'PARTIAL' ? 'bg-orange-50 dark:bg-orange-900/20 border-orange-200 dark:border-orange-800 text-orange-800 dark:text-orange-300' : 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-800 dark:text-red-300'}`}>
                    
                    <AlertTriangle className="shrink-0 mt-0.5" />
                    
                    <div className="w-full">
                      <div className="flex justify-between items-start">
                        <span className="font-bold text-lg block mb-1">
                            {viewingProof.proof.return_type === 'PARTIAL' ? 'Devolução Parcial' : 'Devolução Total'}
                        </span>
                        {/* Badge do Tipo */}
                        <span className={`text-[10px] font-bold px-2 py-1 rounded border uppercase ${viewingProof.proof.return_type === 'PARTIAL' ? 'bg-orange-100 border-orange-300 text-orange-700' : 'bg-red-100 border-red-300 text-red-700'}`}>
                            {viewingProof.proof.return_type || 'FALHA'}
                        </span>
                      </div>

                      <div className="mt-2 text-sm bg-white/50 dark:bg-black/20 p-3 rounded">
                        <strong className="block text-xs opacity-70 uppercase mb-1">Motivo:</strong>
                        {formatProofReason(viewingProof.proof)}
                      </div>

                      {/* MOSTRA ITENS SE FOR PARCIAL */}
                      {viewingProof.proof.return_type === 'PARTIAL' && viewingProof.proof.return_items && (
                          <div className="mt-2 text-sm bg-white/50 dark:bg-black/20 p-3 rounded border-l-4 border-orange-400">
                            <strong className="block text-xs opacity-70 uppercase mb-1">Itens Retornados:</strong>
                            <pre className="whitespace-pre-wrap font-sans">{viewingProof.proof.return_items}</pre>
                          </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Receiver Info */}
                <div className="grid md:grid-cols-2 gap-6">
                   <div className="space-y-4">
                      <h4 className="font-bold text-slate-700 dark:text-slate-300 uppercase text-sm border-b dark:border-slate-700 pb-1">Dados do Recebedor</h4>
                      <div className="space-y-3">
                         <div className="flex items-start gap-3">
                            <User className="text-slate-500 dark:text-slate-400 mt-1" size={18} />
                            <div>
                               <label className="block text-xs text-slate-500 dark:text-slate-400">Nome</label>
                               <span className="font-medium text-slate-800 dark:text-white text-lg">{viewingProof.proof.receiver_name}</span>
                            </div>
                         </div>
                         <div className="flex items-start gap-3">
                            <FileText className="text-slate-500 dark:text-slate-400 mt-1" size={18} />
                            <div>
                               <label className="block text-xs text-slate-500 dark:text-slate-400">Documento (RG/CPF)</label>
                               <span className="font-medium text-slate-800 dark:text-white">{viewingProof.proof.receiver_doc}</span>
                            </div>
                         </div>
                      </div>
                   </div>

                   <div className="space-y-4">
                      <h4 className="font-bold text-slate-700 dark:text-slate-300 uppercase text-sm border-b dark:border-slate-700 pb-1">Dados da Operação</h4>
                      <div className="space-y-3">
                         <div className="flex items-start gap-3">
                            <Clock className="text-slate-500 dark:text-slate-400 mt-1" size={18} />
                            <div>
                               <label className="block text-xs text-slate-500 dark:text-slate-400">Data/Hora</label>
                               <span className="font-medium text-slate-800 dark:text-white">
                                 {new Date(viewingProof.proof.delivered_at).toLocaleString('pt-BR')}
                               </span>
                            </div>
                         </div>
                         <div className="flex items-start gap-3">
                            <MapIcon className="text-slate-500 dark:text-slate-400 mt-1" size={18} />
                            <div>
                               <label className="block text-xs text-slate-500 dark:text-slate-400">Localização (GPS)</label>
                               <span className="font-medium text-slate-800 dark:text-white block">
                                 {viewingProof.proof.geo_lat ? `${viewingProof.proof.geo_lat}, ${viewingProof.proof.geo_long}` : 'Não capturado'}
                               </span>
                               {viewingProof.proof.geo_lat && (
                                   <a 
                                   href={`https://www.google.com/maps?q=${viewingProof.proof.geo_lat},${viewingProof.proof.geo_long}`} 
                                   target="_blank"
                                   rel="noreferrer"
                                   className="text-blue-600 dark:text-blue-400 hover:underline text-xs no-print"
                                 >
                                   Ver no Google Maps
                                 </a>
                               )}
                            </div>
                         </div>
                      </div>
                   </div>
                </div>

                {/* Evidence Images */}
                {/* ADICIONE A CLASSE 'print-evidence-grid' NA DIV ABAIXO */}
                {/* Evidence Images (ATUALIZADO PARA 3 COLUNAS) */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-4 border-t dark:border-slate-700">
                  
                  {/* COLUNA 1: Assinatura */}
                  <div>
                    <h4 className="font-bold text-slate-700 dark:text-slate-300 uppercase text-sm mb-3">Assinatura Digital</h4>
                    <div className="border border-slate-200 dark:border-slate-600 rounded-lg bg-white p-2 h-40 flex items-center justify-center shadow-sm relative group">
                      {viewingProof.proof.signature_data ? (
                        <img src={viewingProof.proof.signature_data} alt="Assinatura" className="max-h-full max-w-full" />
                      ) : (
                        <span className="text-slate-500 dark:text-slate-400 italic text-sm">Não assinada</span>
                      )}
                    </div>
                  </div>

                  {/* COLUNA 2: Foto do Local */}
                  <div>
                    <h4 className="font-bold text-slate-700 dark:text-slate-300 uppercase text-sm mb-3">Foto / Evidência</h4>
                   <div 
                      className="border border-slate-200 dark:border-slate-600 rounded-lg bg-slate-50 dark:bg-slate-900 h-40 flex items-center justify-center overflow-hidden relative shadow-sm cursor-pointer hover:ring-2 hover:ring-blue-400 transition-all"
                      onClick={() => viewingProof.proof.photo_url && setZoomedImage(viewingProof.proof.photo_url)}
                      title="Clique para ampliar"
                    >
                      {viewingProof.proof.photo_url ? (
                        <img src={viewingProof.proof.photo_url} alt="Evidência" className="w-full h-full object-cover" />
                      ) : (
                        <span className="text-slate-500 dark:text-slate-400 italic text-sm">Sem foto</span>
                      )}
                    </div>
                  </div>

                  {/* COLUNA 3: Canhoto Físico (NOVO BLOCO) 📸 */}
                  <div>
                    <h4 className="font-bold text-slate-700 dark:text-slate-300 uppercase text-sm mb-3">Canhoto Físico</h4>
                   <div 
                      className="border border-slate-200 dark:border-slate-600 rounded-lg bg-slate-50 dark:bg-slate-900 h-40 flex items-center justify-center overflow-hidden relative shadow-sm cursor-pointer hover:ring-2 hover:ring-blue-400 transition-all"
                      // Aqui usamos o "as any" ou a verificação opcional para evitar erro de TypeScript se ele reclamar
                      onClick={() => viewingProof.proof.photo_stub_url && setZoomedImage(viewingProof.proof.photo_stub_url)}
                      title="Clique para ampliar"
                    >
                      {viewingProof.proof.photo_stub_url ? (
                        <img src={viewingProof.proof.photo_stub_url} alt="Canhoto" className="w-full h-full object-cover" />
                      ) : (
                        <span className="text-slate-500 dark:text-slate-400 italic text-sm">Não anexado</span>
                      )}
                    </div>
                  </div>

                </div>

              </div>

              {/* Rodapé com Botões */}
              <div className="bg-slate-50 dark:bg-slate-900 p-4 border-t dark:border-slate-700 flex justify-end gap-3 no-print">
                {/* BOTÃO DE IMPRIMIR NOVO */}
                <button 
                    onClick={handlePrintProof}
                    className="flex items-center gap-2 px-6 py-2 bg-slate-800 dark:bg-white text-white dark:text-slate-900 rounded-lg hover:bg-slate-700 transition-colors font-bold shadow-lg"
                >
                    <Printer size={18} /> Imprimir / PDF
                </button>

                <button onClick={() => setViewingProof(null)} className="px-6 py-2 bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-lg hover:bg-slate-300 dark:hover:bg-slate-600 font-medium">
                    Fechar
                </button>
              </div>
           </div>
        </div>
      )}

      {/* Controladoria */}
      {showControladoria && (() => {
        const allTodayInvoices = invoices.filter(i => i.created_at?.startsWith(controlDate));
        const semVeiculo = allTodayInvoices.filter(i => !i.vehicle_id).length;

        const todayVehicles = vehicles.map(v => {
          const vInvoices = invoices.filter(i => i.vehicle_id === v.id && i.created_at?.startsWith(controlDate));
          const driver = (() => {
            const active = vInvoices.find(i => i.status === 'PENDING' || i.status === 'IN_PROGRESS');
            const any = vInvoices[0];
            const inv = active ?? any;
            return inv ? drivers.find(d => d.id === inv.driver_id) : null;
          })();
          const delivered = vInvoices.filter(i => i.status === 'DELIVERED').length;
          const pending   = vInvoices.filter(i => i.status === 'PENDING' || i.status === 'IN_PROGRESS').length;
          const returned  = vInvoices.filter(i => i.status === 'RETURNED' || i.status === 'FAILED').length;
          const totalValue = vInvoices.reduce((s, i) => s + (i.value ?? 0), 0);
          const isOnline = v.last_location && (new Date().getTime() - new Date(v.last_location.updated_at).getTime() < 5 * 60 * 1000);
          return { v, vInvoices, driver, delivered, pending, returned, totalValue, isOnline };
        });

        return (
          <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
            <div className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-6xl max-h-[90vh] flex flex-col overflow-hidden border border-slate-200 dark:border-slate-700">
              {/* Header */}
              <div className="flex items-center justify-between p-5 border-b border-slate-200 dark:border-slate-700">
                <div className="flex items-center gap-3">
                  <LayoutDashboard size={22} className="text-blue-500" />
                  <div>
                    <h2 className="text-lg font-bold text-slate-800 dark:text-white">Controladoria</h2>
                    <p className="text-xs text-slate-500">
                      {new Date(controlDate + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      const d = new Date(controlDate + 'T12:00:00');
                      d.setDate(d.getDate() - 1);
                      setControlDate(d.toISOString().split('T')[0]);
                    }}
                    className="p-2 rounded-lg border border-slate-200 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 transition-colors"
                    title="Dia anterior"
                  >
                    <ArrowDown size={16} />
                  </button>
                  <input
                    type="date"
                    value={controlDate}
                    max={new Date().toISOString().split('T')[0]}
                    onChange={e => setControlDate(e.target.value)}
                    className="px-3 py-1.5 text-sm border border-slate-200 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-700 dark:text-white outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <button
                    onClick={() => {
                      const d = new Date(controlDate + 'T12:00:00');
                      d.setDate(d.getDate() + 1);
                      const today = new Date().toISOString().split('T')[0];
                      if (d.toISOString().split('T')[0] <= today) setControlDate(d.toISOString().split('T')[0]);
                    }}
                    className="p-2 rounded-lg border border-slate-200 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 transition-colors disabled:opacity-40"
                    title="Próximo dia"
                  >
                    <ArrowUp size={16} />
                  </button>
                  <button
                    onClick={() => setControlDate(new Date().toISOString().split('T')[0])}
                    className="px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 transition-colors"
                  >
                    Hoje
                  </button>
                  <button onClick={() => setShowControladoria(false)} className="p-2 rounded-full hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-500 ml-2">
                    <X size={20} />
                  </button>
                </div>
              </div>

              {/* Totais gerais */}
              <div className="grid grid-cols-5 gap-4 p-5 border-b border-slate-200 dark:border-slate-700">
                {[
                  { label: 'Importadas', value: allTodayInvoices.length, color: 'text-slate-700 dark:text-white', sub: semVeiculo > 0 ? `${semVeiculo} sem veículo` : null },
                  { label: 'Distribuídas', value: todayVehicles.reduce((s, x) => s + x.vInvoices.length, 0), color: 'text-indigo-600', sub: null },
                  { label: 'Entregues', value: todayVehicles.reduce((s, x) => s + x.delivered, 0), color: 'text-green-600', sub: null },
                  { label: 'Pendentes', value: todayVehicles.reduce((s, x) => s + x.pending, 0), color: 'text-orange-500', sub: null },
                  { label: 'Valor Total', value: `R$ ${todayVehicles.reduce((s, x) => s + x.totalValue, 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`, color: 'text-blue-600', sub: null },
                ].map(({ label, value, color, sub }) => (
                  <div key={label} className="bg-slate-50 dark:bg-slate-900 rounded-lg p-4 text-center border border-slate-200 dark:border-slate-700">
                    <p className="text-xs text-slate-500 mb-1">{label}</p>
                    <p className={`text-2xl font-bold ${color}`}>{value}</p>
                    {sub && <p className="text-[10px] text-red-500 font-medium mt-1">{sub}</p>}
                  </div>
                ))}
              </div>

              {/* Cards por veículo */}
              <div className="flex-1 overflow-y-auto p-5 space-y-4">
                {todayVehicles.map(({ v, vInvoices, driver, delivered, pending, returned, totalValue, isOnline }) => (
                  <div key={v.id} className="border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
                    {/* Header do veículo */}
                    <div className="flex items-center justify-between px-5 py-3 bg-slate-50 dark:bg-slate-900">
                      <div className="flex items-center gap-3">
                        <div className={`p-2 rounded-full ${isOnline ? 'bg-blue-600' : 'bg-slate-400'}`}>
                          <Truck size={16} className="text-white" />
                        </div>
                        <div>
                          <span className="font-bold text-slate-800 dark:text-white">{v.plate}</span>
                          <span className="text-slate-500 dark:text-slate-400 text-sm ml-2">{v.model}</span>
                          {driver && <span className="ml-2 text-xs bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 px-2 py-0.5 rounded-full">{driver.name}</span>}
                        </div>
                        <div className="flex items-center gap-1 ml-2">
                          <div className={`w-2 h-2 rounded-full ${isOnline ? 'bg-green-500 animate-pulse' : 'bg-slate-300'}`} />
                          <span className="text-xs text-slate-500">{isOnline ? 'Online' : 'Offline'}</span>
                          {v.last_location?.speed_kmh !== undefined && isOnline && (
                            <span className="text-xs text-slate-500 dark:text-slate-400 ml-1">{v.last_location.speed_kmh} km/h</span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-4 text-sm">
                        <span className="flex items-center gap-1 text-green-600 font-semibold"><CheckCircle size={14} /> {delivered}</span>
                        <span className="flex items-center gap-1 text-orange-500 font-semibold"><Clock size={14} /> {pending}</span>
                        {returned > 0 && <span className="flex items-center gap-1 text-red-500 font-semibold"><XCircle size={14} /> {returned}</span>}
                        <span className="text-blue-600 font-bold">R$ {totalValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
                      </div>
                    </div>

                    {/* Lista de notas */}
                    {vInvoices.length === 0 ? (
                      <div className="px-5 py-4 text-sm text-slate-500 dark:text-slate-400 text-center">Nenhuma nota hoje</div>
                    ) : (
                      <div className="divide-y divide-slate-100 dark:divide-slate-700">
                        {vInvoices.map(inv => {
                          const statusConfig: Record<string, { label: string; color: string }> = {
                            PENDING:     { label: 'Pendente',   color: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400' },
                            IN_PROGRESS: { label: 'Em Rota',   color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' },
                            DELIVERED:   { label: 'Entregue',  color: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' },
                            RETURNED:    { label: 'Devolvida', color: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' },
                            FAILED:      { label: 'Falhou',    color: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' },
                            ISSUE:       { label: 'Problema',  color: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400' },
                          };
                          const s = statusConfig[inv.status] ?? { label: inv.status, color: 'bg-slate-100 text-slate-600' };
                          return (
                            <div key={inv.id} className="flex items-center justify-between px-5 py-3 hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors">
                              <div className="flex items-center gap-3 min-w-0">
                                <span className="text-xs font-mono text-slate-500 dark:text-slate-400 shrink-0">NF {inv.number}</span>
                                <span className="text-sm text-slate-700 dark:text-slate-200 truncate">{inv.customer_name}</span>
                                <span className="text-xs text-slate-500 dark:text-slate-400 truncate hidden md:block">{inv.customer_address}</span>
                              </div>
                              <div className="flex items-center gap-3 shrink-0">
                                <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">R$ {(inv.value ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
                                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${s.color}`}>{s.label}</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        );
      })()}

     {/* Fleet Monitor Modal (VERSÃO FINAL 2.0: COM ROTAS VISUAIS) */}
      {showFleetMonitor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
           <div className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-7xl h-[90vh] flex overflow-hidden border border-slate-200 dark:border-slate-700 relative">
              
              {/* --- LISTA LATERAL --- */}
              <div className="w-80 flex-shrink-0 border-r border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 flex flex-col z-20">
                 <div className="p-4 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900">
                    <h3 className="font-bold text-slate-800 dark:text-white flex items-center gap-2">
                       <Satellite size={20} className="text-blue-500"/> Frota Online
                    </h3>
                    <p className="text-xs text-slate-500 mt-1">Selecione para ver rotas</p>
                 </div>
                 
                 <div className="flex-1 overflow-y-auto p-2 space-y-2">
                    {vehicles.map(v => {
                        const hasLocation = !!v.last_location;
                        const lastUpdate = hasLocation ? new Date(v.last_location!.updated_at) : null;
                        const isOnline = lastUpdate && (new Date().getTime() - lastUpdate.getTime() < 5 * 60 * 1000);
                        const isSelected = selectedVehicleId === v.id;
                        const pendingCount = invoices.filter(i =>
                          i.vehicle_id === v.id &&
                          i.status !== 'DELIVERED' &&
                          i.status !== 'RETURNED' &&
                          i.status !== 'FAILED'
                        ).length;

                        return (
                           <div
                             key={v.id}
                             onClick={() => {
                               if (!hasLocation) return;
                               handleSelectVehicle(v.id, v.last_location!.lat, v.last_location!.lng);
                             }}
                             className={`p-3 rounded-lg border transition-all cursor-pointer flex items-center justify-between group
                                ${isSelected ? 'bg-blue-100 dark:bg-blue-900/40 border-blue-500 ring-1 ring-blue-500' : ''}
                                ${hasLocation
                                   ? 'hover:bg-blue-50 dark:hover:bg-blue-900/20 border-slate-100 dark:border-slate-700 hover:border-blue-300'
                                   : 'opacity-50 cursor-not-allowed border-transparent'}
                             `}
                           >
                              <div className="flex items-center gap-3">
                                 <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white font-bold shadow-sm ${isOnline ? 'bg-blue-600' : 'bg-slate-400'}`}>
                                    <Truck size={18} />
                                 </div>
                                 <div>
                                    <span className="font-bold text-slate-700 dark:text-slate-200 text-sm block">{v.plate}</span>
                                    <span className="text-sm text-slate-400 dark:text-slate-500 block">{v.model}</span>
                                    <span className="text-[10px] text-slate-500 flex items-center gap-1 mt-0.5">
                                       <div className={`w-2 h-2 rounded-full ${isOnline ? 'bg-green-500 animate-pulse' : 'bg-slate-300'}`}></div>
                                       {isOnline ? 'Sinal Ativo' : 'Offline'}
                                       {v.last_location?.speed_kmh !== undefined && isOnline && (
                                         <span className="text-slate-500 dark:text-slate-400">{v.last_location.speed_kmh} km/h</span>
                                       )}
                                       {v.last_location?.source === 'salvadorsat' && (
                                         <span className="bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-400 px-1 rounded font-semibold">SAT</span>
                                       )}
                                    </span>
                                 </div>
                              </div>
                              <span className="text-xs font-bold bg-slate-200 dark:bg-slate-700 px-2 py-1 rounded text-slate-600 dark:text-slate-300">
                                 {pendingCount}
                              </span>
                           </div>
                        )
                    })}
                 </div>
              </div>

              {/* --- MAPA --- */}
              <div className="flex-1 relative bg-slate-100">
                <button
                  onClick={() => { setShowFleetMonitor(false); setTrackedInvoiceId(null); }}
                  className="absolute top-4 right-4 z-10 bg-white dark:bg-slate-900 p-2 rounded-full shadow-lg hover:bg-red-50 text-slate-500 hover:text-red-500 transition-colors border border-slate-200 dark:border-slate-700"
                >
                  <X size={20} />
                </button>

                {/* Card de rastreio: distância e tempo do caminhão até a entrega */}
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
                        <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400 shrink-0">NF {trackedInv.number}</span>
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
                        // Compara ETA com trânsito vs. tempo típico para classificar a via
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
                                <p className="text-[10px] text-slate-500 dark:text-slate-400 uppercase tracking-wide font-bold">Distância</p>
                              </div>
                              <div>
                                <p className="text-lg font-black text-slate-700 dark:text-slate-200 leading-tight">
                                  ~{Math.max(1, Math.round(trackedRoute.durationS / 60))} min
                                </p>
                                <p className="text-[10px] text-slate-500 dark:text-slate-400 uppercase tracking-wide font-bold">Com trânsito agora</p>
                              </div>
                            </div>
                            <div className="flex items-center gap-1.5 pt-0.5">
                              <span className={`w-2 h-2 rounded-full ${traffic.dot} ${ratio >= 1.35 ? 'animate-pulse' : ''}`} />
                              <span className={`text-[11px] font-bold ${traffic.text}`}>{traffic.label}</span>
                              {delayMin >= 1 && (
                                <span className="text-[11px] text-slate-500 dark:text-slate-400">· +{delayMin} min de atraso</span>
                              )}
                            </div>
                          </>
                        );
                      })() : (
                        <p className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                          <Loader2 size={13} className="animate-spin" /> Calculando rota...
                        </p>
                      )}
                    </div>
                  </div>
                )}

                <Map
                    ref={mapRef}
                    initialViewState={{ latitude: -12.9777, longitude: -38.5016, zoom: 12 }}
                    style={{width: '100%', height: '100%'}}
                    mapStyle="mapbox://styles/mapbox/streets-v12"
                    mapboxAccessToken={MAPBOX_TOKEN}
                >
                    <NavigationControl position="bottom-right" />
                    <FullscreenControl position="bottom-right" />

                    {/* 1. RENDERIZA OS VEÍCULOS (CAMINHÕES) */}
                    {vehicles.map(v => {
                        if (!v.last_location) return null;
                        const isSelected = selectedVehicleId === v.id;
                        const isOnline = (new Date().getTime() - new Date(v.last_location.updated_at).getTime()) < 5 * 60 * 1000;

                        return (
                            <Marker
                                key={v.id}
                                latitude={v.last_location.lat}
                                longitude={v.last_location.lng}
                                anchor="bottom"
                                onClick={(e) => {
                                    e.originalEvent.stopPropagation();
                                    handleSelectVehicle(v.id, v.last_location!.lat, v.last_location!.lng);
                                }}
                            >
                                <div className={`relative group cursor-pointer flex flex-col items-center transition-all duration-500 ${isSelected ? 'scale-125 z-50' : 'scale-100 z-10'}`}>
                                    <div className="mb-1 px-2 py-0.5 bg-white/90 dark:bg-black/80 backdrop-blur text-slate-800 dark:text-white text-[10px] font-bold rounded shadow-sm border border-slate-200 dark:border-slate-600 whitespace-nowrap">
                                       {v.plate}
                                    </div>
                                    <div className={`p-2 rounded-full shadow-xl border-2 ${isSelected ? 'bg-blue-600 border-white ring-4 ring-blue-500/30' : isOnline ? 'bg-slate-600 border-slate-300' : 'bg-slate-400 border-slate-200'}`}>
                                        <Truck size={20} className="text-white" />
                                    </div>
                                </div>
                            </Marker>
                        )
                    })}

                    {/* 1b. LINHA RETA CAMINHÃO → ENTREGA RASTREADA (distância real vem da Directions API) */}
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

                    {/* 2. RENDERIZA AS ENTREGAS (AGRUPADAS POR LOCAL) */}
                    {(() => {
                        // 1. Agrupa notas pela coordenada (Lat,Lng)
                        const groupedInvoices: Record<string, Invoice[]> = {};
                        
                        invoices
                            .filter(inv =>
                                inv.vehicle_id === selectedVehicleId &&
                                inv.lat && inv.lng &&
                                inv.status !== 'DELIVERED' &&
                                inv.status !== 'RETURNED' &&
                                inv.status !== 'FAILED'
                            )
                            .forEach(inv => {
                                // ... (resto do código de agrupamento continua igual)
                                const key = `${inv.lat},${inv.lng}`; // Chave única do local
                                if (!groupedInvoices[key]) groupedInvoices[key] = [];
                                groupedInvoices[key].push(inv);
                            });

                        // 2. Renderiza os Grupos
                        return Object.values(groupedInvoices).map((group, index) => {
                            const mainInvoice = group[0]; // Pega a 1ª nota para dados gerais (Nome Cliente)
                            const count = group.length;   // Quantas notas tem aqui?

                            return (
                                <Marker 
                                    key={`group-${index}`}
                                    latitude={mainInvoice.lat!}
                                    longitude={mainInvoice.lng!}
                                    anchor="bottom"
                                >
                                    <div
                                        className="group relative cursor-pointer z-50"
                                        onClick={() => setTrackedInvoiceId(prev =>
                                            prev === mainInvoice.id ? null : mainInvoice.id
                                        )}
                                        title="Clique para ver a distância do caminhão"
                                    >
                                        {/* Ícone do Pacote */}
                                        <div className={`
                                            relative flex items-center justify-center rounded-full shadow-md border-2 border-white transition-transform hover:scale-110
                                            ${count > 1 ? 'bg-purple-600 w-8 h-8' : 'bg-orange-500 w-7 h-7 p-1.5'}
                                        `}>
                                            {count > 1 ? (
                                                // Se tiver várias, mostra o NÚMERO
                                                <span className="text-white font-bold text-xs">{count}</span>
                                            ) : (
                                                // Se for única, mostra o ÍCONE
                                                <Package size={14} className="text-white" />
                                            )}

                                            {/* Badge extra visual se for multiplo (opcional, estilo 'pilha') */}
                                            {count > 1 && (
                                                <div className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-orange-500 rounded-full border border-white"></div>
                                            )}
                                        </div>
                                        
                                        {/* Tooltip Turbinado (Lista todas as notas) */}
                                        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 bg-slate-900 text-white text-[10px] p-2 rounded shadow-xl opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-[60]">
                                            {/* Cabeçalho */}
                                            <div className="border-b border-slate-700 pb-1 mb-1">
                                                <span className="font-bold block truncate text-xs text-yellow-400">{mainInvoice.customer_name}</span>
                                                <span className="opacity-70">{count} {count === 1 ? 'entrega' : 'entregas'} aqui</span>
                                            </div>

                                            {/* Lista de Notas */}
                                            <div className="max-h-24 overflow-y-auto space-y-1 scrollbar-thin scrollbar-thumb-slate-600">
                                                {group.map(inv => (
                                                    <div key={inv.id} className="flex justify-between items-center">
                                                        <span className="opacity-90 font-mono">NF {inv.number}</span>
                                                        <span className="text-green-400 font-bold">R$ {inv.value.toLocaleString('pt-BR')}</span>
                                                    </div>
                                                ))}
                                            </div>

                                            {/* Totalizador (Bonus!) */}
                                            {count > 1 && (
                                                <div className="border-t border-slate-700 mt-1 pt-1 text-right font-bold text-green-300">
                                                    Total: R$ {group.reduce((acc, i) => acc + i.value, 0).toLocaleString('pt-BR')}
                                                </div>
                                            )}

                                            {/* Setinha */}
                                            <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-slate-900"></div>
                                        </div>
                                    </div>
                                </Marker>
                            );
                        });
                    })()}

                </Map>
              </div>
           </div>
        </div>
      )}

      {/* --- MODAL DE CONFIRMAÇÃO DE REENTREGA --- */}
      {modalRedeliver.open && modalRedeliver.invoice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl max-w-md w-full p-6 border border-slate-200 dark:border-slate-700">
            <h3 className="text-xl font-bold text-slate-800 dark:text-white mb-2 flex items-center gap-2">
              <RefreshCw className="text-purple-500" /> Confirmar Reentrega
            </h3>
            
            <div className="space-y-4 text-sm text-slate-600 dark:text-slate-300 my-4">
              <p>Você está prestes a reiniciar o ciclo da nota <strong>{modalRedeliver.invoice.number}</strong>.</p>
              
              <div className="bg-purple-50 dark:bg-purple-900/20 p-3 rounded-lg border border-purple-100 dark:border-purple-800/50">
                <p className="font-semibold text-purple-900 dark:text-purple-300 mb-2">O que vai acontecer:</p>
               <ul className="list-disc pl-4 space-y-1">
                  <li>Status volta para <span className="text-yellow-600 font-bold">FATURADA</span>.</li>
                  <li>Motorista atual será removido.</li>
                  <li>
                    Valor da Nota: <strong className="text-slate-900 dark:text-white">
                      {/* Mostra sempre o valor original cheio */}
                      R$ {modalRedeliver.invoice.value.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                    </strong>
                  </li>
                  <li>Contará como <strong>{(modalRedeliver.invoice.delivery_attempts || 1) + 1}ª tentativa</strong>.</li>
                </ul>
              </div>
            </div>

            <div className="flex justify-end gap-3 mt-6">
              <button 
                onClick={() => setModalRedeliver({ open: false, invoice: null })}
                className="px-4 py-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors font-medium"
              >
                Cancelar
              </button>
              <button 
                onClick={confirmRedeliveryAction}
                className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg shadow-lg shadow-purple-200 dark:shadow-none font-bold transition-transform active:scale-95"
              >
                Confirmar Reentrega
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- MODAL DE EDIÇÃO DE VALOR --- */}
      {modalEditValue.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl max-w-sm w-full p-6 border border-slate-200 dark:border-slate-700">
            <h3 className="text-lg font-bold text-slate-800 dark:text-white mb-4 flex items-center gap-2">
              <DollarSign className="text-green-500" /> Editar Valor da Nota
            </h3>
            
            <div className="mb-6">
              
              {/* 👇 1. PARTE NOVA: Mostra o Valor Original/Importação 👇 */}
              <div className="mb-4 bg-slate-50 dark:bg-slate-700/50 p-3 rounded-lg border border-slate-100 dark:border-slate-700">
                <span className="block text-xs text-slate-500 dark:text-slate-400 uppercase font-bold mb-1">
                    Valor Original (Importação)
                </span>
                <span className="text-sm font-mono text-slate-600 dark:text-slate-300">
                    {/* Se tiver original_value usa ele, senão usa o value atual (fallback) */}
                    R$ {(modalEditValue.invoice.original_value || modalEditValue.invoice.value).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                </span>
                
                {/* Aviso laranja se o valor atual já for diferente do original */}
                {modalEditValue.invoice.original_value && modalEditValue.invoice.value !== modalEditValue.invoice.original_value && (
                     <div className="mt-2 pt-2 border-t border-slate-200 dark:border-slate-600">
                         <span className="flex items-center gap-1 text-[10px] text-orange-500 font-bold uppercase">
                            ⚠️ Valor foi alterado
                         </span>
                         <span className="text-xs text-slate-500 dark:text-slate-400">
                            Atual: R$ {modalEditValue.invoice.value.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                         </span>
                     </div>
                )}
              </div>

              {/* 👇 2. PARTE ANTIGA: O Input de Edição (Mantido) 👇 */}
              <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Novo Valor (R$)</label>
              <input 
                type="number"
                step="0.01"
                value={modalEditValue.value}
                onChange={(e) => setModalEditValue(prev => ({ ...prev, value: e.target.value }))}
                className="w-full text-2xl font-mono font-bold text-slate-900 dark:text-white bg-slate-100 dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-lg p-3 focus:ring-2 focus:ring-green-500 outline-none"
                autoFocus
              />
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">Use ponto para decimais (ex: 150.50)</p>
            </div>

            <div className="flex justify-end gap-3">
              <button 
                onClick={() => setModalEditValue({ open: false, invoice: null, value: '' })}
                className="px-4 py-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors font-medium"
              >
                Cancelar
              </button>
              <button 
                onClick={saveNewValueAction}
                className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg shadow-lg shadow-green-200 dark:shadow-none font-bold transition-transform active:scale-95"
              >
                Salvar Valor
              </button>
            </div>
          </div>
        </div>
      )}
      {/* --- MODAL DE FINALIZAÇÃO DE DEVOLUÇÃO (Concluir / Cancelar) --- */}
      {modalFinalize.open && modalFinalize.invoice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl max-w-md w-full p-6 border border-slate-200 dark:border-slate-700">
            <h3 className="text-xl font-bold text-slate-800 dark:text-white mb-2 flex items-center gap-2">
              {modalFinalize.outcome === 'CONCLUDED' ? <CheckCircle className="text-emerald-500" /> : <XCircle className="text-slate-500" />} 
              {modalFinalize.outcome === 'CONCLUDED' ? 'Concluir Devolução' : 'Cancelar Devolução'}
            </h3>

            <div className="space-y-4 text-sm text-slate-600 dark:text-slate-300 my-4">
              <p>Você está prestes a <strong>{modalFinalize.outcome === 'CONCLUDED' ? 'concluir' : 'cancelar'}</strong> a devolução da nota <strong>{modalFinalize.invoice.number}</strong>.</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">Essa ação encerrará o fluxo de devolução e ficará registrada no histórico da nota. (Não reatribui para motorista.)</p>

              <label className="block text-xs font-bold text-slate-500 uppercase">Observação (opcional)</label>
              <textarea
                value={modalFinalize.note}
                onChange={(e) => setModalFinalize(prev => ({ ...prev, note: e.target.value }))}
                placeholder="Anote observações administrativas ou resumo do encerramento..."
                className="w-full p-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none h-28 resize-none text-sm"
              />
            </div>

            <div className="flex justify-end gap-3 mt-6">
              <button 
                onClick={() => setModalFinalize({ open: false, invoice: null, outcome: null, note: '' })}
                className="px-4 py-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors font-medium"
                disabled={modalFinalize.loading}
              >
                Cancelar
              </button>
              <button 
                onClick={confirmFinalize}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg shadow-lg dark:shadow-none font-bold transition-transform active:scale-95"
                disabled={modalFinalize.loading}
              >
                {modalFinalize.loading ? 'Enviando...' : (modalFinalize.outcome === 'CONCLUDED' ? 'Concluir devolução' : 'Cancelar devolução')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- MODAL DE COMPROVANTE DE BAIXA MANUAL (GESTOR) --- */}
      {viewingManualProof && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl max-w-2xl w-full border border-slate-200 dark:border-slate-700 overflow-hidden">
            <div className="px-6 py-4 bg-slate-900 dark:bg-black text-white flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold flex items-center gap-2">
                  <FileText size={18} className="text-sky-400" />
                  Comprovante de Baixa Manual (Gestor)
                </h3>
                <p className="text-xs text-slate-300 mt-1">
                  NF-e {viewingManualProof.number} • R${' '}
                  {viewingManualProof.value.toLocaleString('pt-BR', {
                    minimumFractionDigits: 2,
                  })}
                </p>
              </div>
              <button
                onClick={() => setViewingManualProof(null)}
                className="text-slate-300 hover:text-white"
              >
                <X size={18} />
              </button>
            </div>

            <div className="px-6 py-4 space-y-4 text-sm text-slate-700 dark:text-slate-200">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase">
                    Destinatário
                  </p>
                  <p className="font-medium">{viewingManualProof.customer_name}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {viewingManualProof.customer_address}
                  </p>
                </div>
                <div className="space-y-1">
                  <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase">
                    Status atual
                  </p>
                  <p className="text-xs">
                    <span className="inline-flex items-center rounded-full bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-[11px] font-semibold">
                      {viewingManualProof.status === DeliveryStatus.DELIVERED
                        ? 'ENTREGUE (BAIXA MANUAL)'
                        : 'DEVOLVIDA (BAIXA MANUAL)'}
                    </span>
                  </p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                    Baixada manualmente em:{' '}
                    {viewingManualProof.delivered_at
                      ? new Date(viewingManualProof.delivered_at).toLocaleString('pt-BR')
                      : 'Data não registrada'}
                  </p>
                </div>
              </div>

              <div className="border border-slate-200 dark:border-slate-700 rounded-lg p-3 bg-slate-50 dark:bg-slate-900/40">
                <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase mb-1">
                  Motivo registrado
                </p>
                <pre className="whitespace-pre-wrap text-sm text-slate-800 dark:text-slate-100 bg-transparent">
                  {viewingManualProof.last_failure_reason ||
                    '— Nenhum motivo registrado. Verifique a configuração da baixa manual.'}
                </pre>
              </div>

              {typeof viewingManualProof.return_value === 'number' && viewingManualProof.return_value > 0 && (
                <div className="border border-red-200 dark:border-red-800 rounded-lg p-3 bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-200 text-xs">
                  <p className="font-semibold text-[11px] uppercase mb-1">
                    Valor de prejuízo / devolução registrado
                  </p>
                  <p className="text-sm">
                    R{'$ '}
                    {Number(viewingManualProof.return_value).toLocaleString('pt-BR', {
                      minimumFractionDigits: 2,
                    })}
                  </p>
                </div>
              )}

              <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-2">
                Este comprovante foi gerado a partir de uma baixa manual aplicada pelo gestor, sem
                intervenção do aplicativo do motorista.
              </p>
            </div>

            <div className="px-6 py-3 bg-slate-50 dark:bg-slate-900/80 border-t border-slate-200 dark:border-slate-700 flex justify-end">
              <button
                onClick={() => setViewingManualProof(null)}
                className="px-4 py-1.5 rounded-md text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Baixa Manual (Gestor) */}
      {manualSettleModal.open && manualSettleModal.invoice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-lg border border-slate-200 dark:border-slate-700">
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
              <div className="flex items-center gap-2">
                {manualSettleModal.status === 'DELIVERED' ? (
                  <CheckCircle className="text-emerald-500" />
                ) : (
                  <AlertTriangle className="text-red-500" />
                )}
                <div>
                  <h2 className="text-lg font-bold text-slate-900 dark:text-white">
                    Baixa manual – {manualSettleModal.status === 'DELIVERED' ? 'Entregue' : 'Devolvida'}
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    NF {manualSettleModal.invoice.number} – {manualSettleModal.invoice.customer_name}
                  </p>
                </div>
              </div>
              <button
                onClick={() =>
                  setManualSettleModal({
                    open: false,
                    invoice: null,
                    status: 'DELIVERED',
                    reason: '',
                    loading: false,
                  })
                }
                className="text-slate-500 dark:text-slate-400 hover:text-slate-200"
                disabled={manualSettleModal.loading}
              >
                <X size={18} />
              </button>
            </div>

            <div className="px-6 py-4 space-y-4 text-sm">
              <div className="bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-600 dark:text-slate-300">
                Use esta opção apenas quando a baixa precisar ser aplicada pelo gestor, sem ação do motorista
                (ex.: integração externa, erro de operação, acerto manual).
              </div>

              <div className="space-y-1">
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300">
                  Motivo da baixa manual <span className="text-red-500">*</span>
                </label>
                <textarea
                  className="w-full min-h-[80px] text-sm rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Descreva por que essa nota está sendo baixada manualmente (ex.: integração ERP, conferência física, ajuste de estoque etc.)"
                  value={manualSettleModal.reason}
                  onChange={(e) =>
                    setManualSettleModal((prev) => ({ ...prev, reason: e.target.value }))
                  }
                  disabled={manualSettleModal.loading}
                />
              </div>

              {/* Campo de valor de prejuízo removido conforme solicitado */}
            </div>

            <div className="px-6 py-3 bg-slate-50 dark:bg-slate-900/80 border-t border-slate-200 dark:border-slate-700 flex items-center justify-end gap-3">
              <button
                onClick={() =>
                  setManualSettleModal({
                    open: false,
                    invoice: null,
                    status: 'DELIVERED',
                    reason: '',
                    loading: false,
                  })
                }
                className="px-3 py-1.5 rounded-md text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                disabled={manualSettleModal.loading}
              >
                Cancelar
              </button>
              <button
                onClick={confirmManualSettle}
                disabled={manualSettleModal.loading}
                className="px-4 py-1.5 rounded-md text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {manualSettleModal.loading ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    Processando...
                  </>
                ) : (
                  <>
                    {manualSettleModal.status === 'DELIVERED' ? (
                      <CheckCircle size={14} />
                    ) : (
                      <AlertTriangle size={14} />
                    )}
                    Confirmar baixa manual
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Settings Modal */}
      {showSettings && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-200">
           <div className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-sm overflow-hidden flex flex-col border border-slate-200 dark:border-slate-700">
              <div className="p-4 bg-slate-100 dark:bg-slate-900 border-b dark:border-slate-700 flex justify-between items-center shrink-0">
                 <h3 className="font-bold text-slate-800 dark:text-white flex items-center gap-2"><Settings size={20} className="text-slate-600 dark:text-slate-400"/> Configurações</h3>
                 <button onClick={() => setShowSettings(false)} className="text-slate-500 dark:text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"><X size={20} /></button>
              </div>
              <div className="p-6">
                 <h4 className="text-sm font-bold text-slate-600 dark:text-slate-400 mb-2 uppercase">Segurança</h4>
                 <form onSubmit={handleUpdateAdminPassword} className="space-y-3">
                    <div>
                       <label className="text-xs text-slate-500 dark:text-slate-400 font-bold mb-1 block">Nova Senha de Administrador</label>
                       <input type="password" required className="w-full p-2 border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-white rounded-md focus:ring-2 focus:ring-blue-500 outline-none text-sm" placeholder="Nova senha..." value={newAdminPassword} onChange={e => setNewAdminPassword(e.target.value)} />
                    </div>
                    <button type="submit" className="w-full bg-slate-800 dark:bg-blue-600 text-white font-bold py-2 rounded-md hover:bg-slate-900 dark:hover:bg-blue-700 transition-colors text-sm">Atualizar Senha</button>
                 </form>
              </div>
           </div>
        </div>
      )}

      {/* Manage/Add Driver Modal */}
      {showAddDriver && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-200">
           <div className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col max-h-[80vh] border border-slate-200 dark:border-slate-700">
              <div className="p-4 bg-slate-100 dark:bg-slate-900 border-b dark:border-slate-700 flex justify-between items-center shrink-0">
                 <h3 className="font-bold text-slate-800 dark:text-white flex items-center gap-2"><UserPlus size={20} className="text-blue-600 dark:text-blue-400"/> Gerenciar Motoristas</h3>
                 <button onClick={() => setShowAddDriver(false)} className="text-slate-500 dark:text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"><X size={20} /></button>
              </div>
              
              <div className="p-6 border-b border-slate-100 dark:border-slate-700 shrink-0">
                 <h4 className="text-sm font-bold text-slate-600 dark:text-slate-400 mb-2 uppercase">Novo Cadastro</h4>
                 <form onSubmit={handleCreateDriver} className="space-y-3">
                    <div>
                       <label className="text-xs text-slate-500 dark:text-slate-400 font-bold mb-1 block">Nome Completo</label>
                       <input type="text" required className="w-full p-2 border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-white rounded-md focus:ring-2 focus:ring-blue-500 outline-none text-sm" placeholder="Ex: João Silva" value={newDriverName} onChange={e => setNewDriverName(e.target.value)} />
                    </div>
                    <div>
                       <label className="text-xs text-slate-500 dark:text-slate-400 font-bold mb-1 block">Senha de Acesso</label>
                       <input type="text" required className="w-full p-2 border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-white rounded-md focus:ring-2 focus:ring-blue-500 outline-none text-sm font-mono" placeholder="Ex: 1234" value={newDriverPassword} onChange={e => setNewDriverPassword(e.target.value)} />
                    </div>
                    <button type="submit" className="w-full bg-blue-600 text-white font-bold py-2 rounded-md hover:bg-blue-700 transition-colors text-sm">Cadastrar</button>
                 </form>
              </div>

              <div className="flex-1 overflow-y-auto p-6 bg-slate-50 dark:bg-slate-900/50">
                 <h4 className="text-sm font-bold text-slate-600 dark:text-slate-400 mb-2 uppercase">Motoristas Cadastrados</h4>
                 <div className="space-y-2">
                    {drivers.length === 0 ? (
                      <p className="text-center text-slate-500 dark:text-slate-400 text-sm italic">Nenhum motorista.</p>
                    ) : (
                      drivers.map(d => (
                        <div key={d.id} className="bg-white dark:bg-slate-800 p-3 rounded border border-slate-200 dark:border-slate-600 flex justify-between items-center shadow-sm">
                           <div>
                              <span className="font-medium text-slate-800 dark:text-white block">{d.name}</span>
                              <div className="flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
                                <KeyRound size={10} />
                                <span className="font-mono">{d.password || 'Sem senha'}</span>
                              </div>
                           </div>
                           <button 
                             onClick={() => handleDeleteDriver(d.id)}
                             className="text-red-400 hover:text-red-600 p-1 hover:bg-red-50 dark:hover:bg-red-900/30 rounded"
                             title="Remover Motorista"
                           >
                              <Trash2 size={16} />
                           </button>
                        </div>
                      ))
                    )}
                 </div>
              </div>
           </div>
        </div>
      )}

      {/* --- MODAL DE PENDÊNCIA (NOVO E EXCLUSIVO) --- */}
      {viewingIssue && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
           <div className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-md overflow-hidden border-2 border-orange-500 relative flex flex-col max-h-[90vh]">
                
                {/* Cabeçalho Laranja */}
                <div className="bg-orange-600 p-4 text-white flex justify-between items-center">
                    <h3 className="font-bold text-lg flex items-center gap-2">
                        <AlertOctagon size={24} /> Ocorrência Registrada
                    </h3>
                    <button onClick={() => setViewingIssue(null)} className="hover:bg-white/20 p-2 rounded-full transition-colors">
                        <X size={20} />
                    </button>
                </div>

                <div className="p-6 space-y-6 overflow-y-auto">
                    {/* Resumo da Nota */}
                    <div className="flex justify-between items-center border-b border-slate-100 dark:border-slate-700 pb-4">
                        <div>
                            <p className="text-xs text-slate-500 uppercase font-bold">Nota Fiscal</p>
                            <p className="text-xl font-mono font-bold text-slate-800 dark:text-white">
                                {viewingIssue.invoice.number}
                            </p>
                        </div>
                        <div className="text-right">
                            <p className="text-xs text-slate-500 uppercase font-bold">Valor da Carga</p>
                            <p className="text-xl font-bold text-slate-800 dark:text-white">
                                R$ {viewingIssue.invoice.value.toLocaleString('pt-BR')}
                            </p>
                        </div>
                    </div>

                    {/* Detalhes do Problema */}
                    <div className="bg-orange-50 dark:bg-orange-800/20 p-4 rounded-lg border border-orange-100 dark:border-orange-800 space-y-4">
                        <div>
                            <span className="flex items-center gap-2 text-xs font-bold text-orange-800 dark:text-orange-300 uppercase mb-1">
                                <AlertTriangle size={12}/> Tipo de Problema
                            </span>
                            <div className="font-bold text-slate-800 dark:text-white text-lg bg-white dark:bg-slate-800 px-3 py-2 rounded border border-orange-200 dark:border-orange-900/50 inline-block">
                                {viewingIssue.proof.return_type?.replace('_', ' ') || 'NÃO ESPECIFICADO'}
                            </div>
                        </div>
                        <div>
                            <span className="text-xs font-bold text-orange-800 dark:text-orange-300 uppercase block mb-1">
                                Relato do Motorista
                            </span>
                            <p className="text-slate-700 dark:text-slate-300 italic bg-white dark:bg-slate-800 p-3 rounded border border-orange-200 dark:border-orange-900/50">
                                "{viewingIssue.proof.failure_reason}"
                            </p>
                        </div>
                    </div>

                    {viewingIssue.proof.return_items && (
                            <div>
                                <span className="text-xs font-bold text-orange-800 dark:text-orange-300 uppercase block mb-1">
                                    Itens Afetados / Selecionados
                                </span>
                                <div className="bg-white dark:bg-slate-800 p-3 rounded border border-orange-200 dark:border-orange-900/50">
                                    {/* 'whitespace-pre-wrap' faz o texto respeitar as quebras de linha que criamos no app */}
                                    <pre className="whitespace-pre-wrap font-sans text-sm text-slate-700 dark:text-slate-300">
                                        {viewingIssue.proof.return_items}
                                    </pre>
                                </div>
                            </div>
                        )}

                    {/* Foto da Evidência (Tamanho Reduzido e Fixo) */}
                    <div>
                        <span className="text-xs font-bold text-slate-500 uppercase mb-2 block">Evidência Fotográfica</span>
                        {viewingIssue.proof.photo_url ? (
                            <div 
                                // Mudei de 'h-56' para 'h-40' (mais compacto)
                                className="rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700 h-40 flex items-center justify-center bg-slate-100 cursor-pointer relative group"
                                onClick={() => setZoomedImage(viewingIssue.proof.photo_url!)}
                            >
                                <img 
                                    src={viewingIssue.proof.photo_url} 
                                    alt="Evidência" 
                                    // object-cover garante que a imagem preencha o espaço sem esticar, cortando as bordas se necessário
                                    className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" 
                                />
                                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity backdrop-blur-sm">
                                    <span className="text-white font-bold flex items-center gap-2 px-4 py-2 border-2 border-white rounded-full">
                                        <ZoomIn size={18}/> Ampliar
                                    </span>
                                </div>
                            </div>
                        ) : (
                            // Mudei também o placeholder para 'h-20' para ficar proporcional
                            <div className="h-20 bg-slate-50 dark:bg-slate-900 border border-dashed border-slate-300 rounded-lg flex items-center justify-center text-slate-500 dark:text-slate-400 text-sm gap-2">
                                <ScanBarcode size={18} /> Nenhuma foto anexada
                            </div>
                        )}
                    </div>

                    {/* Botão de Fechar */}
                    <button 
                        onClick={() => setViewingIssue(null)}
                        className="w-full py-3 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-700 dark:text-white font-bold rounded-lg transition-colors border border-slate-200 dark:border-slate-600"
                    >
                        Fechar
                    </button>
                </div>
            </div>
        </div>
      )}

      {/* Manage/Add Vehicle Modal */}
      {showAddVehicle && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-200">
           <div className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col max-h-[80vh] border border-slate-200 dark:border-slate-700">
              <div className="p-4 bg-slate-100 dark:bg-slate-900 border-b dark:border-slate-700 flex justify-between items-center shrink-0">
                 <h3 className="font-bold text-slate-800 dark:text-white flex items-center gap-2"><Truck size={20} className="text-blue-600 dark:text-blue-400"/> Gerenciar Veículos</h3>
                 <button onClick={() => setShowAddVehicle(false)} className="text-slate-500 dark:text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"><X size={20} /></button>
              </div>
              
            <div className="p-6 border-b border-slate-100 dark:border-slate-700 shrink-0">
                 <h4 className="text-sm font-bold text-slate-600 dark:text-slate-400 mb-2 uppercase">
                   {editingVehicleId ? 'Editar Veículo' : 'Novo Cadastro'}
                 </h4>
                 <form onSubmit={handleCreateVehicle} className="space-y-3">
                    <div className="grid grid-cols-2 gap-2">
                       <input
                         type="text"
                         required
                         className="w-full p-2 border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-white rounded-md focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                         placeholder="Modelo"
                         value={newVehicleModel}
                         onChange={e => setNewVehicleModel(e.target.value)}
                       />
                       <input
                         type="text"
                         required
                         className="w-full p-2 border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-white rounded-md focus:ring-2 focus:ring-blue-500 outline-none uppercase text-sm"
                         placeholder="Placa"
                         value={newVehiclePlate}
                         onChange={e => setNewVehiclePlate(e.target.value)}
                       />
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                       <input
                         type="number"
                         step="0.01"
                         min="0"
                         className="w-full p-2 border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-white rounded-md focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                         placeholder="Tara (kg)"
                         value={newVehicleTara}
                         onChange={e => setNewVehicleTara(e.target.value)}
                       />
                       <input
                         type="number"
                         step="0.01"
                         min="0"
                         className="w-full p-2 border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-white rounded-md focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                         placeholder="Cubagem (m³)"
                         value={newVehicleCubagem}
                         onChange={e => setNewVehicleCubagem(e.target.value)}
                       />
                       <input
                         type="number"
                         step="0.01"
                         min="0"
                         className="w-full p-2 border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-white rounded-md focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                         placeholder="Peso Máx. (kg)"
                         value={newVehicleMaxWeight}
                         onChange={e => setNewVehicleMaxWeight(e.target.value)}
                       />
                    </div>
                    <div className="flex gap-2">
                      {editingVehicleId && (
                        <button
                          type="button"
                          onClick={() => {
                            setEditingVehicleId(null);
                            setNewVehiclePlate('');
                            setNewVehicleModel('');
                            setNewVehicleTara('');
                            setNewVehicleCubagem('');
                            setNewVehicleMaxWeight('');
                          }}
                          className="w-1/3 bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-white font-bold py-2 rounded-md hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors text-sm"
                        >
                          Cancelar
                        </button>
                      )}
                      <button
                        type="submit"
                        className="flex-1 bg-blue-600 text-white font-bold py-2 rounded-md hover:bg-blue-700 transition-colors text-sm"
                      >
                        {editingVehicleId ? 'Salvar alterações' : 'Cadastrar'}
                      </button>
                    </div>
                 </form>
              </div>

              <div className="flex-1 overflow-y-auto p-6 bg-slate-50 dark:bg-slate-900/50">
                 <h4 className="text-sm font-bold text-slate-600 dark:text-slate-400 mb-2 uppercase">Veículos Cadastrados</h4>
                 <div className="space-y-2">
                    {vehicles.length === 0 ? (
                      <p className="text-center text-slate-500 dark:text-slate-400 text-sm italic">Nenhum veículo.</p>
                    ) : (
                      vehicles.map(v => (
                        <div
                          key={v.id}
                          className="bg-white dark:bg-slate-800 p-3 rounded border border-slate-200 dark:border-slate-600 flex justify-between items-center shadow-sm"
                        >
                           <div>
                             <span className="font-bold text-slate-800 dark:text-white uppercase block">
                               {v.plate}
                             </span>
                             <span className="text-xs text-slate-500 dark:text-slate-400 block">
                               {v.model}
                             </span>
                             <span className="text-[11px] text-slate-400 dark:text-slate-500 block mt-1">
                               {v.tara ? `Tara: ${v.tara} kg` : 'Tara não informada'} •{' '}
                               {v.cubagem ? `Cubagem: ${v.cubagem} m³` : 'Cubagem não informada'} •{' '}
                               {v.max_weight ? `Peso máx.: ${v.max_weight} kg` : 'Peso máx. não informado'}
                             </span>
                           </div>
                           <div className="flex items-center gap-2">
                             <button
                               onClick={() => {
                                 setEditingVehicleId(v.id);
                                 setNewVehiclePlate(v.plate);
                                 setNewVehicleModel(v.model);
                                 setNewVehicleTara(v.tara ? String(v.tara) : '');
                                 setNewVehicleCubagem(v.cubagem ? String(v.cubagem) : '');
                                 setNewVehicleMaxWeight(v.max_weight ? String(v.max_weight) : '');
                               }}
                               className="text-blue-500 hover:text-blue-700 p-1 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded flex items-center justify-center"
                               title="Editar Veículo"
                             >
                               <Pencil size={16} />
                             </button>
                             <button 
                               onClick={() => handleDeleteVehicle(v.id)}
                               className="text-red-400 hover:text-red-600 p-1 hover:bg-red-50 dark:hover:bg-red-900/30 rounded"
                               title="Remover Veículo"
                             >
                              <Trash2 size={16} />
                             </button>
                           </div>
                        </div>
                      ))
                    )}
                 </div>
              </div>
           </div>
        </div>
      )}
    {/* --- LIGHTBOX PROFISSIONAL COM LUPA E ROTAÇÃO --- */}
      {zoomedImage && (
        <div 
          className="fixed inset-0 z-[100] bg-black/95 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-200"
          onClick={() => setZoomedImage(null)}
        >
          {/* BARRA DE FERRAMENTAS SUPERIOR (FLUTUANTE) */}
          <div className="absolute top-6 right-6 flex items-center gap-3 z-[110]">
            
            {/* Controlo da Lupa (Zoom) */}
            <div className="flex bg-white/10 backdrop-blur-md rounded-full border border-white/20 p-1 shadow-2xl">
              <button 
                onClick={(e) => { e.stopPropagation(); setZoomedScale(prev => Math.max(prev - 0.5, 1)); }}
                className="p-2 text-white/70 hover:text-white hover:bg-white/10 rounded-full transition-all"
                title="Diminuir Zoom"
              >
                <ZoomOut size={22} />
              </button>
              
              <span className="flex items-center px-3 text-[10px] font-mono font-bold text-white/50 border-x border-white/10">
                {Math.round(zoomedScale * 100)}%
              </span>

              <button 
                onClick={(e) => { e.stopPropagation(); setZoomedScale(prev => Math.min(prev + 0.5, 4)); }}
                className="p-2 text-white/70 hover:text-white hover:bg-white/10 rounded-full transition-all"
                title="Aumentar Zoom"
              >
                <ZoomIn size={22} />
              </button>
            </div>

            {/* Botão de Rotação */}
            <button 
              onClick={(e) => { e.stopPropagation(); setZoomedRotation(prev => (prev + 90) % 360); }}
              className="p-3 bg-white/10 backdrop-blur-md text-white/70 hover:text-white hover:bg-white/20 rounded-full border border-white/20 transition-all shadow-2xl"
              title="Girar 90°"
            >
              <RotateCw size={22} />
            </button>

            {/* Botão Fechar */}
            <button 
              onClick={() => setZoomedImage(null)}
              className="p-3 bg-red-500/20 backdrop-blur-md text-red-400 hover:bg-red-500 hover:text-white rounded-full border border-red-500/30 transition-all shadow-2xl"
            >
              <X size={22} />
            </button>
          </div>
          
          {/* ÁREA DA IMAGEM COM SCROLL (Permite navegar na foto quando o zoom for grande) */}
          <div className="w-full h-full overflow-auto flex items-center justify-center p-12 scrollbar-hide">
            <img 
              src={zoomedImage} 
              alt="Documento Ampliado" 
              style={{ 
                transform: `rotate(${zoomedRotation}deg) scale(${zoomedScale})`,
                transition: 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)' 
              }}
              className="max-w-full max-h-[85vh] object-contain rounded-sm shadow-2xl pointer-events-auto select-none origin-center"
              onClick={(e) => e.stopPropagation()} 
            />
          </div>

          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 text-white/20 text-[10px] uppercase tracking-[0.2em] pointer-events-none font-bold">
            Modo de Inspeção Digital
          </div>
        </div>
      )} 


      {/* --- MODAL DE IMPORTAÇÃO XML (DRAG & DROP) --- */}
      {showImportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
           <div className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-2xl overflow-hidden border border-slate-200 dark:border-slate-700 flex flex-col max-h-[90vh]">
              
              {/* Cabeçalho */}
              <div className="p-4 bg-slate-100 dark:bg-slate-900 border-b dark:border-slate-700 flex justify-between items-center">
                 <h3 className="font-bold text-slate-800 dark:text-white flex items-center gap-2">
                    <UploadCloud className="text-blue-600" /> Importar Notas Fiscais
                 </h3>
                 <button onClick={() => { setShowImportModal(false); setImportSummary(null); }} className="text-slate-500 dark:text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"><X size={20}/></button>
              </div>

              <div className="p-6 flex-1 overflow-y-auto">
                 
                 {/* RESUMO PÓS-IMPORTAÇÃO */}
                 {importSummary ? (
                    <div className="space-y-6 animate-in zoom-in-95 duration-300">
                        <div className="grid grid-cols-3 gap-4 text-center">
                            <div className="bg-green-50 dark:bg-green-900/20 p-4 rounded-lg border border-green-100 dark:border-green-800">
                                <span className="block text-2xl font-bold text-green-600 dark:text-green-400">{importSummary.success}</span>
                                <span className="text-xs text-green-800 dark:text-green-200 uppercase font-bold">Importados</span>
                            </div>
                            <div className="bg-yellow-50 dark:bg-yellow-900/20 p-4 rounded-lg border border-yellow-100 dark:border-yellow-800">
                                <span className="block text-2xl font-bold text-yellow-600 dark:text-yellow-400">{importSummary.duplicates}</span>
                                <span className="text-xs text-yellow-800 dark:text-yellow-200 uppercase font-bold">Duplicados</span>
                            </div>
                            <div className="bg-red-50 dark:bg-red-900/20 p-4 rounded-lg border border-red-100 dark:border-red-800">
                                <span className="block text-2xl font-bold text-red-600 dark:text-red-400">{importSummary.errors}</span>
                                <span className="text-xs text-red-800 dark:text-red-200 uppercase font-bold">Erros</span>
                            </div>
                        </div>

                        {importSummary.details.length > 0 && (
                            <div className="bg-slate-50 dark:bg-slate-900 p-4 rounded-lg border border-slate-200 dark:border-slate-700 max-h-40 overflow-y-auto text-xs font-mono space-y-1">
                                <p className="font-bold mb-2 text-slate-500">Detalhes:</p>
                                {importSummary.details.map((msg, i) => (
                                    <div key={i} className="text-slate-600 dark:text-slate-400 border-b border-slate-100 dark:border-slate-800 pb-1 last:border-0">
                                        {msg}
                                    </div>
                                ))}
                            </div>
                        )}

                        <button 
                            onClick={() => setImportSummary(null)} 
                            className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg transition-colors flex items-center justify-center gap-2"
                        >
                            <UploadCloud size={18} /> Importar Mais Arquivos
                        </button>
                    </div>
                 ) : (
                    /* ÁREA DE DRAG & DROP */
                    <div 
                        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                        onDragLeave={() => setIsDragging(false)}
                        onDrop={(e) => {
                            e.preventDefault();
                            setIsDragging(false);
                            if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                                processXMLFiles(e.dataTransfer.files);
                            }
                        }}
                        className={`
                            border-2 border-dashed rounded-xl h-64 flex flex-col items-center justify-center transition-all cursor-pointer relative
                            ${isDragging 
                                ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 scale-[1.02]' 
                                : 'border-slate-300 dark:border-slate-600 hover:border-blue-400 hover:bg-slate-50 dark:hover:bg-slate-800/50'}
                        `}
                    >
                        {uploading ? (
                            <div className="text-center">
                                <Loader2 className="h-10 w-10 text-blue-600 animate-spin mx-auto mb-4" />
                                <p className="text-slate-600 dark:text-slate-300 font-bold">Processando arquivos...</p>
                            </div>
                        ) : (
                            <>
                                <input 
                                    type="file" 
                                    multiple 
                                    accept=".xml" 
                                    className="absolute inset-0 opacity-0 cursor-pointer"
                                    onChange={(e) => {
                                        if (e.target.files && e.target.files.length > 0) processXMLFiles(e.target.files);
                                    }}
                                />
                                <div className="bg-blue-100 dark:bg-blue-900/50 p-4 rounded-full mb-4">
                                    <UploadCloud size={32} className="text-blue-600 dark:text-blue-400" />
                                </div>
                                <h4 className="text-lg font-bold text-slate-700 dark:text-white mb-2">
                                    Arraste seus XMLs aqui
                                </h4>
                                <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">
                                    ou clique para selecionar do computador
                                </p>
                                <div className="flex gap-4 text-xs text-slate-500 dark:text-slate-400">
                                    <span className="flex items-center gap-1"><FileCheck size={14}/> Múltiplos Arquivos</span>
                                    <span className="flex items-center gap-1"><CheckCircle size={14}/> Validação Automática</span>
                                </div>
                            </>
                        )}
                    </div>
                 )}
              </div>
           </div>
        </div>
      )}

      {/* --- MODAL DE CONFIRMAÇÃO DE EXCLUSÃO (GENÉRICO) --- */}
      {confirmModal.isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
           <div className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-md overflow-hidden border border-slate-200 dark:border-slate-700 scale-100 animate-in zoom-in-95 duration-200">
              
              <div className="p-6 text-center">
                 <div className="mx-auto bg-red-100 dark:bg-red-900/30 w-16 h-16 rounded-full flex items-center justify-center mb-4">
                    <Trash2 size={32} className="text-red-600 dark:text-red-400" />
                 </div>
                 
                 <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-2">
                    {confirmModal.title}
                 </h3>
                 
                 <p className="text-slate-500 dark:text-slate-400 mb-8">
                    {confirmModal.message}
                 </p>

                 <div className="flex gap-3">
                    <button 
                      onClick={() => setConfirmModal({ ...confirmModal, isOpen: false })}
                      className="flex-1 py-3 bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 font-bold rounded-lg hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors"
                    >
                       Cancelar
                    </button>
                    
                    <button 
                      onClick={handleConfirmDelete}
                      className="flex-1 py-3 bg-red-600 hover:bg-red-700 text-white font-bold rounded-lg shadow-lg shadow-red-200 dark:shadow-none transition-colors"
                    >
                       Sim, Excluir
                    </button>
                 </div>
              </div>
           </div>
        </div>
      )}

    </div>
  );
};