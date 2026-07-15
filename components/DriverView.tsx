import React, { useState, useEffect, useRef, useMemo } from 'react';
import { db } from '../services/db';
import { Driver, Invoice, DeliveryStatus, DeliveryProof, Vehicle, AppNotification } from '../types';
import { Truck, MapPin, Navigation, Camera, AlertOctagon, CheckCircle, XCircle, ChevronLeft, Search, Package, User, FileText, Map, DollarSign, Compass, Satellite, Navigation2, RefreshCw, Sun, Moon, Lock, AlertTriangle, LogOut, Info, Loader2, ChevronDown, ChevronUp, MapIcon } from 'lucide-react';
import SignatureCanvas from './ui/SignatureCanvas';
import { ToastContainer } from './ui/Toast';
import { getReasonsFor, REASON_REQUIRES_DETAIL } from '../constants/returnReasons';
import { registerPlugin } from '@capacitor/core';
// Importamos o TIPO para o TypeScript entender os comandos
import type { BackgroundGeolocationPlugin } from '@capacitor-community/background-geolocation';

// Registramos a variável manualmente
const BackgroundGeolocation = registerPlugin<BackgroundGeolocationPlugin>('BackgroundGeolocation');

/** Quantas entregas do histórico entram no DOM por vez. */
const HISTORY_PAGE_SIZE = 50;
// --- FUNÇÃO DE LIMPEZA INTELIGENTE ---
const getSmartGPSAddress = (fullString: string, zip: string) => {
    const parts = fullString.split("||");
    let mainAddress = parts[0].trim();
    
    if (parts.length < 2) return `${mainAddress}, ${zip}`;

    let obsContent = parts[1].replace("OBS/LOCAL:", "").trim();
    const obsUpper = obsContent.toUpperCase(); 

    const garbageKeywords = [
        "PEDIDO", "BOLETO", "NOTA", "NFE", "DANFE", "VENDEDOR", "REPRESENTANTE", 
        "FATURAMENTO", "PAGAMENTO", "REF.", "CNPJ", "CPF", "MERCADORIA", "CONFERIR",
        "HORARIO", "RECLAMACOES", "POSTERIORES", "CLIENTE"
    ];

    const addressKeywords = [
        "RUA ", "AV ", "AV.", "TRAVESSA", "ALAMEDA", "RODOVIA", "ESTRADA", 
        "SITIO", "FAZENDA", "COND.", "CONDOMINIO", "EDIFICIO", "APTO", 
        "PORTAO", "FUNDOS", "PROXIMO", "VIZINHO", "FRENTE"
    ];

    const hasGarbage = garbageKeywords.some(badWord => obsUpper.includes(badWord));
    const hasAddress = addressKeywords.some(goodWord => obsUpper.includes(goodWord));

    if (hasAddress && !hasGarbage) {
       return `${mainAddress}, ${obsContent}, ${zip}`;
    }

    return `${mainAddress}, ${zip}`;
};

// --- FUNÇÃO PARA COMPRIMIR FOTOS (Economiza dados e espaço) ---
const compressImage = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target?.result as string;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const scale = 800 / img.width; // Redimensiona para max 800px de largura
        canvas.width = 800;
        canvas.height = img.height * scale;
        
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(img, 0, 0, canvas.width, canvas.height);
        
        // Comprime para JPEG qualidade 70%
        resolve(canvas.toDataURL('image/jpeg', 0.7)); 
      };
      img.onerror = (err) => reject(err);
    };
    reader.onerror = (err) => reject(err);
  });
};

// -------------------------------------

// TIPO PARA O SISTEMA DE MODAL (Opcional, mantido para compatibilidade futura)
type ModalConfig = {
    isOpen: boolean;
    type: 'ALERT' | 'CONFIRM' | 'INPUT';
    title: string;
    message: string;
    onConfirm: (inputValue?: string) => void;
};

interface DriverViewProps {
  driverId: string;
  onLogout: () => void;
  toggleTheme?: () => void;
  theme?: string;
}

export const DriverView: React.FC<DriverViewProps> = ({ driverId, onLogout, toggleTheme, theme }) => {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [driver, setDriver] = useState<Driver | undefined>(undefined);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [showHistory, setShowHistory] = useState(false); // Começa fechado
  const [historySearch, setHistorySearch] = useState('');
  // Motorista veterano passa de 1000 entregas; renderizar tudo de uma vez trava o celular.
  const [historyLimit, setHistoryLimit] = useState(HISTORY_PAGE_SIZE);
  


  const [notifications, setNotifications] = useState<AppNotification[]>([])
  // 👇 2. FUNÇÃO AUXILIAR PARA CRIAR O OBJETO COMPLETO 👇
  const notify = (title: string, message: string, type: 'SUCCESS' | 'WARNING' | 'INFO' = 'WARNING') => {
    setNotifications(prev => [...prev, {
        id: `driver-alert-${Date.now()}-${Math.random()}`,
        recipient_id: driverId,
        title: title,
        message: message,
        type: type,
        read: false,
        timestamp: new Date().toISOString()
    }]);
  };

  // Função de remover (necessária para o X do toast)
 
  // 👆 FIM DA CONFIGURAÇÃO DO TOAST 👆
  
  // --- LÓGICA DE ESTADO (Persistência Diária) ---
  const [routeStarted, setRouteStarted] = useState(() => {
    if (typeof window !== 'undefined') {
        const savedDate = localStorage.getItem(`route_started_date_${driverId}`);
        const today = new Date().toDateString();
        return savedDate === today;
    }
    return false;
  });

  const [isTracking, setIsTracking] = useState(false);
  const [currentLocation, setCurrentLocation] = useState<{lat: number, lng: number} | null>(null);
  const wakeLockRef = useRef<any>(null);
  const watchIdRef = useRef<string | null>(null);
  const notifIntervalRef = useRef<number | null>(null);
  const wakeLockIntervalRef = useRef<number | null>(null);

  // Wake Lock (Tela Ativa)
  const requestWakeLock = async () => {
    try {
      if ('wakeLock' in navigator) {
        wakeLockRef.current = await (navigator as any).wakeLock.request('screen');
        console.log('Tela mantida ativa');
      }
    } catch (err) {
      console.error(`Erro Wake Lock: ${err}`);
    }
  };

  useEffect(() => {
    refreshData();

    if (routeStarted) {
        startTracking();
        requestWakeLock();

        // Reaquire o Wake Lock a cada 30s caso ele tenha sido perdido (tela apagou, app foi pro background)
        wakeLockIntervalRef.current = window.setInterval(() => {
            if (!wakeLockRef.current || wakeLockRef.current.released) {
                requestWakeLock();
            }
        }, 30000);
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && routeStarted) {
        requestWakeLock();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    notifIntervalRef.current = window.setInterval(async () => {
        const newNotifs = await db.consumeNotifications(driverId);
        if (newNotifs.length > 0) {
            setNotifications(prev => [...prev, ...newNotifs]);
            refreshData();
            if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
        }
    }, 10000);

    return () => {
        stopTracking();
        if (notifIntervalRef.current) clearInterval(notifIntervalRef.current);
        if (wakeLockIntervalRef.current) clearInterval(wakeLockIntervalRef.current);
        document.removeEventListener('visibilitychange', handleVisibilityChange);
        if (wakeLockRef.current) wakeLockRef.current.release();
    };
  }, [driverId, routeStarted]);

  const handleStartRoute = async () => {
    if(confirm("Confirmar saída para entrega? O gestor será notificado e o GPS ativado.")) {
        await db.startRoute(driverId);
        const today = new Date().toDateString();
        localStorage.setItem(`route_started_date_${driverId}`, today);
        setRouteStarted(true);
        refreshData();

        // Orienta o motorista a desativar otimização de bateria para garantir GPS contínuo
        notify(
            "Importante: GPS em Background",
            "Para o rastreio funcionar com a tela desligada, vá em Configurações > Aplicativos > EntregaCerta > Bateria e selecione 'Sem restrições'.",
            "INFO"
        );
    }
  };

  const handleLogoutWrapper = () => {
      if(confirm("Deseja sair do sistema? \n(Sua rota continuará ativa se você voltar hoje).")) {
          onLogout();
      }
  };

  // --- FUNÇÕES DE GPS (PLUGIN BACKGROUND) ---
  
  const startTracking = async () => {
    // Guard: não cria um segundo watcher se já existe um ativo
    if (watchIdRef.current) return;

    try {
      const watcherId = await BackgroundGeolocation.addWatcher(
        {
          backgroundMessage: "EntregaCerta está rastreando sua localização.",
          backgroundTitle: "EntregaCerta — Rota ativa",
          requestPermissions: true,
          stale: false, // Não aceita localização velha em cache
          distanceFilter: 10 // Atualiza a cada 10 metros
        },
        (location, error) => {
          if (error) {
            if (error.code === "NOT_AUTHORIZED") {
              if (window.confirm("Para rastrear com a tela desligada, vá em Configurações > Permissões e escolha 'Permitir o tempo todo'. Deseja abrir agora?")) {
                BackgroundGeolocation.openSettings();
              }
            }
            return console.error(error);
          }

          // SUCESSO!
          setIsTracking(true);
          // O plugin retorna latitude/longitude direto no objeto location
          const lat = location.latitude;
          const lng = location.longitude;
          
          setCurrentLocation({ lat, lng });

          // Atualiza localização do motorista e do veículo (se houver)
          db.updateDriverLocation(driverId, lat, lng);
          const vehicleId = pendingInvoices[0]?.vehicle_id;
          if (vehicleId) db.updateVehicleLocation(vehicleId, lat, lng);
        }
      );
      
      // Salva o ID para poder parar depois
      watchIdRef.current = watcherId; // O tipo do ID pode variar, 'as any' resolve rápido

    } catch (err) {
      console.error("Erro ao iniciar GPS Background:", err);
      notify("Erro GPS", "Falha ao iniciar rastreio.", "WARNING");
    }
  };

  const stopTracking = async () => {
    if (watchIdRef.current) {
      await BackgroundGeolocation.removeWatcher({ id: watchIdRef.current });
      watchIdRef.current = null;
      setIsTracking(false);
    }
  };

  const refreshData = async () => {
    setRefreshing(true);
    try {
        const [allDrivers, driverInvoices, allVehicles] = await Promise.all([
            db.getDrivers(),
            db.getInvoicesByDriver(driverId),
            db.getVehicles()
        ]);
        setDriver(allDrivers.find(d => d.id === driverId));
        setInvoices(driverInvoices);
        setVehicles(allVehicles);
    } catch(e) {
        console.error(e);
    } finally {
        setRefreshing(false);
    }
  };

  const removeNotification = (id: string) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
  };

  const handleFullRouteNavigation = (pendingInvoices: Invoice[]) => {
    if (pendingInvoices.length === 0) return;
    const addresses = pendingInvoices.map(i => {
       let addressToSend = getSmartGPSAddress(i.customer_address, i.customer_zip);
       addressToSend = addressToSend.replace(/[|]/g, ' ');
       return encodeURIComponent(addressToSend);
    });
    const destination = addresses[addresses.length - 1];
    const waypoints = addresses.slice(0, addresses.length - 1).join('|');
    let url = `https://www.google.com/maps/dir/?api=1&destination=${destination}&travelmode=driving`;
    if (waypoints.length > 0) url += `&waypoints=${waypoints}`;
    window.open(url, '_blank');
  };

  if (selectedInvoice) {
    const vehicle = vehicles.find(v => v.id === selectedInvoice.vehicle_id);
    return (
      <DeliveryAction 
        invoice={selectedInvoice} 
        vehicle={vehicle}
        currentGeo={currentLocation}
        onBack={() => {
          setSelectedInvoice(null);
          refreshData();
        }}
        routeStarted={routeStarted} 
        notify={notify}
        removeNotification={removeNotification}
        notifications={notifications}
      />
    );
  }

  const pendingInvoices = invoices.filter(i => i.status !== DeliveryStatus.DELIVERED && i.status !== DeliveryStatus.FAILED);
  // Filtra e ORDENA por data (mais recente primeiro) 
  const historyInvoices = useMemo(() =>
    invoices
      .filter(i => i.status === DeliveryStatus.DELIVERED || i.status === DeliveryStatus.FAILED)
      .sort((a, b) => new Date(b.delivered_at || b.created_at).getTime() - new Date(a.delivered_at || a.created_at).getTime()),
    [invoices]
  );

  const filteredHistory = useMemo(() => {
    const termo = historySearch.trim().toLowerCase();
    if (!termo) return historyInvoices;
    return historyInvoices.filter(inv =>
      inv.number.toLowerCase().includes(termo) ||
      inv.customer_name.toLowerCase().includes(termo) ||
      inv.customer_address.toLowerCase().includes(termo)
    );
  }, [historyInvoices, historySearch]);

  // Volta ao topo da lista sempre que a busca muda
  useEffect(() => { setHistoryLimit(HISTORY_PAGE_SIZE); }, [historySearch]);

  const visibleHistory = filteredHistory.slice(0, historyLimit);

  const currentVehicleId = pendingInvoices[0]?.vehicle_id;
  const currentVehicle = vehicles.find(v => v.id === currentVehicleId);

  return (
    <div className="min-h-screen bg-gray-100 dark:bg-slate-900 pb-20 transition-colors duration-300">
      <ToastContainer notifications={notifications} onRemove={removeNotification} />

      <div className="bg-slate-900 dark:bg-black text-white p-6 rounded-b-3xl shadow-lg sticky top-0 z-10">
        <div className="flex justify-between items-start">
          <div>
            <p className="text-slate-400 text-sm font-medium uppercase tracking-wider">Motorista</p>
            <h1 className="text-2xl font-bold">{driver?.name || 'Carregando...'}</h1>
            <div className="flex items-center gap-4 text-sm text-slate-300 mt-1">
              <div className="flex items-center gap-2">
                <Truck size={16} />
                <span>{currentVehicle ? `${currentVehicle.plate}` : '...'}</span>
              </div>
              <div className="flex items-center gap-2">
                  {routeStarted ? (
                    isTracking ? (
                        <div className="flex items-center gap-1 text-green-400 animate-pulse"><Satellite size={14} /><span className="text-xs">GPS Ativo</span></div>
                    ) : (
                        <div className="flex items-center gap-1 text-yellow-400"><Satellite size={14} /><span className="text-xs">Buscando GPS...</span></div>
                    )
                  ) : (
                    <div className="flex items-center gap-1 text-red-400"><Lock size={14} /><span className="text-xs">Rota Bloqueada</span></div>
                  )}
              </div>
            </div>
          </div>
          <div className="flex flex-col items-end gap-2">
            <button onClick={handleLogoutWrapper} className="text-xs bg-slate-800 dark:bg-slate-800 border border-slate-700 dark:border-slate-600 px-3 py-1 rounded-full text-slate-200">Sair</button>
            {toggleTheme && (
              <button onClick={toggleTheme} className="p-2 bg-slate-800/50 rounded-full text-slate-400 hover:text-yellow-400 transition-colors">
                {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="p-4 space-y-6">
        {pendingInvoices.length > 0 && !routeStarted && (
        <div className="grid grid-cols-1 gap-3 animate-in fade-in slide-in-from-top-4">
            <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 p-3 rounded-lg text-sm text-yellow-800 dark:text-yellow-200 mb-2 text-center">
                🔒 Inicie a rota para liberar a baixa das entregas.
            </div>
            <button 
              onClick={handleStartRoute}
              className="bg-green-600 dark:bg-green-700 text-white p-4 rounded-xl shadow-lg flex items-center justify-center gap-2 active:scale-95 transition-transform animate-pulse"
            >
              <Navigation2 size={24} />
              <span className="font-bold text-lg">INICIAR ROTA</span>
            </button>
        </div>
        )}

        <div>
          <div className="flex justify-between items-end mb-3 px-1">
             <h2 className="text-lg font-bold text-gray-800 dark:text-white flex items-center gap-2">
               <Package className="text-orange-500" />
               Minha Rota ({pendingInvoices.length})
             </h2>
             <div className="flex gap-2">
                <button onClick={refreshData} className={`p-1.5 rounded-full border border-slate-200 dark:border-slate-600 ${refreshing ? 'bg-slate-100 dark:bg-slate-700 animate-spin' : 'bg-white dark:bg-slate-800'}`}>
                    <RefreshCw size={16} className="text-slate-600 dark:text-slate-300"/>
                </button>
                {pendingInvoices.length > 0 && routeStarted && (
                <button onClick={() => handleFullRouteNavigation(pendingInvoices)} className="flex items-center gap-1 text-blue-600 dark:text-blue-400 text-sm font-bold bg-blue-50 dark:bg-blue-900/30 px-3 py-1 rounded-full border border-blue-100 dark:border-blue-800 active:scale-95 transition-transform">
                    <Compass size={16} /> Mapa Completo
                </button>
                )}
             </div>
          </div>

          <div className="space-y-3">
            {pendingInvoices.length === 0 ? (
              <div className="text-center py-10 text-gray-400 dark:text-slate-500 bg-white dark:bg-slate-800 rounded-xl border border-dashed border-gray-300 dark:border-slate-600">Sem entregas pendentes.</div>
            ) : (
              pendingInvoices.map((inv, index) => {
                const isInProgress = inv.status === DeliveryStatus.IN_PROGRESS;
                return (
                  <div 
                    key={inv.id}
                    onClick={() => setSelectedInvoice(inv)}
                    className={`bg-white dark:bg-slate-800 p-5 rounded-xl shadow-sm border active:scale-95 transition-transform cursor-pointer relative ${isInProgress ? 'border-blue-300 dark:border-blue-700 shadow-blue-100 dark:shadow-none ring-1 ring-blue-100 dark:ring-blue-900' : 'border-gray-200 dark:border-slate-700'}`}
                  >
                    {isInProgress && (
                       <div className="absolute -top-2 -right-2 bg-blue-500 text-white text-[10px] px-2 py-0.5 rounded-full font-bold shadow-sm flex items-center gap-1"><Navigation2 size={10} /> EM ROTA</div>
                    )}
                    <div className={`absolute top-4 left-0 w-1 h-8 rounded-r-full ${isInProgress ? 'bg-blue-500' : 'bg-orange-400'}`}></div>
                    <div className="flex justify-between items-start mb-2 pl-2">
                      <span className={`text-xs font-bold px-2 py-1 rounded-md ${isInProgress ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300' : 'bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300'}`}>Parada #{index + 1}</span>
                      <span className="text-xs text-gray-400 dark:text-slate-500 font-mono">NF {inv.number}</span>
                    </div>
                    <h3 className="font-bold text-gray-900 dark:text-white text-lg leading-tight mb-1 pl-2">{inv.customer_name}</h3>
                    <p className="text-sm text-gray-500 dark:text-slate-400 line-clamp-2 pl-2">{inv.customer_address}</p>
                    <div className="mt-4 pt-4 border-t border-gray-100 dark:border-slate-700 flex items-center justify-between text-blue-600 dark:text-blue-400 font-medium text-sm pl-2">
                       <span className="flex items-center gap-1"><MapPin size={16}/> Ver Detalhes</span>
                       <Navigation size={16} />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* SEÇÃO DE HISTÓRICO ATUALIZADA */}
        {historyInvoices.length > 0 && (
          <div className="mt-6 mb-20">
            
            <button 
                onClick={() => setShowHistory(!showHistory)}
                className="w-full flex justify-between items-center bg-white dark:bg-slate-800 p-4 rounded-xl border border-gray-200 dark:border-slate-700 shadow-sm active:scale-[0.98] transition-all"
            >
                <div className="text-left">
                    <h2 className="text-lg font-bold text-gray-800 dark:text-white flex items-center gap-2">
                       Histórico
                       <span className="text-xs font-normal bg-slate-100 dark:bg-slate-700 px-2 py-0.5 rounded-full text-slate-500">
                         {historyInvoices.length}
                       </span>
                    </h2>
                    <p className="text-xs text-gray-400 dark:text-slate-500">Entregas finalizadas</p>
                </div>
                {showHistory ? <ChevronUp className="text-gray-400"/> : <ChevronDown className="text-gray-400"/>}
            </button>

            {showHistory && (
                <div className="space-y-3 mt-3 animate-in slide-in-from-top-2 fade-in duration-300">
                  
                  {/* 1. CAMPO DE PESQUISA (NOVO) */}
                  <div className="relative">
                    <Search className="absolute left-3 top-3 text-gray-400" size={18} />
                    <input 
                      type="text" 
                      placeholder="Buscar nota, cliente ou endereço..." 
                      value={historySearch}
                      onChange={(e) => setHistorySearch(e.target.value)}
                      className="w-full pl-10 p-3 rounded-lg bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 text-sm outline-none focus:ring-2 focus:ring-blue-500 dark:text-white"
                    />
                  </div>

                  {/* 2. LISTA FILTRADA */}
                  {visibleHistory.map(inv => (
                    <div
                        key={inv.id}
                        onClick={() => setSelectedInvoice(inv)} // <--- CLIQUE PARA ABRIR
                        className="bg-white dark:bg-slate-800 p-4 rounded-lg border border-gray-200 dark:border-slate-700 flex justify-between items-center opacity-90 hover:opacity-100 active:scale-[0.98] transition-all cursor-pointer shadow-sm hover:shadow-md"
                    >
                      <div className="flex-1 min-w-0 pr-2"> {/* min-w-0 ajuda no truncate */}
                        <div className="font-medium text-gray-800 dark:text-white flex items-center gap-2">
                            NF {inv.number}
                        </div>
                        <div className="text-xs text-gray-500 dark:text-slate-400 line-clamp-1">{inv.customer_name}</div>
                        <div className="text-[10px] text-gray-400 dark:text-slate-500 line-clamp-1 mt-0.5">{inv.customer_address}</div>
                      </div>
                      
                      <div className="text-right shrink-0">
                          {inv.status === 'DELIVERED' ? (
                            <span className="text-green-600 dark:text-green-400 flex items-center justify-end gap-1 text-xs font-bold bg-green-50 dark:bg-green-900/20 px-2 py-1 rounded">
                                <CheckCircle size={12}/> Entregue
                            </span>
                          ) : (
                            <span className="text-red-500 dark:text-red-400 flex items-center justify-end gap-1 text-xs font-bold bg-red-50 dark:bg-red-900/20 px-2 py-1 rounded">
                                <XCircle size={12}/> Falhou
                            </span>
                          )}
                          <span className="text-[10px] text-gray-400 block mt-1">
                              {inv.delivered_at ? new Date(inv.delivered_at).toLocaleDateString('pt-BR') : 'Data N/A'}
                          </span>
                      </div>
                    </div>
                  ))}
                  
                  {filteredHistory.length === 0 && (
                      <div className="text-center p-4 text-sm text-gray-400 italic">
                          Nenhuma nota encontrada.
                      </div>
                  )}

                  {filteredHistory.length > visibleHistory.length && (
                    <div className="space-y-2 pt-1">
                      <p className="text-center text-xs text-gray-400">
                        Mostrando {visibleHistory.length} de {filteredHistory.length}
                      </p>
                      <button
                        onClick={() => setHistoryLimit(l => l + HISTORY_PAGE_SIZE)}
                        className="w-full py-3 rounded-lg bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 text-sm font-bold text-blue-600 dark:text-blue-400 active:scale-[0.98] transition-all"
                      >
                        Carregar mais {Math.min(HISTORY_PAGE_SIZE, filteredHistory.length - visibleHistory.length)}
                      </button>
                    </div>
                  )}
                </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

// -- DELIVERY ACTION --
const DeliveryAction: React.FC<{ invoice: Invoice, vehicle?: Vehicle, currentGeo: {lat: number, lng: number} | null, onBack: () => void, routeStarted: boolean, notify: (title: string, message: string, type?: 'SUCCESS' | 'WARNING' | 'INFO') => void, notifications: AppNotification[], removeNotification: (id: string) => void }> = ({ invoice, vehicle, currentGeo, onBack, routeStarted, notify, notifications, removeNotification }) => {
  // Estados de Controle
  const [step, setStep] = useState<'DETAILS' | 'PROOF' | 'RETURN' | 'SUCCESS' | 'ISSUE'>('DETAILS');
  const [loading, setLoading] = useState(false);
  const [frozenGeo, setFrozenGeo] = useState<{lat: number, lng: number} | null>(currentGeo);
  const [issueType, setIssueType] = useState('AVARIA'); // Valor padrão
  const [issueSelectedItems, setIssueSelectedItems] = useState<Set<string>>(new Set());

  // Estados de Formulário
  const [receiverName, setReceiverName] = useState('');
  const [receiverDoc, setReceiverDoc] = useState('');
  const [signature, setSignature] = useState('');
  const isReadOnly = invoice.status === 'DELIVERED' || invoice.status === 'FAILED';
  
  // Estados de Fotos
  const [photo, setPhoto] = useState<string>('');
  const [photoStub, setPhotoStub] = useState<string>(''); // FOTO CANHOTO (Corrigido)

  // Estados de Devolução
  const [failureReason, setFailureReason] = useState('');
  const [reasonCode, setReasonCode] = useState('');
  const [returnType, setReturnType] = useState<'TOTAL' | 'PARTIAL'>('TOTAL');
  const [returnItems, setReturnItems] = useState('');
  const [selectedReturnItems, setSelectedReturnItems] = useState<string[]>([]);

  // Os motivos de TOTAL e PARTIAL são listas diferentes: ao trocar o tipo, o
  // código escolhido pode não existir na outra lista.
  useEffect(() => {
    if (reasonCode && !getReasonsFor(returnType).some(r => r.code === reasonCode)) {
      setReasonCode('');
    }
  }, [returnType, reasonCode]);

  useEffect(() => {
    if (!frozenGeo && currentGeo) {
      setFrozenGeo(currentGeo);
    }
  }, [currentGeo, frozenGeo]);

  // Função para marcar itens na tela de Pendência
  const toggleIssueItem = (itemCode: string) => {
    const newSet = new Set(issueSelectedItems);
    if (newSet.has(itemCode)) {
      newSet.delete(itemCode);
    } else {
      newSet.add(itemCode);
    }
    setIssueSelectedItems(newSet);
  };

  const handleNavigation = (app: 'waze' | 'maps') => {
    let addressToSend = getSmartGPSAddress(invoice.customer_address, invoice.customer_zip);
    addressToSend = addressToSend.replace(/[|]/g, ' ');
    const encodedAddress = encodeURIComponent(addressToSend);

    if (app === 'waze') {
      window.open(`https://waze.com/ul?q=${encodedAddress}&navigate=yes`, '_blank');
    } else {
      window.open(`https://www.google.com/maps/search/?api=1&query=${encodedAddress}`, '_blank');
    }
  };

  // Nova função de captura de foto (com compressão e tipos)
  const handlePhotoCapture = async (e: React.ChangeEvent<HTMLInputElement>, type: 'proof' | 'stub') => {
    const file = e.target.files?.[0];
    if (file) {
      try {
        setLoading(true);
        const compressedBase64 = await compressImage(file);
        
        if (type === 'proof') {
            setPhoto(compressedBase64);
        } else {
            setPhotoStub(compressedBase64);
        }
      } catch (err) {
        notify("Erro na Imagem", "Erro ao processar imagem. Tente novamente.", "WARNING");
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
  };

  const submitIssue = async () => {
      if (!failureReason.trim()) return notify("Atenção", "Descreva o problema.", "WARNING");

      // 1. Processa os itens selecionados (transforma em texto)
      const selectedItemsList = invoice.items
        ?.filter((item: any) => issueSelectedItems.has(item.code))
        .map((item: any) => `- ${item.name} (${item.code})`)
        .join('\n');
      
      setLoading(true);
      try {
        const proof: DeliveryProof = {
            invoice_id: invoice.id,
            receiver_name: 'PENDÊNCIA REGISTRADA', // Nome fictício para constar
            receiver_doc: 'N/A',
            signature_data: '', 
            photo_url: photo || '', // Se não tiver foto, envia string vazia
            photo_stub_url: '',
            // Aqui usamos as colunas que você já tem no banco:
            return_type: issueType, // Salva "AVARIA", "ITEM_FALTANTE", etc.
            return_items: selectedItemsList || null,
            failure_reason: failureReason, // A descrição digitada
            geo_lat: frozenGeo?.lat || null,
            geo_long: frozenGeo?.lng || null,
            delivered_at: new Date().toISOString(),
        };

        // 1. Salva o comprovante (Valor entregue = 0, pois é pendência)
        await db.saveProof(proof, 0); 
        
        // 2. Força o status da nota para ISSUE
        await db.updateInvoiceStatus(invoice.id, DeliveryStatus.ISSUE);
        
        notify("Registrado", "Pendência reportada com sucesso.", "SUCCESS");
        setStep('SUCCESS');
      } catch (e) {
        console.error(e);
        notify("Erro", "Falha ao salvar pendência.", "WARNING");
      } finally {
        setLoading(false);
      }
  };

  const submitDelivery = async (success: boolean, reasonOverride?: string) => {
    // 1. Validação de Rota
    if (!routeStarted) {
        notify("Atenção", "Inicie a rota antes de realizar ações.", "WARNING");
        return;
    }

    // 2. Validações de Sucesso
    if (success) {
      if (!signature && !photo) {
        notify("Dados Faltando", "Assinatura ou Foto é obrigatória.", "WARNING");
        return;
      }
      if (!receiverName) {
        notify("Dados Faltando", "Informe o nome do recebedor.", "WARNING");
        return;
      }
    } 
    // 3. Validações de Devolução
    else {
      if (!reasonOverride && !reasonCode) {
        notify("Motivo Obrigatório", "Selecione o motivo da devolução.", "WARNING");
        return;
      }

      // "Outro" sem descrição é o que gerava registros inúteis do tipo
      // "concluir devolução" — sem o texto, o motivo não diz nada.
      if (reasonCode === REASON_REQUIRES_DETAIL && !failureReason.trim()) {
        notify("Descrição Obrigatória", "Ao escolher 'Outro', descreva o que aconteceu.", "WARNING");
        return;
      }

      if (returnType === 'PARTIAL') {
          let hasContent = false;
          if (invoice.items && invoice.items.length > 0) {
             const selectedObjs = invoice.items.filter(i => selectedReturnItems.includes(i.code));
             if (selectedObjs.length > 0) hasContent = true;
          }
          
          if (!hasContent && !returnItems.trim()) {
              if (invoice.items && invoice.items.length > 0) {
                  notify("Seleção Necessária", "Selecione os itens devolvidos.", "WARNING");
              } else {
                  notify("Descrição Necessária", "Digite quais itens voltaram.", "WARNING");
              }
              return;
          }
      }
    }

    setLoading(true);

    try {
        let finalReturnItemsString = returnItems;
        let calculatedLoss = 0; // Começa com zero

        if (!success) {
            const invoiceTotal = Number(invoice.value) || 0;

            // LÓGICA DE CÁLCULO ATUALIZADA
            if (returnType === 'PARTIAL' && invoice.items && invoice.items.length > 0) {
                // 1. Pega os objetos selecionados
                const selectedObjs = invoice.items.filter(i => selectedReturnItems.includes(i.code));
                
                // 2. Monta o texto com o valor unitário (NOVO)
                finalReturnItemsString = selectedObjs
                    .map(i => `[${i.code}] ${i.name} (${Number(i.quantity).toFixed(0)} ${i.unit}) - R$ ${Number(i.value).toFixed(2)}`)
                    .join('\n');
                
                // 3. Soma o valor dos itens selecionados (NOVO)
                calculatedLoss = selectedObjs.reduce((acc, i) => acc + (Number(i.value) || 0), 0);
            } 
            else if (returnType === 'TOTAL') {
                 calculatedLoss = invoiceTotal;
                 finalReturnItemsString = "[TOTAL] Devolução completa da nota.";
            }
        }
        
        if (!success && returnType === 'PARTIAL' && !finalReturnItemsString.trim()) {
             setLoading(false);
             notify("Erro", "Não foi possível identificar itens devolvidos.", "WARNING");
             return;
        }

        const proof: DeliveryProof = {
            invoice_id: invoice.id,
            receiver_name: success ? receiverName : 'N/A',
            receiver_doc: success ? receiverDoc : 'N/A',
            signature_data: success ? signature : '',
            photo_url: success ? photo : '',
            photo_stub_url: success ? photoStub : '',
           // 👇 AQUI ESTÁ A CORREÇÃO MÁGICA 👇
            // Usamos 'null' em vez de 'undefined' para LIMPAR o banco de dados
            return_type: success ? null : returnType,
            return_items: success ? null : finalReturnItemsString,
            failure_reason: success ? null : (reasonOverride || failureReason.trim() || null),
            failure_reason_code: success ? null : (reasonOverride ? null : reasonCode),
            // 👆 Se for sucesso, força APAGAR esses campos antigos 👆
            geo_lat: frozenGeo?.lat || null,
            geo_long: frozenGeo?.lng || null,
            delivered_at: new Date().toISOString(),
        };
       
        // Salva passando o valor calculado
        await db.saveProof(proof, calculatedLoss);
        
        notify("Sucesso", "Informações enviadas.", "SUCCESS");
        setStep('SUCCESS');

    } catch (e) {
      console.error(e);
      notify("Erro no Envio", "Falha ao salvar. Verifique sua conexão.", "WARNING");
    } finally {
      setLoading(false);
    }
  };

    if (step === 'SUCCESS') {
    return (
      <div className="min-h-screen bg-green-500 text-white flex flex-col items-center justify-center p-8 text-center animate-in fade-in zoom-in duration-300">
        <div className="bg-white text-green-500 p-6 rounded-full mb-6 shadow-xl"><CheckCircle size={64} strokeWidth={3} /></div>
        <h1 className="text-3xl font-black mb-2">Sucesso!</h1>
        <p className="text-green-100 text-lg mb-8">Informações sincronizadas.</p>
        <button onClick={onBack} className="w-full bg-white text-green-600 font-bold py-4 rounded-xl shadow-lg active:scale-95 transition-transform">Voltar para Rota</button>
        <ToastContainer notifications={notifications} onRemove={removeNotification} />
      </div>
    );
  }

  // --- TELA DE DEVOLUÇÃO (ATUALIZADA) ---
  if (step === 'RETURN') {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-slate-900 flex flex-col transition-colors duration-300">
        {/* Cabeçalho */}
        <div className="bg-white dark:bg-slate-800 p-4 shadow-sm border-b dark:border-slate-700 flex items-center gap-2 sticky top-0 z-10">
          <button onClick={() => setStep('DETAILS')} className="p-2 -ml-2 text-gray-600 dark:text-slate-300"><ChevronLeft /></button>
          <h2 className="font-bold text-lg text-gray-800 dark:text-white">Registrar Devolução</h2>
        </div>

        <div className="flex-1 p-6 space-y-6 overflow-y-auto">
           {/* Seleção do Tipo */}
           <div className="space-y-3">
             <label className="text-sm font-bold text-gray-500 dark:text-slate-400 uppercase">O que aconteceu?</label>
             <div className="grid grid-cols-2 gap-4">
                <button onClick={() => setReturnType('TOTAL')} className={`p-4 rounded-xl border-2 font-bold transition-all text-left ${returnType === 'TOTAL' ? 'border-red-500 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 ring-2 ring-red-200 dark:ring-red-900' : 'border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-500 opacity-60'}`}>
                  <span className="block text-lg mb-1">Total</span>
                  <span className="text-xs font-normal">Cliente recusou tudo ou local fechado.</span>
                </button>
                <button onClick={() => setReturnType('PARTIAL')} className={`p-4 rounded-xl border-2 font-bold transition-all text-left ${returnType === 'PARTIAL' ? 'border-orange-500 bg-orange-50 dark:bg-orange-900/20 text-orange-700 dark:text-orange-400 ring-2 ring-orange-200 dark:ring-orange-900' : 'border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-500 opacity-60'}`}>
                  <span className="block text-lg mb-1">Parcial</span>
                  <span className="text-xs font-normal">Avaria, falta ou recusa de itens específicos.</span>
                </button>
             </div>
           </div>

           {/* LISTA DE DEVOLUÇÃO INTELIGENTE (NOVO CÓDIGO AQUI) */}
           {returnType === 'PARTIAL' && (
             <div className="space-y-3 animate-in fade-in slide-in-from-top-4">
                <label className="text-sm font-bold text-orange-600 dark:text-orange-400 uppercase flex items-center gap-2">
                  <Package size={16} /> Selecione o que voltou:
                </label>
                
                {/* Se tem itens do XML */}
                {invoice.items && invoice.items.length > 0 ? (
                    <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 divide-y divide-slate-100 dark:divide-slate-700 max-h-60 overflow-y-auto">
                        {invoice.items.map((item, idx) => {
                            const isSelected = selectedReturnItems.includes(item.code);
                            return (
                                <div 
                                    key={idx} 
                                    className={`p-3 flex items-start gap-3 cursor-pointer transition-colors ${isSelected ? 'bg-orange-50 dark:bg-orange-900/20' : 'hover:bg-slate-50 dark:hover:bg-slate-700/50'}`}
                                    onClick={() => {
                                        if (isSelected) setSelectedReturnItems(prev => prev.filter(id => id !== item.code));
                                        else setSelectedReturnItems(prev => [...prev, item.code]);
                                    }}
                                >
                                    <div className={`w-5 h-5 rounded border flex items-center justify-center mt-0.5 transition-all ${isSelected ? 'bg-orange-500 border-orange-500 text-white' : 'border-slate-300 dark:border-slate-500'}`}>
                                        {isSelected && <CheckCircle size={14} />}
                                    </div>
                                    <div className="flex-1">
                                        <p className={`text-sm font-bold leading-tight ${isSelected ? 'text-orange-800 dark:text-orange-300' : 'text-slate-700 dark:text-slate-200'}`}>
                                            {item.name}
                                        </p>
                                        <p className="text-xs text-slate-500 mt-1">
                                            Cód: {item.code} • Qtd: {item.quantity} {item.unit}
                                        </p>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                ) : (
                    // Se NÃO tem itens (Manual)
                    <textarea 
                      placeholder="Descreva os itens devolvidos..."
                      className="w-full p-4 rounded-lg border border-orange-300 dark:border-orange-800 bg-orange-50 dark:bg-orange-900/10 text-slate-900 dark:text-white focus:border-orange-500 outline-none h-32 resize-none placeholder:text-slate-400"
                      value={returnItems}
                      onChange={e => setReturnItems(e.target.value)}
                    />
                )}
             </div>
           )}

           {/* Motivo padronizado (obrigatório) */}
           <div className="space-y-3">
              <label className="text-sm font-bold text-gray-500 dark:text-slate-400 uppercase">
                Motivo da devolução <span className="text-red-500">*</span>
              </label>
              <div className="grid grid-cols-1 gap-2">
                {getReasonsFor(returnType).map(reason => {
                  const isSelected = reasonCode === reason.code;
                  return (
                    <button
                      key={reason.code}
                      onClick={() => setReasonCode(reason.code)}
                      className={`p-3 rounded-lg border text-left transition-all flex items-center justify-between gap-2 ${
                        isSelected
                          ? 'bg-red-600 text-white border-red-600 shadow-md'
                          : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-gray-300 dark:border-slate-600 active:bg-slate-50'
                      }`}
                    >
                      <span className="flex flex-col">
                        <span className="font-bold text-sm leading-tight">{reason.label}</span>
                        {reason.hint && (
                          <span className={`text-xs font-normal mt-0.5 ${isSelected ? 'text-red-100' : 'text-slate-400'}`}>
                            {reason.hint}
                          </span>
                        )}
                      </span>
                      {isSelected && <CheckCircle size={18} className="shrink-0" />}
                    </button>
                  );
                })}
              </div>
           </div>

           {/* Detalhe livre — só obrigatório quando o motivo é "Outro" */}
           <div className="space-y-2">
              <label className="text-sm font-bold text-gray-500 dark:text-slate-400 uppercase flex justify-between items-center">
                <span>
                  Detalhe {reasonCode === REASON_REQUIRES_DETAIL && <span className="text-red-500">*</span>}
                </span>
                {reasonCode !== REASON_REQUIRES_DETAIL && (
                  <span className="text-xs font-normal lowercase text-slate-400">(opcional)</span>
                )}
              </label>
              <textarea
                placeholder={
                  reasonCode === REASON_REQUIRES_DETAIL
                    ? "Descreva o que aconteceu..."
                    : "Algo a acrescentar? Ex: quem recebeu, quantidades, quem autorizou..."
                }
                className={`w-full p-4 rounded-lg border bg-white dark:bg-slate-800 text-slate-900 dark:text-white outline-none h-24 resize-none placeholder:text-slate-400 ${
                  reasonCode === REASON_REQUIRES_DETAIL
                    ? 'border-red-400 dark:border-red-700 focus:border-red-500'
                    : 'border-gray-300 dark:border-slate-600 focus:border-blue-500'
                }`}
                value={failureReason}
                onChange={e => setFailureReason(e.target.value)}
              />
           </div>
        </div>

        {/* Botão Confirmar */}
        <div className="p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] bg-white dark:bg-slate-800 border-t dark:border-slate-700 sticky bottom-0 z-50">
          <button onClick={() => submitDelivery(false)} className="w-full bg-red-600 hover:bg-red-700 text-white font-bold py-4 rounded-xl text-lg shadow-lg active:scale-95 transition-transform flex items-center justify-center gap-2">
            {loading ? <Loader2 className="animate-spin" /> : <AlertTriangle size={20} />}
            Confirmar Devolução {returnType === 'TOTAL' ? 'Total' : 'Parcial'}
          </button>
        </div>
        <ToastContainer notifications={notifications} onRemove={removeNotification} />
      </div>
    );
  }

// --- TELA DE PENDÊNCIA (NOVO) ---
  if (step === 'ISSUE') {
    return (
      <div className="min-h-screen bg-orange-50 dark:bg-slate-900 flex flex-col transition-colors duration-300">
        <div className="bg-white dark:bg-slate-800 p-4 shadow-sm border-b dark:border-slate-700 flex items-center gap-2 sticky top-0 z-10">
          <button onClick={() => setStep('DETAILS')} className="p-2 -ml-2 text-gray-600 dark:text-slate-300"><ChevronLeft /></button>
          <h2 className="font-bold text-lg text-orange-600 dark:text-orange-400 flex items-center gap-2">
            <AlertOctagon size={20}/> Reportar Pendência
          </h2>
        </div>

        <div className="flex-1 p-6 space-y-6 overflow-y-auto">
           
           <div className="bg-orange-100 dark:bg-orange-900/30 p-4 rounded-lg text-orange-800 dark:text-orange-200 text-sm border border-orange-200 dark:border-orange-800">
              Use esta opção para problemas internos como <strong>Avarias</strong>, <strong>Produtos Trocados</strong> ou <strong>Erros de Conferência</strong>.
           </div>

           {/* Seleção do Tipo de Problema */}
           <div className="space-y-3">
             <label className="text-sm font-bold text-gray-500 dark:text-slate-400 uppercase">Qual o problema?</label>
             <div className="grid grid-cols-1 gap-3">
                {['AVARIA', 'ERRO_CONFERENCIA', 'ITEM_FALTANTE', 'OUTRO'].map((type) => (
                    <button 
                        key={type}
                        onClick={() => setIssueType(type)}
                        className={`p-3 rounded-lg border text-left font-bold transition-all flex items-center justify-between ${
                            issueType === type 
                            ? 'bg-orange-600 text-white border-orange-600 shadow-md' 
                            : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-gray-300 dark:border-slate-600'
                        }`}
                    >
                        <span>{type.replace('_', ' ')}</span>
                        {issueType === type && <CheckCircle size={16}/>}
                    </button>
                ))}
             </div>
           </div>
            
           {/* LISTA DE ITENS PARA PENDÊNCIA (NOVO) */}
           {invoice.items && invoice.items.length > 0 && (
             <div className="space-y-2 mt-4">
               <label className="text-sm font-bold text-gray-500 dark:text-slate-400 uppercase flex justify-between">
                 Itens com Problema 
                 <span className="text-xs font-normal lowercase">(opcional)</span>
               </label>
               
               <div className="bg-white dark:bg-slate-800 rounded-lg border border-gray-200 dark:border-slate-700 divide-y divide-gray-100 dark:divide-slate-700 max-h-48 overflow-y-auto">
                 {invoice.items.map((item: any) => {
                   const isSelected = issueSelectedItems.has(item.code);
                   return (
                     <div 
                       key={item.code} 
                       onClick={() => toggleIssueItem(item.code)}
                       className={`p-3 flex items-center justify-between cursor-pointer transition-colors ${isSelected ? 'bg-orange-50 dark:bg-orange-900/20' : ''}`}
                     >
                       <div className="flex flex-col">
                         <span className={`text-sm font-medium ${isSelected ? 'text-orange-700 dark:text-orange-300' : 'text-slate-700 dark:text-slate-300'}`}>
                           {item.name}
                         </span>
                         <span className="text-xs text-gray-400">
                           Cód: {item.code} • Qtd: {item.quantity}
                         </span>
                       </div>
                       
                       <div className={`w-5 h-5 rounded border flex items-center justify-center transition-all ${isSelected ? 'bg-orange-500 border-orange-500 text-white' : 'border-gray-300 dark:border-slate-500'}`}>
                         {isSelected && <CheckCircle size={14} strokeWidth={3} />}
                       </div>
                     </div>
                   );
                 })}
               </div>
             </div>
           )}

           {/* Descrição */}
           <div className="space-y-2">
              <label className="text-sm font-bold text-gray-500 dark:text-slate-400 uppercase">Observação *</label>
              <textarea 
                placeholder="Descreva detalhadamente o que houve..."
                className="w-full p-4 rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:border-orange-500 outline-none h-24 resize-none"
                value={failureReason} 
                onChange={e => setFailureReason(e.target.value)}
              />
           </div>

           {/* Foto Obrigatória */}
           <div className="space-y-2">
             <h3 className="text-sm font-bold text-gray-500 dark:text-slate-400 uppercase tracking-wide">Foto da Ocorrência *</h3>
             <label className="block w-full">
                <div className={`border-2 border-dashed rounded-lg h-40 flex flex-col items-center justify-center cursor-pointer transition-colors ${photo ? 'border-green-500 bg-green-50 dark:bg-green-900/20' : 'border-orange-300 dark:border-orange-800 bg-orange-50 dark:bg-orange-900/10 hover:border-orange-500'}`}>
                  {photo ? (
                    <div className="relative w-full h-full p-2">
                      <img src={photo} className="w-full h-full object-contain rounded" alt="Evidence" />
                      <div className="absolute inset-0 flex items-center justify-center bg-black/40 text-white font-bold text-xs rounded">Toque para trocar</div>
                    </div>
                  ) : (
                    <>
                      <Camera className="text-orange-400 mb-2" size={32} />
                      <span className="text-orange-600 dark:text-orange-400 text-sm font-bold">Fotografar Problema</span>
                    </>
                  )}
                  <input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => handlePhotoCapture(e, 'proof')} />
                </div>
             </label>
           </div>
        </div>

        {/* Botão Confirmar */}
        <div className="p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] bg-white dark:bg-slate-800 border-t dark:border-slate-700 sticky bottom-0 z-50">
          <button 
            onClick={submitIssue} 
            disabled={loading}
            className="w-full bg-orange-600 hover:bg-orange-700 text-white font-bold py-4 rounded-xl text-lg shadow-lg active:scale-95 transition-transform flex items-center justify-center gap-2"
          >
            {loading ? <Loader2 className="animate-spin" /> : <AlertOctagon size={20} />}
            Confirmar Pendência
          </button>
        </div>
      </div>
    );
  }

  // --- TELA DE BAIXA (PROOF) ---
  if (step === 'PROOF') {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-slate-900 flex flex-col transition-colors duration-300">
        <div className="bg-white dark:bg-slate-800 p-4 shadow-sm border-b dark:border-slate-700 flex items-center gap-2 sticky top-0 z-10">
          <button onClick={() => setStep('DETAILS')} className="p-2 -ml-2 text-gray-600 dark:text-slate-300"><ChevronLeft /></button>
          <h2 className="font-bold text-lg text-gray-800 dark:text-white">Comprovante Digital</h2>
        </div>
        <div className="flex-1 p-4 space-y-6 overflow-y-auto">
          <div className={`p-3 rounded-lg flex items-center justify-center gap-2 text-xs font-bold ${frozenGeo ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800' : 'bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800'}`}>
             <MapPin size={14} />
             {frozenGeo ? 
               `Localização da Baixa Capturada: ${frozenGeo.lat.toFixed(5)}, ${frozenGeo.lng.toFixed(5)}` : 
               'Aguardando sinal GPS para vincular local...'
             }
          </div>

          <div className="space-y-4">
            <h3 className="text-sm font-bold text-gray-500 dark:text-slate-400 uppercase tracking-wide">1. Quem recebeu?</h3>
            <div className="grid gap-3">
              <input type="text" placeholder="Nome Completo *" className="w-full p-4 rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-none transition-all" value={receiverName} onChange={e => setReceiverName(e.target.value)}/>
              <input type="text" placeholder="Documento (RG/CPF)" className="w-full p-4 rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:border-blue-500 outline-none" value={receiverDoc} onChange={e => setReceiverDoc(e.target.value)}/>
            </div>
          </div>
          <div className="space-y-2">
             <h3 className="text-sm font-bold text-gray-500 dark:text-slate-400 uppercase tracking-wide">2. Assinatura do Cliente</h3>
             <SignatureCanvas className="shadow-sm h-80 w-full bg-white rounded-lg border border-gray-300" onEnd={setSignature}/>
          </div>
          
          {/* FOTO 1: LOCAL / MERCADORIA */}
          <div className="space-y-2">
             <h3 className="text-sm font-bold text-gray-500 dark:text-slate-400 uppercase tracking-wide">3. Foto do Local/Produto</h3>
             <label className="block w-full">
                <div className={`border-2 border-dashed rounded-lg h-32 flex flex-col items-center justify-center cursor-pointer transition-colors ${photo ? 'border-green-500 bg-green-50 dark:bg-green-900/20' : 'border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 hover:border-blue-400'}`}>
                  {photo ? (
                    <div className="relative w-full h-full p-2">
                      <img src={photo} className="w-full h-full object-contain rounded" alt="Proof" />
                      <div className="absolute inset-0 flex items-center justify-center bg-black/20 text-white font-bold text-xs">Toque para alterar</div>
                    </div>
                  ) : (
                    <>
                      <Camera className="text-gray-400 dark:text-slate-500 mb-2" />
                      <span className="text-gray-500 dark:text-slate-400 text-sm font-medium">Tirar Foto</span>
                    </>
                  )}
                  {/* CORREÇÃO: Chama passando o tipo 'proof' */}
                  <input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => handlePhotoCapture(e, 'proof')} />
                </div>
             </label>
          </div>

          {/* FOTO 2: CANHOTO (NOVO) */}
          <div className="space-y-2">
             <h3 className="text-sm font-bold text-gray-500 dark:text-slate-400 uppercase tracking-wide flex justify-between">
                <span>4. Foto do Canhoto (Opcional)</span>
                {photoStub && <span className="text-green-500 text-xs">OK</span>}
             </h3>
             <label className="block w-full">
                <div className={`border-2 border-dashed rounded-lg h-24 flex flex-col items-center justify-center cursor-pointer transition-colors ${photoStub ? 'border-green-500 bg-green-50 dark:bg-green-900/20' : 'border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 hover:border-blue-400'}`}>
                  {photoStub ? (
                    <div className="relative w-full h-full p-2">
                      <img src={photoStub} className="w-full h-full object-contain rounded" alt="Stub" />
                      <div className="absolute inset-0 flex items-center justify-center bg-black/20 text-white font-bold text-xs">Alterar</div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <FileText className="text-gray-400 dark:text-slate-500" />
                      <span className="text-gray-500 dark:text-slate-400 text-sm font-medium">Fotografar Canhoto</span>
                    </div>
                  )}
                  {/* CORREÇÃO: Chama passando o tipo 'stub' */}
                  <input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => handlePhotoCapture(e, 'stub')} />
                </div>
             </label>
          </div>

        </div>
        <div className="p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] bg-white dark:bg-slate-800 border-t dark:border-slate-700 sticky bottom-0 space-y-3 z-50">
          <button onClick={() => submitDelivery(true)} disabled={loading} className="w-full bg-green-600 hover:bg-green-700 text-white font-bold py-4 rounded-xl text-lg shadow-lg active:scale-95 transition-transform disabled:opacity-50 disabled:scale-100">
            {loading ? 'Enviando...' : 'Confirmar Entrega'}
          </button>
        </div>
        <ToastContainer notifications={notifications} onRemove={removeNotification} />
      </div>
    );
  }

  // --- TELA INICIAL (DETAILS) ---
  return (
    <div className="min-h-screen bg-white dark:bg-slate-900 flex flex-col transition-colors duration-300">
      <div className="bg-slate-900 dark:bg-black text-white p-6 pb-12 rounded-b-[2.5rem] shadow-lg relative">
        <button onClick={onBack} className="absolute top-6 left-6 p-2 -ml-2 hover:bg-white/10 rounded-full transition-colors"><ChevronLeft /></button>
        <div className="mt-8 text-center">
          <span className="inline-block px-3 py-1 bg-white/20 rounded-full text-xs font-medium mb-3">NF-e {invoice.number}</span>
          <h1 className="text-2xl font-bold leading-tight px-4">{invoice.customer_name}</h1>
          <div className="flex items-center justify-center gap-2 mt-3 mb-1 text-slate-300 text-sm font-mono bg-white/10 py-1 px-4 rounded-full mx-auto w-fit">
            <User size={14} /> <span>{invoice.customer_doc || 'Doc não informado'}</span>
          </div>
          <p className="text-slate-200 mt-2 text-sm px-8 mx-auto flex items-center justify-center gap-2 leading-relaxed opacity-90">
             <MapPin size={16} className="shrink-0 text-blue-400" /> {invoice.customer_address}
          </p>
        </div>
      </div>

      <div className="flex-1 px-6 -mt-8 pb-24">
         <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl border border-gray-100 dark:border-slate-700 p-6 space-y-6">
            <div className="flex justify-between items-center pb-4 border-b border-gray-100 dark:border-slate-700">
               <div className="text-center w-full">
                 <p className="text-xs text-gray-400 dark:text-slate-500 uppercase font-bold mb-1 flex items-center justify-center gap-1"><DollarSign size={14} className="text-green-600 dark:text-green-500"/> Valor Total</p>
                 <p className="text-3xl font-mono font-bold text-slate-800 dark:text-white tracking-tight">R$ {invoice.value.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
               </div>
            </div>
            
            <div className="grid grid-cols-2 gap-2">
              <button 
                onClick={() => handleNavigation('waze')}
                className="flex flex-col items-center justify-center p-4 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 rounded-xl hover:bg-blue-100 dark:hover:bg-blue-900/50 transition-colors"
              >
                <Navigation className="mb-2" /> <span className="text-[10px] font-bold">Waze</span>
              </button>
              <button 
                onClick={() => handleNavigation('maps')}
                className="flex flex-col items-center justify-center p-4 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 rounded-xl hover:bg-blue-100 dark:hover:bg-blue-900/50 transition-colors"
              >
                <MapIcon className="mb-2" /> <span className="text-[10px] font-bold">Maps</span>
              </button>
            </div>

            <div className="space-y-2">
               <h3 className="font-bold text-gray-800 dark:text-white flex items-center gap-2"><Truck size={18} className="text-gray-400"/> Veículo de Transporte</h3>
               <div className="bg-gray-50 dark:bg-slate-700/50 p-3 rounded-lg text-sm text-gray-600 dark:text-slate-300 space-y-1">
                 {vehicle ? (
                   <>
                     <p className="flex justify-between"><span>Placa:</span> <span className="font-bold uppercase">{vehicle.plate}</span></p>
                     <p className="flex justify-between"><span>Modelo:</span> <span>{vehicle.model}</span></p>
                   </>
                 ) : (
                   <p className="text-center text-gray-400">Veículo não atribuído</p>
                 )}
               </div>
            </div>

            <div className="space-y-2">
               <h3 className="font-bold text-gray-800 dark:text-white flex items-center gap-2"><FileText size={18} className="text-gray-400"/> Detalhes Técnicos</h3>
               <div className="bg-gray-50 dark:bg-slate-700/50 p-3 rounded-lg text-sm text-gray-600 dark:text-slate-300 space-y-1">
                 <p className="flex justify-between"><span>Série:</span> <span className="font-bold">{invoice.series}</span></p>
                 <p className="flex justify-between"><span>CEP:</span> <span>{invoice.customer_zip}</span></p>
                 <div className="pt-1 mt-1 border-t border-gray-200 dark:border-slate-600">
                    <span className="text-xs text-gray-400 block mb-1">Chave de Acesso:</span>
                    <span className="font-mono text-xs break-all bg-white dark:bg-slate-900 p-1 rounded border border-gray-200 dark:border-slate-600 block text-center">{invoice.access_key}</span>
                 </div>
               </div>
            </div>
         </div>
      </div>

      {/* Adicionei 'pb-[calc(1rem+env(safe-area-inset-bottom))]' para respeitar a barra do Android */}
      {/* Adicionei 'pb-[calc(1rem+env(safe-area-inset-bottom))]' para respeitar a barra do Android */}
      {/* BARRA DE AÇÕES INTELIGENTE */}
      <div className="fixed bottom-0 left-0 right-0 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] bg-white dark:bg-slate-900 border-t border-gray-100 dark:border-slate-800 shadow-[0_-5px_20px_rgba(0,0,0,0.05)] z-50">
        
        {!isReadOnly ? (
            // MODO OPERAÇÃO: Botões normais de trabalho
            <div className="flex gap-3">
                <button onClick={() => {
                    if (!routeStarted) {
                        notify("Atenção", "Rota não iniciada! Inicie a rota para ativar o GPS.", "WARNING");
                        return;
                    }
                    setStep('RETURN');
                  }}
                  className={`flex-1 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 font-bold py-4 rounded-xl hover:bg-red-200 dark:hover:bg-red-900/50 transition-colors ${!routeStarted ? 'opacity-50 cursor-not-allowed' : ''}`}>Devolver</button>
                
                <button 
                  onClick={() => {
                      if (!routeStarted) {
                          notify("Atenção", "Rota não iniciada! Inicie a rota para ativar o GPS.", "WARNING");
                          return;
                      }
                      setStep('PROOF');
                  }} 
                  className={`flex-[2] bg-blue-600 text-white font-bold py-4 rounded-xl shadow-lg shadow-blue-200 dark:shadow-none hover:bg-blue-700 active:scale-95 transition-all ${!routeStarted ? 'opacity-50 cursor-not-allowed' : ''}`}>
                    Realizar Baixa
                    {!routeStarted && <Lock size={16} className="inline ml-2" />}
                </button>

                {/* Botão Pendência (Meio - NOVO) */}
                <button onClick={() => {
                    if (!routeStarted) return notify("Atenção", "Inicie a rota primeiro.", "WARNING");
                    setStep('ISSUE');
                }}
                className="flex-1 bg-orange-50 dark:bg-orange-900/20 text-orange-600 dark:text-orange-400 font-bold py-3 rounded-xl border border-orange-100 dark:border-orange-800 text-xs flex flex-col items-center justify-center gap-1">
                    <AlertOctagon size={18} />
                    Pendência
                </button>


            </div>
        ) : (
            // MODO LEITURA: Apenas visualização
            <div className="space-y-3">
                <div className={`p-3 rounded-lg text-center font-bold text-sm border ${
                    invoice.status === 'DELIVERED' 
                    ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300 border-green-200 dark:border-green-800' 
                    : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 border-red-200 dark:border-red-800'
                }`}>
                    {invoice.status === 'DELIVERED' ? (
                        <span className="flex items-center justify-center gap-2"><CheckCircle size={16}/> Entrega Concluída</span>
                    ) : (
                        <span className="flex items-center justify-center gap-2"><XCircle size={16}/> Entrega Devolvida</span>
                    )}
                    <div className="text-xs font-normal opacity-80 mt-1">
                        Em {invoice.delivered_at ? new Date(invoice.delivered_at).toLocaleString() : 'Data não registrada'}
                    </div>
                </div>

                <button 
                    onClick={onBack} 
                    className="w-full bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-white font-bold py-3 rounded-xl hover:brightness-95 transition-colors"
                >
                    Voltar para Histórico
                </button>
            </div>
        )}
      </div>
      <ToastContainer notifications={notifications} onRemove={removeNotification} />
    </div>
  );
};