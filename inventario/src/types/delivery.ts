// -- Actas de entrega/devolución ----------------------------------------------

export type DeliveryType = 'entrega' | 'devolucion';
export type DeliveryStatus = 'pendiente' | 'entregado' | 'devuelto' | 'en_revision' | 'danado' | 'perdido';

export interface DeliveryDevice {
  id?: number;
  asset_id?: string | null;
  device_type: string;
  model: string;
  serial_number: string;
  observations?: string;
}

export interface DeliveryRecord {
  id: number;
  doc_id: string;
  type: DeliveryType;
  client_user_id?: number | null;
  recipient_name?: string;
  recipient_dni?: string;
  delivery_date: string;
  responsible?: string;
  notes?: string;
  status: DeliveryStatus;
  created_by?: number;
  created_by_name?: string;
  created_at?: string;
  updated_at?: string;
  // JOIN fields
  first_name?: string;
  last_name?: string;
  department?: string;
  employee_id?: string;
  devices?: DeliveryDevice[];
}
