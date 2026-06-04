import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X, Save, User, FileText, ExternalLink } from 'lucide-react';
import { Asset, AssetCategory, AssetStatus, ClientUser } from '../types';
import DocumentsPanel from './DocumentsPanel';
import AssetUsersPanel from './AssetUsersPanel';
import { useCategories } from '../context/CategoriesContext';
import { apiClient } from '../api/client';
import toast from 'react-hot-toast';

const statuses: { value: AssetStatus; label: string }[] = [
  { value: 'activo',     label: 'Activo'        },
  { value: 'inactivo',   label: 'Inactivo'      },
  { value: 'reparacion', label: 'En reparación' },
  { value: 'baja',       label: 'Baja'          },
];

const emptyForm: Omit<Asset, 'created_at' | 'updated_at'> & { department: string } = {
  id:             '',
  serial_number:  '',
  category:       'laptop',
  brand:          '',
  model:          '',
  price:          0,
  purchase_date:  '',
  purchase_order: '',
  assigned_to:    '',
  department:     '',
  status:         'activo',
  notes:          '',
};

// ── Field ─────────────────────────────────────────────────────────────────────
// Definido FUERA del componente para que React no lo desmonte en cada re-render

interface FieldProps { label: string; name: string; children: React.ReactNode; error?: string; }

function Field({ label, name, children, error }: FieldProps) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-400 mb-1" htmlFor={name}>{label}</label>
      {children}
      {error && <p className="text-red-400 text-xs mt-1">{error}</p>}
    </div>
  );
}

function inputClass(errors: Record<string, string>, name: string) {
  return `w-full bg-gray-800 border ${errors[name] ? 'border-red-500' : 'border-gray-700'} rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors`;
}

// ── AssignedToAutocomplete ────────────────────────────────────────────────────
// Definido FUERA de AssetForm para evitar desmontajes en cada re-render

function AssignedToAutocomplete({ value, onChange, iClass }: {
  value: string; onChange: (v: string, user?: ClientUser) => void; iClass: string;
}) {
  const [search, setSearch] = useState(value || '');
  const [results, setResults] = useState<ClientUser[]>([]);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 });
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setSearch(value || ''); }, [value]);

  useEffect(() => {
    if (search.length < 2) { setResults([]); return; }
    const t = setTimeout(async () => {
      try {
        const res = await apiClient.get('/client-users');
        const q = search.toLowerCase();
        setResults((res.data as ClientUser[]).filter(u =>
          `${u.first_name} ${u.last_name}`.toLowerCase().includes(q) ||
          u.department?.toLowerCase().includes(q) ||
          u.employee_id?.toLowerCase().includes(q)
        ).slice(0, 8));
      } catch { setResults([]); }
    }, 250);
    return () => clearTimeout(t);
  }, [search]);

  const openDropdown = () => {
    if (inputRef.current) {
      const r = inputRef.current.getBoundingClientRect();
      setPos({ top: r.bottom + 2, left: r.left, width: r.width });
    }
    setOpen(true);
  };

  const select = (u: ClientUser) => {
    const name = `${u.first_name} ${u.last_name}`;
    setSearch(name); onChange(name, u); setOpen(false); setResults([]);
  };

  return (
    <>
      <div className="relative flex items-center">
        <User className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500 pointer-events-none" />
        <input
          ref={inputRef}
          id="assigned_to"
          type="text"
          value={search}
          onChange={e => { setSearch(e.target.value); onChange(e.target.value); setOpen(true); }}
          onFocus={openDropdown}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder="Buscar usuario o escribir nombre..."
          className={iClass + ' pl-9'}
          autoComplete="off"
        />
      </div>
      {open && results.length > 0 && createPortal(
        <div style={{ position: 'fixed', top: pos.top, left: pos.left, width: pos.width, zIndex: 9999 }}
          className="bg-gray-800 border border-gray-700 rounded-xl shadow-2xl max-h-48 overflow-y-auto">
          {results.map(u => (
            <button key={u.id} onMouseDown={() => select(u)}
              className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-gray-700 transition-colors border-b border-gray-700/40 last:border-0">
              <div className="w-7 h-7 rounded-full bg-blue-600/20 flex items-center justify-center text-xs font-bold text-blue-400 flex-shrink-0">
                {u.first_name.charAt(0)}
              </div>
              <div className="min-w-0">
                <p className="text-sm text-white truncate">{u.first_name} {u.last_name}</p>
                <p className="text-xs text-gray-400 truncate">{u.department || '—'}{u.employee_id ? ` · ${u.employee_id}` : ''}</p>
              </div>
            </button>
          ))}
        </div>,
        document.body
      )}
    </>
  );
}

// ── DeliveryRecordsPanel ──────────────────────────────────────────────────────

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  pendiente:   { label: 'Pendiente',   color: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/30' },
  entregado:   { label: 'Entregado',   color: 'text-green-400 bg-green-500/10 border-green-500/30'   },
  devuelto:    { label: 'Devuelto',    color: 'text-blue-400 bg-blue-500/10 border-blue-500/30'      },
  en_revision: { label: 'En revisión', color: 'text-purple-400 bg-purple-500/10 border-purple-500/30' },
  danado:      { label: 'Dañado',      color: 'text-red-400 bg-red-500/10 border-red-500/30'         },
  perdido:     { label: 'Perdido',     color: 'text-gray-400 bg-gray-500/10 border-gray-500/30'      },
};

interface DeliveryLink {
  id: number; doc_id: string; type: string;
  delivery_date: string; status: string;
  recipient_name?: string; first_name?: string; last_name?: string;
}

function DeliveryRecordsPanel({ assetId }: { assetId: string }) {
  const [records, setRecords] = useState<DeliveryLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [linking, setLinking] = useState(false);

  const load = () => {
    setLoading(true);
    apiClient.get(`/assets/${assetId}/deliveries`)
      .then(r => setRecords(r.data || []))
      .catch(() => setRecords([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [assetId]);

  const handleAutoLink = async () => {
    setLinking(true);
    try {
      const res = await apiClient.post(`/assets/${assetId}/auto-link-deliveries`);
      if (res.data.linked > 0) {
        toast.success(`${res.data.linked} acta${res.data.linked > 1 ? 's' : ''} vinculada${res.data.linked > 1 ? 's' : ''} automáticamente`);
        load();
      } else {
        toast.success('No hay actas pendientes de vincular');
      }
    } catch {
      toast.error('Error al vincular actas');
    } finally { setLinking(false); }
  };

  if (loading) return (
    <div className="mt-5 flex items-center gap-2 text-xs text-gray-500">
      <div className="w-3 h-3 border border-gray-600 border-t-blue-500 rounded-full animate-spin" />
      Cargando actas vinculadas...
    </div>
  );

  return (
    <div className="mt-5">
      <div className="flex items-center gap-2 mb-3">
        <FileText className="w-4 h-4 text-blue-400" />
        <h3 className="text-sm font-medium text-white">Actas de entrega vinculadas</h3>
        {records.length > 0 && (
          <span className="px-1.5 py-0.5 text-xs bg-blue-600/20 text-blue-400 rounded-full">{records.length}</span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <button onClick={load} disabled={loading}
            title="Refrescar"
            className="p-1 text-gray-500 hover:text-white transition-colors">
            <svg xmlns="http://www.w3.org/2000/svg" className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
          <button onClick={handleAutoLink} disabled={linking}
            title="Vincular actas pendientes automáticamente"
            className="flex items-center gap-1 px-2 py-1 text-xs bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/30 text-blue-400 rounded-lg transition-colors">
            {linking ? (
              <div className="w-3 h-3 border border-blue-400/30 border-t-blue-400 rounded-full animate-spin" />
            ) : (
              <ExternalLink className="w-3 h-3" />
            )}
            Vincular actas
          </button>
        </div>
      </div>

      {records.length === 0 ? (
        <div className="flex items-center gap-2 px-4 py-3 bg-gray-800/40 border border-gray-700/50 rounded-lg">
          <FileText className="w-4 h-4 text-gray-600" />
          <p className="text-sm text-gray-500">Este activo no tiene actas de entrega vinculadas</p>
        </div>
      ) : (
        <div className="space-y-2">
          {records.map(r => {
            const recipientName = r.first_name ? `${r.first_name} ${r.last_name}` : r.recipient_name || '—';
            const st = STATUS_LABELS[r.status] || STATUS_LABELS.pendiente;
            return (
              <div key={r.id} className="flex items-center gap-3 px-4 py-2.5 bg-gray-800/40 border border-gray-700/50 rounded-lg">
                <span className={`text-xs px-1.5 py-0.5 rounded ${r.type === 'entrega' ? 'text-blue-400' : 'text-purple-400'}`}>
                  {r.type === 'entrega' ? '📤' : '📥'}
                </span>
                <span className="font-mono text-xs text-gray-400 w-24 flex-shrink-0">{r.doc_id}</span>
                <span className="text-sm text-white flex-1 truncate">{recipientName}</span>
                <span className="text-xs text-gray-500">{new Date(r.delivery_date).toLocaleDateString('es-ES')}</span>
                <span className={`text-xs px-2 py-0.5 rounded-full border ${st.color}`}>{st.label}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface AssetFormProps {
  asset?: Asset | null;
  onSave: (data: Omit<Asset, 'created_at' | 'updated_at'>) => Promise<void>;
  onClose: () => void;
  isEdit?: boolean;
}

// ── Componente principal ──────────────────────────────────────────────────────

export default function AssetForm({ asset, onSave, onClose, isEdit }: AssetFormProps) {
  const { categories } = useCategories();
  const [form, setForm]     = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [deptOptions, setDeptOptions] = useState<string[]>([]);

  // Load existing departments for the dropdown
  useEffect(() => {
    apiClient.get('/assets').then(r => {
      const depts = [...new Set((r.data as Asset[]).map((a: any) => a.department).filter(Boolean))].sort() as string[];
      setDeptOptions(depts);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (asset) {
      setForm({
        id:             asset.id,
        serial_number:  asset.serial_number  || '',
        category:       asset.category       || 'laptop',
        brand:          asset.brand          || '',
        model:          asset.model          || '',
        price:          asset.price          ?? 0,
        purchase_date:  asset.purchase_date?.slice(0, 10) || '',
        purchase_order: asset.purchase_order || '',
        assigned_to:    asset.assigned_to    || '',
        department:     (asset as any).department || '',
        status:         asset.status         || 'activo',
        notes:          asset.notes          || '',
      });
    } else {
      setForm(emptyForm);
    }
  }, [asset]);

  const validate = () => {
    const e: Record<string, string> = {};
    if (!form.id.trim())            e.id            = 'ID interno requerido';
    if (!form.serial_number.trim()) e.serial_number = 'Número de serie requerido';
    if (!form.brand.trim())         e.brand         = 'Marca requerida';
    if (!form.model.trim())         e.model         = 'Modelo requerido';
    if (!form.purchase_date)        e.purchase_date = 'Fecha de compra requerida';
    if (form.price < 0)             e.price         = 'El precio no puede ser negativo';
    return e;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length > 0) { setErrors(errs); return; }
    setSaving(true);
    try { await onSave(form); } finally { setSaving(false); }
  };

  const iClass = (name: string) => inputClass(errors, name);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
          <h2 className="text-lg font-semibold text-white">{isEdit ? 'Editar Activo' : 'Nuevo Activo'}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors"><X className="w-5 h-5" /></button>
        </div>

        {/* Formulario */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-6 py-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">

            <Field label="ID Interno *" name="id" error={errors.id}>
              <input id="id" type="text" value={form.id}
                onChange={e => setForm(f => ({ ...f, id: e.target.value }))}
                disabled={isEdit} placeholder="IT-001"
                className={iClass('id') + (isEdit ? ' opacity-60 cursor-not-allowed' : '')} />
            </Field>

            <Field label="Número de Serie *" name="serial_number" error={errors.serial_number}>
              <input id="serial_number" type="text" value={form.serial_number}
                onChange={e => setForm(f => ({ ...f, serial_number: e.target.value }))}
                placeholder="SN-XXXXXXXX" className={iClass('serial_number')} />
            </Field>

            <Field label="Categoría *" name="category">
              <select id="category" value={form.category}
                onChange={e => setForm(f => ({ ...f, category: e.target.value as AssetCategory }))}
                className={iClass('category')}>
                {categories.map(c => <option key={c.value} value={c.value}>{c.icon ? `${c.icon} ` : ''}{c.label}</option>)}
              </select>
            </Field>

            <Field label="Estado *" name="status">
              <select id="status" value={form.status}
                onChange={e => setForm(f => ({ ...f, status: e.target.value as AssetStatus }))}
                className={iClass('status')}>
                {statuses.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </Field>

            <Field label="Marca *" name="brand" error={errors.brand}>
              <input id="brand" type="text" value={form.brand}
                onChange={e => setForm(f => ({ ...f, brand: e.target.value }))}
                placeholder="Ej: Dell, Lenovo, HP..." className={iClass('brand')} />
            </Field>

            <Field label="Modelo *" name="model" error={errors.model}>
              <input id="model" type="text" value={form.model}
                onChange={e => setForm(f => ({ ...f, model: e.target.value }))}
                placeholder="Ej: ThinkPad E15 Gen 4" className={iClass('model')} />
            </Field>

            <Field label="Precio (€)" name="price" error={errors.price}>
              <input id="price" type="number" min="0" step="0.01" value={form.price}
                onChange={e => setForm(f => ({ ...f, price: parseFloat(e.target.value) || 0 }))}
                className={iClass('price')} />
            </Field>

            <Field label="Fecha de Compra *" name="purchase_date" error={errors.purchase_date}>
              <input id="purchase_date" type="date" value={form.purchase_date}
                onChange={e => setForm(f => ({ ...f, purchase_date: e.target.value }))}
                className={iClass('purchase_date')} />
            </Field>

            <Field label="Orden de Compra" name="purchase_order">
              <input id="purchase_order" type="text" value={form.purchase_order}
                onChange={e => setForm(f => ({ ...f, purchase_order: e.target.value }))}
                placeholder="OC-2024-001" className={iClass('purchase_order')} />
            </Field>

            {/* ── Asignado a — con autocomplete ── */}
            <Field label="Asignado a" name="assigned_to">
              <AssignedToAutocomplete
                value={form.assigned_to}
                onChange={(val, user) => {
                  setForm(f => ({
                    ...f,
                    assigned_to: val,
                    // Auto-fill department from user if not already set
                    department: user?.department || f.department,
                  }));
                }}
                iClass={iClass('assigned_to')}
              />
            </Field>

            {/* ── Departamento — desplegable con opciones + libre ── */}
            <Field label="Departamento" name="department">
              <input
                id="department"
                list="dept-options"
                type="text"
                value={(form as any).department || ''}
                onChange={e => setForm(f => ({ ...f, department: e.target.value }))}
                placeholder="Selecciona o escribe un departamento..."
                className={iClass('department')}
              />
              <datalist id="dept-options">
                {deptOptions.map(d => <option key={d} value={d} />)}
              </datalist>
            </Field>

            <div className="col-span-1 sm:col-span-2 lg:col-span-3">
              <Field label="Notas" name="notes">
                <textarea id="notes" value={form.notes}
                  onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                  rows={3} placeholder="Observaciones adicionales..."
                  className={iClass('notes') + ' resize-none'} />
              </Field>
            </div>
          </div>

          {isEdit && asset && <AssetUsersPanel assetId={asset.id} />}
          {isEdit && asset && <DeliveryRecordsPanel assetId={asset.id} />}
          {isEdit && asset && (
            <div className="mt-5"><DocumentsPanel serial={asset.serial_number} /></div>
          )}

        </form>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-800">
          <button type="button" onClick={onClose}
            className="px-4 py-2 text-sm text-gray-400 hover:text-white bg-gray-800 hover:bg-gray-700 rounded-lg transition-colors">
            Cancelar
          </button>
          <button onClick={handleSubmit} disabled={saving}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors">
            {saving ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Save className="w-4 h-4" />}
            {isEdit ? 'Guardar cambios' : 'Crear activo'}
          </button>
        </div>
      </div>
    </div>
  );
}
