import { useEffect, useState, useCallback } from 'react';
import { Plus, Pencil, Trash2, Key, Shield, AlertTriangle, Users, CheckCircle, XCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import { User, UserRole } from '../types';
import { getUsers, createUser, updateUser, deleteUser, changePassword } from '../api/client';
import { useAuth } from '../context/AuthContext';

const roleColors: Record<UserRole, string> = {
  admin: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
  editor: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  viewer: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
};

const emptyUser = {
  username: '', full_name: '', email: '', role: 'viewer' as UserRole,
  active: true, password: '', confirm_password: ''
};

export default function UsersPage() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editUser, setEditUser] = useState<User | null>(null);
  const [deleteModal, setDeleteModal] = useState<User | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [pwModal, setPwModal] = useState<User | null>(null);
  const [form, setForm] = useState(emptyUser);
  const [pwForm, setPwForm] = useState({ new_password: '', confirm_password: '' });
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const load = useCallback(() => {
    setLoading(true);
    getUsers()
      .then((res) => setUsers(res.data))
      .catch(() => toast.error('Error al cargar usuarios'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => {
    setEditUser(null);
    setForm(emptyUser);
    setErrors({});
    setShowForm(true);
  };

  const openEdit = (u: User) => {
    setEditUser(u);
    setForm({ username: u.username, full_name: u.full_name, email: u.email, role: u.role, active: u.active, password: '', confirm_password: '' });
    setErrors({});
    setShowForm(true);
  };

  const validate = () => {
    const e: Record<string, string> = {};
    if (!form.username.trim()) e.username = 'Requerido';
    if (!form.full_name.trim()) e.full_name = 'Requerido';
    if (!form.email.trim() || !form.email.includes('@')) e.email = 'Email inválido';
    if (!editUser) {
      if (!form.password || form.password.length < 6) e.password = 'Mínimo 6 caracteres';
      if (form.password !== form.confirm_password) e.confirm_password = 'Las contraseñas no coinciden';
    }
    return e;
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length > 0) { setErrors(errs); return; }
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        username: form.username, full_name: form.full_name,
        email: form.email, role: form.role, active: form.active
      };
      if (!editUser) payload.password = form.password;
      if (editUser) {
        await updateUser(editUser.id, payload);
        toast.success('Usuario actualizado');
      } else {
        await createUser(payload);
        toast.success('Usuario creado correctamente');
      }
      setShowForm(false);
      load();
    } catch (err: unknown) {
      const er = err as { response?: { data?: { error?: string } } };
      toast.error(er.response?.data?.error || 'Error al guardar usuario');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteModal) return;
    setDeleting(true);
    try {
      await deleteUser(deleteModal.id);
      toast.success('Usuario eliminado');
      setDeleteModal(null);
      load();
    } catch {
      toast.error('Error al eliminar usuario');
    } finally {
      setDeleting(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pwForm.new_password || pwForm.new_password.length < 6) {
      toast.error('La contraseña debe tener al menos 6 caracteres');
      return;
    }
    if (pwForm.new_password !== pwForm.confirm_password) {
      toast.error('Las contraseñas no coinciden');
      return;
    }
    setSaving(true);
    try {
      await changePassword(pwModal!.id, { new_password: pwForm.new_password });
      toast.success('Contraseña cambiada correctamente');
      setPwModal(null);
      setPwForm({ new_password: '', confirm_password: '' });
    } catch {
      toast.error('Error al cambiar la contraseña');
    } finally {
      setSaving(false);
    }
  };

  const inputClass = (name: string) =>
    `w-full bg-gray-800 border ${errors[name] ? 'border-red-500' : 'border-gray-700'} rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors`;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Usuarios</h1>
          <p className="text-gray-400 text-sm mt-1">{users.length} usuarios registrados</p>
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg transition-colors"
        >
          <Plus className="w-4 h-4" />
          Nuevo usuario
        </button>
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-48">
            <div className="w-8 h-8 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />
          </div>
        ) : users.length === 0 ? (
          <div className="text-center py-16 text-gray-500">
            <Users className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p>No hay usuarios registrados</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-800/50 border-b border-gray-800">
                <tr>
                  <th className="text-left text-xs font-medium text-gray-400 px-4 py-3">Usuario</th>
                  <th className="text-left text-xs font-medium text-gray-400 px-4 py-3">Nombre completo</th>
                  <th className="text-left text-xs font-medium text-gray-400 px-4 py-3">Email</th>
                  <th className="text-left text-xs font-medium text-gray-400 px-4 py-3">Rol</th>
                  <th className="text-left text-xs font-medium text-gray-400 px-4 py-3">Estado</th>
                  <th className="text-left text-xs font-medium text-gray-400 px-4 py-3">Alta</th>
                  <th className="px-4 py-3 text-xs font-medium text-gray-400">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {users.map((u) => (
                  <tr key={u.id} className="hover:bg-gray-800/40 transition-colors">
                    <td className="px-4 py-3 font-mono text-xs text-blue-400">{u.username}</td>
                    <td className="px-4 py-3 text-white font-medium">{u.full_name}</td>
                    <td className="px-4 py-3 text-gray-400 text-xs">{u.email}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${roleColors[u.role]}`}>
                        <Shield className="w-3 h-3" />
                        {u.role}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {u.active
                        ? <span className="flex items-center gap-1 text-green-400 text-xs"><CheckCircle className="w-3.5 h-3.5" />Activo</span>
                        : <span className="flex items-center gap-1 text-red-400 text-xs"><XCircle className="w-3.5 h-3.5" />Inactivo</span>
                      }
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs">
                      {u.created_at ? new Date(u.created_at).toLocaleDateString('es-ES') : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => openEdit(u)}
                          className="text-gray-500 hover:text-blue-400 transition-colors p-1"
                          title="Editar"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => { setPwModal(u); setPwForm({ new_password: '', confirm_password: '' }); }}
                          className="text-gray-500 hover:text-yellow-400 transition-colors p-1"
                          title="Cambiar contraseña"
                        >
                          <Key className="w-4 h-4" />
                        </button>
                        {u.id !== currentUser?.id && (
                          <button
                            onClick={() => setDeleteModal(u)}
                            className="text-gray-500 hover:text-red-400 transition-colors p-1"
                            title="Eliminar"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* User Form Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
              <h2 className="text-lg font-semibold text-white">
                {editUser ? 'Editar usuario' : 'Nuevo usuario'}
              </h2>
              <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-white">✕</button>
            </div>
            <form onSubmit={handleSave} className="px-6 py-5 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1">Usuario *</label>
                  <input type="text" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })}
                    disabled={!!editUser} placeholder="nombre.usuario"
                    className={inputClass('username') + (editUser ? ' opacity-60 cursor-not-allowed' : '')} />
                  {errors.username && <p className="text-red-400 text-xs mt-1">{errors.username}</p>}
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1">Rol *</label>
                  <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as UserRole })}
                    className={inputClass('role')}>
                    <option value="admin">Admin</option>
                    <option value="editor">Editor</option>
                    <option value="viewer">Viewer</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">Nombre completo *</label>
                <input type="text" value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })}
                  placeholder="Juan García López" className={inputClass('full_name')} />
                {errors.full_name && <p className="text-red-400 text-xs mt-1">{errors.full_name}</p>}
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">Email *</label>
                <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })}
                  placeholder="juan@empresa.com" className={inputClass('email')} />
                {errors.email && <p className="text-red-400 text-xs mt-1">{errors.email}</p>}
              </div>
              {!editUser && (
                <>
                  <div>
                    <label className="block text-xs font-medium text-gray-400 mb-1">Contraseña *</label>
                    <input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })}
                      placeholder="Mínimo 6 caracteres" className={inputClass('password')} />
                    {errors.password && <p className="text-red-400 text-xs mt-1">{errors.password}</p>}
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-400 mb-1">Confirmar contraseña *</label>
                    <input type="password" value={form.confirm_password} onChange={(e) => setForm({ ...form, confirm_password: e.target.value })}
                      placeholder="Repite la contraseña" className={inputClass('confirm_password')} />
                    {errors.confirm_password && <p className="text-red-400 text-xs mt-1">{errors.confirm_password}</p>}
                  </div>
                </>
              )}
              <div className="flex items-center gap-3">
                <input type="checkbox" id="active" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })}
                  className="w-4 h-4 accent-blue-500" />
                <label htmlFor="active" className="text-sm text-gray-300">Usuario activo</label>
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setShowForm(false)}
                  className="flex-1 px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg text-sm">
                  Cancelar
                </button>
                <button type="submit" disabled={saving}
                  className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 text-white rounded-lg text-sm font-medium">
                  {saving ? 'Guardando...' : editUser ? 'Guardar cambios' : 'Crear usuario'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Change Password Modal */}
      {pwModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-sm shadow-2xl">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
              <div className="flex items-center gap-2">
                <Key className="w-4 h-4 text-yellow-400" />
                <h2 className="text-lg font-semibold text-white">Cambiar contraseña</h2>
              </div>
              <button onClick={() => setPwModal(null)} className="text-gray-400 hover:text-white">✕</button>
            </div>
            <form onSubmit={handleChangePassword} className="px-6 py-5 space-y-4">
              <p className="text-sm text-gray-400">Usuario: <span className="text-white font-medium">{pwModal.username}</span></p>
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">Nueva contraseña</label>
                <input type="password" value={pwForm.new_password}
                  onChange={(e) => setPwForm({ ...pwForm, new_password: e.target.value })}
                  placeholder="Mínimo 6 caracteres"
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">Confirmar nueva contraseña</label>
                <input type="password" value={pwForm.confirm_password}
                  onChange={(e) => setPwForm({ ...pwForm, confirm_password: e.target.value })}
                  placeholder="Repite la contraseña"
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500" />
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setPwModal(null)}
                  className="flex-1 px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg text-sm">
                  Cancelar
                </button>
                <button type="submit" disabled={saving}
                  className="flex-1 px-4 py-2 bg-yellow-600 hover:bg-yellow-500 disabled:bg-yellow-800 text-white rounded-lg text-sm font-medium">
                  {saving ? 'Cambiando...' : 'Cambiar contraseña'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Modal */}
      {deleteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 max-w-md w-full shadow-2xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-red-500/20 flex items-center justify-center">
                <AlertTriangle className="w-5 h-5 text-red-400" />
              </div>
              <h3 className="text-lg font-semibold text-white">Eliminar usuario</h3>
            </div>
            <p className="text-gray-400 text-sm mb-2">¿Seguro que quieres eliminar al usuario:</p>
            <p className="text-white font-medium mb-1">{deleteModal.full_name}</p>
            <p className="text-gray-500 font-mono text-xs mb-6">@{deleteModal.username}</p>
            <div className="flex gap-3">
              <button onClick={() => setDeleteModal(null)}
                className="flex-1 px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg text-sm">
                Cancelar
              </button>
              <button onClick={handleDelete} disabled={deleting}
                className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-500 disabled:bg-red-800 text-white rounded-lg text-sm font-medium">
                {deleting ? 'Eliminando...' : 'Eliminar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
