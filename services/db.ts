import { supabase } from './supabaseClient';
import { Driver, Invoice, DeliveryStatus, DeliveryProof, Vehicle, AppNotification } from '../types';

// Senha de admin padrão
const ADMIN_PASSWORD_DEFAULT = 'admin123';

export const db = {
  init: () => {
    console.log("Supabase DB Service initialized");
  },

 // ATUALIZADA: Aceita APENAS 2 argumentos agora (removemos o failureReason)
  // ATUALIZADA: Aceita 3 argumentos (ID, Tentativas, Valor Anterior)
  // VOLTOU AO PADRÃO: Aceita apenas ID e Tentativas (Sem mexer no valor)
  resetInvoiceForRedelivery: async (invoiceId: string, currentAttempts: number) => {
    // 1. Calcula nova tentativa
    const nextAttempt = (currentAttempts || 1) + 1;

    // 2. Prepara atualização (Reset Total)
    const updates = {
        status: DeliveryStatus.PENDING, // Volta para Amarelo
        driver_id: null,                // Libera motorista
        vehicle_id: null,               // Libera veículo
        delivered_at: null,             // Limpa data de baixa
        return_value: 0,                // Zera o prejuízo anterior
        delivery_attempts: nextAttempt,  // Incrementa contador
        return_final_status: null,      // Reabre o fluxo (nota voltou para reentrega)
        return_finalized_at: null,
        // OBS: Não mexemos no 'value'. Ele continua sendo o valor cheio original.
    };

    const { error } = await supabase
        .from('invoices')
        .update(updates)
        .eq('id', invoiceId);

    if (error) throw error;
  },
  
  // Função auxiliar para editar valor (caso seja devolução parcial e precise ajustar)
  updateInvoiceValue: async (invoiceId: string, newValue: number) => {
    const { error } = await supabase
        .from('invoices')
        .update({ value: newValue })
        .eq('id', invoiceId);
    if (error) throw error;
  },

  updateInvoiceStatus: async (invoiceId: string, newStatus: DeliveryStatus) => {
    const { error } = await supabase
      .from('invoices')
      .update({ status: newStatus })
      .eq('id', invoiceId);

    if (error) {
      console.error('Erro ao atualizar status:', error);
      throw error;
    }
  },

  /** Finaliza o fluxo de devolução: CONCLUDED = concluída (não volta para motorista), CANCELLED = cancelada (cliente desistiu). Mantém a história da nota. */
  finalizeReturn: async (invoiceId: string, outcome: 'CONCLUDED' | 'CANCELLED', adminNote?: string) => {
    try {
      const updates: any = {
        return_final_status: outcome,
        return_finalized_at: new Date().toISOString(),
      };

      if (adminNote && adminNote.trim()) {
        updates.return_final_note = adminNote.trim();
      }

      const { error } = await supabase
        .from('invoices')
        .update(updates)
        .eq('id', invoiceId);

      if (error) throw error;
    } catch (err) {
      throw err;
    }
  },

  

  // --- NOTIFICATION SYSTEM ---
  addNotification: async (recipientId: string, title: string, message: string, type: 'INFO' | 'SUCCESS' | 'WARNING' = 'INFO') => {
    const { error } = await supabase.from('notifications').insert({
      recipient_id: recipientId,
      title,
      message,
      type,
      read: false,
      timestamp: new Date().toISOString()
    });
    if (error) console.error('Erro ao criar notificação:', error);
  },

  consumeNotifications: async (recipientId: string): Promise<AppNotification[]> => {
    const { data: notifs, error } = await supabase
      .from('notifications')
      .select('*')
      .eq('recipient_id', recipientId)
      .eq('read', false);

    if (error || !notifs || notifs.length === 0) return [];

    const ids = notifs.map(n => n.id);
    await supabase.from('notifications').update({ read: true }).in('id', ids);

    return notifs as AppNotification[];
  },

  // --- CRUD METHODS ---
  getDrivers: async (): Promise<Driver[]> => {
    const { data, error } = await supabase.from('drivers').select('*');
    if (error) {
      console.error(error);
      return [];
    }
    return data as Driver[];
  },

  addDriver: async (driver: Driver) => {
    const { error } = await supabase.from('drivers').insert(driver);
    if (error) throw error;
  },

  verifyDriverCredentials: async (driverId: string, passwordInput: string): Promise<boolean> => {
    const { data, error } = await supabase.from('drivers').select('password').eq('id', driverId).single();
    if (error || !data) return false;
    if (!data.password) return true;
    return data.password === passwordInput;
  },

  deleteDriver: async (driverId: string) => {
    const { error } = await supabase.from('drivers').delete().eq('id', driverId);
    if (!error) {
      await supabase.from('invoices').update({ driver_id: null }).eq('driver_id', driverId);
    }
  },

  updateDriverLocation: async (driverId: string, lat: number, lng: number) => {
    await supabase.from('drivers').update({
      last_location: { lat, lng, updated_at: new Date().toISOString() }
    }).eq('id', driverId);
  },

  getVehicles: async (): Promise<Vehicle[]> => {
    const { data } = await supabase.from('vehicles').select('*');
    return (data as Vehicle[]) || [];
  },

  addVehicle: async (vehicle: Vehicle) => {
    await supabase.from('vehicles').insert(vehicle);
  },

  updateVehicle: async (vehicleId: string, updates: Partial<Vehicle>) => {
    await supabase.from('vehicles').update(updates).eq('id', vehicleId);
  },

  deleteVehicle: async (vehicleId: string) => {
    const { error } = await supabase.from('vehicles').delete().eq('id', vehicleId);
    if (!error) {
       await supabase.from('invoices').update({ vehicle_id: null }).eq('vehicle_id', vehicleId);
    }
  },

  getInvoices: async (): Promise<Invoice[]> => {
    // Busca TODAS as notas (sem limite de data) em múltiplos lotes,
    // para contornar o limite de ~1000 linhas por requisição do PostgREST.
    const pageSize = 500; // cada chamada traz até 500 registros
    let all: Invoice[] = [];
    let from = 0;

    while (true) {
      const to = from + pageSize - 1;

      const { data, error } = await supabase
        .from('invoices')
        .select('*')
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .range(from, to);

      if (error) {
        console.error('Erro ao buscar invoices:', error);
        break;
      }

      const batch = (data as Invoice[]) || [];
      all = all.concat(batch);

      // Se veio menos que o tamanho da página, não há mais registros
      if (batch.length < pageSize) {
        break;
      }

      from += pageSize;
    }

    return all;
  },

  getInvoicesByDriver: async (driverId: string): Promise<Invoice[]> => {
    const { data } = await supabase
      .from('invoices')
      .select('*')
      .eq('driver_id', driverId)
      .is('deleted_at', null);
    return (data as Invoice[]) || [];
  },

  addInvoice: async (invoice: Invoice) => {
    // PREPARAÇÃO:
    // Cria um objeto novo garantindo que o 'original_value' seja igual ao valor inicial
    const payload = {
        ...invoice,
        original_value: invoice.value 
    };

    const { error } = await supabase.from('invoices').insert(payload);
    if (error) alert("Erro ao salvar nota: " + error.message);
  },

  // Adicione isso no services/db.ts
  updateInvoiceLocation: async (invoiceId: string, lat: number, lng: number) => {
    const { error } = await supabase
      .from('invoices')
      .update({ lat, lng })
      .eq('id', invoiceId);
      
    if (error) throw error;
  },

  // Soft delete: marca a nota como excluída, mas mantém o registro para auditoria
  deleteInvoice: async (invoiceId: string, reason?: string) => {
    const { error } = await supabase
      .from('invoices')
      .update({
        deleted_at: new Date().toISOString(),
        deleted_by: 'ADMIN',
        deleted_reason: reason || null,
      })
      .eq('id', invoiceId);

    if (error) {
      console.error('Erro ao excluir (soft delete) invoice:', error);
      throw error;
    }
  },

  // Lista de notas excluídas (para tela de auditoria do gestor)
  getDeletedInvoices: async (): Promise<Invoice[]> => {
    const { data, error } = await supabase
      .from('invoices')
      .select('*')
      .not('deleted_at', 'is', null)
      .order('deleted_at', { ascending: false });

    if (error) {
      console.error('Erro ao buscar invoices excluídas:', error);
      return [];
    }

    return (data as Invoice[]) || [];
  },

  // Exclusão definitiva: remove nota e comprovantes do banco (usar apenas em auditoria)
  hardDeleteInvoice: async (invoiceId: string) => {
    // Remove comprovantes associados
    const { error: proofError } = await supabase
      .from('delivery_proofs')
      .delete()
      .eq('invoice_id', invoiceId);

    if (proofError) {
      console.error('Erro ao apagar comprovantes da nota:', proofError);
      throw proofError;
    }

    // Remove nota definitivamente
    const { error } = await supabase
      .from('invoices')
      .delete()
      .eq('id', invoiceId);

    if (error) {
      console.error('Erro ao apagar nota (hard delete):', error);
      throw error;
    }
  },

//Trecho que mudei a logica do em rota 👇
assignLogistics: async (invoiceId: string, driverId: string | null, vehicleId: string | null) => {
    const { data: currentInv } = await supabase.from('invoices').select('driver_id, number').eq('id', invoiceId).single();
    
    const updates: any = { 
        driver_id: driverId, 
        vehicle_id: vehicleId 
    };
//Trecho que mudei a logica do em rota 👆

    if (driverId) {
        // 👇 NOVO: Verifica se o motorista já iniciou a rota hoje
        // Procuramos por qualquer nota deste motorista que já esteja 'IN_PROGRESS'
        const { count } = await supabase
            .from('invoices')
            .select('*', { count: 'exact', head: true })
            .eq('driver_id', driverId)
            .eq('status', DeliveryStatus.IN_PROGRESS);

        // Se ele já tiver notas em rota, a nova nota entra direto como 'IN_PROGRESS'
        // Caso contrário, entra como 'PENDING' aguardando o "Iniciar Rota"
        updates.status = (count && count > 0) 
            ? DeliveryStatus.IN_PROGRESS 
            : DeliveryStatus.PENDING;
    }

    await supabase.from('invoices').update(updates).eq('id', invoiceId);

    if (driverId && currentInv && currentInv.driver_id !== driverId) {
       await db.addNotification(driverId, 'Nova Carga', `NF ${currentInv.number} adicionada.`, 'INFO');
    }
  },

  startRoute: async (driverId: string) => {
    // 1. Conta quantas entregas pendentes existem para notificar depois
    const { count } = await supabase
      .from('invoices')
      .select('*', { count: 'exact', head: true })
      .eq('driver_id', driverId)
      .eq('status', 'PENDING');

    if (count && count > 0) {
        // 2. Atualiza TUDO que é 'PENDING' para 'IN_PROGRESS' de uma vez
        const { error } = await supabase
        .from('invoices')
        .update({ status: 'IN_PROGRESS' })
        .eq('driver_id', driverId)
        .eq('status', 'PENDING');
        
        if (!error) {
             // 3. Notifica o Gestor
             const { data: driver } = await supabase.from('drivers').select('name').eq('id', driverId).single();
             const driverName = driver?.name || 'Motorista';
             
             await db.addNotification(
                'ADMIN', 
                'Início de Rota', 
                `${driverName} iniciou a rota com ${count} entregas.`, 
                'INFO'
             );
        }
    }
  },
  
  // ATUALIZADA: Agora aceita o segundo argumento 'invoiceValueLoss'
  // ATUALIZADA: Agora salva o motivo também na tabela de notas (Histórico)
  // ATUALIZADA: Com "Teste da Verdade" (Debug de RLS)
  saveProof: async (proof: DeliveryProof, invoiceValueLoss?: number) => {

    console.log("--- DEBUG SAVE PROOF ---");
    console.log("1. É falha?", !!proof.failure_reason);
    console.log("2. Motivo recebido:", proof.failure_reason);
    console.log("3. ID da Nota:", proof.invoice_id);

    // 1. Usa UPSERT para evitar erro se já existir um comprovante
    const { error } = await supabase.from('delivery_proofs').upsert(proof);
    
    if (!error) {
       const isFailure = !!proof.failure_reason;
       const newStatus = isFailure ? DeliveryStatus.FAILED : DeliveryStatus.DELIVERED;
       
       const updates: any = { 
           status: newStatus,
           delivered_at: proof.delivered_at
       };

       // 2. Lógica Financeira e DE HISTÓRICO
       if (isFailure) {
           updates.return_value = invoiceValueLoss !== undefined ? invoiceValueLoss : 0;
           updates.last_failure_reason = proof.failure_reason; // Copia para o histórico
       } else {
           updates.return_value = 0;
           // updates.last_failure_reason = null; // MANTIDO COMENTADO PARA PRESERVAR HISTÓRICO ANTIGO
       }

       console.log("--- TENTANDO ATUALIZAR NOTA ---");
       console.log("ID:", proof.invoice_id);
       console.log("Dados enviados:", updates);

       // 👇 AQUI ESTÁ O TESTE DA VERDADE 👇
       // Adicionamos .select() para forçar o banco a retornar o que gravou
       const { data: dadosRetornados, error: updateError } = await supabase
           .from('invoices')
           .update(updates)
           .eq('id', proof.invoice_id)
           .select(); 

       if (updateError) {
           console.error("❌ ERRO GRAVE DO BANCO:", updateError);
           alert("Erro no banco: " + updateError.message);
       } else if (!dadosRetornados || dadosRetornados.length === 0) {
           // 👇 SE CAIR AQUI, É CERTEZA QUE É PERMISSÃO (RLS)
           console.error("⚠️ ALERTA: O banco disse 'sucesso', mas NENHUMA linha foi alterada!");
           console.error(" DIAGNÓSTICO: O motorista não tem permissão (Policy RLS) para editar a tabela 'invoices'.");
           alert("Erro de Permissão: O banco bloqueou a gravação do status.");
       } else {
           console.log("✅ SUCESSO REAL: O banco confirmou a gravação.");
           console.log("Como ficou no banco:", dadosRetornados[0]);
           console.log("Motivo salvo na nota:", dadosRetornados[0].last_failure_reason);
       }
       
    } else {
        throw error;
    }
  },

  getProofByInvoiceId: async (invoiceId: string): Promise<DeliveryProof | undefined> => {
    const { data } = await supabase.from('delivery_proofs').select('*').eq('invoice_id', invoiceId).single();
    return data as DeliveryProof || undefined;
  },

  // Baixa manual pelo gestor (sem intervenção do motorista)
  adminManualSettleInvoice: async (
    invoiceId: string,
    options: { status: 'DELIVERED' | 'FAILED'; reason: string; lossValue?: number }
  ) => {
    const { status, reason, lossValue } = options;

    const updates: any = {
      status,
      delivered_at: new Date().toISOString(),
    };

    if (status === DeliveryStatus.FAILED) {
      updates.return_value =
        typeof lossValue === 'number' && !isNaN(lossValue) ? lossValue : 0;
      updates.last_failure_reason = `BAIXA MANUAL (GESTOR): ${reason}`;
    }

    // Para entregas manuais sem falha, apenas registramos o motivo no histórico de falha
    if (status === DeliveryStatus.DELIVERED) {
      updates.last_failure_reason = `BAIXA MANUAL (GESTOR): ${reason}`;
      updates.return_value = 0;
    }

    const { error } = await supabase
      .from('invoices')
      .update(updates)
      .eq('id', invoiceId);

    if (error) {
      console.error('Erro na baixa manual:', error);
      throw error;
    }

    await db.addNotification(
      'ADMIN',
      'Baixa manual aplicada',
      `NF ${invoiceId} atualizada para ${status} pelo gestor.`,
      'INFO'
    );
  },

  verifyAdminPassword: async (passwordInput: string): Promise<boolean> => {
    return passwordInput === (import.meta.env.VITE_ADMIN_PASSWORD || ADMIN_PASSWORD_DEFAULT);
  },

  updateAdminPassword: async (newPassword: string) => {
    alert("Configuração de senha deve ser feita via Variáveis de Ambiente no Supabase/Vercel.");
  }
};