import { useEffect, useState, useCallback } from 'react';
import {
  Plus, Search, Pencil, Trash2, X, Save, Globe, ExternalLink,
  Calendar, RefreshCw, AlertTriangle, Loader2, CheckSquare, Square,
  ChevronUp, ChevronDown, Filter, Upload, Download
} from 'lucide-react';
import Papa from 'papaparse';
import toast from 'react-hot-toast';
import { apiClient } from '../api/client';
import { Service, ServiceStatus, BillingCycle } from '../types';
import { useAuth } from '../context/AuthContext';

// ── Constants ─────────────────────────────────────────────────────────────────

const SERVICE_STATUSES: { value: ServiceStatus; label: string; color: string }[] = [
  { value: 'activo',    label: 'Activo',    color: 'bg-green-500/20 text-green-400 border-green-500/30' },
  { value: 'inactivo',  label: 'Inactivo',  color: 'bg-gray-500/20 text-gray-400 border-gray-500/30' },
  { value: 'cancelado', label: 'Cancelado', color: 'bg-red-500/20 text-red-400 border-red-500/30' },
  { value: 'pendiente', label: 'Pendiente', color: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30' },
];

const BILLING_CYCLES: { value: BillingCycle; label: string }[] = [
  { value: 'mensual',  label: 'Mensual' },
  { value: 'anual',    label: 'Anual' },
  { value: 'unico',    label: 'Pago único' },
  { value: 'gratuito', label: 'Gratuito' },
];

const SERVICE_CATEGORIES = [
  'Cloud / Hosting', 'Seguridad', 'Comunicaciones', 'Productividad',
  'Monitorización', 'Backup', 'Dominio / DNS', 'Soporte', 'SaaS', 'Otros'
];

const getStatusColor = (s: string) => SERVICE_STATUSES.find(x => x.value === s)?.color || 'bg-gray-500/20 text-gray-400 border-gray-500/30';
const getStatusLabel = (s: string) => SERVICE_STATUSES.find(x => x.value === s)?.label || s;
const getBillingLabel = (b: string) => BILLING_CYCLES.find(x => x.value === b)?.label || b;

const emptyForm = {
  name: '', provider: '', category: 'Cloud / Hosting', url: '',
  account: '', department: '', cost: 0,
  billing_cycle: 'mensual' as BillingCycle,
  renewal_date: '', status: 'activo' as ServiceStatus, notes: '',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function inp(extra = '') {
  return `w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 ${extra}`;
}
function lbl() { return 'block text-xs font-medium text-gray-400 mb-1'; }

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className={lbl()}>{label}</label>{children}</div>;
}

function Checkbox({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <button onClick={e => { e.stopPropagation(); onChange(); }} className="flex items-center justify-center w-5 h-5" type="button">
      {checked
        ? <CheckSquare className="w-4 h-4 text-blue-500" />
        : <Square className="w-4 h-4 text-gray-600 hover:text-gray-400" />}
    </button>
  );
}

// ── ServiceForm Modal ─────────────────────────────────────────────────────────

function ServiceForm({ service, onSave, onClose }: {
  service?: Service; onSave: (data: typeof emptyForm) => Promise<void>; onClose: () => void;
}) {
  const [form, setForm] = useState(service ? {
    name: service.name, provider: service.provider, category: service.category,
    url: service.url || '', account: service.account || '',
    department: service.department || '', cost: service.cost,
    billing_cycle: service.billing_cycle, renewal_date: service.renewal_date?.slice(0, 10) || '',
    status: service.status, notes: service.notes || '',
  } : emptyForm);
  const [saving, setSaving] = useState(false);

  const set = (k: string, v: unknown) => setForm(f => ({ ...f, [k]: v }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) { toast.error('El nombre es obligatorio'); return; }
    setSaving(true);
    try { await onSave(form); } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
          <h2 className="text-lg font-semibold text-white">{service ? 'Editar servicio' : 'Nuevo servicio'}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white"><X className="w-5 h-5" /></button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-6 py-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <Field label="Nombre del servicio *">
                <input className={inp()} value={form.name} onChange={e => set('name', e.target.value)} placeholder="Ej: Google Workspace" autoFocus />
              </Field>
            </div>
            <Field label="Proveedor">
              <input className={inp()} value={form.provider} onChange={e => set('provider', e.target.value)} placeholder="Ej: Google LLC" />
            </Field>
            <Field label="Categoría">
              <select className={inp()} value={form.category} onChange={e => set('category', e.target.value)}>
                {SERVICE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="URL de acceso">
              <input className={inp()} value={form.url} onChange={e => set('url', e.target.value)} placeholder="https://..." />
            </Field>
            <Field label="Cuenta / Email">
              <input className={inp()} value={form.account} onChange={e => set('account', e.target.value)} placeholder="admin@empresa.com" />
            </Field>
            <Field label="Departamento">
              <input className={inp()} value={form.department} onChange={e => set('department', e.target.value)} placeholder="Ej: TI, RRHH..." />
            </Field>
            <Field label="Coste (€)">
              <input className={inp()} type="number" min={0} step={0.01} value={form.cost} onChange={e => set('cost', parseFloat(e.target.value) || 0)} />
            </Field>
            <Field label="Ciclo de facturación">
              <select className={inp()} value={form.billing_cycle} onChange={e => set('billing_cycle', e.target.value)}>
                {BILLING_CYCLES.map(b => <option key={b.value} value={b.value}>{b.label}</option>)}
              </select>
            </Field>
            <Field label="Fecha de renovación">
              <input className={inp()} type="date" value={form.renewal_date} onChange={e => set('renewal_date', e.target.value)} />
            </Field>
            <Field label="Estado">
              <select className={inp()} value={form.status} onChange={e => set('status', e.target.value)}>
                {SERVICE_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </Field>
            <div className="sm:col-span-2">
              <Field label="Notas">
                <textarea className={inp('resize-none')} rows={3} value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="Observaciones..." />
              </Field>
            </div>
          </div>
        </form>

        <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-800">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-400 hover:text-white border border-gray-700 hover:border-gray-600 rounded-lg transition-colors">Cancelar</button>
          <button onClick={handleSubmit} disabled={saving} className="flex items-center gap-2 px-4 py-2 text-sm bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors disabled:opacity-50">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {service ? 'Guardar cambios' : 'Crear servicio'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function ServicesPage() {
  const { user } = useAuth();
  const canEdit = user?.role === 'admin' || user?.role === 'editor';

  const [services, setServices]   = useState<Service[]>([]);
  const [loading, setLoading]     = useState(true);
  const [search, setSearch]       = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [filterDept, setFilterDept] = useState('');
  const [showForm, setShowForm]   = useState(false);
  const [editSvc, setEditSvc]     = useState<Service | undefined>();
  const [selected, setSelected]   = useState<Set<number>>(new Set());
  const [sortField, setSortField] = useState<keyof Service>('name');
  const [sortDir, setSortDir]     = useState<'asc'|'desc'>('asc');
  const [deleting, setDeleting]   = useState(false);
  const [importLoading, setImportLoading] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    apiClient.get('/services').then(r => setServices(r.data)).catch(() => toast.error('Error al cargar servicios')).finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const departments = [...new Set(services.map(s => s.department).filter(Boolean))] as string[];
  const categories  = [...new Set(services.map(s => s.category).filter(Boolean))] as string[];

  const filtered = services
    .filter(s => {
      const q = search.toLowerCase();
      return (!q || s.name.toLowerCase().includes(q) || s.provider.toLowerCase().includes(q) || s.category.toLowerCase().includes(q))
        && (!filterStatus || s.status === filterStatus)
        && (!filterCategory || s.category === filterCategory)
        && (!filterDept || s.department === filterDept);
    })
    .sort((a, b) => {
      const va = String(a[sortField] ?? '').toLowerCase();
      const vb = String(b[sortField] ?? '').toLowerCase();
      return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
    });

  const toggleSort = (f: keyof Service) => {
    if (sortField === f) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(f); setSortDir('asc'); }
  };

  const SortIcon = ({ field }: { field: keyof Service }) =>
    sortField === field
      ? (sortDir === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)
      : <ChevronUp className="w-3 h-3 opacity-20" />;

  const allSelected = filtered.length > 0 && filtered.every(s => selected.has(s.id));
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(filtered.map(s => s.id)));
  const toggleOne = (id: number) => setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const handleSave = async (data: typeof emptyForm) => {
    try {
      if (editSvc) {
        await apiClient.put(`/services/${editSvc.id}`, data);
        toast.success('Servicio actualizado');
      } else {
        await apiClient.post('/services', data);
        toast.success('Servicio creado');
      }
      setShowForm(false); setEditSvc(undefined); load();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Error al guardar');
      throw err;
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('¿Eliminar este servicio?')) return;
    try { await apiClient.delete(`/services/${id}`); toast.success('Eliminado'); load(); }
    catch { toast.error('Error al eliminar'); }
  };

  const handleBulkDelete = async () => {
    if (!confirm(`¿Eliminar ${selected.size} servicio(s)?`)) return;
    setDeleting(true);
    try {
      await Promise.all([...selected].map(id => apiClient.delete(`/services/${id}`)));
      toast.success(`${selected.size} eliminados`); setSelected(new Set()); load();
    } catch { toast.error('Error al eliminar'); } finally { setDeleting(false); }
  };

  // Renewal alert (30 days)
  const soonRenewal = filtered.filter(s => {
    if (!s.renewal_date) return false;
    const days = Math.ceil((new Date(s.renewal_date).getTime() - Date.now()) / 86400000);
    return days >= 0 && days <= 30;
  });

  const handleDownloadTemplate = () => {
    const example = [{ name: 'Google Workspace', provider: 'Google LLC',
      category: 'Cloud / Hosting', url: 'https://workspace.google.com',
      account: 'admin@empresa.com', department: 'TI', cost: '120.00',
      billing_cycle: 'mensual', renewal_date: '2025-12-31', status: 'activo', notes: 'Plan Business' }];
    const csv = Papa.unparse({ fields: ['name','provider','category','url','account',
      'department','cost','billing_cycle','renewal_date','status','notes'], data: example });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    a.download = 'plantilla_servicios.csv'; a.click();
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    setImportLoading(true);
    Papa.parse<Record<string,string>>(file, {
      header: true, skipEmptyLines: true,
      complete: async (results) => {
        const items = results.data.map(r => ({
          name: r.name?.trim()||'', provider: r.provider?.trim()||'',
          category: r.category?.trim()||'otros', url: r.url?.trim()||'',
          account: r.account?.trim()||'', department: r.department?.trim()||'',
          cost: parseFloat(r.cost)||0, billing_cycle: r.billing_cycle?.trim()||'mensual',
          renewal_date: r.renewal_date?.trim()||'', status: r.status?.trim()||'activo',
          notes: r.notes?.trim()||'',
        }));
        try {
          const res = await apiClient.post('/services/import', { items });
          toast.success(`Importados: ${res.data.inserted} nuevos, ${res.data.updated} actualizados`);
          load();
        } catch (err: any) {
          toast.error(err?.response?.data?.error || 'Error en la importación');
        } finally { setImportLoading(false); e.target.value = ''; }
      },
      error: () => { toast.error('Error al leer el CSV'); setImportLoading(false); }
    });
  };

  const totalCost = filtered.reduce((acc, s) => {
    const monthly = s.billing_cycle === 'mensual' ? s.cost : s.billing_cycle === 'anual' ? s.cost / 12 : 0;
    return acc + monthly;
  }, 0);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Servicios</h1>
          <p className="text-sm text-gray-400 mt-0.5">Gestión de suscripciones y servicios externos</p>
        </div>
        {canEdit && (
          <button onClick={() => { setEditSvc(undefined); setShowForm(true); }}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg transition-colors">
            <Plus className="w-4 h-4" /> Nuevo servicio
          </button>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Total', value: services.length, color: 'text-blue-400' },
          { label: 'Activos', value: services.filter(s => s.status === 'activo').length, color: 'text-green-400' },
          { label: 'Renovación prox.', value: soonRenewal.length, color: 'text-yellow-400' },
          { label: 'Coste mensual', value: `${totalCost.toLocaleString('es-ES', { minimumFractionDigits: 2 })} €`, color: 'text-purple-400' },
        ].map(s => (
          <div key={s.label} className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <p className="text-xs text-gray-500 mb-1">{s.label}</p>
            <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Renewal alert */}
      {soonRenewal.length > 0 && (
        <div className="flex items-start gap-3 bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-4">
          <AlertTriangle className="w-4 h-4 text-yellow-400 mt-0.5 flex-shrink-0" />
          <p className="text-sm text-yellow-300">
            {soonRenewal.length} servicio(s) con renovación en los próximos 30 días:{' '}
            <span className="font-medium">{soonRenewal.map(s => s.name).join(', ')}</span>
          </p>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
          <input className="w-full bg-gray-900 border border-gray-800 rounded-lg pl-9 pr-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
            placeholder="Buscar servicios..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <select className="bg-gray-900 border border-gray-800 rounded-lg px-3 py-2 text-sm text-gray-300 focus:outline-none focus:border-blue-500"
          value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
          <option value="">Todos los estados</option>
          {SERVICE_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        <select className="bg-gray-900 border border-gray-800 rounded-lg px-3 py-2 text-sm text-gray-300 focus:outline-none focus:border-blue-500"
          value={filterCategory} onChange={e => setFilterCategory(e.target.value)}>
          <option value="">Todas las categorías</option>
          {categories.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        {departments.length > 0 && (
          <select className="bg-gray-900 border border-gray-800 rounded-lg px-3 py-2 text-sm text-gray-300 focus:outline-none focus:border-blue-500"
            value={filterDept} onChange={e => setFilterDept(e.target.value)}>
            <option value="">Todos los departamentos</option>
            {departments.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
        )}
        <button onClick={load} className="p-2 bg-gray-900 border border-gray-800 rounded-lg text-gray-400 hover:text-white transition-colors">
          <RefreshCw className="w-4 h-4" />
        </button>
        <button onClick={handleDownloadTemplate} title="Descargar plantilla CSV"
          className="flex items-center gap-1.5 px-3 py-2 bg-gray-900 border border-gray-800 text-gray-400 hover:text-white text-sm rounded-lg transition-colors">
          <Download className="w-4 h-4" /> Plantilla
        </button>
        {canEdit && (
          <label className={`flex items-center gap-1.5 px-3 py-2 bg-gray-900 border border-gray-800 text-gray-400 hover:text-white text-sm rounded-lg transition-colors cursor-pointer ${importLoading ? 'opacity-60 pointer-events-none' : ''}`}>
            {importLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            Importar CSV
            <input type="file" accept=".csv" className="hidden" onChange={handleImport} />
          </label>
        )}
      </div>

      {/* Bulk delete */}
      {selected.size > 0 && canEdit && (
        <div className="flex items-center gap-3 px-4 py-2 bg-red-500/10 border border-red-500/30 rounded-lg">
          <span className="text-sm text-red-300">{selected.size} seleccionado(s)</span>
          <button onClick={handleBulkDelete} disabled={deleting}
            className="flex items-center gap-1 text-xs text-red-400 hover:text-red-300 transition-colors ml-auto">
            {deleting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />} Eliminar selección
          </button>
        </div>
      )}

      {/* Table */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-6 h-6 text-blue-400 animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-gray-500">
            <Globe className="w-10 h-10 mb-3 opacity-30" />
            <p>{services.length === 0 ? 'No hay servicios registrados' : 'Sin resultados para los filtros aplicados'}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-800/50 border-b border-gray-800">
                <tr>
                  <th className="px-3 py-3"><Checkbox checked={allSelected} onChange={toggleAll} /></th>
                  {([
                    { field: 'name'     as keyof Service, label: 'Nombre' },
                    { field: 'provider' as keyof Service, label: 'Proveedor' },
                    { field: 'category' as keyof Service, label: 'Categoría' },
                    { field: 'department' as keyof Service, label: 'Departamento' },
                    { field: 'cost'     as keyof Service, label: 'Coste' },
                    { field: 'billing_cycle' as keyof Service, label: 'Ciclo' },
                    { field: 'renewal_date' as keyof Service, label: 'Renovación' },
                    { field: 'status'   as keyof Service, label: 'Estado' },
                  ]).map(({ field, label }) => (
                    <th key={field} onClick={() => toggleSort(field)}
                      className="text-left text-xs font-medium text-gray-400 px-4 py-3 cursor-pointer hover:text-white whitespace-nowrap">
                      <div className="flex items-center gap-1">{label}<SortIcon field={field} /></div>
                    </th>
                  ))}
                  <th className="px-4 py-3 text-xs font-medium text-gray-400">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {filtered.map(s => {
                  const isSelected = selected.has(s.id);
                  const daysToRenew = s.renewal_date
                    ? Math.ceil((new Date(s.renewal_date).getTime() - Date.now()) / 86400000)
                    : null;
                  return (
                    <tr key={s.id} onClick={() => toggleOne(s.id)}
                      className={`hover:bg-gray-800/40 transition-colors cursor-pointer ${isSelected ? 'bg-blue-600/5' : ''}`}>
                      <td className="px-3 py-3"><Checkbox checked={isSelected} onChange={() => toggleOne(s.id)} /></td>
                      <td className="px-4 py-3 font-medium text-white whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          {s.url && (
                            <a href={s.url} target="_blank" rel="noopener noreferrer"
                              onClick={e => e.stopPropagation()}
                              className="text-blue-400 hover:text-blue-300">
                              <ExternalLink className="w-3.5 h-3.5" />
                            </a>
                          )}
                          {s.name}
                        </div>
                        {s.account && <p className="text-xs text-gray-500">{s.account}</p>}
                      </td>
                      <td className="px-4 py-3 text-gray-400 whitespace-nowrap text-xs">{s.provider || '—'}</td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className="px-2 py-0.5 rounded bg-gray-800 text-xs text-gray-300">{s.category}</span>
                      </td>
                      <td className="px-4 py-3 text-gray-400 whitespace-nowrap text-xs">{s.department || '—'}</td>
                      <td className="px-4 py-3 text-gray-300 whitespace-nowrap text-xs font-mono">
                        {s.billing_cycle !== 'gratuito' ? `${Number(s.cost).toLocaleString('es-ES', { minimumFractionDigits: 2 })} €` : '—'}
                      </td>
                      <td className="px-4 py-3 text-gray-400 whitespace-nowrap text-xs">{getBillingLabel(s.billing_cycle)}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-xs">
                        {s.renewal_date ? (
                          <span className={daysToRenew !== null && daysToRenew <= 30 && daysToRenew >= 0 ? 'text-yellow-400 font-medium' : 'text-gray-400'}>
                            {new Date(s.renewal_date + 'T12:00:00').toLocaleDateString('es-ES')}
                            {daysToRenew !== null && daysToRenew >= 0 && daysToRenew <= 30 && ` (${daysToRenew}d)`}
                          </span>
                        ) : '—'}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${getStatusColor(s.status)}`}>
                          {getStatusLabel(s.status)}
                        </span>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap" onClick={e => e.stopPropagation()}>
                        {canEdit && (
                          <div className="flex items-center gap-2">
                            <button onClick={() => { setEditSvc(s); setShowForm(true); }}
                              className="text-gray-500 hover:text-blue-400 transition-colors p-1">
                              <Pencil className="w-4 h-4" />
                            </button>
                            <button onClick={() => handleDelete(s.id)}
                              className="text-gray-500 hover:text-red-400 transition-colors p-1">
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showForm && (
        <ServiceForm
          service={editSvc}
          onSave={handleSave}
          onClose={() => { setShowForm(false); setEditSvc(undefined); }}
        />
      )}
    </div>
  );
}
