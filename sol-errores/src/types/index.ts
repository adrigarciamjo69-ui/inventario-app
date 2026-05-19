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
  id: number;            // PK autoincremental
  name: string;          // Nombre del software
  vendor: string;        // Fabricante/proveedor
  version: string;       // Versión
  license_key?: string;  // Clave de licencia
  license_type: SoftwareLicenseType;
  seats: number;         // Número de licencias/puestos
  purchase_date?: string;
  expiry_date?: string;
  purchase_order?: string;
  price: number;
  status: SoftwareStatus;
  notes?: string;
  created_at?: string;
  updated_at?: string;
  // Relaciones (desde JOIN)
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
  id: string;              // PRIMARY KEY (ID interno)
  serial_number: string;   // Número de serie (obligatorio pero no PK)
  category: AssetCategory;
  brand: string;
  model: string;
  price: number;
  purchase_date: string;
  purchase_order: string;
  assigned_to: string;
  status: AssetStatus;
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
