import { useEffect, useState, useCallback } from 'react';
import {
  Plus, Search, Pencil, Trash2, Upload, Download, FileDown,
  AlertTriangle, Users2, CheckCircle, XCircle, X, Save, Loader2
} from 'lucide-react';
import Papa from 'papaparse';
import toast from 'react-hot-toast';
import { ClientUser } from '../types';
import { getClientUsers, createClientUser, updateClientUser, deleteClientUser, importClientUsers } from '../api/client';
import { useAuth } from '../context/AuthContext';

// ── Plantilla CSV ─────────────────────────────────────────────────────────────
const CSV_HEADERS = ['first_name', 'last_name', 'email', 'phone', 'department', 'position', 'employee_id', 'notes', 'active'];

const emptyForm = {
  first_name: '', last_name: '', email: '', phone: '',
  department: '', position: '', employee_id: '', notes: '', active: true,
};

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

// ── Modal formulario ──────────────────────────────────────────────────────────
interface FormModalProps {
  user: ClientUser | null;
  onSave: (data: typeof emptyForm) => Promise<void>;
  onClose: () => void;
}

function FormModal({ user, onSave, onClose }: FormModalProps) {
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (user) {
      setForm({
        first_name: user.first_name,
        last_name: user.last_name,
        email: user.email || '',
        phone: user.phone || '',
        department: user.department || '',
        position: user.position || '',
        employee_id: user.employee_id || '',
        notes: user.notes || '',
        active: user.active,
      });
    } else {
      setForm(emptyForm);
    }
    setErrors({});
  }, [user]);

  const validate = () => {
    const e: Record<string, string> = {};
    if (!form.first_name.trim()) e.first_name = 'Nombre requerido';
    if (!form.last_name.trim()) e.last_name = 'Apellidos requeridos';
    if (form.email && !form.email.includes('@')) e.email = 'Email no válido';
    return e;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length > 0) { setErrors(errs); return; }
    setSaving(true);
    try { await onSave(form); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-lg shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
          <h2 className="text-lg font-semibold text-white flex items-center gap-2">
            <Users2 className="w-5 h-5 text-emerald-400" />
            {user ? 'Editar usuario cliente' : 'Nuevo usuario cliente'}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Nombre *" error={errors.first_name}>
              <input type="text" value={form.first_name}
                onChange={e => setForm(f => ({ ...f, first_name: e.target.value }))}
                placeholder="Juan" className={ic(errors.first_name)} />
            </Field>
            <Field label="Apellidos *" error={errors.last_name}>
              <input type="text" value={form.last_name}
                onChange={e => setForm(f => ({ ...f, last_name: e.target.value }))}
                placeholder="García López" className={ic(errors.last_name)} />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Email" error={errors.email}>
              <input type="email" value={form.email}
                onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                placeholder="juan@empresa.com" className={ic(errors.email)} />
            </Field>
            <Field label="Teléfono">
              <input type="text" value={form.phone}
                onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                placeholder="+34 600 000 000" className={ic()} />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Departamento">
              <input type="text" value={form.department}
                onChange={e => setForm(f => ({ ...f, department: e.target.value }))}
                placeholder="Informática" className={ic()} />
            </Field>
            <Field label="Cargo / Puesto">
              <input type="text" value={form.position}
                onChange={e => setForm(f => ({ ...f, position: e.target.value }))}
                placeholder="Técnico IT" className={ic()} />
            </Field>
          </div>

          <Field label="ID Empleado (para importación CSV)">
            <input type="text" value={form.employee_id}
              onChange={e => setForm(f => ({ ...f, employee_id: e.target.value }))}
              placeholder="EMP-001" className={ic()} />
          </Field>

          <Field label="Notas">
            <textarea value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              rows={2} placeholder="Observaciones..." className={ic() + ' resize-none'} />
          </Field>

          <div className="flex items-center gap-3">
            <input type="checkbox" id="cu-active" checked={form.active}
              onChange={e => setForm(f => ({ ...f, active: e.target.checked }))}
              className="w-4 h-4 accent-emerald-500" />
            <label htmlFor="cu-active" className="text-sm text-gray-300">Usuario activo</label>
          </div>

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose}
              className="flex-1 px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg text-sm transition-colors">
              Cancelar
            </button>
            <button type="submit" disabled={saving}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-900 text-white rounded-lg text-sm font-medium transition-colors">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {user ? 'Guardar cambios' : 'Crear usuario'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Página principal ──────────────────────────────────────────────────────────
export default function ClientUsersPage() {
  const { user: currentUser } = useAuth();
  const canEdit = currentUser?.role === 'admin' || currentUser?.role === 'editor';

  const [list, setList]             = useState<ClientUser[]>([]);
  const [loading, setLoading]       = useState(true);
  const [search, setSearch]         = useState('');
  const [filterDept, setFilterDept] = useState('');
  const [showForm, setShowForm]     = useState(false);
  const [editUser, setEditUser]     = useState<ClientUser | null>(null);
  const [deleteModal, setDeleteModal] = useState<ClientUser | null>(null);
  const [deleting, setDeleting]     = useState(false);
  const [importLoading, setImportLoading] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    getClientUsers()
      .then(res => setList(res.data))
      .catch(() => toast.error('Error al cargar usuarios clientes'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const departments = Array.from(new Set(list.map(u => u.department).filter(Boolean))).sort() as string[];

  const filtered = list.filter(u => {
    const q = search.toLowerCase();
    const fullName = `${u.first_name} ${u.last_name}`.toLowerCase();
    return (
      (!q || fullName.includes(q) || u.email?.toLowerCase().includes(q) ||
        u.department?.toLowerCase().includes(q) || u.position?.toLowerCase().includes(q) ||
        u.employee_id?.toLowerCase().includes(q)) &&
      (!filterDept || u.department === filterDept)
    );
  });

  const handleSave = async (data: typeof emptyForm) => {
    try {
      if (editUser) {
        await updateClientUser(editUser.id, data);
        toast.success('Usuario cliente actualizado');
      } else {
        await createClientUser(data);
        toast.success('Usuario cliente creado');
      }
      setShowForm(false);
      setEditUser(null);
      load();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      toast.error(e.response?.data?.error || 'Error al guardar');
      throw err;
    }
  };

  const handleDelete = async () => {
    if (!deleteModal) return;
    setDeleting(true);
    try {
      await deleteClientUser(deleteModal.id);
      toast.success('Usuario cliente eliminado');
      setDeleteModal(null);
      load();
    } catch {
      toast.error('Error al eliminar el usuario');
    } finally {
      setDeleting(false);
    }
  };

  // CSV Template
  const handleDownloadTemplate = () => {
    const example = [{
      first_name: 'Juan', last_name: 'García López', email: 'juan@empresa.com',
      phone: '+34 600 000 000', department: 'Informática', position: 'Técnico IT',
      employee_id: 'EMP-001', notes: 'Usuario de ejemplo', active: 'true',
    }];
    const csv = Papa.unparse({ fields: CSV_HEADERS, data: example });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'plantilla_usuarios_clientes.csv'; a.click();
    URL.revokeObjectURL(url);
  };

  // CSV Export
  const handleExport = () => {
    const rows = filtered.map(u => ({
      first_name: u.first_name, last_name: u.last_name,
      email: u.email || '', phone: u.phone || '',
      department: u.department || '', position: u.position || '',
      employee_id: u.employee_id || '', notes: u.notes || '',
      active: u.active ? 'true' : 'false',
    }));
    const csv = Papa.unparse(rows);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `usuarios_clientes_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Exportados ${rows.length} usuarios`);
  };

  // CSV Import
  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportLoading(true);
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: async (results) => {
        const rows = results.data.map(r => ({
          first_name: r.first_name?.trim() || '',
          last_name: r.last_name?.trim() || '',
          email: r.email?.trim() || '',
          phone: r.phone?.trim() || '',
          department: r.department?.trim() || '',
          position: r.position?.trim() || '',
          employee_id: r.employee_id?.trim() || '',
          notes: r.notes?.trim() || '',
          active: r.active?.trim() !== 'false',
        }));
        try {
          const res = await importClientUsers(rows);
          toast.success(`Importados: ${res.data.inserted} nuevos, ${res.data.updated} actualizados`);
          if (res.data.errors?.length > 0) {
            toast.error(`${res.data.errors.length} errores en la importación`);
          }
          load();
        } catch (err: unknown) {
          const er = err as { response?: { data?: { error?: string } } };
          toast.error(er.response?.data?.error || 'Error en la importación');
        } finally {
          setImportLoading(false);
          e.target.value = '';
        }
      },
      error: () => {
        toast.error('Error al leer el archivo CSV');
        setImportLoading(false);
      },
    });
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Usuarios Clientes</h1>
          <p className="text-gray-400 text-sm mt-1">
            {list.length} usuarios · personas asignables a activos y software
          </p>
        </div>
        {canEdit && (
          <button
            onClick={() => { setEditUser(null); setShowForm(true); }}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium rounded-lg transition-colors"
          >
            <Plus className="w-4 h-4" />
            Nuevo usuario
          </button>
        )}
      </div>

      {/* Info banner */}
      <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl px-4 py-3 text-sm text-emerald-300 flex items-start gap-2">
        <Users2 className="w-4 h-4 mt-0.5 flex-shrink-0" />
        <span>
          Estos usuarios <strong>no tienen acceso a la aplicación</strong>. Son las personas de tu organización
          que puedes asignar a activos y software. Para gestionar quién puede entrar a la app, ve a{' '}
          <strong>Usuarios App</strong>.
        </span>
      </div>

      {/* Filtros y acciones */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
          <input
            type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Buscar por nombre, email, departamento, cargo, ID empleado..."
            className="w-full bg-gray-800 border border-gray-700 rounded-lg pl-10 pr-4 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
          />
        </div>

        <div className="flex flex-wrap gap-2 items-center">
          <select value={filterDept} onChange={e => setFilterDept(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500 appearance-none">
            <option value="">Todos los departamentos</option>
            {departments.map(d => <option key={d} value={d}>{d}</option>)}
          </select>

          {(search || filterDept) && (
            <button onClick={() => { setSearch(''); setFilterDept(''); }}
              className="px-3 py-2 text-xs text-gray-400 hover:text-white bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg transition-colors">
              Limpiar filtros
            </button>
          )}

          <div className="flex-1" />

          {/* Plantilla CSV */}
          <button onClick={handleDownloadTemplate} title="Descargar plantilla CSV"
            className="flex items-center gap-1.5 px-3 py-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 text-sm rounded-lg transition-colors">
            <FileDown className="w-4 h-4" />
            <span className="hidden sm:inline">Plantilla</span>
          </button>

          {/* Importar CSV */}
          {canEdit && (
            <label className={`flex items-center gap-1.5 px-3 py-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 text-sm rounded-lg transition-colors cursor-pointer ${importLoading ? 'opacity-60 pointer-events-none' : ''}`}>
              {importLoading
                ? <div className="w-4 h-4 border-2 border-gray-500 border-t-white rounded-full animate-spin" />
                : <Upload className="w-4 h-4" />}
              <span className="hidden sm:inline">Importar CSV</span>
              <input type="file" accept=".csv" className="hidden" onChange={handleImport} />
            </label>
          )}

          {/* Exportar */}
          <button onClick={handleExport}
            className="flex items-center gap-1.5 px-3 py-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 text-sm rounded-lg transition-colors">
            <Download className="w-4 h-4" />
            <span className="hidden sm:inline">Exportar</span>
          </button>
        </div>
      </div>

      {/* Tabla */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-48">
            <div className="w-8 h-8 border-2 border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 text-gray-500">
            <Users2 className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p className="font-medium">No se encontraron usuarios</p>
            <p className="text-sm mt-1">
              {canEdit ? 'Añade usuarios manualmente o importa desde CSV' : 'No hay usuarios clientes registrados'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-800/50 border-b border-gray-800">
                <tr>
                  <th className="text-left text-xs font-medium text-gray-400 px-4 py-3">Nombre</th>
                  <th className="text-left text-xs font-medium text-gray-400 px-4 py-3">Email</th>
                  <th className="text-left text-xs font-medium text-gray-400 px-4 py-3">Teléfono</th>
                  <th className="text-left text-xs font-medium text-gray-400 px-4 py-3">Departamento</th>
                  <th className="text-left text-xs font-medium text-gray-400 px-4 py-3">Cargo</th>
                  <th className="text-left text-xs font-medium text-gray-400 px-4 py-3">ID Empleado</th>
                  <th className="text-left text-xs font-medium text-gray-400 px-4 py-3">Estado</th>
                  <th className="px-4 py-3 text-xs font-medium text-gray-400">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {filtered.map(u => (
                  <tr key={u.id} className="hover:bg-gray-800/40 transition-colors">
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full bg-emerald-600/30 flex items-center justify-center text-xs font-bold text-emerald-400 flex-shrink-0">
                          {u.first_name.charAt(0)}{u.last_name.charAt(0)}
                        </div>
                        <span className="text-white font-medium">{u.first_name} {u.last_name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-400 text-xs whitespace-nowrap">{u.email || '—'}</td>
                    <td className="px-4 py-3 text-gray-400 text-xs whitespace-nowrap">{u.phone || '—'}</td>
                    <td className="px-4 py-3 text-gray-300 text-xs whitespace-nowrap">
                      {u.department ? (
                        <span className="px-2 py-0.5 rounded bg-gray-800 text-gray-300">{u.department}</span>
                      ) : '—'}
                    </td>
                    <td className="px-4 py-3 text-gray-400 text-xs whitespace-nowrap">{u.position || '—'}</td>
                    <td className="px-4 py-3 text-gray-500 font-mono text-xs whitespace-nowrap">{u.employee_id || '—'}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {u.active
                        ? <span className="flex items-center gap-1 text-emerald-400 text-xs"><CheckCircle className="w-3.5 h-3.5" />Activo</span>
                        : <span className="flex items-center gap-1 text-red-400 text-xs"><XCircle className="w-3.5 h-3.5" />Inactivo</span>
                      }
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        {canEdit && (
                          <button onClick={() => { setEditUser(u); setShowForm(true); }}
                            className="text-gray-500 hover:text-emerald-400 transition-colors p-1" title="Editar">
                            <Pencil className="w-4 h-4" />
                          </button>
                        )}
                        {currentUser?.role === 'admin' && (
                          <button onClick={() => setDeleteModal(u)}
                            className="text-gray-500 hover:text-red-400 transition-colors p-1" title="Eliminar">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="px-4 py-3 border-t border-gray-800 text-xs text-gray-500">
              Mostrando {filtered.length} de {list.length} usuarios
            </div>
          </div>
        )}
      </div>

      {/* Modal formulario */}
      {showForm && (
        <FormModal
          user={editUser}
          onSave={handleSave}
          onClose={() => { setShowForm(false); setEditUser(null); }}
        />
      )}

      {/* Modal eliminar */}
      {deleteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 max-w-md w-full shadow-2xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-red-500/20 flex items-center justify-center">
                <AlertTriangle className="w-5 h-5 text-red-400" />
              </div>
              <h3 className="text-lg font-semibold text-white">Eliminar usuario cliente</h3>
            </div>
            <p className="text-gray-400 text-sm mb-2">¿Seguro que quieres eliminar a:</p>
            <p className="text-white font-medium mb-1">{deleteModal.first_name} {deleteModal.last_name}</p>
            {deleteModal.email && <p className="text-gray-500 text-xs mb-2">{deleteModal.email}</p>}
            <p className="text-red-400 text-xs mb-6">Se eliminarán también todos sus vínculos con activos y software.</p>
            <div className="flex gap-3">
              <button onClick={() => setDeleteModal(null)}
                className="flex-1 px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg text-sm transition-colors">
                Cancelar
              </button>
              <button onClick={handleDelete} disabled={deleting}
                className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-500 disabled:bg-red-800 text-white rounded-lg text-sm font-medium transition-colors">
                {deleting ? 'Eliminando...' : 'Eliminar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
