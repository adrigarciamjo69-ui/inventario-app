import { useState, useEffect } from 'react';
import { X, Save } from 'lucide-react';
import { Asset, AssetCategory, AssetStatus } from '../types';
import DocumentsPanel from './DocumentsPanel';
import AssetUsersPanel from './AssetUsersPanel';
import { useCategories } from '../context/CategoriesContext';

const statuses: { value: AssetStatus; label: string }[] = [
  { value: 'activo',     label: 'Activo'        },
  { value: 'inactivo',   label: 'Inactivo'      },
  { value: 'reparacion', label: 'En reparación' },
  { value: 'baja',       label: 'Baja'          },
];

const emptyForm: Omit<Asset, 'created_at' | 'updated_at'> = {
  id:             '',      // PRIMARY KEY
  serial_number:  '',      // Obligatorio pero no PK
  category:       'laptop',
  brand:          '',
  model:          '',
  price:          0,
  purchase_date:  '',
  purchase_order: '',
  assigned_to:    '',
  status:         'activo',
  notes:          '',
};

// ─────────────────────────────────────────────────────────────────────────────
// Field — definido FUERA de AssetForm para que React no lo desmonte en cada
// re-render (si estuviera dentro, cada pulsación de tecla destruiría el input
// y lo recrearía, perdiendo el foco).
// ─────────────────────────────────────────────────────────────────────────────
interface FieldProps {
  label: string;
  name: string;
  children: React.ReactNode;
  error?: string;
}

function Field({ label, name, children, error }: FieldProps) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-400 mb-1" htmlFor={name}>
        {label}
      </label>
      {children}
      {error && <p className="text-red-400 text-xs mt-1">{error}</p>}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// inputClass — también fuera del componente (función pura, sin dependencias)
// ─────────────────────────────────────────────────────────────────────────────
function inputClass(errors: Record<string, string>, name: string) {
  return `w-full bg-gray-800 border ${
    errors[name] ? 'border-red-500' : 'border-gray-700'
  } rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────────────────────
interface AssetFormProps {
  asset?: Asset | null;
  onSave: (data: Omit<Asset, 'created_at' | 'updated_at'>) => Promise<void>;
  onClose: () => void;
  isEdit?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Componente principal
// ─────────────────────────────────────────────────────────────────────────────
export default function AssetForm({ asset, onSave, onClose, isEdit }: AssetFormProps) {
  const { categories } = useCategories();
  const [form, setForm]       = useState(emptyForm);
  const [saving, setSaving]   = useState(false);
  const [errors, setErrors]   = useState<Record<string, string>>({});

  useEffect(() => {
    if (asset) {
      setForm({
        id:             asset.id,
        serial_number:  asset.serial_number,
        category:       asset.category,
        brand:          asset.brand,
        model:          asset.model,
        price:          asset.price,
        purchase_date:  asset.purchase_date?.slice(0, 10) || '',
        purchase_order: asset.purchase_order,
        assigned_to:    asset.assigned_to,
        status:         asset.status,
        notes:          asset.notes || '',
      });
    } else {
      setForm(emptyForm);
    }
  }, [asset]);

  const validate = () => {
    const e: Record<string, string> = {};
    if (!form.id.trim())            e.id             = 'ID interno requerido';
    if (!form.serial_number.trim()) e.serial_number  = 'Número de serie requerido';
    if (!form.brand.trim())         e.brand          = 'Marca requerida';
    if (!form.model.trim())         e.model          = 'Modelo requerido';
    if (!form.purchase_date)        e.purchase_date  = 'Fecha de compra requerida';
    if (form.price < 0)             e.price          = 'El precio no puede ser negativo';
    return e;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length > 0) { setErrors(errs); return; }
    setSaving(true);
    try {
      await onSave(form);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl">

        {/* ── Header ── */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
          <h2 className="text-lg font-semibold text-white">
            {isEdit ? 'Editar Activo' : 'Nuevo Activo'}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* ── Formulario ── */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-6 py-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">

            <Field label="ID Interno *" name="id" error={errors.id}>
              <input
                id="id"
                type="text"
                value={form.id}
                onChange={(e) => setForm(f => ({ ...f, id: e.target.value }))}
                disabled={isEdit}
                placeholder="IT-001"
                className={inputClass(errors, 'id') + (isEdit ? ' opacity-60 cursor-not-allowed' : '')}
              />
            </Field>

            <Field label="Número de Serie *" name="serial_number" error={errors.serial_number}>
              <input
                id="serial_number"
                type="text"
                value={form.serial_number}
                onChange={(e) => setForm(f => ({ ...f, serial_number: e.target.value }))}
                placeholder="SN-XXXXXXXX"
                className={inputClass(errors, 'serial_number')}
              />
            </Field>

            <Field label="Categoría *" name="category">
              <select
                id="category"
                value={form.category}
                onChange={(e) => setForm(f => ({ ...f, category: e.target.value as AssetCategory }))}
                className={inputClass(errors, 'category')}
              >
                {categories.map((c) => (
                  <option key={c.value} value={c.value}>{c.icon ? `${c.icon} ` : ''}{c.label}</option>
                ))}
              </select>
            </Field>

            <Field label="Estado *" name="status">
              <select
                id="status"
                value={form.status}
                onChange={(e) => setForm(f => ({ ...f, status: e.target.value as AssetStatus }))}
                className={inputClass(errors, 'status')}
              >
                {statuses.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </Field>

            <Field label="Marca *" name="brand" error={errors.brand}>
              <input
                id="brand"
                type="text"
                value={form.brand}
                onChange={(e) => setForm(f => ({ ...f, brand: e.target.value }))}
                placeholder="Ej: Dell, Lenovo, HP..."
                className={inputClass(errors, 'brand')}
              />
            </Field>

            <Field label="Modelo *" name="model" error={errors.model}>
              <input
                id="model"
                type="text"
                value={form.model}
                onChange={(e) => setForm(f => ({ ...f, model: e.target.value }))}
                placeholder="Ej: ThinkPad E15 Gen 4"
                className={inputClass(errors, 'model')}
              />
            </Field>

            <Field label="Precio (€)" name="price" error={errors.price}>
              <input
                id="price"
                type="number"
                min="0"
                step="0.01"
                value={form.price}
                onChange={(e) => setForm(f => ({ ...f, price: parseFloat(e.target.value) || 0 }))}
                className={inputClass(errors, 'price')}
              />
            </Field>

            <Field label="Fecha de Compra *" name="purchase_date" error={errors.purchase_date}>
              <input
                id="purchase_date"
                type="date"
                value={form.purchase_date}
                onChange={(e) => setForm(f => ({ ...f, purchase_date: e.target.value }))}
                className={inputClass(errors, 'purchase_date')}
              />
            </Field>

            <Field label="Orden de Compra" name="purchase_order">
              <input
                id="purchase_order"
                type="text"
                value={form.purchase_order}
                onChange={(e) => setForm(f => ({ ...f, purchase_order: e.target.value }))}
                placeholder="OC-2024-001"
                className={inputClass(errors, 'purchase_order')}
              />
            </Field>

            <Field label="Asignado a" name="assigned_to">
              <input
                id="assigned_to"
                type="text"
                value={form.assigned_to}
                onChange={(e) => setForm(f => ({ ...f, assigned_to: e.target.value }))}
                placeholder="Nombre del usuario"
                className={inputClass(errors, 'assigned_to')}
              />
            </Field>

            <div className="sm:col-span-2">
              <Field label="Notas" name="notes">
                <textarea
                  id="notes"
                  value={form.notes}
                  onChange={(e) => setForm(f => ({ ...f, notes: e.target.value }))}
                  rows={3}
                  placeholder="Observaciones adicionales..."
                  className={inputClass(errors, 'notes') + ' resize-none'}
                />
              </Field>
            </div>

          </div>

          {/* Panel de usuarios vinculados — solo al editar */}
          {isEdit && asset && (
            <AssetUsersPanel assetId={asset.id} />
          )}

          {/* Panel de documentos — solo al editar un activo existente */}
          {isEdit && asset && (
            <div className="mt-5">
              <DocumentsPanel serial={asset.serial_number} />
            </div>
          )}
        </form>

        {/* ── Footer ── */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-800">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-400 hover:text-white bg-gray-800 hover:bg-gray-700 rounded-lg transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors"
          >
            {saving ? (
              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <Save className="w-4 h-4" />
            )}
            {isEdit ? 'Guardar cambios' : 'Crear activo'}
          </button>
        </div>

      </div>
    </div>
  );
}
