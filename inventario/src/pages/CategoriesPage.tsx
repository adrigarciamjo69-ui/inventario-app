import { useState } from 'react';
import { Plus, Pencil, Trash2, Tag, AlertTriangle, Lock, X, Save } from 'lucide-react';
import toast from 'react-hot-toast';
import { Category } from '../types';
import { createCategory, updateCategory, deleteCategory } from '../api/client';
import { useCategories } from '../context/CategoriesContext';

const EMOJI_SUGGESTIONS = [
  '💻','🖥️','🖵','🖨️','📡','🔀','🗄️','📱','📲','🖱️','🔋','📦',
  '📷','🎤','📺','🖲️','💾','📀','🔌','🔧','🛠️','📋','📁','🗂️',
  '🔐','🔑','📶','🌐','☁️','⚡','🔊','🎧','📠','🖋️',
];

interface FormState {
  value: string;
  label: string;
  icon: string;
}

const emptyForm: FormState = { value: '', label: '', icon: '📦' };

function slugify(str: string) {
  return str.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
}

function FormField({ label, children, error }: { label: string; children: React.ReactNode; error?: string }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-400 mb-1">{label}</label>
      {children}
      {error && <p className="text-red-400 text-xs mt-1">{error}</p>}
    </div>
  );
}

export default function CategoriesPage() {
  const { categories, reload } = useCategories();
  const [showForm, setShowForm] = useState(false);
  const [editCat, setEditCat] = useState<Category | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [deleteModal, setDeleteModal] = useState<Category | null>(null);
  const [deleting, setDeleting] = useState(false);

  const openCreate = () => {
    setEditCat(null);
    setForm(emptyForm);
    setErrors({});
    setShowForm(true);
  };

  const openEdit = (cat: Category) => {
    setEditCat(cat);
    setForm({ value: cat.value, label: cat.label, icon: cat.icon || '📦' });
    setErrors({});
    setShowForm(true);
  };

  const validate = () => {
    const e: Record<string, string> = {};
    if (!form.label.trim()) e.label = 'El nombre es requerido';
    if (!editCat && !form.value.trim()) e.value = 'El identificador es requerido';
    if (!editCat && slugify(form.value) === '') e.value = 'Solo letras, números y guiones bajos';
    return e;
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length > 0) { setErrors(errs); return; }
    setSaving(true);
    try {
      if (editCat) {
        await updateCategory(editCat.id, { label: form.label, icon: form.icon });
        toast.success('Categoría actualizada');
      } else {
        await createCategory({ value: form.value, label: form.label, icon: form.icon });
        toast.success('Categoría creada');
      }
      setShowForm(false);
      reload();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      toast.error(e.response?.data?.error || 'Error al guardar');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteModal) return;
    setDeleting(true);
    try {
      await deleteCategory(deleteModal.id);
      toast.success('Categoría eliminada');
      setDeleteModal(null);
      reload();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      toast.error(e.response?.data?.error || 'Error al eliminar');
    } finally {
      setDeleting(false);
    }
  };

  const ic = `w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500
    focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors`;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Categorías</h1>
          <p className="text-gray-400 text-sm mt-1">{categories.length} categorías ({categories.filter(c => c.is_system).length} del sistema)</p>
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg transition-colors"
        >
          <Plus className="w-4 h-4" />
          Nueva categoría
        </button>
      </div>

      {/* Info */}
      <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl px-4 py-3 text-sm text-blue-300 flex items-start gap-2">
        <Tag className="w-4 h-4 mt-0.5 flex-shrink-0" />
        <span>
                          Las categorías marcadas con <Lock className="w-3 h-3 inline mx-1" aria-label="candado" /> son del sistema y no se pueden eliminar.
          Puedes añadir tus propias categorías personalizadas.
        </span>
      </div>

      {/* Grid de categorías */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {categories.map((cat) => (
          <div
            key={cat.id}
            className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex items-start gap-3 hover:border-gray-700 transition-colors group"
          >
            <div className="text-2xl flex-shrink-0 mt-0.5">{cat.icon || '📦'}</div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <p className="text-sm font-semibold text-white truncate">{cat.label}</p>
                {cat.is_system && (
                  <span title="Categoría del sistema"><Lock className="w-3 h-3 text-gray-500 flex-shrink-0" /></span>
                )}
              </div>
              <p className="text-xs text-gray-500 font-mono mt-0.5">{cat.value}</p>
            </div>
            <div className="flex gap-1 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                onClick={() => openEdit(cat)}
                className="p-1.5 text-gray-500 hover:text-blue-400 transition-colors rounded"
                title="Editar"
              >
                <Pencil className="w-3.5 h-3.5" />
              </button>
              {!cat.is_system && (
                <button
                  onClick={() => setDeleteModal(cat)}
                  className="p-1.5 text-gray-500 hover:text-red-400 transition-colors rounded"
                  title="Eliminar"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
        ))}

        {categories.length === 0 && (
          <div className="col-span-full text-center py-16 text-gray-500">
            <Tag className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p>No hay categorías todavía</p>
          </div>
        )}
      </div>

      {/* Modal Crear / Editar */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
              <h2 className="text-lg font-semibold text-white">
                {editCat ? 'Editar categoría' : 'Nueva categoría'}
              </h2>
              <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSave} className="px-6 py-5 space-y-4">
              {/* Icono selector */}
              <FormField label="Icono (emoji)">
                <div className="space-y-2">
                  <div className="flex items-center gap-3">
                    <div className="text-3xl w-12 h-12 flex items-center justify-center bg-gray-800 border border-gray-700 rounded-lg">
                      {form.icon || '📦'}
                    </div>
                    <input
                      type="text"
                      value={form.icon}
                      onChange={(e) => setForm(f => ({ ...f, icon: e.target.value }))}
                      placeholder="📦"
                      className={ic + ' flex-1'}
                      maxLength={8}
                    />
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {EMOJI_SUGGESTIONS.map((emoji) => (
                      <button
                        key={emoji}
                        type="button"
                        onClick={() => setForm(f => ({ ...f, icon: emoji }))}
                        className={`w-8 h-8 text-lg flex items-center justify-center rounded transition-colors hover:bg-gray-700
                          ${form.icon === emoji ? 'bg-blue-600' : 'bg-gray-800'}`}
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                </div>
              </FormField>

              <FormField label="Nombre visible *" error={errors.label}>
                <input
                  type="text"
                  value={form.label}
                  onChange={(e) => setForm(f => ({ ...f, label: e.target.value }))}
                  placeholder="Ej: Escáner"
                  className={ic}
                />
              </FormField>

              {!editCat && (
                <FormField label="Identificador único *" error={errors.value}>
                  <input
                    type="text"
                    value={form.value}
                    onChange={(e) => setForm(f => ({ ...f, value: e.target.value }))}
                    placeholder="Ej: scanner"
                    className={ic}
                  />
                  <p className="text-xs text-gray-600 mt-1">
                    Solo letras, números y guiones bajos. Vista previa: <span className="font-mono text-gray-400">{slugify(form.value) || '...'}</span>
                  </p>
                </FormField>
              )}

              {editCat?.is_system && (
                <div className="flex items-center gap-2 bg-yellow-500/10 border border-yellow-500/20 rounded-lg px-3 py-2 text-xs text-yellow-400">
                  <Lock className="w-3.5 h-3.5 flex-shrink-0" />
                  <span>Solo puedes editar el nombre e icono de las categorías del sistema.</span>
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  className="flex-1 px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg text-sm"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 text-white rounded-lg text-sm font-medium"
                >
                  {saving ? (
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    <Save className="w-4 h-4" />
                  )}
                  {editCat ? 'Guardar cambios' : 'Crear categoría'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal eliminar */}
      {deleteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 max-w-sm w-full shadow-2xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-red-500/20 flex items-center justify-center">
                <AlertTriangle className="w-5 h-5 text-red-400" />
              </div>
              <h3 className="text-base font-semibold text-white">Eliminar categoría</h3>
            </div>
            <p className="text-sm text-gray-400 mb-2">¿Eliminar la categoría:</p>
            <div className="flex items-center gap-2 mb-4">
              <span className="text-2xl">{deleteModal.icon}</span>
              <span className="text-white font-medium">{deleteModal.label}</span>
            </div>
            <p className="text-xs text-red-400 mb-5">
              Solo se puede eliminar si ningún activo la usa. Esta acción no se puede deshacer.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setDeleteModal(null)}
                className="flex-1 px-3 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg text-sm"
              >
                Cancelar
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="flex-1 px-3 py-2 bg-red-600 hover:bg-red-500 disabled:bg-red-800 text-white rounded-lg text-sm font-medium"
              >
                {deleting ? 'Eliminando...' : 'Eliminar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
