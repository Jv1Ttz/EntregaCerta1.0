import React, { useState, useEffect, useRef } from 'react';
import { db } from '../services/db';
import { Driver, Invoice, DeliveryStatus, DeliveryProof, Vehicle, AppNotification } from '../types';
import { Truck, MapPin, Navigation, Camera, CheckCircle, XCircle, ChevronLeft, Package, User, FileText, Map, DollarSign, Compass, Satellite, Navigation2, RefreshCw, MessageSquare, Sun, Moon } from 'lucide-react';
import SignatureCanvas from './ui/SignatureCanvas';
import { ToastContainer } from './ui/Toast';

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
  
  // Tracking State (GPS "Vivo")
  const [isTracking, setIsTracking] = useState(false);
  const [currentLocation, setCurrentLocation] = useState<{lat: number, lng: number} | null>(null);

  // Notification State
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  
  const watchIdRef = useRef<number | null>(null);
  const notifIntervalRef = useRef<number | null>(null);

  useEffect(() => {
    refreshData();
    startTracking();

    // Poll for notifications every 10 seconds
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
    };
  }, [driverId]);

  const startTracking = () => {
    if ('geolocation' in navigator) {
      watchIdRef.current = navigator.geolocation.watchPosition(
        (position) => {
          setIsTracking(true);
          const lat = position.coords.latitude;
          const lng = position.coords.longitude;
          
          // Atualiza a localização "viva"
          setCurrentLocation({ lat, lng });

          // Atualiza no banco (Debounce idealmente seria aplicado aqui)
          db.updateDriverLocation(driverId, lat, lng);
        },
        (error) => {
          console.warn("GPS Tracking warning:", error.message);
          setIsTracking(false);
        },
        {
          enableHighAccuracy: true, // Força maior precisão
          maximumAge: 10000,
          timeout: 10000
        }
      );
    }
  };

  const stopTracking = () => {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
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
    const addresses = pendingInvoices.map(i => `${i.customer_address} ${i.customer_zip}`);
    const destination = addresses[addresses.length - 1];
    const waypoints = addresses.slice(0, addresses.length - 1).join('|');
    const url = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}&waypoints=${encodeURIComponent(waypoints)}&travelmode=driving`;
    window.open(url, '_blank');
  };

  if (selectedInvoice) {
    const vehicle = vehicles.find(v => v.id === selectedInvoice.vehicle_id);
    return (
      <DeliveryAction 
        invoice={selectedInvoice} 
        vehicle={vehicle}
        currentGeo={currentLocation} // Passa a localização atual para ser congelada lá dentro
        onBack={() => {
          setSelectedInvoice(null);
          refreshData();
        }}
      />
    );
  }

  const pendingInvoices = invoices.filter(i => i.status !== DeliveryStatus.DELIVERED && i.status !== DeliveryStatus.FAILED);
  const historyInvoices = invoices.filter(i => i.status === DeliveryStatus.DELIVERED || i.status === DeliveryStatus.FAILED);

  const currentVehicleId = pendingInvoices[0]?.vehicle_id;
  const currentVehicle = vehicles.find(v => v.id === currentVehicleId);

  return (
    <div className="min-h-screen bg-gray-100 dark:bg-slate-900 pb-20 transition-colors duration-300">
      <ToastContainer notifications={notifications} onRemove={removeNotification} />

      {/* Header */}
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
              {isTracking && (
                <div className="flex items-center gap-1 text-green-400 animate-pulse">
                  <Satellite size={14} />
                  <span className="text-xs">GPS Ativo</span>
                </div>
              )}
            </div>
          </div>
          
          <div className="flex flex-col items-end gap-2">
            <button onClick={onLogout} className="text-xs bg-slate-800 dark:bg-slate-800 border border-slate-700 dark:border-slate-600 px-3 py-1 rounded-full text-slate-200">Sair</button>
            
            {/* Botão de Tema */}
            {toggleTheme && (
              <button 
                onClick={toggleTheme}
                className="p-2 bg-slate-800/50 rounded-full text-slate-400 hover:text-yellow-400 transition-colors"
              >
                {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="p-4 space-y-6">
        
        {/* Quick Actions - Apenas Iniciar Rota Agora */}
        {pendingInvoices.some(i => i.status === 'PENDING') && (
        <div className="grid grid-cols-1 gap-3">
            <button 
              onClick={async () => {
                if(confirm("Confirmar saída para entrega? O gestor será notificado.")) {
                  await db.startRoute(driverId);
                  refreshData();
                }
              }}
              className="bg-green-600 dark:bg-green-700 text-white p-4 rounded-xl shadow-lg flex items-center justify-center gap-2 active:scale-95 transition-transform animate-pulse"
            >
              <Navigation2 size={24} />
              <span className="font-bold text-lg">Iniciar Rota</span>
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
                <button 
                    onClick={refreshData}
                    className={`p-1.5 rounded-full border border-slate-200 dark:border-slate-600 ${refreshing ? 'bg-slate-100 dark:bg-slate-700 animate-spin' : 'bg-white dark:bg-slate-800'}`}
                >
                    <RefreshCw size={16} className="text-slate-600 dark:text-slate-300"/>
                </button>
                {pendingInvoices.length > 0 && (
                <button 
                    onClick={() => handleFullRouteNavigation(pendingInvoices)}
                    className="flex items-center gap-1 text-blue-600 dark:text-blue-400 text-sm font-bold bg-blue-50 dark:bg-blue-900/30 px-3 py-1 rounded-full border border-blue-100 dark:border-blue-800 active:scale-95 transition-transform"
                >
                    <Compass size={16} />
                    Mapa Completo
                </button>
                )}
             </div>
          </div>

          <div className="space-y-3">
            {pendingInvoices.length === 0 ? (
              <div className="text-center py-10 text-gray-400 dark:text-slate-500 bg-white dark:bg-slate-800 rounded-xl border border-dashed border-gray-300 dark:border-slate-600">
                Sem entregas pendentes.
              </div>
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
                       <div className="absolute -top-2 -right-2 bg-blue-500 text-white text-[10px] px-2 py-0.5 rounded-full font-bold shadow-sm flex items-center gap-1">
                         <Navigation2 size={10} /> EM ROTA
                       </div>
                    )}
                    <div className={`absolute top-4 left-0 w-1 h-8 rounded-r-full ${isInProgress ? 'bg-blue-500' : 'bg-orange-400'}`}></div>
                    <div className="flex justify-between items-start mb-2 pl-2">
                      <span className={`text-xs font-bold px-2 py-1 rounded-md ${isInProgress ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300' : 'bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300'}`}>
                        Parada #{index + 1}
                      </span>
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

        {historyInvoices.length > 0 && (
          <div>
            <h2 className="text-lg font-bold text-gray-800 dark:text-slate-300 mb-3 px-1 mt-6 opacity-70">Histórico</h2>
            <div className="space-y-2 opacity-70">
              {historyInvoices.map(inv => (
                <div key={inv.id} className="bg-white dark:bg-slate-800 p-4 rounded-lg border border-gray-200 dark:border-slate-700 flex justify-between items-center">
                  <div>
                    <div className="font-medium text-gray-800 dark:text-white">NF {inv.number}</div>
                    <div className="text-xs text-gray-500 dark:text-slate-400">{inv.customer_name}</div>
                  </div>
                  {inv.status === DeliveryStatus.DELIVERED ? (
                    <span className="text-green-600 dark:text-green-400 flex items-center gap-1 text-sm font-bold"><CheckCircle size={16}/> Entregue</span>
                  ) : (
                    <span className="text-red-500 dark:text-red-400 flex items-center gap-1 text-sm font-bold"><XCircle size={16}/> Falhou</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// -- Sub Component: Delivery Action Form --
// Alterado para CONGELAR a localização assim que abre
const DeliveryAction: React.FC<{ invoice: Invoice, vehicle?: Vehicle, currentGeo: {lat: number, lng: number} | null, onBack: () => void }> = ({ invoice, vehicle, currentGeo, onBack }) => {
  const [step, setStep] = useState<'DETAILS' | 'PROOF' | 'SUCCESS'>('DETAILS');
  
  // -- Lógica de Congelamento de Localização --
  // Usamos um estado local para salvar a coordenada no momento que a tela carrega
  const [frozenGeo, setFrozenGeo] = useState<{lat: number, lng: number} | null>(currentGeo);

  useEffect(() => {
    // Se entrou na tela e não tinha GPS, mas o GPS chegou depois de 1 segundo, atualiza.
    // Mas se já tiver (frozenGeo), mantém o original (congela).
    if (!frozenGeo && currentGeo) {
      setFrozenGeo(currentGeo);
    }
  }, [currentGeo, frozenGeo]);
  // ------------------------------------------

  const [receiverName, setReceiverName] = useState('');
  const [receiverDoc, setReceiverDoc] = useState('');
  const [signature, setSignature] = useState('');
  const [photo, setPhoto] = useState<string>('');
  const [failureReason, setFailureReason] = useState('');
  const [loading, setLoading] = useState(false);

  const handleNavigation = (app: 'waze' | 'maps') => {
    const fullAddress = `${invoice.customer_address} ${invoice.customer_zip}`;
    const encodedAddress = encodeURIComponent(fullAddress);

    if (app === 'waze') {
      window.open(`https://waze.com/ul?q=${encodedAddress}&navigate=yes`, '_blank');
    } else {
      window.open(`https://www.google.com/maps/dir/?api=1&destination=${encodedAddress}`, '_blank');
    }
  };

  const handlePhotoCapture = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (ev) => setPhoto(ev.target?.result as string);
      reader.readAsDataURL(file);
    }
  };

  const submitDelivery = async (success: boolean, reasonOverride?: string) => {
    const finalReason = reasonOverride || failureReason;

    if (success) {
      if (!signature && !photo) {
        alert("É necessário pelo menos uma Assinatura ou Foto para comprovar a entrega.");
        return;
      }
      if (!receiverName) {
         alert("Nome do recebedor é obrigatório.");
         return;
      }
    } else {
      if (!finalReason) {
        alert("Informe o motivo da devolução.");
        return;
      }
    }

    setLoading(true);

    try {
      const proof: DeliveryProof = {
        invoice_id: invoice.id,
        receiver_name: success ? receiverName : 'N/A',
        receiver_doc: success ? receiverDoc : 'N/A',
        signature_data: success ? signature : '',
        photo_url: success ? photo : '',
        // AQUI ESTÁ O TRUQUE: Usamos o frozenGeo, que é a localização de quando ele abriu a tela
        geo_lat: frozenGeo?.lat || null,
        geo_long: frozenGeo?.lng || null,
        delivered_at: new Date().toISOString(),
        failure_reason: success ? undefined : finalReason
      };

      await db.saveProof(proof);
      setStep('SUCCESS');
    } catch (e) {
      alert("Erro ao salvar entrega. Tente novamente.");
      console.error(e);
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
      </div>
    );
  }

  if (step === 'PROOF') {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-slate-900 flex flex-col transition-colors duration-300">
        <div className="bg-white dark:bg-slate-800 p-4 shadow-sm border-b dark:border-slate-700 flex items-center gap-2 sticky top-0 z-10">
          <button onClick={() => setStep('DETAILS')} className="p-2 -ml-2 text-gray-600 dark:text-slate-300"><ChevronLeft /></button>
          <h2 className="font-bold text-lg text-gray-800 dark:text-white">Comprovante Digital</h2>
        </div>
        <div className="flex-1 p-4 space-y-6 overflow-y-auto">
          {/* Indicador de Localização Congelada */}
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
             {/* Aumentei para h-80 (320px) para ficar grande no mobile */}
             <SignatureCanvas className="shadow-sm h-80 w-full bg-white rounded-lg border border-gray-300" onEnd={setSignature}/>
          </div>
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
                  <input type="file" accept="image/*" capture="environment" className="hidden" onChange={handlePhotoCapture} />
                </div>
             </label>
          </div>
        </div>
        <div className="p-4 bg-white dark:bg-slate-800 border-t dark:border-slate-700 sticky bottom-0 space-y-3">
          <button onClick={() => submitDelivery(true)} disabled={loading} className="w-full bg-green-600 hover:bg-green-700 text-white font-bold py-4 rounded-xl text-lg shadow-lg active:scale-95 transition-transform disabled:opacity-50 disabled:scale-100">
            {loading ? 'Enviando...' : 'Confirmar Entrega'}
          </button>
        </div>
      </div>
    );
  }

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
            
            <div className="grid grid-cols-3 gap-2">
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
                <Map className="mb-2" /> <span className="text-[10px] font-bold">Maps</span>
              </button>
              <button 
                onClick={() => {
                  const msg = `Olá ${invoice.customer_name}! Sou o motorista da EntregaCerta e estou a caminho com sua entrega (NF ${invoice.number}). Por favor, aguarde no local.`;
                  const url = `https://wa.me/?text=${encodeURIComponent(msg)}`;
                  window.open(url, '_blank');
                }}
                className="flex flex-col items-center justify-center p-4 bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400 rounded-xl hover:bg-green-100 dark:hover:bg-green-900/50 transition-colors"
              >
                <MessageSquare className="mb-2" /> <span className="text-[10px] font-bold">Avisar</span>
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

      <div className="fixed bottom-0 left-0 right-0 p-4 bg-white dark:bg-slate-900 border-t border-gray-100 dark:border-slate-800 flex gap-3 shadow-[0_-5px_20px_rgba(0,0,0,0.05)]">
        <button onClick={() => {
            const reason = prompt("Qual o motivo da devolução?");
            if(reason) { 
              submitDelivery(false, reason); 
            }
          }}
          className="flex-1 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 font-bold py-4 rounded-xl hover:bg-red-200 dark:hover:bg-red-900/50 transition-colors">Devolver</button>
        <button onClick={() => setStep('PROOF')} className="flex-[2] bg-blue-600 text-white font-bold py-4 rounded-xl shadow-lg shadow-blue-200 dark:shadow-none hover:bg-blue-700 active:scale-95 transition-all">Realizar Baixa</button>
      </div>
    </div>
  );
};