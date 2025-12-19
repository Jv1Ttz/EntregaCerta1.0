import { supabase } from './supabaseClient';
import { Driver, Invoice, DeliveryStatus, DeliveryProof, Vehicle, AppNotification } from '../types';

// Senha de admin padrão
const ADMIN_PASSWORD_DEFAULT = 'admin123';

export const db = {
  init: () => {
    console.log("Supabase DB Service initialized");
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

  deleteVehicle: async (vehicleId: string) => {
    const { error } = await supabase.from('vehicles').delete().eq('id', vehicleId);
    if (!error) {
       await supabase.from('invoices').update({ vehicle_id: null }).eq('vehicle_id', vehicleId);
    }
  },

  getInvoices: async (): Promise<Invoice[]> => {
    const { data } = await supabase.from('invoices').select('*');
    return (data as Invoice[]) || [];
  },

  getInvoicesByDriver: async (driverId: string): Promise<Invoice[]> => {
    const { data } = await supabase.from('invoices').select('*').eq('driver_id', driverId);
    return (data as Invoice[]) || [];
  },

  addInvoice: async (invoice: Invoice) => {
    const { error } = await supabase.from('invoices').insert(invoice);
    if (error) alert("Erro ao salvar nota: " + error.message);
  },

  deleteInvoice: async (invoiceId: string) => {
    await supabase.from('delivery_proofs').delete().eq('invoice_id', invoiceId);
    await supabase.from('invoices').delete().eq('id', invoiceId);
  },

  assignLogistics: async (invoiceId: string, driverId: string | null, vehicleId: string | null) => {
    const { data: currentInv } = await supabase.from('invoices').select('driver_id, number').eq('id', invoiceId).single();
    const updates: any = { driver_id: driverId, vehicle_id: vehicleId };
    if (driverId) updates.status = DeliveryStatus.PENDING;

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
  
  saveProof: async (proof: DeliveryProof) => {
    const { error } = await supabase.from('delivery_proofs').insert(proof);
    if (!error) {
       const newStatus = proof.failure_reason ? DeliveryStatus.FAILED : DeliveryStatus.DELIVERED;
       await supabase.from('invoices').update({ status: newStatus }).eq('id', proof.invoice_id);
    }
  },

  getProofByInvoiceId: async (invoiceId: string): Promise<DeliveryProof | undefined> => {
    const { data } = await supabase.from('delivery_proofs').select('*').eq('invoice_id', invoiceId).single();
    return data as DeliveryProof || undefined;
  },

  verifyAdminPassword: async (passwordInput: string): Promise<boolean> => {
    return passwordInput === (import.meta.env.VITE_ADMIN_PASSWORD || ADMIN_PASSWORD_DEFAULT);
  },

  updateAdminPassword: async (newPassword: string) => {
    alert("Configuração de senha deve ser feita via Variáveis de Ambiente no Supabase/Vercel.");
  }
};