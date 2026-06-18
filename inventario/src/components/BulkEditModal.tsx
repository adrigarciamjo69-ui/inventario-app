import { useState } from 'react';
import { X, Pencil } from 'lucide-react';
import toast from 'react-hot-toast';

interface FieldDef {
  key: string;
  label: string;
  type: 'text' | 'select' | 'textarea';
  options?: { value: string; label: string }[];
  placeholder?: string;
}

interface Props {
  title: string;
  count: number;
  fields: FieldDef[];
  onSave: (fields: Record<string, string>) => Promise<void>;
  onClose: () => void;
}

export default function BulkEditModal({ title, count, fields, onSave, onClose }: Props) {
  const [values, setValues]   = useState<Record<string, string>>({});
  const [enabled, setEnabled] = useState<Record<string, boolean>>({});
  const [saving, setSaving]   = useState(false);

  const set    = (k: string, v: string) => setValues(f => ({ ...f, [k]: v }));
  const toggle = (k: string, defaultVal = '') => {
    setEnabled(e => ({ ...e, [k]: !e[k] }));
    if (!values[k]) set(k, defaultVal);
  };

  const inp = (disabled: boolean) =>
    `w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 ${disabled ? 'opacity-40 cursor-not-allowed' : ''}`;

  const handleSave = async () => {
    const active = Object.fromEntries(
      Object.entries(values).filter(([k, v]) => enabled[k] && v !== undefined && v !== '')
    );
    if (Object.keys(active).length === 0) { toast.error('Activa al menos un campo'); return; }
    setSaving(true);
    try { await onSave(active); } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-lg shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
          <div>
            <h2 className="text-base font-semibold text-white">Edición masiva - {title}</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              Activa los campos a modificar en los{' '}
              <span className="text-blue-400 font-medium">{count} elementos</span> seleccionados
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white"><X className="w-5 h-5" /></button>
        </div>

        <div className="px-6 py-4 space-y-3 max-h-[60vh] overflow-y-auto">
          {fields.map(field => (
            <div key={field.key} className="flex items-start gap-3">
              <button
                onClick={() => toggle(field.key, field.options?.[0]?.value || '')}
                className={`mt-2 flex-shrink-0 w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
                  enabled[field.key] ? 'bg-blue-600 border-blue-500' : 'border-gray-600 hover:border-gray-400'
                }`}>
                {enabled[field.key] && <span className="text-white text-xs">✓</span>}
              </button>
              <div className="flex-1">
                <label className="block text-xs text-gray-400 mb-1">{field.label}</label>
                {field.type === 'select' && (
                  <select disabled={!enabled[field.key]} value={values[field.key] || ''}
                    onChange={e => set(field.key, e.target.value)} className={inp(!enabled[field.key])}>
                    {field.options?.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                )}
                {field.type === 'text' && (
                  <input type="text" disabled={!enabled[field.key]} value={values[field.key] || ''}
                    onChange={e => set(field.key, e.target.value)}
                    placeholder={field.placeholder} className={inp(!enabled[field.key])} />
                )}
                {field.type === 'textarea' && (
                  <textarea disabled={!enabled[field.key]} value={values[field.key] || ''}
                    onChange={e => set(field.key, e.target.value)} rows={2}
                    placeholder={field.placeholder} className={inp(!enabled[field.key]) + ' resize-none'} />
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-800">
          <button onClick={onClose}
            className="px-4 py-2 text-sm text-gray-400 hover:text-white border border-gray-700 hover:border-gray-600 rounded-lg transition-colors">
            Cancelar
          </button>
          <button onClick={handleSave} disabled={saving}
            className="flex items-center gap-2 px-4 py-2 text-sm bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg transition-colors">
            <Pencil className="w-4 h-4" />
            {saving ? 'Aplicando...' : `Aplicar a ${count} elemento${count !== 1 ? 's' : ''}`}
          </button>
        </div>
      </div>
    </div>
  );
}
