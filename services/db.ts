import { supabase } from './supabaseClient';
import { Driver, Invoice, DeliveryStatus, DeliveryProof, ProofSummary, Vehicle, AppNotification, ActivityLog, ActivityLogEventType, Route } from '../types';
import { REASON_LABEL } from '../constants/returnReasons';

/** Bucket privado das imagens de comprovante (foto, canhoto, assinatura). */
const PROOF_BUCKET = 'delivery-proofs';

// Senha de admin padrão

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

    const { data: inv } = await supabase.from('invoices').select('number').eq('id', invoiceId).single();
    await db.addLog('STATUS_CHANGE', `NF ${inv?.number || invoiceId} liberada para reentrega (${nextAttempt}ª tentativa)`);
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

      const { data: inv } = await supabase.from('invoices').select('number').eq('id', invoiceId).single();
      const outcomeLabel = outcome === 'CONCLUDED' ? 'concluída' : 'cancelada';
      await db.addLog('STATUS_CHANGE', `Devolução da NF ${inv?.number || invoiceId} ${outcomeLabel}${adminNote ? ` — ${adminNote}` : ''}`);
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
      last_location: { lat, lng, updated_at: new Date().toISOString(), source: 'app' }
    }).eq('id', driverId);
  },

  updateVehicleLocation: async (vehicleId: string, lat: number, lng: number) => {
    await supabase.from('vehicles').update({
      last_location: { lat, lng, updated_at: new Date().toISOString(), source: 'app' }
    }).eq('id', vehicleId);
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

  /**
   * "Pulso" do painel: assinatura barata do estado das notas, para detectar que
   * algo mudou SEM baixar a lista inteira (getInvoices traz ~4 mil notas / ~5 MB).
   *
   * Usa count exato com `head: true` — a contagem volta no cabeçalho e o corpo
   * da resposta vem vazio, então cada checagem custa alguns bytes. Os três
   * contadores cobrem o que interessa ao gestor: entrega/devolução (mexe em
   * DELIVERED e IN_PROGRESS), "não entregue hoje" e início/fim de rota (mexem em
   * IN_PROGRESS) e importação de nota nova (mexe no total).
   */
  getInvoicesPulse: async (): Promise<string> => {
    const base = () => supabase.from('invoices').select('*', { count: 'exact', head: true }).is('deleted_at', null);
    const [total, entregues, emRota] = await Promise.all([
      base(),
      base().eq('status', DeliveryStatus.DELIVERED),
      base().eq('status', DeliveryStatus.IN_PROGRESS),
    ]);
    return `${total.count ?? -1}|${entregues.count ?? -1}|${emRota.count ?? -1}`;
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
        .order('id', { ascending: false }) // desempate único: estabiliza a paginação e evita notas duplicadas entre lotes
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
    // Pagina como o getInvoices: sem isso o PostgREST corta em ~1000 linhas e
    // as notas excedentes somem da rota do motorista sem nenhum aviso.
    // A ordenação não é cosmética — sem ela o corte pega linhas arbitrárias,
    // e uma carga recém-atribuída pode nunca aparecer no app.
    const pageSize = 500;
    let all: Invoice[] = [];
    let from = 0;

    while (true) {
      const { data, error } = await supabase
        .from('invoices')
        .select('*')
        .eq('driver_id', driverId)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false }) // desempate único: estabiliza a paginação
        .range(from, from + pageSize - 1);

      if (error) {
        console.error('Erro ao buscar invoices do motorista:', error);
        break;
      }

      const batch = (data as Invoice[]) || [];
      all = all.concat(batch);

      if (batch.length < pageSize) break;
      from += pageSize;
    }

    return all;
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

  // Atribuição em lote de vehicle_id (usada pela Roteirização)
  assignVehicleToInvoices: async (vehicleId: string, invoiceIds: string[]) => {
    if (invoiceIds.length === 0) return;
    const { error } = await supabase
      .from('invoices')
      .update({ vehicle_id: vehicleId })
      .in('id', invoiceIds);
    if (error) throw error;
  },

  updateInvoiceLocation: async (invoiceId: string, lat: number, lng: number) => {
    const { error } = await supabase
      .from('invoices')
      .update({ lat, lng })
      .eq('id', invoiceId);
      
    if (error) throw error;
  },

  // Soft delete: marca a nota como excluída, mas mantém o registro para auditoria
  deleteInvoice: async (invoiceId: string, reason?: string) => {
    const { data: inv } = await supabase.from('invoices').select('number').eq('id', invoiceId).single();

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

    await db.addLog('SOFT_DELETE', `NF ${inv?.number || invoiceId} excluída${reason ? ` — Motivo: ${reason}` : ''}`);
  },

  restoreInvoice: async (invoiceId: string) => {
    const { data: inv } = await supabase.from('invoices').select('number').eq('id', invoiceId).single();

    const { error } = await supabase
      .from('invoices')
      .update({ deleted_at: null, deleted_by: null, deleted_reason: null })
      .eq('id', invoiceId);

    if (error) {
      console.error('Erro ao restaurar invoice:', error);
      throw error;
    }

    await db.addLog('STATUS_CHANGE', `NF ${inv?.number || invoiceId} restaurada`);
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
assignLogistics: async (invoiceId: string, driverId: string | null, vehicleId: string | null, addToActiveRoute = false) => {
    const { data: currentInv } = await supabase.from('invoices').select('driver_id, number, status').eq('id', invoiceId).single();

    const updates: any = {
        driver_id: driverId,
        vehicle_id: vehicleId
    };
//Trecho que mudei a logica do em rota 👆

    const rotaAtivaId = async (dId: string): Promise<string | null> => {
        const { data } = await supabase
            .from('routes').select('id')
            .eq('driver_id', dId).eq('status', 'IN_PROGRESS')
            .order('started_at', { ascending: false }).limit(1).maybeSingle();
        return data?.id ?? null;
    };

    if (driverId) {
        const driverMudou = currentInv?.driver_id !== driverId;
        const jaEmRotaMesmoMotorista = currentInv?.status === DeliveryStatus.IN_PROGRESS && !driverMudou;

        if (jaEmRotaMesmoMotorista) {
            // Já está em rota com este motorista: mantém, só garante o carimbo.
            updates.status = DeliveryStatus.IN_PROGRESS;
            const rid = await rotaAtivaId(driverId);
            if (rid) updates.route_id = rid;
        } else if (addToActiveRoute) {
            // Gestor optou por adicionar à rota ativa (motorista já saiu/está na doca).
            const rid = await rotaAtivaId(driverId);
            if (rid) { updates.status = DeliveryStatus.IN_PROGRESS; updates.route_id = rid; }
            else updates.status = DeliveryStatus.PENDING; // sem rota ativa → faturada
        } else {
            // Fica faturada, aguardando "Iniciar Rota" (ou a próxima rota).
            updates.status = DeliveryStatus.PENDING;
            // Trocou de motorista: sai de qualquer rota/reserva anterior.
            if (driverMudou) updates.route_id = null;
        }
    }

    await supabase.from('invoices').update(updates).eq('id', invoiceId);

    if (currentInv) {
      const parts: string[] = [];
      if (driverId && currentInv.driver_id !== driverId) {
        const { data: drv } = await supabase.from('drivers').select('name').eq('id', driverId).single();
        parts.push(`Motorista: ${drv?.name || driverId}`);
        await db.addNotification(driverId, 'Nova Carga', `NF ${currentInv.number} adicionada.`, 'INFO');
      }
      if (vehicleId) {
        const { data: veh } = await supabase.from('vehicles').select('plate').eq('id', vehicleId).single();
        parts.push(`Veículo: ${veh?.plate || vehicleId}`);
      }
      if (parts.length > 0) {
        await db.addLog('ASSIGNMENT', `NF ${currentInv.number} — ${parts.join(', ')}`);
      }
    }
  },

  startRoute: async (driverId: string) => {
    const agora = new Date().toISOString();

    // Guard: se o motorista já está EM ROTA, não inicia de novo. Sem isto, um
    // duplo-toque (ou o gestor forçando) criaria uma 2ª rota IN_PROGRESS e as
    // duas ficariam disputando as mesmas notas. A UI já esconde o botão quando
    // ativo — este é o cinto de segurança do lado do banco.
    const { data: drvAtual } = await supabase
      .from('drivers').select('route_started_at').eq('id', driverId).single();
    if (drvAtual?.route_started_at) return;

    // Veículo da jornada: pega o das notas pendentes (melhor esforço, pode ser null)
    const { data: pend } = await supabase
      .from('invoices')
      .select('vehicle_id')
      .eq('driver_id', driverId)
      .eq('status', 'PENDING')
      .not('vehicle_id', 'is', null)
      .limit(1);
    const vehicleId = pend?.[0]?.vehicle_id ?? null;

    // 1. Rota agendada "vencida" (data <= hoje) é ADOTADA; senão abre uma ad-hoc.
    const hoje = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD local
    const { data: agendada } = await supabase
      .from('routes')
      .select('id, scheduled_for')
      .eq('driver_id', driverId)
      .eq('status', 'SCHEDULED')
      .order('scheduled_for', { ascending: true })
      .limit(1)
      .maybeSingle();

    let routeId: string | null;
    let usarReservadas = false;
    if (agendada && (!agendada.scheduled_for || agendada.scheduled_for <= hoje)) {
      await supabase
        .from('routes')
        .update({ status: 'IN_PROGRESS', started_at: agora, vehicle_id: vehicleId })
        .eq('id', agendada.id);
      routeId = agendada.id;
      // Se a rota agendada tem notas reservadas, leva SÓ elas (conjunto fechado).
      // Sem reservas, cai no comportamento aberto (todas as pendentes do dia).
      const { count: reservadas } = await supabase
        .from('invoices')
        .select('*', { count: 'exact', head: true })
        .eq('route_id', routeId)
        .eq('driver_id', driverId)
        .eq('status', 'PENDING');
      usarReservadas = (reservadas || 0) > 0;
    } else {
      const { data: rota } = await supabase
        .from('routes')
        .insert({ driver_id: driverId, vehicle_id: vehicleId, status: 'IN_PROGRESS', started_at: agora })
        .select('id')
        .single();
      routeId = rota?.id ?? null;
      if (!routeId) {
        // Perdeu a corrida do índice único (duplo-toque): outro start acabou de
        // criar a rota ativa. Adota a vencedora em vez de embarcar sem carimbo.
        const { data: vencedora } = await supabase
          .from('routes')
          .select('id')
          .eq('driver_id', driverId)
          .eq('status', 'IN_PROGRESS')
          .order('started_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        routeId = vencedora?.id ?? null;
      }
    }

    // 2. Embarca as notas na rota.
    if (usarReservadas) {
      // Conjunto fechado: só as reservadas (já têm route_id) viram IN_PROGRESS.
      await supabase
        .from('invoices')
        .update({ status: 'IN_PROGRESS' })
        .eq('route_id', routeId)
        .eq('driver_id', driverId)
        .eq('status', 'PENDING');
    } else {
      // Aberto: as pendentes do motorista, carimbando a rota — MENOS as que
      // estão reservadas para outra rota ainda agendada (ex.: a de amanhã).
      // Sem esta exceção, iniciar uma rota avulsa hoje levaria embora a carga
      // planejada para outro dia e deixaria a rota agendada órfã. A trava por
      // data na tela do motorista evita o caso comum; isto protege a corrida
      // (o gestor agenda enquanto a tela do motorista está desatualizada).
      const { data: agendadas } = await supabase
        .from('routes')
        .select('id')
        .eq('driver_id', driverId)
        .eq('status', 'SCHEDULED');
      const reservadasOutras = new Set((agendadas || []).map(r => r.id));

      const { data: pendentes } = await supabase
        .from('invoices')
        .select('id, route_id')
        .eq('driver_id', driverId)
        .eq('status', 'PENDING');
      const embarcar = (pendentes || [])
        .filter(n => !n.route_id || !reservadasOutras.has(n.route_id))
        .map(n => n.id);

      if (embarcar.length) {
        await supabase
          .from('invoices')
          .update({ status: 'IN_PROGRESS', route_id: routeId })
          .in('id', embarcar);
      }
    }

    // 3. Marca a rota como ATIVA (fonte de verdade, não mais o localStorage)
    await supabase
      .from('drivers')
      .update({ route_started_at: agora })
      .eq('id', driverId);

    // 4. Notifica o gestor com o total que está em rota agora
    const { count } = await supabase
      .from('invoices')
      .select('*', { count: 'exact', head: true })
      .eq('driver_id', driverId)
      .eq('status', 'IN_PROGRESS');

    const { data: driver } = await supabase.from('drivers').select('name').eq('id', driverId).single();
    const driverName = driver?.name || 'Motorista';
    await db.addNotification(
      'ADMIN',
      'Início de Rota',
      `${driverName} iniciou a rota com ${count || 0} entrega(s).`,
      'INFO'
    );
  },

  /**
   * Encerra a rota do motorista. Qualquer nota ainda IN_PROGRESS volta para
   * PENDING mantendo motorista/veículo (rede de segurança — no fluxo normal o
   * motorista já resolveu todas antes de finalizar). Zera route_started_at,
   * notifica o gestor com o resumo do dia e registra no log.
   */
  finishRoute: async (driverId: string, byGestor = false) => {
    const { data: driver } = await supabase.from('drivers').select('name').eq('id', driverId).single();
    const driverName = driver?.name || 'Motorista';

    // Rota ativa deste motorista (pode não existir se a rota começou antes desta
    // feature — nesse caso só encerramos o flag, sem snapshot).
    const { data: rota } = await supabase
      .from('routes')
      .select('id')
      .eq('driver_id', driverId)
      .eq('status', 'IN_PROGRESS')
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    const routeId = rota?.id ?? null;

    // Contadores da rota, ANTES de mexer nas sobras. Uma consulta, agrupada por
    // status entre as notas carimbadas com esta rota.
    const snap = { delivered_count: 0, returned_count: 0, issue_count: 0, not_delivered_count: 0, leftover_count: 0 };
    if (routeId) {
      const { data: notas } = await supabase.from('invoices').select('status').eq('route_id', routeId);
      for (const n of notas || []) {
        if (n.status === 'DELIVERED') snap.delivered_count++;
        else if (n.status === 'FAILED' || n.status === 'RETURNED') snap.returned_count++;
        else if (n.status === 'ISSUE') snap.issue_count++;
        else if (n.status === 'PENDING') snap.not_delivered_count++;   // "não entregue hoje" (valve)
        else if (n.status === 'IN_PROGRESS') snap.leftover_count++;     // sobras (voltam à fila agora)
      }
    }

    // Notas que ainda estavam em rota (não resolvidas) voltam para a fila
    const { count: aindaEmRota } = await supabase
      .from('invoices')
      .select('*', { count: 'exact', head: true })
      .eq('driver_id', driverId)
      .eq('status', 'IN_PROGRESS');

    if (aindaEmRota && aindaEmRota > 0) {
      await supabase
        .from('invoices')
        .update({ status: 'PENDING' })  // mantém driver_id e vehicle_id
        .eq('driver_id', driverId)
        .eq('status', 'IN_PROGRESS');
    }

    // Fecha a linha da rota com o snapshot do resultado
    if (routeId) {
      await supabase
        .from('routes')
        .update({
          status: 'FINISHED',
          finished_at: new Date().toISOString(),
          finished_by: byGestor ? 'GESTOR' : 'DRIVER',
          ...snap,
        })
        .eq('id', routeId);
    }

    // Encerra a rota
    await supabase
      .from('drivers')
      .update({ route_started_at: null })
      .eq('id', driverId);

    // Resumo do dia (entregas finalizadas hoje por este motorista)
    const hoje = new Date().toISOString().slice(0, 10);
    const { count: entreguesHoje } = await supabase
      .from('invoices')
      .select('*', { count: 'exact', head: true })
      .eq('driver_id', driverId)
      .eq('status', 'DELIVERED')
      .gte('delivered_at', `${hoje}T00:00:00`);

    const restantes = aindaEmRota || 0;
    const origem = byGestor ? ' (pelo gestor)' : '';
    await db.addNotification(
      'ADMIN',
      'Rota Finalizada',
      `${driverName} finalizou a rota${origem}. ${entreguesHoje || 0} entregue(s) hoje` +
        (restantes > 0 ? `, ${restantes} voltaram para a fila.` : '.'),
      'INFO'
    );
    await db.addLog('STATUS_CHANGE', `${driverName} finalizou a rota${origem}` +
      (restantes > 0 ? ` — ${restantes} nota(s) voltaram para a fila` : ''));
  },

  /**
   * "Não entregue hoje": a nota não foi realizada (nem entregue, nem devolvida,
   * nem pendência) e volta para a fila, mantendo o motorista/veículo. O motivo
   * fica registrado no log. Não confundir com devolução/pendência.
   */
  markNotDelivered: async (invoiceId: string, reason: string) => {
    const { data: inv } = await supabase.from('invoices').select('number, driver_id').eq('id', invoiceId).single();

    await supabase
      .from('invoices')
      .update({ status: 'PENDING' })  // volta para a fila, mantém atribuição
      .eq('id', invoiceId)
      // Guard: só age sobre nota ainda EM ROTA. Sem isto, uma ação atrasada de
      // tela desatualizada desfazia uma entrega já registrada (DELIVERED→PENDING).
      .eq('status', DeliveryStatus.IN_PROGRESS);

    let driverName = '';
    if (inv?.driver_id) {
      const { data: drv } = await supabase.from('drivers').select('name').eq('id', inv.driver_id).single();
      driverName = drv?.name || '';
    }
    await db.addLog('STATUS_CHANGE',
      `NF ${inv?.number || invoiceId} não entregue hoje${driverName ? ` (${driverName})` : ''} — Motivo: ${reason}`);
  },

  /**
   * Histórico de rotas para a Controladoria de Rotas do gestor. Traz o nome do
   * motorista e a placa via embed do PostgREST. Por padrão só rotas finalizadas
   * (as que têm resultado); passar includeActive para incluir a em andamento.
   */
  /**
   * Histórico de rotas, PAGINADO. A lista cresce ~1 rota por motorista/dia; sem
   * limite, com o tempo o PostgREST corta em ~1000 linhas (esconde as antigas)
   * e a tela renderiza tudo de uma vez e engasga. Traz `limit` por vez a partir
   * de `offset` — a aba pede a próxima página com "Ver mais".
   */
  getRoutes: async (includeActive = false, limit = 40, offset = 0): Promise<Route[]> => {
    let query = supabase
      .from('routes')
      .select('*, drivers(name), vehicles(plate)')
      .order('started_at', { ascending: false, nullsFirst: false })
      .range(offset, offset + limit - 1);

    query = includeActive
      ? query.in('status', ['IN_PROGRESS', 'FINISHED'])
      : query.eq('status', 'FINISHED');

    const { data, error } = await query;
    if (error) { console.error('Erro ao buscar rotas:', error); return []; }

    return (data || []).map((r: any) => ({
      ...r,
      driver_name: r.drivers?.name ?? r.driver_id,
      vehicle_plate: r.vehicles?.plate ?? null,
    }));
  },

  /** Notas atualmente atribuídas a uma rota (drill-down da controladoria). */
  getRouteInvoices: async (routeId: string): Promise<Invoice[]> => {
    const { data, error } = await supabase
      .from('invoices')
      .select('*')
      .eq('route_id', routeId)
      .order('number');
    if (error) { console.error('Erro ao buscar notas da rota:', error); return []; }
    return (data || []) as Invoice[];
  },

  /**
   * Agenda (ou reagenda) a rota de um motorista para uma data. Não reserva notas:
   * a rota agendada só define motorista + dia; as pendentes do motorista entram
   * quando ele inicia (startRoute adota a agendada vencida). Um motorista tem no
   * máximo uma rota agendada por vez — chamar de novo reagenda a data.
   */
  scheduleRoute: async (driverId: string, scheduledFor: string, invoiceIds: string[] = []) => {
    const { data: existente } = await supabase
      .from('routes')
      .select('id')
      .eq('driver_id', driverId)
      .eq('status', 'SCHEDULED')
      .limit(1)
      .maybeSingle();

    let routeId: string | null;
    if (existente) {
      routeId = existente.id;
      await supabase.from('routes').update({ scheduled_for: scheduledFor }).eq('id', routeId);
    } else {
      const { data: nova } = await supabase
        .from('routes')
        .insert({ driver_id: driverId, status: 'SCHEDULED', scheduled_for: scheduledFor })
        .select('id')
        .single();
      routeId = nova?.id ?? null;
      if (!routeId) {
        // Perdeu a corrida do índice único (duplo-clique/duas abas): reaproveita
        // o agendamento que acabou de ser criado e só atualiza a data.
        const { data: vencedora } = await supabase
          .from('routes')
          .select('id')
          .eq('driver_id', driverId)
          .eq('status', 'SCHEDULED')
          .limit(1)
          .maybeSingle();
        routeId = vencedora?.id ?? null;
        if (routeId) await supabase.from('routes').update({ scheduled_for: scheduledFor }).eq('id', routeId);
      }
    }

    // Reserva de notas (conjunto fechado). Reconcilia: solta as que estavam
    // reservadas nesta rota e foram desmarcadas; reserva as marcadas (assina ao
    // motorista, mantém PENDING até ele iniciar).
    if (routeId) {
      const { data: reservadasAtuais } = await supabase.from('invoices').select('id').eq('route_id', routeId);
      const selecionadas = new Set(invoiceIds);
      const soltar = (reservadasAtuais || []).map(r => r.id).filter(id => !selecionadas.has(id));
      if (soltar.length) await supabase.from('invoices').update({ route_id: null }).in('id', soltar);
      if (invoiceIds.length) {
        // Não rouba nota já reservada a OUTRA rota agendada (dois gestores/abas
        // planejando ao mesmo tempo). A UI filtra as elegíveis, mas a tela pode
        // estar desatualizada — a proteção de verdade fica aqui.
        const { data: outrasAgendadas } = await supabase
          .from('routes').select('id').eq('status', 'SCHEDULED').neq('id', routeId);
        const protegidas = new Set((outrasAgendadas || []).map(r => r.id));
        const { data: alvo } = await supabase.from('invoices').select('id, route_id').in('id', invoiceIds);
        const livres = (alvo || [])
          .filter(n => !n.route_id || n.route_id === routeId || !protegidas.has(n.route_id))
          .map(n => n.id);
        if (livres.length) {
          await supabase.from('invoices')
            .update({ route_id: routeId, driver_id: driverId })
            .in('id', livres)
            .eq('status', 'PENDING');
        }
      }
    }

    const { data: driver } = await supabase.from('drivers').select('name').eq('id', driverId).single();
    const dataFmt = new Date(scheduledFor + 'T12:00:00').toLocaleDateString('pt-BR');
    const qtd = invoiceIds.length;
    const detalhe = qtd > 0 ? ` com ${qtd} nota(s)` : '';
    await db.addNotification(driverId, 'Rota Agendada', `Sua próxima rota foi agendada para ${dataFmt}${detalhe}.`, 'INFO');
    await db.addLog('ASSIGNMENT', `Rota de ${driver?.name || driverId} agendada para ${dataFmt}${detalhe}`);
  },

  /**
   * Cancela uma rota agendada, soltando as notas reservadas de volta ao pool.
   * Só age se a rota AINDA está SCHEDULED: se o motorista iniciou enquanto a
   * tela do gestor estava desatualizada, o clique em "Cancelar" vira no-op —
   * sem isto, uma rota ATIVA era marcada CANCELLED e as notas em rota perdiam
   * o carimbo (rota órfã, sem histórico). Retorna se cancelou de fato.
   */
  cancelScheduledRoute: async (routeId: string): Promise<boolean> => {
    const { data: rota } = await supabase
      .from('routes')
      .select('driver_id, scheduled_for, status')
      .eq('id', routeId)
      .single();

    if (rota?.status !== 'SCHEDULED') return false; // já iniciou/terminou — não mexe

    // Solta só as notas ainda PENDING (as reservadas); condição de status no
    // WHERE evita apagar carimbo de nota que embarcou entre a leitura e o update.
    await supabase.from('invoices').update({ route_id: null }).eq('route_id', routeId).eq('status', 'PENDING');
    await supabase.from('routes').update({ status: 'CANCELLED' }).eq('id', routeId).eq('status', 'SCHEDULED');

    if (rota?.driver_id) {
      await db.addNotification(rota.driver_id, 'Agendamento Cancelado', 'O agendamento da sua próxima rota foi cancelado.', 'INFO');
    }
    await db.addLog('ASSIGNMENT', `Agendamento de rota cancelado`);
    return true;
  },

  /** Rotas agendadas (lista do gestor), com nome do motorista e placa. */
  getScheduledRoutes: async (): Promise<Route[]> => {
    const { data, error } = await supabase
      .from('routes')
      .select('*, drivers(name), vehicles(plate)')
      .eq('status', 'SCHEDULED')
      .order('scheduled_for', { ascending: true });
    if (error) { console.error('Erro ao buscar rotas agendadas:', error); return []; }
    return (data || []).map((r: any) => ({
      ...r,
      driver_name: r.drivers?.name ?? r.driver_id,
      vehicle_plate: r.vehicles?.plate ?? null,
    }));
  },

  /** A rota agendada mais próxima de um motorista (para a trava no app dele). */
  getScheduledRouteForDriver: async (driverId: string): Promise<Route | null> => {
    const { data } = await supabase
      .from('routes')
      .select('*')
      .eq('driver_id', driverId)
      .eq('status', 'SCHEDULED')
      .order('scheduled_for', { ascending: true })
      .limit(1)
      .maybeSingle();
    return (data as Route) ?? null;
  },

  // ATUALIZADA: Agora aceita o segundo argumento 'invoiceValueLoss'
  // ATUALIZADA: Agora salva o motivo também na tabela de notas (Histórico)
  // ATUALIZADA: Com "Teste da Verdade" (Debug de RLS)
  saveProof: async (proof: DeliveryProof, invoiceValueLoss?: number) => {
    // Uma devolução é identificada por ter motivo (código OU texto) ou tipo de
    // retorno. Não basta olhar failure_reason: desde a padronização dos motivos
    // ele é opcional, e uma devolução sem detalhe escrito viraria "entregue".
    const isFailure = !!(proof.failure_reason_code || proof.failure_reason || proof.return_type);

    console.log("--- DEBUG SAVE PROOF ---");
    console.log("1. É falha?", isFailure);
    console.log("2. Motivo recebido:", proof.failure_reason_code, proof.failure_reason);
    console.log("3. ID da Nota:", proof.invoice_id);

    // 1. Usa UPSERT para evitar erro se já existir um comprovante
    const { error } = await supabase.from('delivery_proofs').upsert(proof);

    if (!error) {
       const newStatus = isFailure ? DeliveryStatus.FAILED : DeliveryStatus.DELIVERED;

       const updates: any = {
           status: newStatus,
           delivered_at: proof.delivered_at
       };

       // 2. Lógica Financeira e DE HISTÓRICO
       if (isFailure) {
           updates.return_value = invoiceValueLoss !== undefined ? invoiceValueLoss : 0;
           // Grava o motivo já legível: código vira rótulo e o detalhe entra junto.
           updates.last_failure_reason = proof.failure_reason_code
             ? [REASON_LABEL[proof.failure_reason_code] ?? proof.failure_reason_code, proof.failure_reason]
                 .filter(Boolean).join(' — ')
             : proof.failure_reason;
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
    if (!data) return undefined;

    // Resolve os campos de imagem para algo exibível num <img src>:
    // base64 antigo passa direto; caminho no Storage vira URL assinada.
    // Feito só aqui porque é o único ponto que carrega as imagens para exibição
    // — as telas (AdminView/SellerView) não precisam saber de Storage.
    const proof = data as DeliveryProof;
    const [photo_url, photo_stub_url, signature_data] = await Promise.all([
      db.resolveProofImageUrl(proof.photo_url),
      db.resolveProofImageUrl(proof.photo_stub_url),
      db.resolveProofImageUrl(proof.signature_data),
    ]);
    return { ...proof, photo_url, photo_stub_url, signature_data };
  },

  /**
   * Converte o valor guardado numa coluna de imagem em algo que um <img src>
   * exibe. base64 (comprovantes antigos) e http (legado) passam direto;
   * qualquer outra coisa é tratada como caminho no bucket delivery-proofs e
   * vira uma URL assinada temporária (1h). Nunca lança — na dúvida devolve
   * o valor original, para não quebrar a tela.
   */
  resolveProofImageUrl: async (value?: string | null): Promise<string> => {
    if (!value) return '';
    if (value.startsWith('data:') || value.startsWith('http')) return value;
    try {
      const { data, error } = await supabase.storage
        .from(PROOF_BUCKET)
        .createSignedUrl(value, 3600);
      if (error || !data?.signedUrl) {
        console.error('Erro ao gerar URL assinada:', error);
        return '';
      }
      return data.signedUrl;
    } catch (e) {
      console.error('Falha ao resolver imagem do comprovante:', e);
      return '';
    }
  },

  /**
   * Sobe uma imagem base64 para o Storage e devolve o CAMINHO (não a URL, que
   * expira). Devolve null se não for base64 ou se o upload falhar — o chamador
   * decide o fallback (ex.: manter o base64 para não perder o comprovante).
   */
  uploadProofImage: async (invoiceId: string, kind: string, dataUri?: string | null): Promise<string | null> => {
    if (!dataUri) return null;
    const m = /^data:(image\/(\w+));base64,(.*)$/s.exec(dataUri);
    if (!m) return null; // já é caminho/URL, ou vazio

    const mime = m[1];
    const ext = m[2] === 'jpeg' ? 'jpg' : m[2];
    try {
      const bin = atob(m[3]);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const blob = new Blob([bytes], { type: mime });

      const path = `${invoiceId}/${kind}.${ext}`;
      const { error } = await supabase.storage
        .from(PROOF_BUCKET)
        .upload(path, blob, { contentType: mime, upsert: true });
      if (error) {
        console.error(`Erro ao subir ${kind} da nota ${invoiceId}:`, error);
        return null;
      }
      return path;
    } catch (e) {
      console.error(`Falha no upload de ${kind}:`, e);
      return null;
    }
  },

  /**
   * Busca comprovantes de várias notas de uma vez, indexados por invoice_id.
   * Omite signature_data/photo_url/photo_stub_url de propósito: são base64 de
   * centenas de MB no total e estourariam o tráfego numa listagem.
   */
  getProofsByInvoiceIds: async (invoiceIds: string[]): Promise<Record<string, ProofSummary>> => {
    const map: Record<string, ProofSummary> = {};
    if (!invoiceIds.length) return map;

    const chunkSize = 200; // evita URL longa demais no filtro .in()
    for (let i = 0; i < invoiceIds.length; i += chunkSize) {
      const chunk = invoiceIds.slice(i, i + chunkSize);
      const { data, error } = await supabase
        .from('delivery_proofs')
        .select('invoice_id, receiver_name, delivered_at, failure_reason, failure_reason_code, notes, return_type, return_items')
        .in('invoice_id', chunk);

      if (error) {
        console.error('Erro ao buscar comprovantes em lote:', error);
        continue;
      }
      (data as ProofSummary[] | null)?.forEach(p => { map[p.invoice_id] = p; });
    }
    return map;
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

    const { data: inv } = await supabase.from('invoices').select('number').eq('id', invoiceId).single();
    const nf = inv?.number || invoiceId;
    const statusLabel = status === 'DELIVERED' ? 'Entregue' : 'Devolvida';
    await db.addLog('STATUS_CHANGE', `Baixa manual na NF ${nf} como ${statusLabel} — Motivo: ${reason}`);

    await db.addNotification(
      'ADMIN',
      'Baixa manual aplicada',
      `NF ${nf} atualizada para ${status} pelo gestor.`,
      'INFO'
    );
  },

  // --- SAVED LABELS ---
  getSavedLabels: async (): Promise<{ id: string; name: string; barcode_value: string; label_text: string; format: string; created_at: string }[]> => {
    const { data, error } = await supabase
      .from('saved_labels')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) { console.error('Erro ao buscar etiquetas:', error); return []; }
    return data ?? [];
  },

  addSavedLabel: async (label: { name: string; barcode_value: string; label_text: string; format: string }) => {
    const { error } = await supabase.from('saved_labels').insert(label);
    if (error) throw error;
  },

  deleteSavedLabel: async (id: string) => {
    const { error } = await supabase.from('saved_labels').delete().eq('id', id);
    if (error) throw error;
  },

  // --- ACTIVITY LOG ---
  addLog: async (event_type: ActivityLogEventType, description: string, actor: string = 'ADMIN') => {
    const { error } = await supabase.from('activity_logs').insert({ event_type, description, actor });
    if (error) console.error('Erro ao salvar log:', error);
  },

  getLogs: async (filters?: { event_type?: ActivityLogEventType; start?: string; end?: string }): Promise<ActivityLog[]> => {
    let query = supabase.from('activity_logs').select('*').order('created_at', { ascending: false }).limit(500);
    if (filters?.event_type) query = query.eq('event_type', filters.event_type);
    if (filters?.start) query = query.gte('created_at', filters.start);
    if (filters?.end) query = query.lte('created_at', filters.end + 'T23:59:59');
    const { data, error } = await query;
    if (error) { console.error('Erro ao buscar logs:', error); return []; }
    return (data as ActivityLog[]) || [];
  },

  verifyAdminPassword: async (passwordInput: string): Promise<boolean> => {
    const configured = import.meta.env.VITE_ADMIN_PASSWORD;
    if (!configured) return false;
    return passwordInput === configured;
  },

  updateAdminPassword: async (newPassword: string) => {
    alert("Configuração de senha deve ser feita via Variáveis de Ambiente no Supabase/Vercel.");
  },

  // ── Zonas geográficas ──────────────────────────────────────────────────────

  getZones: async () => {
    const { data, error } = await supabase
      .from('zones')
      .select('*')
      .order('created_at');
    if (error) throw error;
    return (data ?? []) as import('../types').Zone[];
  },

  createZone: async (zone: Omit<import('../types').Zone, 'id' | 'created_at'>) => {
    const { data, error } = await supabase
      .from('zones')
      .insert(zone)
      .select()
      .single();
    if (error) throw error;
    return data as import('../types').Zone;
  },

  updateZone: async (id: string, updates: Partial<Pick<import('../types').Zone, 'name' | 'color' | 'coordinates'>>) => {
    const { error } = await supabase
      .from('zones')
      .update(updates)
      .eq('id', id);
    if (error) throw error;
  },

  deleteZone: async (id: string) => {
    const { error } = await supabase
      .from('zones')
      .delete()
      .eq('id', id);
    if (error) throw error;
  },
};