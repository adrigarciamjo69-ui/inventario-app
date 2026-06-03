export type AssetCategory = string; // Dinámico desde la BD

export interface Category {
  id: number;
  value: string;
  label: string;
  icon?: string;
  is_system: boolean;
  created_at?: string;
}

export interface FloorplanItem {
  id: number;
  floor: number;
  x: number;
  y: number;
  width: number;
  height: number;
  type: FloorplanItemType;
  label: string;
  color: string;
  asset_id?: string | null;
  notes?: string | null;
  created_at?: string;
}

export type FloorplanItemType = 'room' | 'desk' | 'server_rack' | 'printer' | 'switch' | 'wall' | 'door' | 'window' | 'asset' | 'label';

export type AssetStatus = 'activo' | 'inactivo' | 'reparacion' | 'baja';

export type SoftwareLicenseType = 'perpetua' | 'suscripcion' | 'freeware' | 'opensource' | 'trial' | 'volumen';
export type SoftwareStatus = 'activo' | 'inactivo' | 'expirado' | 'baja';

export interface Software {
  id: number;
  name: string;
  vendor: string;
  version: string;
  license_key?: string;
  license_type: SoftwareLicenseType;
  seats: number;
  purchase_date?: string;
  expiry_date?: string;
  purchase_order?: string;
  price: number;
  department?: string;
  status: SoftwareStatus;
  notes?: string;
  created_at?: string;
  updated_at?: string;
  asset_assignments?: SoftwareAssetLink[];
  user_assignments?: SoftwareUserLink[];
}

export interface SoftwareAssetLink {
  id: number;
  software_id: number;
  asset_id: string;       // FK a assets.id
  asset_brand?: string;
  asset_model?: string;
  asset_serial?: string;
  assigned_at?: string;
  notes?: string;
}

export interface SoftwareUserLink {
  id: number;
  software_id: number;
  user_id: number;
  username?: string;
  full_name?: string;
  assigned_at?: string;
  notes?: string;
}

export interface Asset {
  id: string;
  serial_number: string;
  category: AssetCategory;
  brand: string;
  model: string;
  price: number;
  purchase_date: string;
  purchase_order: string;
  assigned_to: string;
  department?: string;
  status: AssetStatus;
  notes?: string;
  created_at?: string;
  updated_at?: string;
}

export type ServiceStatus = 'activo' | 'inactivo' | 'cancelado' | 'pendiente';
export type BillingCycle = 'mensual' | 'anual' | 'unico' | 'gratuito';

export interface Service {
  id: number;
  name: string;
  provider: string;
  category: string;
  url?: string;
  account?: string;
  department?: string;
  cost: number;
  billing_cycle: BillingCycle;
  renewal_date?: string;
  status: ServiceStatus;
  notes?: string;
  created_at?: string;
  updated_at?: string;
}

// ── Usuario cliente (persona asignable, sin acceso a la app) ─────────────────
export interface ClientUser {
  id: number;
  first_name: string;
  last_name: string;
  email?: string;
  phone?: string;
  department?: string;
  position?: string;
  employee_id?: string;
  notes?: string;
  active: boolean;
  created_at?: string;
  updated_at?: string;
}

export type AssetUserLinkType = 'asignado' | 'responsable' | 'usuario_secundario';

export interface AssetUserLink {
  id: number;
  asset_id: string;
  client_user_id: number;
  link_type: AssetUserLinkType;
  notes?: string;
  assigned_at?: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  department?: string;
  position?: string;
  employee_id?: string;
}

export type UserRole = 'admin' | 'editor' | 'viewer';

export interface User {
  id: number;
  username: string;
  full_name: string;
  email: string;
  role: UserRole;
  active: boolean;
  preferences: Record<string, unknown>;
  created_at?: string;
}

export interface AuthUser extends User {
  token: string;
}

export interface LoginCredentials {
  username: string;
  password: string;
}

export interface ApiResponse<T> {
  data?: T;
  error?: string;
  message?: string;
}

export interface AssetDocument {
  id: number;
  asset_serial: string;
  filename: string;
  original_name: string;
  mimetype: string;
  size: number;
  uploaded_by_name?: string;
  created_at?: string;
}
