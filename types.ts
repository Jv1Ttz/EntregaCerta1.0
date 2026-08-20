
export enum DeliveryStatus {
  PENDING = 'PENDING',
  IN_PROGRESS = 'IN_PROGRESS',
  DELIVERED = 'DELIVERED',
  RETURNED = 'RETURNED',
  FAILED = 'FAILED',
  ISSUE = 'ISSUE'
}

export interface Vehicle {
  id: string;
  plate: string;
  model: string;
  /** Peso do veículo em vazio (kg) */
  tara?: number;
  /** Capacidade volumétrica (m³) ou critério de cubagem definido pela operação */
  cubagem?: number;
  /** Peso bruto total máximo permitido (kg) — PBT/lotação total */
  max_weight?: number;
  last_location?: {
    lat: number;
    lng: number;
    updated_at: string;
    source?: 'salvadorsat' | 'app';
    speed_kmh?: number;
  };
}

export interface Driver {
  id: string;
  name: string;
  password?: string; // Added password field (optional for backward compatibility with old data)
  /** Início da rota ativa. null/undefined = não está em rota. Fonte de verdade do "rota ativa". */
  route_started_at?: string | null;
  last_location?: {
    lat: number;
    lng: number;
    updated_at: string;
    source?: 'salvadorsat' | 'app';
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
  /** Quantidade total de volumes da carga (somatório de <qVol> dos <vol>) */
  cargo_volume_count?: number;
  /** Tipo/descrição do volume (primeiro <esp> encontrado em <vol>) */
  cargo_volume_type?: string | null;
  /** Peso líquido total da carga (somatório de <pesoL> dos <vol>, em kg) */
  cargo_weight_net?: number;
  /** Peso bruto total da carga (somatório de <pesoB> dos <vol>, em kg) */
  cargo_weight_gross?: number;
  items?: InvoiceItem[];   // Lista de produtos importados
  return_value?: number;
  failure_reason?: string; // Já deve ter
  return_items?: string;   // <--- ADICIONE SE NÃO TIVER
  delivered_at?: string | null;
  delivery_attempts?: number;      // Contador de tentativas (0, 1, 2...)
  last_failure_reason?: string;
  original_value?: number;  
  lat?: number;
  lng?: number;   // Motivo da última falha (texto simples)
  /** Encerramento do fluxo de devolução: null = aberta, CONCLUDED = concluída, CANCELLED = cancelada */
  return_final_status?: 'CONCLUDED' | 'CANCELLED' | null;
  /** Data/hora em que a devolução foi finalizada */
  return_finalized_at?: string | null;
  /** Observação do gestor quando encerra a devolução (opcional) */
  return_final_note?: string | null;
  /** Link público para PDF (DANFE) — opcional, salvo pelo n8n/Drive */
  pdf_url?: string | null;
  /** Soft delete: data/hora em que a nota foi marcada como excluída pelo gestor */
  deleted_at?: string | null;
  /** Soft delete: identificador de quem excluiu (por enquanto usamos 'ADMIN') */
  deleted_by?: string | null;
  /** Soft delete: motivo da exclusão, se informado */
  deleted_reason?: string | null;
  /** Rota em que a nota foi tratada (FK routes.id). null = notas antigas / sem rota. */
  route_id?: string | null;
}

/**
 * Uma jornada de entrega de um motorista. Serve ao histórico (Controladoria de
 * Rotas) e, no futuro, ao agendamento — uma rota SCHEDULED é só uma rota ainda
 * não iniciada. Os *_count são o snapshot do resultado, gravado na finalização.
 */
export interface Route {
  id: string;
  driver_id: string;
  vehicle_id?: string | null;
  status: 'SCHEDULED' | 'IN_PROGRESS' | 'FINISHED' | 'CANCELLED';
  /** Dia planejado (só no agendamento). */
  scheduled_for?: string | null;
  started_at?: string | null;
  finished_at?: string | null;
  finished_by?: 'DRIVER' | 'GESTOR' | null;
  delivered_count: number;
  returned_count: number;
  issue_count: number;
  not_delivered_count: number;
  leftover_count: number;
  created_at: string;
  /** Preenchidos por embed do PostgREST na leitura da controladoria. */
  driver_name?: string;
  vehicle_plate?: string | null;
}

export interface DeliveryProof {
  invoice_id: string;
  receiver_name: string;
  receiver_doc: string;
  signature_data: string; // Base64
  photo_url: string; // Base64 for demo
  photo_stub_url?: string;
  return_type?: 'TOTAL' | 'PARTIAL' | string;
  return_items?: string;
  geo_lat: number | null;
  geo_long: number | null;
  delivered_at: string;
  notes?: string;
  /** Detalhe livre do motivo. Opcional desde a padronização. */
  failure_reason?: string;
  /** Motivo padronizado (ver constants/returnReasons). NULL nos registros antigos. */
  failure_reason_code?: string | null;
}

/**
 * Subconjunto leve de DeliveryProof, sem as colunas base64
 * (signature_data/photo_url/photo_stub_url). Usado em listagens.
 */
export type ProofSummary = Pick<
  DeliveryProof,
  'invoice_id' | 'receiver_name' | 'delivered_at' | 'failure_reason' | 'failure_reason_code' | 'notes' | 'return_type' | 'return_items'
>;

export interface AppNotification {
  id: string;
  recipient_id: string; // 'ADMIN' or driverId
  title: string;
  message: string;
  type: 'INFO' | 'SUCCESS' | 'WARNING';
  read: boolean;
  timestamp: string;
}

export interface InvoiceItem {
  itemIndex: string;
  code: string;
  name: string;     // Essencial para corrigir o erro "name não existe"
  quantity: number; // Essencial para corrigir o erro anterior de "string vs number"
  unit: string;
  value: number;
}

export type ActivityLogEventType = 'ASSIGNMENT' | 'STATUS_CHANGE' | 'XML_IMPORT' | 'SOFT_DELETE';

export interface ActivityLog {
  id: string;
  event_type: ActivityLogEventType;
  description: string;
  actor: string;
  created_at: string;
}

export interface Zone {
  id: string;
  name: string;
  color: string;
  /** Array de vértices do polígono */
  coordinates: { lat: number; lng: number }[];
  created_at: string;
}

export type ViewState =
  | { type: 'ROLE_SELECT' }
  /** `destino` guarda para onde ir depois de autenticar. Sem ele, quem clica em
   *  Auditoria e digita a senha cairia no Painel, tendo que navegar de novo. */
  | { type: 'ADMIN_LOGIN'; destino?: 'ADMIN_DASHBOARD' | 'ADMIN_AUDIT' }
  | { type: 'ADMIN_DASHBOARD' }
  | { type: 'ADMIN_AUDIT' }
  | { type: 'ADMIN_ROUTING' }
  | { type: 'ADMIN_ZONES' }
  | { type: 'DRIVER_LOGIN' }
  | { type: 'DRIVER_LIST'; driverId: string }
  | { type: 'DRIVER_ACTION'; driverId: string; invoiceId: string }
  | { type: 'SELLER_VIEW' };
