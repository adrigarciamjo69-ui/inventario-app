import { useEffect, useState, useCallback } from 'react';
import {
  Plus, Search, Pencil, Trash2, ChevronUp, ChevronDown,
  Filter, AlertTriangle, Package2, Link2, Link2Off,
  Users2, Monitor, X, Save, Key, Calendar, Hash, Loader2,
  CheckSquare, Square, Download, Tag
} from 'lucide-react';
import Papa from 'papaparse';
import toast from 'react-hot-toast';
import {
  Software, SoftwareLicenseType, SoftwareStatus,
  SoftwareAssetLink, SoftwareUserLink, ClientUser
} from '../types';
import {
  getSoftwareList, createSoftware, updateSoftware, deleteSoftware,
  getSoftware, linkSoftwareAsset, unlinkSoftwareAsset,
  linkSoftwareUser, unlinkSoftwareUser,
  getAssets, getClientUsers
} from '../api/client';
import { useAuth } from '../context/AuthContext';
import { Asset } from '../types';

// ── Constantes ────────────────────────────────────────────────────────────────
const LICENSE_TYPES: { value: SoftwareLicenseType; label: string; color: string }[] = [
  { value: 'perpetua',    label: 'Perpetua',     color: 'bg-blue-500/20 text-blue-400 border-blue-500/30' },
  { value: 'suscripcion', label: 'Suscripción',  color: 'bg-purple-500/20 text-purple-400 border-purple-500/30' },
  { value: 'volumen',     label: 'Volumen',      color: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30' },
  { value: 'freeware',    label: 'Freeware',     color: 'bg-green-500/20 text-green-400 border-green-500/30' },
  { value: 'opensource',  label: 'Open Source',  color: 'bg-teal-500/20 text-teal-400 border-teal-500/30' },
  { value: 'trial',       label: 'Trial',        color: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30' },
];

const SW_STATUSES: { value: SoftwareStatus; label: string; color: string }[] = [
  { value: 'activo',   label: 'Activo',    color: 'bg-green-500/20 text-green-400 border-green-500/30' },
  { value: 'inactivo', label: 'Inactivo',  color: 'bg-gray-500/20 text-gray-400 border-gray-500/30' },
  { value: 'expirado', label: 'Expirado',  color: 'bg-red-500/20 text-red-400 border-red-500/30' },
  { value: 'baja',     label: 'Baja',      color: 'bg-orange-500/20 text-orange-400 border-orange-500/30' },
];

const getLicenseColor = (t: string) => LICENSE_TYPES.find(l => l.value === t)?.color || 'bg-gray-500/20 text-gray-400 border-gray-500/30';
const getLicenseLabel = (t: string) => LICENSE_TYPES.find(l => l.value === t)?.label || t;
const getStatusColor  = (s: string) => SW_STATUSES.find(x => x.value === s)?.color || 'bg-gray-500/20 text-gray-400 border-gray-500/30';
const getStatusLabel  = (s: string) => SW_STATUSES.find(x => x.value === s)?.label || s;

const emptyForm = {
  name: '', vendor: '', version: '',
  license_key: '', license_type: 'perpetua' as SoftwareLicenseType,
  seats: 1, purchase_date: '', expiry_date: '',
  purchase_order: '', price: 0,
  status: 'activo' as SoftwareStatus, notes: '',
};

// ── Checkbox ──────────────────────────────────────────────────────────────────
function Checkbox({ checked, indeterminate, onChange }: {
  checked: boolean; indeterminate?: boolean; onChange: () => void;
}) {
  return (
    <button onClick={(e) => { e.stopPropagation(); onChange(); }}
      className="flex items-center justify-center w-5 h-5 flex-shrink-0" type="button">
      {indeterminate
        ? <CheckSquare className="w-4 h-4 text-purple-400" />
        : checked
          ? <CheckSquare className="w-4 h-4 text-purple-500" />
          : <Square className="w-4 h-4 text-gray-600 hover:text-gray-400" />}
    </button>
  );
}

// ── Field ─────────────────────────────────────────────────────────────────────
function Field({ label, children, error }: { label: string; children: React.ReactNode; error?: string }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-400 mb-1">{label}</label>
      {children}
      {error && <p className="text-red-400 text-xs mt-1">{error}</p>}
    </div>
  );
}

const ic = (err?: string) =>
  `w-full bg-gray-800 border ${err ? 'border-red-500' : 'border-gray-700'} rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors`;

// ── Panel de vínculos ─────────────────────────────────────────────────────────
interface LinksPanelProps {
  software: Software;
  canEdit: boolean;
  onRefresh: () => void;
}

function LinksPanel({ software, canEdit, onRefresh }: LinksPanelProps) {
  const [assets, setAssets]           = useState<Asset[]>([]);
  const [clientUsers, setClientUsers] = useState<ClientUser[]>([]);
  const [assetLinks, setAssetLinks]   = useState<SoftwareAssetLink[]>(software.asset_assignments || []);
  const [userLinks, setUserLinks]     = useState<SoftwareUserLink[]>(software.user_assignments || []);
  const [selAsset, setSelAsset]       = useState('');
  const [selUser, setSelUser]         = useState('');
  const [addingAsset, setAddingAsset] = useState(false);
  const [addingUser, setAddingUser]   = useState(false);
  const [tab, setTab]                 = useState<'assets' | 'users'>('assets');

  useEffect(() => {
    getAssets().then(r => setAssets(r.data)).catch(() => {});
    getClientUsers().then(r => setClientUsers(r.data.filter((u: ClientUser) => u.active))).catch(() => {});
  }, []);

  useEffect(() => {
    setAssetLinks(software.asset_assignments || []);
    setUserLinks(software.user_assignments || []);
  }, [software]);

  // Puestos: cuántos quedan disponibles
  const seatsUsed      = userLinks.length;
  const seatsTotal     = software.seats;
  const seatsAvailable = Math.max(0, seatsTotal - seatsUsed);
  const seatsExceeded  = seatsUsed > seatsTotal;

  const handleLinkAsset = async () => {
    if (!selAsset) return;
    setAddingAsset(true);
    try {
      const res = await linkSoftwareAsset(software.id, { asset_id: selAsset });
      setAssetLinks(prev => [...prev, res.data]);
      setSelAsset('');
      toast.success('Activo vinculado');
      onRefresh();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      toast.error(e.response?.data?.error || 'Error al vincular activo');
    } finally { setAddingAsset(false); }
  };

  const handleUnlinkAsset = async (linkId: number) => {
    try {
      await unlinkSoftwareAsset(linkId);
      setAssetLinks(prev => prev.filter(l => l.id !== linkId));
      toast.success('Vínculo eliminado');
      onRefresh();
    } catch { toast.error('Error al desvincular activo'); }
  };

  const handleLinkUser = async () => {
    if (!selUser) return;
    if (seatsAvailable <= 0) {
      toast.error(`No quedan puestos disponibles (${seatsTotal} puestos máximo)`);
      return;
    }
    setAddingUser(true);
    try {
      const res = await linkSoftwareUser(software.id, { client_user_id: parseInt(selUser) });
      setUserLinks(prev => [...prev, res.data]);
      setSelUser('');
      toast.success('Usuario vinculado');
      onRefresh();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      toast.error(e.response?.data?.error || 'Error al vincular usuario');
    } finally { setAddingUser(false); }
  };

  const handleUnlinkUser = async (linkId: number) => {
    try {
      await unlinkSoftwareUser(linkId);
      setUserLinks(prev => prev.filter(l => l.id !== linkId));
      toast.success('Vínculo eliminado');
      onRefresh();
    } catch { toast.error('Error al desvincular usuario'); }
  };

  const linkedAssetIds  = new Set(assetLinks.map(l => l.asset_id));
  // NO filtramos usuarios ya vinculados — un usuario puede ocupar varios puestos
  const availableAssets = assets.filter(a => !linkedAssetIds.has(a.id));

  return (
    <div className="mt-5 border-t border-gray-800 pt-5 space-y-4">
      <div className="flex gap-2 flex-wrap">
        <button onClick={() => setTab('assets')}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors border
            ${tab === 'assets' ? 'bg-blue-600 border-blue-500 text-white' : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-white'}`}>
          <Monitor className="w-3.5 h-3.5" />
          Activos vinculados ({assetLinks.length})
        </button>
        <button onClick={() => setTab('users')}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors border
            ${tab === 'users'
              ? seatsExceeded ? 'bg-red-600 border-red-500 text-white'
              : 'bg-emerald-600 border-emerald-500 text-white'
              : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-white'}`}>
          <Users2 className="w-3.5 h-3.5" />
          Usuarios ({seatsUsed}/{seatsTotal} puestos)
        </button>
      </div>

      {tab === 'assets' && (
        <div className="space-y-3">
          {canEdit && (
            <div className="flex gap-2">
              <select value={selAsset} onChange={e => setSelAsset(e.target.value)}
                className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500">
                <option value="">Seleccionar activo...</option>
                {availableAssets.map(a => (
                  <option key={a.id} value={a.id}>{a.id} — {a.brand} {a.model}</option>
                ))}
              </select>
              <button onClick={handleLinkAsset} disabled={!selAsset || addingAsset}
                className="flex items-center gap-1.5 px-3 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-900 disabled:text-blue-400 text-white text-xs font-medium rounded-lg transition-colors">
                {addingAsset ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Link2 className="w-3.5 h-3.5" />}
                Vincular
              </button>
            </div>
          )}
          {assetLinks.length === 0
            ? <p className="text-sm text-gray-600 text-center py-3">No hay activos vinculados</p>
            : (
              <div className="space-y-2">
                {assetLinks.map(link => (
                  <div key={link.id} className="flex items-center gap-3 px-3 py-2.5 bg-gray-800/50 border border-gray-700/50 rounded-lg">
                    <Monitor className="w-4 h-4 text-blue-400 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-white font-medium">{link.asset_id}</p>
                      <p className="text-xs text-gray-500">{link.asset_brand} {link.asset_model} · SN: {link.asset_serial}</p>
                    </div>
                    {canEdit && (
                      <button onClick={() => handleUnlinkAsset(link.id)}
                        className="text-gray-500 hover:text-red-400 transition-colors p-1" title="Desvincular">
                        <Link2Off className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
        </div>
      )}

      {tab === 'users' && (
        <div className="space-y-3">

          {/* Contador de puestos */}
          <div className={`flex items-center justify-between px-3 py-2 rounded-lg border text-xs font-medium
            ${seatsExceeded
              ? 'bg-red-500/10 border-red-500/30 text-red-400'
              : seatsAvailable === 0
                ? 'bg-yellow-500/10 border-yellow-500/30 text-yellow-400'
                : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'}`}>
            <span className="flex items-center gap-2">
              <Users2 className="w-3.5 h-3.5" />
              {seatsExceeded
                ? `⚠️ Excedido: ${seatsUsed} usuarios asignados (máximo ${seatsTotal} puestos)`
                : seatsAvailable === 0
                  ? `🔒 Todos los puestos ocupados (${seatsTotal}/${seatsTotal})`
                  : `✅ ${seatsAvailable} puesto${seatsAvailable !== 1 ? 's' : ''} disponible${seatsAvailable !== 1 ? 's' : ''} de ${seatsTotal}`}
            </span>
            {/* Barra de progreso */}
            <div className="flex items-center gap-2">
              <div className="w-24 h-1.5 bg-gray-700 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${seatsExceeded ? 'bg-red-500' : seatsAvailable === 0 ? 'bg-yellow-500' : 'bg-emerald-500'}`}
                  style={{ width: `${Math.min(100, (seatsUsed / seatsTotal) * 100)}%` }}
                />
              </div>
              <span className="text-gray-400 font-normal">{seatsUsed}/{seatsTotal}</span>
            </div>
          </div>

          {/* Info sobre usuarios clientes */}
          <div className="flex items-center gap-2 text-xs text-blue-400/70 bg-blue-500/10 border border-blue-500/20 rounded-lg px-3 py-2">
            <Users2 className="w-3.5 h-3.5 flex-shrink-0" />
            Usuarios clientes de la organización · Un mismo usuario puede ocupar varios puestos
          </div>

          {canEdit && (
            <div className="flex gap-2">
              <select value={selUser} onChange={e => setSelUser(e.target.value)}
                disabled={seatsAvailable <= 0}
                className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed">
                <option value="">
                  {seatsAvailable <= 0 ? 'Sin puestos disponibles' : 'Seleccionar usuario...'}
                </option>
                {clientUsers.map(u => (
                  <option key={u.id} value={u.id}>
                    {u.first_name} {u.last_name}{u.department ? ` — ${u.department}` : ''}
                    {userLinks.filter(l => l.user_id === u.id).length > 0
                      ? ` (${userLinks.filter(l => l.user_id === u.id).length} puesto${userLinks.filter(l => l.user_id === u.id).length > 1 ? 's' : ''} ya asignado${userLinks.filter(l => l.user_id === u.id).length > 1 ? 's' : ''})`
                      : ''}
                  </option>
                ))}
              </select>
              <button onClick={handleLinkUser} disabled={!selUser || addingUser || seatsAvailable <= 0}
                className="flex items-center gap-1.5 px-3 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-900 disabled:text-emerald-400 text-white text-xs font-medium rounded-lg transition-colors">
                {addingUser ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Link2 className="w-3.5 h-3.5" />}
                Asignar
              </button>
            </div>
          )}

          {userLinks.length === 0
            ? <p className="text-sm text-gray-600 text-center py-3">No hay usuarios asignados</p>
            : (
              <div className="space-y-2">
                {userLinks.map((link, idx) => (
                  <div key={link.id} className="flex items-center gap-3 px-3 py-2.5 bg-gray-800/50 border border-gray-700/50 rounded-lg">
                    <div className="w-7 h-7 rounded-full bg-emerald-600/30 flex items-center justify-center text-xs font-bold text-emerald-400 flex-shrink-0">
                      {link.full_name?.charAt(0) || '?'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm text-white font-medium">{link.full_name || link.username}</p>
                        <span className="text-xs text-gray-600 bg-gray-800 border border-gray-700 rounded px-1.5 py-0.5">
                          Puesto #{idx + 1}
                        </span>
                      </div>
                      <p className="text-xs text-gray-500">
                        {(link as SoftwareUserLink & { department?: string; position?: string }).department || ''}
                        {(link as SoftwareUserLink & { department?: string; position?: string }).position
                          ? ` · ${(link as SoftwareUserLink & { position?: string }).position}` : ''}
                      </p>
                    </div>
                    {canEdit && (
                      <button onClick={() => handleUnlinkUser(link.id)}
                        className="text-gray-500 hover:text-red-400 transition-colors p-1" title="Liberar puesto">
                        <Link2Off className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
        </div>
      )}
    </div>
  );
}

// ── Modal de formulario ───────────────────────────────────────────────────────
interface SoftwareFormProps {
  software?: Software | null;
  onSave: (data: typeof emptyForm) => Promise<void>;
  onClose: () => void;
  isEdit?: boolean;
  canEdit: boolean;
}

function SoftwareFormModal({ software, onSave, onClose, isEdit, canEdit }: SoftwareFormProps) {
  const [form, setForm]               = useState(emptyForm);
  const [saving, setSaving]           = useState(false);
  const [errors, setErrors]           = useState<Record<string, string>>({});
  const [detail, setDetail]           = useState<Software | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  useEffect(() => {
    if (software) {
      setForm({
        name: software.name, vendor: software.vendor, version: software.version || '',
        license_key: software.license_key || '', license_type: software.license_type,
        seats: software.seats,
        purchase_date: software.purchase_date?.slice(0, 10) || '',
        expiry_date: software.expiry_date?.slice(0, 10) || '',
        purchase_order: software.purchase_order || '',
        price: software.price, status: software.status, notes: software.notes || '',
      });
      if (isEdit) {
        setLoadingDetail(true);
        getSoftware(software.id).then(r => setDetail(r.data)).catch(() => {}).finally(() => setLoadingDetail(false));
      }
    } else { setForm(emptyForm); }
  }, [software, isEdit]);

  const validate = () => {
    const e: Record<string, string> = {};
    if (!form.name.trim()) e.name = 'Nombre requerido';
    if (!form.vendor.trim()) e.vendor = 'Proveedor requerido';
    if (form.seats < 1) e.seats = 'Mínimo 1 puesto';
    if (form.price < 0) e.price = 'El precio no puede ser negativo';
    return e;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length > 0) { setErrors(errs); return; }
    setSaving(true);
    try { await onSave(form); } finally { setSaving(false); }
  };

  const handleRefresh = () => {
    if (software) getSoftware(software.id).then(r => setDetail(r.data)).catch(() => {});
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
          <h2 className="text-lg font-semibold text-white flex items-center gap-2">
            <Package2 className="w-5 h-5 text-purple-400" />
            {isEdit ? 'Editar Software' : 'Nuevo Software'}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          <form id="sw-form" onSubmit={handleSubmit}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Nombre *" error={errors.name}>
                <input type="text" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="Ej: Microsoft Office 365" className={ic(errors.name)} />
              </Field>
              <Field label="Proveedor / Fabricante *" error={errors.vendor}>
                <input type="text" value={form.vendor} onChange={e => setForm(f => ({ ...f, vendor: e.target.value }))}
                  placeholder="Ej: Microsoft" className={ic(errors.vendor)} />
              </Field>
              <Field label="Versión">
                <input type="text" value={form.version} onChange={e => setForm(f => ({ ...f, version: e.target.value }))}
                  placeholder="Ej: 2024" className={ic()} />
              </Field>
              <Field label="Tipo de licencia">
                <select value={form.license_type} onChange={e => setForm(f => ({ ...f, license_type: e.target.value as SoftwareLicenseType }))}
                  className={ic()}>
                  {LICENSE_TYPES.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
                </select>
              </Field>
              <Field label="Estado">
                <select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value as SoftwareStatus }))}
                  className={ic()}>
                  {SW_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </Field>
              <Field label="Número de puestos / licencias" error={errors.seats}>
                <input type="number" min={1} value={form.seats} onChange={e => setForm(f => ({ ...f, seats: parseInt(e.target.value) || 1 }))}
                  className={ic(errors.seats)} />
              </Field>
              <div className="sm:col-span-2">
                <Field label="Clave de licencia">
                  <div className="relative">
                    <Key className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                    <input type="text" value={form.license_key} onChange={e => setForm(f => ({ ...f, license_key: e.target.value }))}
                      placeholder="XXXX-XXXX-XXXX-XXXX" className={ic() + ' pl-9 font-mono text-xs'} />
                  </div>
                </Field>
              </div>
              <Field label="Precio (€)" error={errors.price}>
                <input type="number" min={0} step="0.01" value={form.price} onChange={e => setForm(f => ({ ...f, price: parseFloat(e.target.value) || 0 }))}
                  className={ic(errors.price)} />
              </Field>
              <Field label="Orden de compra">
                <input type="text" value={form.purchase_order} onChange={e => setForm(f => ({ ...f, purchase_order: e.target.value }))}
                  placeholder="OC-2024-001" className={ic()} />
              </Field>
              <Field label="Fecha de compra">
                <div className="relative">
                  <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                  <input type="date" value={form.purchase_date} onChange={e => setForm(f => ({ ...f, purchase_date: e.target.value }))}
                    className={ic() + ' pl-9'} />
                </div>
              </Field>
              <Field label="Fecha de expiración">
                <div className="relative">
                  <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                  <input type="date" value={form.expiry_date} onChange={e => setForm(f => ({ ...f, expiry_date: e.target.value }))}
                    className={ic() + ' pl-9'} />
                </div>
              </Field>
              <div className="sm:col-span-2">
                <Field label="Notas">
                  <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                    rows={3} placeholder="Observaciones adicionales..." className={ic() + ' resize-none'} />
                </Field>
              </div>
            </div>
          </form>

          {isEdit && (
            loadingDetail
              ? <div className="mt-5 flex items-center gap-2 text-gray-500 text-sm"><Loader2 className="w-4 h-4 animate-spin" /> Cargando vínculos...</div>
              : detail
                ? <LinksPanel software={detail} canEdit={canEdit} onRefresh={handleRefresh} />
                : null
          )}
        </div>

        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-800">
          <button type="button" onClick={onClose}
            className="px-4 py-2 text-sm text-gray-400 hover:text-white bg-gray-800 hover:bg-gray-700 rounded-lg transition-colors">
            Cancelar
          </button>
          {canEdit && (
            <button form="sw-form" type="submit" disabled={saving}
              className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-500 disabled:bg-purple-900 text-white text-sm font-medium rounded-lg transition-colors">
              {saving ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Save className="w-4 h-4" />}
              {isEdit ? 'Guardar cambios' : 'Crear software'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Página principal ──────────────────────────────────────────────────────────
export default function SoftwarePage() {
  const { user } = useAuth();
  const canEdit = user?.role === 'admin' || user?.role === 'editor';

  const [list, setList]               = useState<Software[]>([]);
  const [loading, setLoading]         = useState(true);
  const [search, setSearch]           = useState('');
  const [filterStatus, setFilterStatus]   = useState('');
  const [filterLicense, setFilterLicense] = useState('');
  const [sortField, setSortField]     = useState<keyof Software>('name');
  const [sortDir, setSortDir]         = useState<'asc' | 'desc'>('asc');
  const [showForm, setShowForm]       = useState(false);
  const [editSw, setEditSw]           = useState<Software | null>(null);
  const [deleteModal, setDeleteModal] = useState<Software | null>(null);
  const [deleting, setDeleting]       = useState(false);

  // ── Selección múltiple ──────────────────────────────────────────────────────
  const [selected, setSelected]           = useState<Set<number>>(new Set());
  const [bulkDeleteModal, setBulkDeleteModal] = useState(false);
  const [bulkDeleting, setBulkDeleting]   = useState(false);
  const [bulkStatusModal, setBulkStatusModal] = useState(false);
  const [bulkStatus, setBulkStatus]       = useState('activo');

  const load = useCallback(() => {
    setLoading(true);
    getSoftwareList().then(r => setList(r.data)).catch(() => toast.error('Error al cargar software')).finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setSelected(new Set()); }, [search, filterStatus, filterLicense]);

  const handleSort = (f: keyof Software) => {
    if (sortField === f) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(f); setSortDir('asc'); }
  };

  const filtered = list
    .filter(s => {
      const q = search.toLowerCase();
      return (
        (!q || s.name.toLowerCase().includes(q) || s.vendor.toLowerCase().includes(q) || s.version?.toLowerCase().includes(q)) &&
        (!filterStatus  || s.status       === filterStatus) &&
        (!filterLicense || s.license_type === filterLicense)
      );
    })
    .sort((a, b) => {
      const av = String(a[sortField] ?? '');
      const bv = String(b[sortField] ?? '');
      return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
    });

  const filteredIds = filtered.map(s => s.id);
  const allSelected = filteredIds.length > 0 && filteredIds.every(id => selected.has(id));
  const someSelected = filteredIds.some(id => selected.has(id));

  const toggleAll = () => {
    if (allSelected) { setSelected(prev => { const n = new Set(prev); filteredIds.forEach(id => n.delete(id)); return n; }); }
    else { setSelected(prev => { const n = new Set(prev); filteredIds.forEach(id => n.add(id)); return n; }); }
  };
  const toggleOne = (id: number) => {
    setSelected(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  };
  const clearSelection = () => setSelected(new Set());

  const handleBulkExport = () => {
    const rows = list.filter(s => selected.has(s.id)).map(s => ({
      name: s.name, vendor: s.vendor, version: s.version,
      license_type: s.license_type, seats: s.seats, price: s.price,
      purchase_date: s.purchase_date?.slice(0,10) || '',
      expiry_date: s.expiry_date?.slice(0,10) || '',
      purchase_order: s.purchase_order || '', status: s.status, notes: s.notes || '',
    }));
    const csv = Papa.unparse(rows);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `software_seleccionado_${new Date().toISOString().slice(0,10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
    toast.success(`Exportadas ${rows.length} licencias`);
  };

  const handleBulkDelete = async () => {
    setBulkDeleting(true);
    let ok = 0, fail = 0;
    for (const id of selected) { try { await deleteSoftware(id); ok++; } catch { fail++; } }
    setBulkDeleting(false); setBulkDeleteModal(false); clearSelection();
    if (ok > 0) toast.success(`${ok} licencia${ok > 1 ? 's' : ''} eliminada${ok > 1 ? 's' : ''}`);
    if (fail > 0) toast.error(`${fail} no se pudo${fail > 1 ? 'ron' : ''} eliminar`);
    load();
  };

  const handleBulkStatus = async () => {
    let ok = 0, fail = 0;
    for (const id of selected) {
      const sw = list.find(s => s.id === id);
      if (!sw) continue;
      try { await updateSoftware(id, { ...sw, status: bulkStatus }); ok++; } catch { fail++; }
    }
    setBulkStatusModal(false); clearSelection();
    if (ok > 0) toast.success(`Estado actualizado en ${ok} licencia${ok > 1 ? 's' : ''}`);
    if (fail > 0) toast.error(`${fail} no se pudo${fail > 1 ? 'ron' : ''} actualizar`);
    load();
  };

  const handleSave = async (data: typeof emptyForm) => {
    try {
      if (editSw) { await updateSoftware(editSw.id, data); toast.success('Software actualizado'); }
      else { await createSoftware(data); toast.success('Software creado'); }
      setShowForm(false); setEditSw(null); load();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      toast.error(e.response?.data?.error || 'Error al guardar'); throw err;
    }
  };

  const handleDelete = async () => {
    if (!deleteModal) return;
    setDeleting(true);
    try { await deleteSoftware(deleteModal.id); toast.success('Software eliminado'); setDeleteModal(null); load(); }
    catch { toast.error('Error al eliminar'); } finally { setDeleting(false); }
  };

  const SortIcon = ({ field }: { field: keyof Software }) =>
    sortField !== field ? <ChevronUp className="w-3 h-3 text-gray-600" />
      : sortDir === 'asc' ? <ChevronUp className="w-3 h-3 text-purple-400" />
        : <ChevronDown className="w-3 h-3 text-purple-400" />;

  const today = new Date();
  const soonExpiring = list.filter(s => {
    if (!s.expiry_date || s.status !== 'activo') return false;
    const diff = (new Date(s.expiry_date).getTime() - today.getTime()) / (1000 * 60 * 60 * 24);
    return diff >= 0 && diff <= 30;
  });

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Software</h1>
          <p className="text-gray-400 text-sm mt-1">{list.length} licencias registradas</p>
        </div>
        {canEdit && (
          <button onClick={() => { setEditSw(null); setShowForm(true); }}
            className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white text-sm font-medium rounded-lg transition-colors">
            <Plus className="w-4 h-4" /> Nuevo software
          </button>
        )}
      </div>

      {/* Aviso expiración */}
      {soonExpiring.length > 0 && (
        <div className="flex items-start gap-3 bg-yellow-500/10 border border-yellow-500/20 rounded-xl px-4 py-3">
          <AlertTriangle className="w-5 h-5 text-yellow-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-yellow-300">
              {soonExpiring.length} licencia{soonExpiring.length > 1 ? 's' : ''} expira{soonExpiring.length === 1 ? '' : 'n'} en menos de 30 días
            </p>
            <p className="text-xs text-yellow-500 mt-0.5">{soonExpiring.map(s => s.name).join(', ')}</p>
          </div>
        </div>
      )}

      {/* Barra de selección múltiple */}
      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 bg-purple-600/10 border border-purple-500/30 rounded-xl px-4 py-3">
          <CheckSquare className="w-4 h-4 text-purple-400 flex-shrink-0" />
          <span className="text-sm font-medium text-purple-300">
            {selected.size} licencia{selected.size > 1 ? 's' : ''} seleccionada{selected.size > 1 ? 's' : ''}
          </span>
          <div className="flex gap-2 ml-2 flex-wrap">
            <button onClick={handleBulkExport}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 text-xs rounded-lg transition-colors">
              <Download className="w-3.5 h-3.5" /> Exportar selección
            </button>
            {canEdit && (
              <>
                <button onClick={() => setBulkStatusModal(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 text-xs rounded-lg transition-colors">
                  <Tag className="w-3.5 h-3.5" /> Cambiar estado
                </button>
                {user?.role === 'admin' && (
                  <button onClick={() => setBulkDeleteModal(true)}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500/20 hover:bg-red-500/30 border border-red-500/30 text-red-400 text-xs rounded-lg transition-colors">
                    <Trash2 className="w-3.5 h-3.5" /> Eliminar selección
                  </button>
                )}
              </>
            )}
          </div>
          <button onClick={clearSelection} className="ml-auto text-gray-500 hover:text-white transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Filtros */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
        <div className="flex flex-col lg:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
            <input type="text" value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Buscar por nombre, proveedor, versión..."
              className="w-full bg-gray-800 border border-gray-700 rounded-lg pl-10 pr-4 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500" />
          </div>
          <div className="flex gap-2 flex-wrap">
            <div className="relative">
              <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500" />
              <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
                className="bg-gray-800 border border-gray-700 rounded-lg pl-8 pr-3 py-2 text-sm text-white focus:outline-none focus:border-purple-500 appearance-none">
                <option value="">Todos los estados</option>
                {SW_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>
            <select value={filterLicense} onChange={e => setFilterLicense(e.target.value)}
              className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-purple-500 appearance-none">
              <option value="">Todos los tipos</option>
              {LICENSE_TYPES.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* Tabla */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-48">
            <div className="w-8 h-8 border-2 border-purple-500/30 border-t-purple-500 rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 text-gray-500">
            <Package2 className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p className="font-medium">No se encontró software</p>
            <p className="text-sm mt-1">Prueba con otros filtros o añade nuevo software</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-800/50 border-b border-gray-800">
                <tr>
                  <th className="px-3 py-3 w-10">
                    <Checkbox checked={allSelected} indeterminate={someSelected && !allSelected} onChange={toggleAll} />
                  </th>
                  {([
                    { f: 'name' as keyof Software, l: 'Nombre' },
                    { f: 'vendor' as keyof Software, l: 'Proveedor' },
                    { f: 'version' as keyof Software, l: 'Versión' },
                    { f: 'license_type' as keyof Software, l: 'Tipo licencia' },
                    { f: 'seats' as keyof Software, l: 'Puestos' },
                    { f: 'price' as keyof Software, l: 'Precio' },
                    { f: 'expiry_date' as keyof Software, l: 'Expiración' },
                    { f: 'status' as keyof Software, l: 'Estado' },
                  ]).map(({ f, l }) => (
                    <th key={f} onClick={() => handleSort(f)}
                      className="text-left text-xs font-medium text-gray-400 px-4 py-3 cursor-pointer hover:text-white transition-colors whitespace-nowrap">
                      <div className="flex items-center gap-1">{l}<SortIcon field={f} /></div>
                    </th>
                  ))}
                  <th className="px-4 py-3 text-xs font-medium text-gray-400 whitespace-nowrap">Vínculos</th>
                  <th className="px-4 py-3 text-xs font-medium text-gray-400">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {filtered.map(sw => {
                  const isSelected = selected.has(sw.id);
                  const isExpiringSoon = sw.expiry_date && sw.status === 'activo' &&
                    (() => { const diff = (new Date(sw.expiry_date!).getTime() - today.getTime()) / (1000 * 60 * 60 * 24); return diff >= 0 && diff <= 30; })();
                  return (
                    <tr key={sw.id}
                      className={`hover:bg-gray-800/40 transition-colors cursor-pointer ${isSelected ? 'bg-purple-600/5' : ''}`}
                      onClick={() => toggleOne(sw.id)}
                    >
                      <td className="px-3 py-3">
                        <Checkbox checked={isSelected} onChange={() => toggleOne(sw.id)} />
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <p className="text-white font-medium">{sw.name}</p>
                      </td>
                      <td className="px-4 py-3 text-gray-400 text-xs whitespace-nowrap">{sw.vendor}</td>
                      <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">{sw.version || '—'}</td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${getLicenseColor(sw.license_type)}`}>
                          {getLicenseLabel(sw.license_type)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-300 text-xs whitespace-nowrap">
                        <div className="flex items-center gap-1"><Hash className="w-3 h-3 text-gray-600" />{sw.seats}</div>
                      </td>
                      <td className="px-4 py-3 text-gray-300 text-xs whitespace-nowrap">
                        {Number(sw.price).toLocaleString('es-ES', { minimumFractionDigits: 2 })} €
                      </td>
                      <td className="px-4 py-3 text-xs whitespace-nowrap">
                        {sw.expiry_date ? (
                          <span className={isExpiringSoon ? 'text-yellow-400 font-medium' : 'text-gray-400'}>
                            {isExpiringSoon && '⚠️ '}{new Date(sw.expiry_date).toLocaleDateString('es-ES')}
                          </span>
                        ) : <span className="text-gray-600">—</span>}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${getStatusColor(sw.status)}`}>
                          {getStatusLabel(sw.status)}
                        </span>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="flex items-center gap-2 text-xs text-gray-500">
                          <span className="flex items-center gap-1"><Monitor className="w-3 h-3" />{(sw as Software & { asset_count?: number }).asset_count || 0}</span>
                          <span className="flex items-center gap-1"><Users2 className="w-3 h-3" />{(sw as Software & { user_count?: number }).user_count || 0}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center gap-2">
                          <button onClick={() => { setEditSw(sw); setShowForm(true); }}
                            className="text-gray-500 hover:text-purple-400 transition-colors p-1" title="Ver / Editar">
                            <Pencil className="w-4 h-4" />
                          </button>
                          {canEdit && user?.role === 'admin' && (
                            <button onClick={() => setDeleteModal(sw)}
                              className="text-gray-500 hover:text-red-400 transition-colors p-1" title="Eliminar">
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="px-4 py-3 border-t border-gray-800 text-xs text-gray-500 flex items-center justify-between">
              <span>Mostrando {filtered.length} de {list.length} licencias</span>
              {selected.size > 0 && <span className="text-purple-400">{selected.size} seleccionada{selected.size > 1 ? 's' : ''}</span>}
            </div>
          </div>
        )}
      </div>

      {/* Modal formulario */}
      {showForm && (
        <SoftwareFormModal software={editSw} isEdit={!!editSw} canEdit={canEdit}
          onSave={handleSave} onClose={() => { setShowForm(false); setEditSw(null); }} />
      )}

      {/* Modal eliminar individual */}
      {deleteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 max-w-md w-full shadow-2xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-red-500/20 flex items-center justify-center">
                <AlertTriangle className="w-5 h-5 text-red-400" />
              </div>
              <h3 className="text-lg font-semibold text-white">Eliminar software</h3>
            </div>
            <p className="text-gray-400 text-sm mb-2">¿Eliminar el software:</p>
            <p className="text-white font-medium mb-1">{deleteModal.name}</p>
            <p className="text-gray-500 text-xs mb-2">{deleteModal.vendor} · v{deleteModal.version}</p>
            <p className="text-red-400 text-xs mb-6">Se eliminarán todos los vínculos con activos y usuarios. Esta acción no se puede deshacer.</p>
            <div className="flex gap-3">
              <button onClick={() => setDeleteModal(null)} className="flex-1 px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg text-sm">Cancelar</button>
              <button onClick={handleDelete} disabled={deleting} className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-500 disabled:bg-red-800 text-white rounded-lg text-sm font-medium">
                {deleting ? 'Eliminando...' : 'Eliminar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal eliminar múltiple */}
      {bulkDeleteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 max-w-md w-full shadow-2xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-red-500/20 flex items-center justify-center">
                <AlertTriangle className="w-5 h-5 text-red-400" />
              </div>
              <h3 className="text-lg font-semibold text-white">Eliminar {selected.size} licencias</h3>
            </div>
            <p className="text-gray-400 text-sm mb-2">¿Estás seguro de que quieres eliminar las <strong className="text-white">{selected.size}</strong> licencias seleccionadas?</p>
            <p className="text-red-400 text-xs mb-6">Se eliminarán también todos sus vínculos. Esta acción no se puede deshacer.</p>
            <div className="flex gap-3">
              <button onClick={() => setBulkDeleteModal(false)} className="flex-1 px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg text-sm">Cancelar</button>
              <button onClick={handleBulkDelete} disabled={bulkDeleting} className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-500 disabled:bg-red-800 text-white rounded-lg text-sm font-medium">
                {bulkDeleting ? 'Eliminando...' : `Eliminar ${selected.size} licencias`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal cambio estado múltiple */}
      {bulkStatusModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 max-w-sm w-full shadow-2xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-purple-500/20 flex items-center justify-center">
                <Tag className="w-5 h-5 text-purple-400" />
              </div>
              <h3 className="text-lg font-semibold text-white">Cambiar estado</h3>
            </div>
            <p className="text-gray-400 text-sm mb-4">Cambiar el estado de <strong className="text-white">{selected.size}</strong> licencias seleccionadas a:</p>
            <select value={bulkStatus} onChange={e => setBulkStatus(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white mb-5 focus:outline-none focus:border-purple-500">
              {SW_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
            <div className="flex gap-3">
              <button onClick={() => setBulkStatusModal(false)} className="flex-1 px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg text-sm">Cancelar</button>
              <button onClick={handleBulkStatus} className="flex-1 px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-lg text-sm font-medium">Aplicar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
