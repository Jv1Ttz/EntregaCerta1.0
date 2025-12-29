
export enum DeliveryStatus {
  PENDING = 'PENDING',
  IN_PROGRESS = 'IN_PROGRESS',
  DELIVERED = 'DELIVERED',
  FAILED = 'FAILED'
}

export interface Vehicle {
  id: string;
  plate: string;
  model: string;
}

export interface Driver {
  id: string;
  name: string;
  password?: string; // Added password field (optional for backward compatibility with old data)
  last_location?: {
    lat: number;
    lng: number;
    updated_at: string;
  };
}

export interface Invoice {
  id: string;
  access_key: string;
  number: string;
  series: string;
  customer_name: string;
  customer_doc: string; // CNPJ or CPF
  customer_address: string;
  customer_zip: string;
  value: number;
  status: DeliveryStatus;
  driver_id: string | null;
  vehicle_id: string | null; // The vehicle assigned for this specific delivery
  created_at: string;
}

export interface DeliveryProof {
  invoice_id: string;
  receiver_name: string;
  receiver_doc: string;
  signature_data: string; // Base64
  photo_url: string; // Base64 for demo
  photo_stub_url?: string;
  return_type?: 'TOTAL' | 'PARTIAL';
  return_items?: string;
  geo_lat: number | null;
  geo_long: number | null;
  delivered_at: string;
  notes?: string;
  failure_reason?: string;
}

export interface AppNotification {
  id: string;
  recipient_id: string; // 'ADMIN' or driverId
  title: string;
  message: string;
  type: 'INFO' | 'SUCCESS' | 'WARNING';
  read: boolean;
  timestamp: string;
}

export type ViewState = 
  | { type: 'ROLE_SELECT' }
  | { type: 'ADMIN_LOGIN' }
  | { type: 'ADMIN_DASHBOARD' }
  | { type: 'DRIVER_LOGIN' }
  | { type: 'DRIVER_LIST'; driverId: string }
  | { type: 'DRIVER_ACTION'; driverId: string; invoiceId: string };
