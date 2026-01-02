import React, { useState, useEffect, useRef, useMemo } from 'react';
import { db } from '../services/db';
import { sefazApi } from '../services/sefazApi';
import { Driver, Invoice, DeliveryStatus, Vehicle, DeliveryProof, AppNotification, InvoiceItem } from '../types';
import { Truck, Upload, Map, FileText, CheckCircle, AlertTriangle, Clock, ScanBarcode, X, Search, Loader2, UserPlus, Users, PlusCircle, CheckSquare, Square, Satellite, ExternalLink, Trash2, Eye, Calendar, User, KeyRound, Settings, Navigation2, RefreshCw, Zap, Filter, Download, Maximize2, DollarSign, TrendingUp, TrendingDown, Award, Sun, Moon, Printer, UploadCloud, FileCheck, XCircle, LayoutDashboard} from 'lucide-react';
import { Html5QrcodeScanner } from 'html5-qrcode';
import { ToastContainer } from './ui/Toast';

interface AdminViewProps {
  toggleTheme?: () => void;
  theme?: string;
}

export const AdminView: React.FC<AdminViewProps> = ({ toggleTheme, theme }) => {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [uploading, setUploading] = useState(false);
  const [processingKey, setProcessingKey] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [lastUpdate, setLastUpdate] = useState(new Date());
  
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedInvoiceIds, setSelectedInvoiceIds] = useState<Set<string>>(new Set());
  const [bulkDriver, setBulkDriver] = useState<string>("");
  const [bulkVehicle, setBulkVehicle] = useState<string>("");
  
  const [showAddDriver, setShowAddDriver] = useState(false);
  const [showAddVehicle, setShowAddVehicle] = useState(false);
  const [showFleetMonitor, setShowFleetMonitor] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  
  const [viewingProof, setViewingProof] = useState<{invoice: Invoice, proof: DeliveryProof} | null>(null);
  const [zoomedImage, setZoomedImage] = useState<string | null>(null);
  
  const [notifications, setNotifications] = useState<AppNotification[]>([]);

  const [newDriverName, setNewDriverName] = useState('');
  const [newDriverPassword, setNewDriverPassword] = useState('');
  
  const [newVehiclePlate, setNewVehiclePlate] = useState('');
  const [newVehicleModel, setNewVehicleModel] = useState('');
  const [newAdminPassword, setNewAdminPassword] = useState('');

  const scannerRef = useRef<Html5QrcodeScanner | null>(null);
  const fleetIntervalRef = useRef<number | null>(null);
  const notifIntervalRef = useRef<number | null>(null);

  const [showImportModal, setShowImportModal] = useState(false);
  const [importSummary, setImportSummary] = useState<{ total: number; success: number; duplicates: number; errors: number; details: string[] } | null>(null);
  const [isDragging, setIsDragging] = useState(false);


  // --- NOVOS ESTADOS DE FILTRO ---
  const [filterDriver, setFilterDriver] = useState('');
  const [filterVehicle, setFilterVehicle] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterStartDate, setFilterStartDate] = useState('');
  const [filterEndDate, setFilterEndDate] = useState('');

// 1. ESTADOS DO FILTRO DE DATA
  const [dashStartDate, setDashStartDate] = useState('');
  const [dashEndDate, setDashEndDate] = useState('');

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
      .sort((a, b) => b.value - a.value)
      .slice(0, 5);
  }, [dashboardData, drivers]);
  

  // 3. MÉTRICAS FINANCEIRAS E OPERACIONAIS (Baseadas no filtro acima)
  
  // R$ Total Entregue (Sucesso)
  const totalDeliveredValue = dashboardData
    .filter(i => i.status === 'DELIVERED')
    .reduce((acc, inv) => acc + inv.value, 0);

  // R$ Total Devolvido (Falha)
  const totalFailedValue = dashboardData
    .filter(i => i.status === 'FAILED')
    .reduce((acc, inv) => acc + inv.value, 0);

  // Contagens Simples
  const countPending = dashboardData.filter(i => i.status === 'PENDING').length;
  const countProgress = dashboardData.filter(i => i.status === 'IN_PROGRESS').length;
  const countDelivered = dashboardData.filter(i => i.status === 'DELIVERED').length;
  const countFailed = dashboardData.filter(i => i.status === 'FAILED').length;

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

      // 2. Filtro de Motorista
      const matchesDriver = !filterDriver || inv.driver_id === filterDriver;

      // 3. Filtro de Veículo
      const matchesVehicle = !filterVehicle || inv.vehicle_id === filterVehicle;

      // 4. Filtro de Status
      const matchesStatus = !filterStatus || inv.status === filterStatus;

      // 5. Filtro de DATA POR PERÍODO (Intervalo) 📅
      // Pegamos apenas a parte YYYY-MM-DD da data de criação da nota
      const invoiceDate = inv.created_at.split('T')[0];
      
      const matchesStart = !filterStartDate || invoiceDate >= filterStartDate;
      const matchesEnd = !filterEndDate || invoiceDate <= filterEndDate;

      return matchesSearch && matchesDriver && matchesVehicle && matchesStatus && matchesStart && matchesEnd;
    });
  }, [invoices, searchTerm, filterDriver, filterVehicle, filterStatus, filterStartDate, filterEndDate]);

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
    if (proof) {
      setViewingProof({ invoice, proof });
    } else {
      alert("Comprovante ainda não sincronizado ou não encontrado.");
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
      message: 'Ao remover este motorista, todas as entregas vinculadas a ele voltarão para o status "Pendente".'
    });
  };

  const handleCreateVehicle = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newVehiclePlate && newVehicleModel) {
      try {
        await db.addVehicle({
          id: `v-${Date.now()}`,
          plate: newVehiclePlate.toUpperCase(),
          model: newVehicleModel
        });
        setNewVehiclePlate('');
        setNewVehicleModel('');
        refreshData();
      } catch (error) {
        console.error(error);
        alert("Erro ao cadastrar veículo.");
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

  const getStatusBadge = (status: DeliveryStatus) => {
    const styles = {
      [DeliveryStatus.PENDING]: 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-400 border-yellow-200 dark:border-yellow-800',
      [DeliveryStatus.IN_PROGRESS]: 'bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-400 border-blue-200 dark:border-blue-800',
      [DeliveryStatus.DELIVERED]: 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-400 border-green-200 dark:border-green-800',
      [DeliveryStatus.FAILED]: 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-400 border-red-200 dark:border-red-800',
    };
    
    const labels = {
      [DeliveryStatus.PENDING]: 'Pendente',
      [DeliveryStatus.IN_PROGRESS]: 'Em Rota',
      [DeliveryStatus.DELIVERED]: 'Entregue',
      [DeliveryStatus.FAILED]: 'Devolvido',
    };

    return (
      <span className={`px-2 py-1 rounded-full text-xs font-bold border flex items-center gap-1 w-fit ${styles[status]}`}>
        {status === DeliveryStatus.IN_PROGRESS && <Navigation2 size={10} className="animate-pulse" />}
        {labels[status]}
      </span>
    );
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 pb-20 transition-colors duration-300">
      <ToastContainer notifications={notifications} onRemove={removeNotification} />

      {/* Header */}
      <header className="bg-slate-900 dark:bg-black text-white p-4 shadow-md sticky top-0 z-10 border-b border-slate-700">
        <div className="container mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Truck className="h-6 w-6 text-blue-400" />
            <h1 className="text-xl font-bold tracking-tight">EntregaCerta <span className="text-slate-400 font-normal">| Gestão</span></h1>
          </div>
          <div className="flex items-center gap-4">
            {/* --- NOVO BOTÃO DE TEMA AQUI --- */}
            {toggleTheme && (
              <button 
                onClick={toggleTheme}
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

      <main className="container mx-auto p-4 md:p-8 space-y-6">
        
       

        {/* Actions Bar */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white dark:bg-slate-800 p-4 rounded-lg border border-slate-200 dark:border-slate-700 shadow-sm">
          <div>
            <h2 className="text-lg font-semibold text-slate-800 dark:text-white">Painel de Controle</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">Gerencie recursos e distribua cargas.</p>
          </div>
          
          <div className="flex flex-wrap gap-2 w-full md:w-auto">
            <button onClick={() => setShowFleetMonitor(true)} className="flex items-center justify-center gap-2 px-3 py-2 bg-blue-50 dark:bg-blue-900/30 hover:bg-blue-100 dark:hover:bg-blue-900/50 text-blue-700 dark:text-blue-400 border border-blue-200 dark:border-blue-800 rounded-md transition-colors shadow-sm animate-pulse">
              <Satellite className="h-4 w-4" /> <span className="font-medium text-sm">Monitorar Frota</span>
            </button>
            
            <button onClick={() => setShowAddVehicle(true)} className="flex items-center justify-center gap-2 px-3 py-2 bg-white dark:bg-slate-700 hover:bg-slate-50 dark:hover:bg-slate-600 text-slate-700 dark:text-white border border-slate-300 dark:border-slate-600 rounded-md transition-colors shadow-sm">
              <Truck className="h-4 w-4" /> <span className="font-medium text-sm">Gerir Veículos</span>
            </button>
            
            <button onClick={() => setShowAddDriver(true)} className="flex items-center justify-center gap-2 px-3 py-2 bg-white dark:bg-slate-700 hover:bg-slate-50 dark:hover:bg-slate-600 text-slate-700 dark:text-white border border-slate-300 dark:border-slate-600 rounded-md transition-colors shadow-sm">
              <UserPlus className="h-4 w-4" /> <span className="font-medium text-sm">Gerir Motoristas</span>
            </button>

            <button onClick={() => setShowScanner(true)} disabled={uploading || processingKey} className="flex items-center justify-center gap-2 px-3 py-2 bg-slate-800 dark:bg-slate-700 hover:bg-slate-700 text-white rounded-md transition-colors shadow-sm disabled:opacity-50">
              <ScanBarcode className="h-4 w-4" /> <span className="font-medium text-sm">Ler DANFE</span>
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
            <div className="flex items-center gap-2 bg-slate-50 dark:bg-slate-900 p-2 rounded-lg border border-slate-200 dark:border-slate-700">
                <div className="flex items-center gap-2 px-2 border-r border-slate-200 dark:border-slate-700">
                   <Clock size={14} className="text-slate-400"/>
                   <span className="text-xs font-bold text-slate-500 uppercase">Período</span>
                </div>
                <input 
                    type="date" 
                    className="bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-blue-500 dark:text-white cursor-pointer"
                    value={dashStartDate}
                    onChange={(e) => setDashStartDate(e.target.value)}
                />
                <span className="text-slate-400">-</span>
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
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
           {[
             { label: 'Pendentes', count: countPending, icon: Clock, color: 'text-yellow-600 dark:text-yellow-400', bg: 'bg-yellow-50 dark:bg-yellow-900/20' },
             { label: 'Em Rota', count: countProgress, icon: Navigation2, color: 'text-blue-600 dark:text-blue-400', bg: 'bg-blue-50 dark:bg-blue-900/20' },
             { label: 'Entregues', count: countDelivered, icon: CheckCircle, color: 'text-green-600 dark:text-green-400', bg: 'bg-green-50 dark:bg-green-900/20' },
             { label: 'Devoluções', count: countFailed, icon: AlertTriangle, color: 'text-red-600 dark:text-red-400', bg: 'bg-red-50 dark:bg-red-900/20' },
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
               <p className="text-xs text-slate-400 mt-1">Soma das notas baixadas no período.</p>
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
               <p className="text-xs text-slate-400 mt-1">Soma das falhas no período.</p>
             </div>
          </div>

          {/* Card 3: Ranking de Motoristas (RESTAURADO COM LÓGICA NOVA) */}
          <div className="bg-white dark:bg-slate-800 p-4 rounded-lg border border-slate-200 dark:border-slate-700 shadow-sm flex flex-col h-[200px]">
             <div className="flex items-center justify-between mb-4 border-b border-slate-100 dark:border-slate-700 pb-2">
               <h3 className="font-bold text-slate-700 dark:text-slate-200 flex items-center gap-2">
                 <Award className="text-orange-500" size={20}/> Top Motoristas
               </h3>
               <span className="text-[10px] bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 px-2 py-1 rounded font-bold">Por Valor</span>
             </div>
             
             <div className="flex-1 overflow-y-auto space-y-3 pr-2 scrollbar-thin scrollbar-thumb-slate-200 dark:scrollbar-thumb-slate-600">
               {driverRanking.length === 0 ? (
                 <div className="h-full flex flex-col items-center justify-center text-slate-400 text-sm italic opacity-60">
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
                         <p className="text-[10px] text-slate-400">
                           {driver.value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                         </p>
                       </div>
                     </div>
                     <span className="text-xs font-bold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 px-2 py-0.5 rounded-full">
                       {driver.count}
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
        <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 shadow-sm flex flex-col h-[calc(100vh-80px)]"> 
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
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
               
               {/* 1. Busca Texto (1 Espaço) */}
               <div className="relative col-span-2 md:col-span-1 xl:col-span-1">
                 <Search className="absolute left-3 top-2.5 text-slate-400 h-4 w-4" />
                 <input 
                   type="text" 
                   placeholder="Buscar..." 
                   className="w-full pl-9 p-2 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-md text-sm outline-none focus:ring-2 focus:ring-blue-500 text-slate-900 dark:text-white"
                   value={searchTerm}
                   onChange={(e) => setSearchTerm(e.target.value)}
                 />
               </div>

               {/* 2. Filtro Motorista (1 Espaço) */}
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

               {/* 3. Filtro Veículo (1 Espaço) */}
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

               {/* 4. Filtro Status (1 Espaço) */}
               <div className="col-span-1">
                 <select 
                   className="w-full p-2 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-md text-sm outline-none focus:ring-2 focus:ring-blue-500 text-slate-700 dark:text-slate-200"
                   value={filterStatus}
                   onChange={(e) => setFilterStatus(e.target.value)}
                 >
                   <option value="">Status</option>
                   <option value="PENDING">Pendente</option>
                   <option value="IN_PROGRESS">Em Rota</option>
                   <option value="DELIVERED">Entregue</option>
                   <option value="FAILED">Devolvido</option>
                 </select>
               </div>

               {/* 5. Filtro Data (2 ESPAÇOS - O DOBRO DE TAMANHO) */}
               {/* Aqui usamos col-span-2 no Desktop (xl) para a data respirar */}
               <div className="flex gap-2 items-center col-span-2 md:col-span-2 xl:col-span-2">
                 <div className="relative flex-1 min-w-0"> {/* min-w-0 evita overflow */}
                    <span className="absolute -top-2 left-2 bg-slate-50 dark:bg-slate-900 px-1 text-[10px] text-slate-400 font-bold z-10">De</span>
                    <input 
                      type="date"
                      className="w-full p-2 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-md text-sm outline-none focus:ring-2 focus:ring-blue-500 text-slate-700 dark:text-slate-200"
                      value={filterStartDate}
                      onChange={(e) => setFilterStartDate(e.target.value)}
                    />
                 </div>
                 
                 <div className="relative flex-1 min-w-0">
                    <span className="absolute -top-2 left-2 bg-slate-50 dark:bg-slate-900 px-1 text-[10px] text-slate-400 font-bold z-10">Até</span>
                    <input 
                      type="date"
                      className="w-full p-2 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-md text-sm outline-none focus:ring-2 focus:ring-blue-500 text-slate-700 dark:text-slate-200"
                      value={filterEndDate}
                      onChange={(e) => setFilterEndDate(e.target.value)}
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
                  }}
                  className="text-xs text-red-500 hover:underline flex items-center gap-1"
                >
                    <X size={12} /> Limpar todos os filtros
                </button>
            )}
          </div>
          
          {/* TABELA COM SCROLL INTERNO (Resolve o Ponto 2) */}
          <div className="flex-1 overflow-auto"> 
            <table className="w-full text-sm text-left text-slate-600 dark:text-slate-400">
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
                  <th className="px-6 py-4 bg-slate-700 dark:bg-slate-900 font-bold tracking-wider">Nota / Data</th>
                  <th className="px-6 py-4 bg-slate-700 dark:bg-slate-900 font-bold tracking-wider">Cliente</th>
                  <th className="px-6 py-4 bg-slate-700 dark:bg-slate-900 font-bold tracking-wider">Status</th>
                  <th className="px-6 py-4 bg-slate-700 dark:bg-slate-900 font-bold tracking-wider">Motorista</th>
                  <th className="px-6 py-4 bg-slate-700 dark:bg-slate-900 font-bold tracking-wider">Veículo</th>
                  
                  {/* Célula de Ações (Canto direito arredondado) */}
                  <th className="px-6 py-4 text-right bg-slate-700 dark:bg-slate-900 rounded-tr-lg font-bold tracking-wider">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                {filteredInvoices.length === 0 ? (
                   <tr>
                     <td colSpan={7} className="px-6 py-12 text-center text-slate-400 flex flex-col items-center justify-center gap-2 w-full">
                       <Search size={32} className="opacity-20 mb-2"/>
                       <p>Nenhuma nota encontrada com os filtros atuais.</p>
                     </td>
                   </tr>
                ) : (
                  filteredInvoices.map((inv) => (
                    <tr key={inv.id} className={`bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors ${selectedInvoiceIds.has(inv.id) ? 'bg-blue-50 dark:bg-blue-900/20' : ''}`}>
                      <td className="px-6 py-4">
                        <button onClick={() => toggleSelectOne(inv.id)} className="flex items-center justify-center text-slate-400 hover:text-blue-600 dark:hover:text-blue-400">
                          {selectedInvoiceIds.has(inv.id) ? <CheckSquare size={18} className="text-blue-600 dark:text-blue-400"/> : <Square size={18}/>}
                        </button>
                      </td>
                      <td className="px-6 py-4">
                        <div className="font-medium text-slate-900 dark:text-white">{inv.number}-{inv.series}</div>
                        <div className="text-[10px] text-slate-400">
                            {new Date(inv.created_at).toLocaleDateString('pt-BR')}
                        </div>
                      </td>
                      <td className="px-6 py-4 max-w-[200px]">
                        <div className="font-medium text-slate-900 dark:text-white truncate" title={inv.customer_name}>{inv.customer_name}</div>
                        <div className="text-xs text-slate-500 dark:text-slate-400 truncate" title={inv.customer_address}>{inv.customer_address}</div>
                      </td>
                      <td className="px-6 py-4">
                    {getStatusBadge(inv.status)}
                      </td>
                      
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
                        <div className="flex justify-end gap-2">
                         {/* Visualizar Comprovante */}
                         {(inv.status === DeliveryStatus.DELIVERED || inv.status === DeliveryStatus.FAILED) && (
                            <button
                              onClick={() => handleViewProof(inv)}
                              className="text-blue-500 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 transition-colors p-2 rounded-full hover:bg-blue-50 dark:hover:bg-blue-900/30"
                              title="Ver Comprovante"
                            >
                              <Eye size={18} />
                            </button>
                         )}
                         
                         {/* Botão de Excluir Novo */}
                         <button 
                           onClick={() => handleDeleteInvoice(inv.id)}
                           className="text-slate-400 hover:text-red-600 dark:hover:text-red-400 transition-colors p-2 rounded-full hover:bg-red-50 dark:hover:bg-red-900/30"
                           title="Excluir Nota"
                         >
                           <Trash2 size={18} />
                         </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>

  {processingKey && (
        <div className="fixed inset-0 z-[60] flex flex-col items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-800 p-6 rounded-lg shadow-xl flex flex-col items-center">
             <Loader2 className="h-10 w-10 text-blue-600 animate-spin mb-4" />
             <h3 className="text-lg font-bold dark:text-white">Consultando SEFAZ...</h3>
             <p className="text-sm text-gray-500">Buscando dados da chave...</p>
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

     {/* Proof Viewer Modal */}
      {viewingProof && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-in fade-in duration-200">
           {/* ADICIONADO ID: printable-proof */}
           <div id="printable-proof" className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-3xl overflow-hidden max-h-[90vh] flex flex-col relative">
              
              {/* CABEÇALHO SÓ PARA IMPRESSÃO (Logotipo no Papel) */}
              <div className="hidden print:block p-8 border-b border-gray-300 mb-4">
                 <h1 className="text-2xl font-bold text-slate-900">EntregaCerta | Comprovante Digital</h1>
                 <p className="text-sm text-slate-500">Documento gerado eletronicamente em {new Date().toLocaleString()}</p>
              </div>

              {/* Cabeçalho Visual da Tela */}
              <div className={`p-5 text-white flex justify-between items-center ${viewingProof.proof.failure_reason ? 'bg-red-600 dark:bg-red-700' : 'bg-green-600 dark:bg-green-700'}`}>
                 <div>
                    <h3 className="font-bold flex items-center gap-2 text-lg">
                      <FileText size={22} />
                      {viewingProof.proof.failure_reason ? 'Devolução / Falha' : 'Comprovante de Entrega'}
                    </h3>
                    <p className="text-white/80 text-sm">NF-e {viewingProof.invoice.number} • R$ {viewingProof.invoice.value.toLocaleString('pt-BR', {minimumFractionDigits: 2})}</p>
                 </div>
                 {/* Botão Fechar (Some na impressão) */}
                 <button onClick={() => setViewingProof(null)} className="hover:bg-white/20 rounded-full p-2 transition-colors no-print"><X size={24} /></button>
              </div>
              
              <div className="overflow-y-auto p-6 space-y-6">
                
                {/* Status Banner */}
                {/* STATUS BANNER (ATUALIZADO PARA SUPORTAR PARCIAL/TOTAL) */}
                {viewingProof.proof.failure_reason && (
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
                        {viewingProof.proof.failure_reason}
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
                   </div>

                   <div className="space-y-4">
                      <h4 className="font-bold text-slate-700 dark:text-slate-300 uppercase text-sm border-b dark:border-slate-700 pb-1">Dados da Operação</h4>
                      <div className="space-y-3">
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
                            <Map className="text-slate-400 mt-1" size={18} />
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
                        <span className="text-slate-400 italic text-sm">Não assinada</span>
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
                        <span className="text-slate-400 italic text-sm">Sem foto</span>
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
                        <span className="text-slate-400 italic text-sm">Não anexado</span>
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

      {/* Fleet Monitor Modal */}
      {showFleetMonitor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-200">
           <div className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-4xl h-[80vh] flex flex-col overflow-hidden border border-slate-200 dark:border-slate-700">
              <div className="p-4 bg-slate-800 dark:bg-black text-white flex justify-between items-center shrink-0">
                 <h3 className="font-bold flex items-center gap-2"><Satellite size={20} className="text-green-400"/> Monitoramento em Tempo Real</h3>
                 <button onClick={() => setShowFleetMonitor(false)} className="hover:bg-slate-700 rounded-full p-1"><X size={20} /></button>
              </div>
              <div className="flex-1 overflow-y-auto p-4 bg-slate-100 dark:bg-slate-900">
                <div className="grid md:grid-cols-2 gap-4">
                  {drivers.map(d => {
                    const hasLocation = !!d.last_location;
                    const lastUpdate = hasLocation ? new Date(d.last_location!.updated_at) : null;
                    const isOnline = lastUpdate && (new Date().getTime() - lastUpdate.getTime() < 5 * 60 * 1000); 
                    
                    return (
                      <div key={d.id} className="bg-white dark:bg-slate-800 p-4 rounded-lg shadow-sm border border-slate-200 dark:border-slate-700 flex flex-col justify-between">
                        <div className="flex justify-between items-start mb-4">
                          <div className="flex items-center gap-3">
                            <div className={`w-3 h-3 rounded-full ${isOnline ? 'bg-green-500 animate-pulse' : 'bg-gray-300 dark:bg-gray-600'}`}></div>
                            <div>
                              <h4 className="font-bold text-slate-800 dark:text-white">{d.name}</h4>
                              <p className="text-xs text-slate-500 dark:text-slate-400">
                                {isOnline ? 'Sinal Ativo' : 'Sem sinal recente'}
                              </p>
                            </div>
                          </div>
                          <div className="text-right">
                             {hasLocation && (
                               <p className="text-xs text-slate-400 font-mono">
                                 {lastUpdate?.toLocaleTimeString()}
                               </p>
                             )}
                          </div>
                        </div>

                        {hasLocation ? (
                           <div className="space-y-3">
                              <div className="text-xs bg-slate-50 dark:bg-slate-700 p-2 rounded border border-slate-100 dark:border-slate-600 text-slate-600 dark:text-slate-300 font-mono">
                                {d.last_location!.lat.toFixed(6)}, {d.last_location!.lng.toFixed(6)}
                              </div>
                              <a 
                                href={`https://www.google.com/maps?q=${d.last_location!.lat},${d.last_location!.lng}`} 
                                target="_blank"
                                rel="noreferrer"
                                className="flex items-center justify-center gap-2 w-full bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 py-2 rounded-md text-sm font-bold hover:bg-blue-100 dark:hover:bg-blue-900/50 transition-colors"
                              >
                                <ExternalLink size={16} /> Abrir no Mapa
                              </a>
                           </div>
                        ) : (
                          <div className="bg-gray-50 dark:bg-slate-700/50 p-4 rounded text-center text-sm text-gray-400 italic">
                            Aguardando primeira localização...
                          </div>
                        )}
                      </div>
                    )
                  })}
                  {drivers.length === 0 && <div className="text-center text-gray-400 col-span-2 py-10">Nenhum motorista cadastrado.</div>}
                </div>
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
                 <button onClick={() => setShowSettings(false)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"><X size={20} /></button>
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
                 <button onClick={() => setShowAddDriver(false)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"><X size={20} /></button>
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
                      <p className="text-center text-gray-400 text-sm italic">Nenhum motorista.</p>
                    ) : (
                      drivers.map(d => (
                        <div key={d.id} className="bg-white dark:bg-slate-800 p-3 rounded border border-gray-200 dark:border-slate-600 flex justify-between items-center shadow-sm">
                           <div>
                              <span className="font-medium text-slate-800 dark:text-white block">{d.name}</span>
                              <div className="flex items-center gap-1 text-xs text-slate-400">
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

      {/* Manage/Add Vehicle Modal */}
      {showAddVehicle && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-200">
           <div className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col max-h-[80vh] border border-slate-200 dark:border-slate-700">
              <div className="p-4 bg-slate-100 dark:bg-slate-900 border-b dark:border-slate-700 flex justify-between items-center shrink-0">
                 <h3 className="font-bold text-slate-800 dark:text-white flex items-center gap-2"><Truck size={20} className="text-blue-600 dark:text-blue-400"/> Gerenciar Veículos</h3>
                 <button onClick={() => setShowAddVehicle(false)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"><X size={20} /></button>
              </div>
              
              <div className="p-6 border-b border-slate-100 dark:border-slate-700 shrink-0">
                 <h4 className="text-sm font-bold text-slate-600 dark:text-slate-400 mb-2 uppercase">Novo Cadastro</h4>
                 <form onSubmit={handleCreateVehicle} className="space-y-3">
                    <div className="grid grid-cols-2 gap-2">
                       <input type="text" required className="w-full p-2 border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-white rounded-md focus:ring-2 focus:ring-blue-500 outline-none text-sm" placeholder="Modelo" value={newVehicleModel} onChange={e => setNewVehicleModel(e.target.value)} />
                       <input type="text" required className="w-full p-2 border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-white rounded-md focus:ring-2 focus:ring-blue-500 outline-none uppercase text-sm" placeholder="Placa" value={newVehiclePlate} onChange={e => setNewVehiclePlate(e.target.value)} />
                    </div>
                    <button type="submit" className="w-full bg-blue-600 text-white font-bold py-2 rounded-md hover:bg-blue-700 transition-colors text-sm">Cadastrar</button>
                 </form>
              </div>

              <div className="flex-1 overflow-y-auto p-6 bg-slate-50 dark:bg-slate-900/50">
                 <h4 className="text-sm font-bold text-slate-600 dark:text-slate-400 mb-2 uppercase">Veículos Cadastrados</h4>
                 <div className="space-y-2">
                    {vehicles.length === 0 ? (
                      <p className="text-center text-gray-400 text-sm italic">Nenhum veículo.</p>
                    ) : (
                      vehicles.map(v => (
                        <div key={v.id} className="bg-white dark:bg-slate-800 p-3 rounded border border-gray-200 dark:border-slate-600 flex justify-between items-center shadow-sm">
                           <div>
                             <span className="font-bold text-slate-800 dark:text-white uppercase block">{v.plate}</span>
                             <span className="text-xs text-slate-500 dark:text-slate-400">{v.model}</span>
                           </div>
                           <button 
                             onClick={() => handleDeleteVehicle(v.id)}
                             className="text-red-400 hover:text-red-600 p-1 hover:bg-red-50 dark:hover:bg-red-900/30 rounded"
                             title="Remover Veículo"
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
      {/* --- LIGHTBOX / ZOOM DA IMAGEM --- */}
      {zoomedImage && (
        <div 
          className="fixed inset-0 z-[100] bg-black/95 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200 cursor-zoom-out"
          onClick={() => setZoomedImage(null)} // Clica fora para fechar
        >
           {/* Botão X para fechar */}
           <button 
             onClick={() => setZoomedImage(null)}
             className="absolute top-4 right-4 text-white/70 hover:text-white bg-white/10 hover:bg-white/20 rounded-full p-2 transition-colors"
           >
             <X size={32} />
           </button>
           
           <img 
             src={zoomedImage} 
             alt="Zoom Evidência" 
             className="max-w-full max-h-full object-contain rounded shadow-2xl pointer-events-none select-none"
           />
           
           <p className="absolute bottom-4 text-white/50 text-sm">Toque em qualquer lugar para fechar</p>
        </div>
      )}
      {/* Lightbox / Zoom da Imagem */}
      {zoomedImage && (
        <div 
          className="fixed inset-0 z-[100] bg-black/90 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200"
          onClick={() => setZoomedImage(null)}
        >
           <button 
             onClick={() => setZoomedImage(null)}
             className="absolute top-4 right-4 text-white/70 hover:text-white bg-white/10 hover:bg-white/20 rounded-full p-2 transition-colors"
           >
             <X size={32} />
           </button>
           
           <img 
             src={zoomedImage} 
             alt="Zoom" 
             className="max-w-full max-h-full object-contain rounded shadow-2xl"
             onClick={(e) => e.stopPropagation()} 
           />
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
                 <button onClick={() => { setShowImportModal(false); setImportSummary(null); }} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"><X size={20}/></button>
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
                                <p className="text-sm text-slate-400 mb-6">
                                    ou clique para selecionar do computador
                                </p>
                                <div className="flex gap-4 text-xs text-slate-400">
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