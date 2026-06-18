import { useCallback, useEffect, useMemo, useState } from 'react';
import { Copy, KeyRound, Plus, RefreshCw, RotateCcw, Trash2, MonitorCog, CheckCircle, XCircle, Clock, Download } from 'lucide-react';
import toast from 'react-hot-toast';
import { createAgentToken, deleteAgentToken, getAgents, regenerateAgentToken, updateAgentToken } from '../api/client';

type AgentToken = {
  id: number;
  name: string;
  delegation?: string | null;
  enabled: boolean;
  auto_import: boolean;
  notes?: string | null;
  created_at?: string;
  updated_at?: string;
  last_seen?: string | null;
  last_report_at?: string | null;
  last_hostname?: string | null;
  last_ip?: string | null;
  last_os?: string | null;
  agent_version?: string | null;
};

const emptyForm = { name: '', delegation: '', notes: '', auto_import: false, enabled: true };

function fmtDate(value?: string | null) {
  if (!value) return 'Nunca';
  return new Date(value).toLocaleString();
}

function statusOf(agent: AgentToken) {
  if (!agent.enabled) return { label: 'Deshabilitado', cls: 'bg-gray-500/20 text-gray-400 border-gray-500/30', icon: XCircle };
  if (!agent.last_seen) return { label: 'Pendiente', cls: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30', icon: Clock };
  const hours = (Date.now() - new Date(agent.last_seen).getTime()) / 36e5;
  if (hours > 48) return { label: 'Sin reportar', cls: 'bg-red-500/20 text-red-400 border-red-500/30', icon: XCircle };
  return { label: 'Activo', cls: 'bg-green-500/20 text-green-400 border-green-500/30', icon: CheckCircle };
}

export default function AgentsPage() {
  const [agents, setAgents] = useState<AgentToken[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editAgent, setEditAgent] = useState<AgentToken | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [newToken, setNewToken] = useState<string | null>(null);
  const [filter, setFilter] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    getAgents()
      .then((res) => setAgents(res.data))
      .catch(() => toast.error('Error al cargar agentes'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return agents;
    return agents.filter(a => [a.name, a.delegation, a.last_hostname, a.last_ip, a.last_os].some(v => String(v || '').toLowerCase().includes(q)));
  }, [agents, filter]);

  const openCreate = () => {
    setEditAgent(null);
    setForm(emptyForm);
    setNewToken(null);
    setShowForm(true);
  };

  const openEdit = (a: AgentToken) => {
    setEditAgent(a);
    setForm({
      name: a.name || '',
      delegation: a.delegation || '',
      notes: a.notes || '',
      auto_import: !!a.auto_import,
      enabled: a.enabled !== false,
    });
    setNewToken(null);
    setShowForm(true);
  };

  const copy = async (text: string, msg = 'Copiado') => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(msg);
    } catch {
      toast.error('No se pudo copiar');
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) { toast.error('Indica un nombre'); return; }
    setSaving(true);
    try {
      if (editAgent) {
        await updateAgentToken(editAgent.id, form);
        toast.success('Agente actualizado');
        setShowForm(false);
      } else {
        const res = await createAgentToken(form);
        setNewToken(res.data.token);
        toast.success('Token creado');
      }
      load();
    } catch (err: unknown) {
      const e2 = err as { response?: { data?: { error?: string } } };
      toast.error(e2.response?.data?.error || 'Error al guardar');
    } finally {
      setSaving(false);
    }
  };

  const handleRegenerate = async (a: AgentToken) => {
    if (!confirm(`Regenerar el token de ${a.name}? El token anterior dejara de funcionar.`)) return;
    try {
      const res = await regenerateAgentToken(a.id);
      setNewToken(res.data.token);
      setEditAgent(a);
      setShowForm(true);
      toast.success('Token regenerado');
      load();
    } catch {
      toast.error('Error regenerando token');
    }
  };

  const handleDelete = async (a: AgentToken) => {
    if (!confirm(`Eliminar el agente ${a.name}?`)) return;
    try {
      await deleteAgentToken(a.id);
      toast.success('Agente eliminado');
      load();
    } catch {
      toast.error('Error eliminando agente');
    }
  };

  const installWin = newToken ? `powershell.exe -ExecutionPolicy Bypass -File .\\install-scheduled-task.ps1 -ApiUrl "https://TU_SERVIDOR/api" -Token "${newToken}" -Delegation "${form.delegation || 'Delegacion'}"` : '';
  const installLinux = newToken ? `sudo ./install.sh https://TU_SERVIDOR/api '${newToken}' '${form.delegation || 'Delegacion'}'` : '';

  return (
    <div className="space-y-5">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2"><MonitorCog className="w-6 h-6 text-blue-400" /> Agentes</h1>
          <p className="text-gray-400 text-sm mt-1">Inventario remoto para delegaciones sin escaneo de red directo</p>
        </div>
        <div className="flex gap-2">
          <button onClick={load} className="flex items-center gap-2 px-3 py-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-200 text-sm rounded-lg"><RefreshCw className="w-4 h-4" />Actualizar</button>
          <button onClick={openCreate} className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg"><Plus className="w-4 h-4" />Nuevo token</button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4"><p className="text-gray-400 text-sm">Total agentes</p><p className="text-2xl font-bold mt-1">{agents.length}</p></div>
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4"><p className="text-gray-400 text-sm">Activos últimas 48h</p><p className="text-2xl font-bold mt-1 text-green-400">{agents.filter(a => a.last_seen && (Date.now() - new Date(a.last_seen).getTime()) / 36e5 <= 48 && a.enabled).length}</p></div>
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4"><p className="text-gray-400 text-sm">Pendientes</p><p className="text-2xl font-bold mt-1 text-yellow-400">{agents.filter(a => !a.last_seen && a.enabled).length}</p></div>
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
        <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Buscar por nombre, delegación, host, IP o SO..." className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500" />
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-48"><div className="w-8 h-8 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" /></div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 text-gray-500"><MonitorCog className="w-12 h-12 mx-auto mb-3 opacity-30" /><p>No hay agentes configurados</p></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-800/50 border-b border-gray-800">
                <tr>
                  <th className="text-left text-xs font-medium text-gray-400 px-4 py-3">Agente</th>
                  <th className="text-left text-xs font-medium text-gray-400 px-4 py-3">Estado</th>
                  <th className="text-left text-xs font-medium text-gray-400 px-4 py-3">Último equipo</th>
                  <th className="text-left text-xs font-medium text-gray-400 px-4 py-3">SO / IP</th>
                  <th className="text-left text-xs font-medium text-gray-400 px-4 py-3">Último reporte</th>
                  <th className="text-left text-xs font-medium text-gray-400 px-4 py-3">Auto alta</th>
                  <th className="px-4 py-3 text-xs font-medium text-gray-400">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {filtered.map((a) => {
                  const s = statusOf(a); const Icon = s.icon;
                  return (
                    <tr key={a.id} className="hover:bg-gray-800/40">
                      <td className="px-4 py-3"><p className="font-medium text-white">{a.name}</p><p className="text-xs text-gray-500">{a.delegation || 'Sin delegación'}</p></td>
                      <td className="px-4 py-3"><span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs border ${s.cls}`}><Icon className="w-3 h-3" />{s.label}</span></td>
                      <td className="px-4 py-3"><p className="text-white">{a.last_hostname || '-'}</p><p className="text-xs text-gray-500">v{a.agent_version || '-'}</p></td>
                      <td className="px-4 py-3"><p className="text-gray-300 max-w-xs truncate">{a.last_os || '-'}</p><p className="text-xs text-gray-500">{a.last_ip || '-'}</p></td>
                      <td className="px-4 py-3 text-gray-300">{fmtDate(a.last_report_at || a.last_seen)}</td>
                      <td className="px-4 py-3">{a.auto_import ? <span className="text-green-400">Sí</span> : <span className="text-gray-500">No</span>}</td>
                      <td className="px-4 py-3"><div className="flex justify-center gap-1"><button onClick={() => openEdit(a)} className="p-2 text-gray-400 hover:text-blue-400 hover:bg-blue-500/10 rounded-lg" title="Editar"><KeyRound className="w-4 h-4" /></button><button onClick={() => handleRegenerate(a)} className="p-2 text-gray-400 hover:text-yellow-400 hover:bg-yellow-500/10 rounded-lg" title="Regenerar token"><RotateCcw className="w-4 h-4" /></button><button onClick={() => handleDelete(a)} className="p-2 text-gray-400 hover:text-red-400 hover:bg-red-500/10 rounded-lg" title="Eliminar"><Trash2 className="w-4 h-4" /></button></div></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="bg-gray-900 border border-gray-800 rounded-xl w-full max-w-2xl p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4"><h2 className="text-lg font-bold text-white">{editAgent ? 'Editar agente' : 'Nuevo token de agente'}</h2><button onClick={() => { setShowForm(false); setNewToken(null); }} className="text-gray-400 hover:text-white">×</button></div>
            <form onSubmit={handleSave} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div><label className="block text-sm text-gray-400 mb-1">Nombre</label><input value={form.name} onChange={e => setForm({...form, name: e.target.value})} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm" placeholder="Delegación Valencia" /></div>
                <div><label className="block text-sm text-gray-400 mb-1">Delegación</label><input value={form.delegation} onChange={e => setForm({...form, delegation: e.target.value})} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm" placeholder="Valencia" /></div>
              </div>
              <div><label className="block text-sm text-gray-400 mb-1">Notas</label><textarea value={form.notes} onChange={e => setForm({...form, notes: e.target.value})} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm h-20" /></div>
              <div className="flex flex-col gap-2">
                <label className="flex items-center gap-2 text-sm text-gray-300"><input type="checkbox" checked={form.enabled} onChange={e => setForm({...form, enabled: e.target.checked})} /> Habilitado</label>
                <label className="flex items-center gap-2 text-sm text-gray-300"><input type="checkbox" checked={form.auto_import} onChange={e => setForm({...form, auto_import: e.target.checked})} /> Alta automática si llega un equipo nuevo con serie, marca y modelo</label>
              </div>
              <div className="flex justify-end gap-2"><button type="button" onClick={() => { setShowForm(false); setNewToken(null); }} className="px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-sm">Cerrar</button><button disabled={saving} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm disabled:opacity-50">{saving ? 'Guardando...' : editAgent ? 'Guardar' : 'Crear token'}</button></div>
            </form>

            {newToken && (
              <div className="mt-5 border border-yellow-500/30 bg-yellow-500/10 rounded-xl p-4 space-y-3">
                <p className="text-yellow-300 font-medium flex items-center gap-2"><KeyRound className="w-4 h-4" />Token generado: guárdalo ahora</p>
                <div className="flex gap-2"><code className="flex-1 bg-gray-950 border border-gray-800 rounded-lg px-3 py-2 text-xs break-all text-yellow-100">{newToken}</code><button onClick={() => copy(newToken, 'Token copiado')} className="px-3 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg"><Copy className="w-4 h-4" /></button></div>
                <div className="space-y-2">
                  <p className="text-sm text-gray-300 flex items-center gap-2"><Download className="w-4 h-4" />Comandos de instalación</p>
                  <div><p className="text-xs text-gray-500 mb-1">Windows</p><pre className="bg-gray-950 border border-gray-800 rounded-lg p-3 text-xs overflow-x-auto text-gray-200">{installWin}</pre></div>
                  <div><p className="text-xs text-gray-500 mb-1">Linux</p><pre className="bg-gray-950 border border-gray-800 rounded-lg p-3 text-xs overflow-x-auto text-gray-200">{installLinux}</pre></div>
                  <p className="text-xs text-gray-500">Sustituye https://TU_SERVIDOR/api por la URL real de tu backend.</p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
