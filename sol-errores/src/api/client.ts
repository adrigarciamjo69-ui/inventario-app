import axios from 'axios';

const API_BASE = import.meta.env.VITE_API_URL || '/api';

export const apiClient = axios.create({
  baseURL: API_BASE,
  headers: { 'Content-Type': 'application/json' },
});

apiClient.interceptors.request.use((config) => {
  const token = sessionStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

apiClient.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      const token = sessionStorage.getItem('token');
      // Solo limpiar sesión si había un token activo (no en el login inicial)
      if (token) {
        sessionStorage.removeItem('token');
        sessionStorage.removeItem('user');
        // Recargar solo si no estamos ya en el proceso de login
        window.location.reload();
      }
    }
    return Promise.reject(err);
  }
);

// AUTH
export const login = (username: string, password: string) =>
  apiClient.post('/auth/login', { username, password });

export const getMe = () => apiClient.get('/auth/me');

// ASSETS — PK es ahora el campo `id` (ID interno)
export const getAssets = () => apiClient.get('/assets');
export const getAsset = (id: string) => apiClient.get(`/assets/${encodeURIComponent(id)}`);
export const createAsset = (data: object) => apiClient.post('/assets', data);
export const updateAsset = (id: string, data: object) => apiClient.put(`/assets/${encodeURIComponent(id)}`, data);
export const deleteAsset = (id: string) => apiClient.delete(`/assets/${encodeURIComponent(id)}`);
export const importAssets = (data: object[]) => apiClient.post('/assets/import', { assets: data });

// SOFTWARE
export const getSoftwareList = () => apiClient.get('/software');
export const getSoftware = (id: number) => apiClient.get(`/software/${id}`);
export const createSoftware = (data: object) => apiClient.post('/software', data);
export const updateSoftware = (id: number, data: object) => apiClient.put(`/software/${id}`, data);
export const deleteSoftware = (id: number) => apiClient.delete(`/software/${id}`);
// Vínculos software ↔ asset
export const getSoftwareAssets = (softwareId: number) => apiClient.get(`/software/${softwareId}/assets`);
export const linkSoftwareAsset = (softwareId: number, data: object) => apiClient.post(`/software/${softwareId}/assets`, data);
export const unlinkSoftwareAsset = (linkId: number) => apiClient.delete(`/software/asset-link/${linkId}`);
// Vínculos software ↔ usuario
export const getSoftwareUsers = (softwareId: number) => apiClient.get(`/software/${softwareId}/users`);
export const linkSoftwareUser = (softwareId: number, data: object) => apiClient.post(`/software/${softwareId}/users`, data);
export const unlinkSoftwareUser = (linkId: number) => apiClient.delete(`/software/user-link/${linkId}`);

// DOCUMENTS
export const getDocuments = (serial: string) =>
  apiClient.get(`/documents/${encodeURIComponent(serial)}`);

export const uploadDocument = (serial: string, file: File) => {
  const formData = new FormData();
  formData.append('document', file);
  return apiClient.post(`/documents/${encodeURIComponent(serial)}`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
};

export const downloadDocument = (id: number) =>
  apiClient.get(`/documents/download/${id}`, { responseType: 'blob' });

export const deleteDocument = (id: number) =>
  apiClient.delete(`/documents/file/${id}`);

// CATEGORIES
export const getCategories = () => apiClient.get('/categories');
export const createCategory = (data: object) => apiClient.post('/categories', data);
export const updateCategory = (id: number, data: object) => apiClient.put(`/categories/${id}`, data);
export const deleteCategory = (id: number) => apiClient.delete(`/categories/${id}`);

// FLOORPLAN
export const getFloorplan = () => apiClient.get('/floorplan');
export const createFloorplanItem = (data: object) => apiClient.post('/floorplan', data);
export const updateFloorplanItem = (id: number, data: object) => apiClient.put(`/floorplan/${id}`, data);
export const deleteFloorplanItem = (id: number) => apiClient.delete(`/floorplan/${id}`);

// ASSET ↔ USUARIO CLIENTE (vínculos)
export const getAssetUsers = (assetId: string) => apiClient.get(`/assets/${encodeURIComponent(assetId)}/users`);
export const linkAssetUser = (assetId: string, data: object) => apiClient.post(`/assets/${encodeURIComponent(assetId)}/users`, data);
export const unlinkAssetUser = (linkId: number) => apiClient.delete(`/assets/user-link/${linkId}`);

// CLIENT USERS (usuarios clientes / personas asignables)
export const getClientUsers = () => apiClient.get('/client-users');
export const getClientUser = (id: number) => apiClient.get(`/client-users/${id}`);
export const createClientUser = (data: object) => apiClient.post('/client-users', data);
export const updateClientUser = (id: number, data: object) => apiClient.put(`/client-users/${id}`, data);
export const deleteClientUser = (id: number) => apiClient.delete(`/client-users/${id}`);
export const importClientUsers = (data: object[]) => apiClient.post('/client-users/import', { users: data });

// USERS (usuarios de la app — administradores/editores/viewers)
export const getUsers = () => apiClient.get('/users');
export const getUser = (id: number) => apiClient.get(`/users/${id}`);
export const createUser = (data: object) => apiClient.post('/users', data);
export const updateUser = (id: number, data: object) => apiClient.put(`/users/${id}`, data);
export const deleteUser = (id: number) => apiClient.delete(`/users/${id}`);
export const changePassword = (id: number, data: object) => apiClient.put(`/users/${id}/password`, data);
