import { useEffect, useMemo, useState } from 'react';
import {
  Laptop, Plus, Trash2, X, Save, KeyRound, Copy, Check, RefreshCw,
  Power, PowerOff, Building2, Clock, AlertTriangle, ShieldCheck, Terminal,
} from 'lucide-react';
import toast from 'react-hot-toast';
import {
  getAgents, createAgent, updateAgent, deleteAgent, rotateAgentToken,
} from '../api/client';

// ---------------------------------------------------------------------------
// AgentsPage - Gestion de agentes de inventario (modo push) para delegaciones.
// Da de alta agentes, copia/rota su token (visible una sola vez) y los
// activa/desactiva o elimina. El token recogido aqui se usa al instalar el
// agente en el equipo (inventario-agent.ps1 / inventario-agent.py).
// ---------------------------------------------------------------------------

interface Agent {
  id: number;
  name: string;
  delegation?: string | null;
  os?: string | null;
  enabled: boolean;
  last_seen_at?: string | null;
  created_at: string;
  network_name?: string | null;
  cidr?: string | null;
}

function relativeTime(iso?: string | null): string {
  if (!iso) return 'Nunca';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'Hace un momento';
  if (m < 60) return `Hace ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `Hace ${h} h`;
  const d = Math.floor(h / 24);
  return `Hace ${d} d`;
}

function isStale(iso?: string | null): boolean {
  if (!iso) return true;
  return Date.now() - new Date(iso).getTime() > 48 * 3600 * 1000; // > 48h sin reportar
}

function CopyButton({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast.success('Copiado al portapapeles');
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error('No se pudo copiar');
    }
  };
  return (
    <button
      onClick={copy}
      className="flex items-center gap-1.5 px-2.5 py-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg text-xs font-medium text-gray-200 transition-colors"
    >
      {copied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
      {label || 'Copiar'}
    </button>
  );
}

export default function AgentsPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', delegation: '', cidr: '' });
  const [saving, setSaving] = useState(false);
  const [deleteModal, setDeleteModal] = useState<Agent | null>(null);
  const [deleting, setDeleting] = useState(false);
  // Token recien generado (alta o rotacion): se muestra UNA sola vez.
  const [newToken, setNewToken] = useState<{ agent: Agent; token: string } | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await getAgents();
      setAgents(res.data || []);
    } catch {
      toast.error('Error al cargar los agentes');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const stats = useMemo(() => ({
    total: agents.length,
    activos: agents.filter(a => a.enabled).length,
    reportando: agents.filter(a => !isStale(a.last_seen_at)).length,
  }), [agents]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) { toast.error('El nombre es obligatorio'); return; }
    setSaving(true);
    try {
      const res = await createAgent({
        name: form.name.trim(),
        delegation: form.delegation.trim() || undefined,
        cidr: form.cidr.trim() || undefined,
      });
      toast.success('Agente creado');
      setShowForm(false);
      setForm({ name: '', delegation: '', cidr: '' });
      await load();
      // El backend devuelve el token en claro solo en esta respuesta.
      if (res.data?.token) setNewToken({ agent: res.data, token: res.data.token });
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      toast.error(e.response?.data?.error || 'Error al crear el agente');
    } finally {
      setSaving(false);
    }
  };

  const toggleEnabled = async (a: Agent) => {
    try {
      await updateAgent(a.id, { enabled: !a.enabled });
      toast.success(a.enabled ? 'Agente desactivado' : 'Agente activado');
      load();
    } catch {
      toast.error('Error al actualizar el agente');
    }
  };

  const handleRotate = async (a: Agent) => {
    try {
      const res = await rotateAgentToken(a.id);
      if (res.data?.token) {
        setNewToken({ agent: a, token: res.data.token });
        toast.success('Token regenerado');
      }
    } catch {
      toast.error('Error al rotar el token');
    }
  };

  const handleDelete = async () => {
    if (!deleteModal) return;
    setDeleting(true);
    try {
      await deleteAgent(deleteModal.id);
      toast.success('Agente eliminado');
      setDeleteModal(null);
      load();
    } catch {
      toast.error('Error al eliminar el agente');
    } finally {
      setDeleting(false);
    }
  };

  const ic = `w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500
    focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors`;

  const serverOrigin = window.location.origin;
  const installWin = (token: string) =>
    `powershell -ExecutionPolicy Bypass -File inventario-agent.ps1 -Server "${serverOrigin}" -Token "${token}"`;
  const installLinux = (token: string) =>
    `sudo ./instalar.sh ${serverOrigin} ${token}`;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Laptop className="w-6 h-6 text-blue-400" /> Agentes
          </h1>
          <p className="text-gray-400 text-sm mt-1">
            {stats.total} agentes · {stats.activos} activos · {stats.reportando} reportando
          </p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg transition-colors"
        >
          <Plus className="w-4 h-4" /> Nuevo agente
        </button>
      </div>

      {/* Info */}
      <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl px-4 py-3 text-sm text-blue-300 flex items-start gap-2">
        <ShieldCheck className="w-4 h-4 mt-0.5 flex-shrink-0" />
        <span>
          Los agentes recogen el inventario <strong>en local</strong> en las delegaciones que no se pueden escanear por red
          y lo envían por HTTPS saliente. El <strong>token solo se muestra una vez</strong> al crear o rotar: cópialo y úsalo al instalar el agente.
        </span>
      </div>

      {/* Lista */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />
        </div>
      ) : agents.length === 0 ? (
        <div className="bg-gray-900 border border-gray-800 rounded-xl py-16 text-center">
          <Laptop className="w-10 h-10 text-gray-600 mx-auto mb-3" />
          <p className="text-gray-400 text-sm">Aún no hay agentes. Crea el primero para una delegación.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {agents.map((a) => {
            const stale = isStale(a.last_seen_at);
            return (
              <div key={a.id} className="bg-gray-900 border border-gray-800 rounded-xl p-4 hover:border-gray-700 transition-colors">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-white truncate flex items-center gap-2">
                      {a.name}
                      {a.os && <span className="text-[10px] uppercase px-1.5 py-0.5 rounded bg-gray-800 text-gray-400 border border-gray-700">{a.os}</span>}
                    </p>
                    {a.delegation && (
                      <p className="text-xs text-gray-400 mt-0.5 flex items-center gap-1 truncate">
                        <Building2 className="w-3 h-3" /> {a.delegation}
                      </p>
                    )}
                  </div>
                  <span
                    className={`text-[10px] font-medium px-2 py-0.5 rounded-full flex-shrink-0 ${
                      a.enabled ? 'bg-green-500/15 text-green-400' : 'bg-gray-700 text-gray-400'
                    }`}
                  >
                    {a.enabled ? 'Activo' : 'Inactivo'}
                  </span>
                </div>

                <div className="mt-3 flex items-center gap-1.5 text-xs">
                  <Clock className="w-3.5 h-3.5 text-gray-500" />
                  <span className={stale ? 'text-amber-400' : 'text-gray-400'}>
                    Último informe: {relativeTime(a.last_seen_at)}
                  </span>
                  {stale && <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />}
                </div>

                <div className="mt-4 flex items-center gap-2 border-t border-gray-800 pt-3">
                  <button
                    onClick={() => toggleEnabled(a)}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg text-xs font-medium text-gray-200 transition-colors"
                    title={a.enabled ? 'Desactivar' : 'Activar'}
                  >
                    {a.enabled ? <PowerOff className="w-3.5 h-3.5" /> : <Power className="w-3.5 h-3.5 text-green-400" />}
                    {a.enabled ? 'Desactivar' : 'Activar'}
                  </button>
                  <button
                    onClick={() => handleRotate(a)}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg text-xs font-medium text-gray-200 transition-colors"
                    title="Rotar token"
                  >
                    <RefreshCw className="w-3.5 h-3.5" /> Token
                  </button>
                  <button
                    onClick={() => setDeleteModal(a)}
                    className="ml-auto p-1.5 text-gray-500 hover:text-red-400 transition-colors rounded"
                    title="Eliminar"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal: crear agente */}
      {showForm && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
              <h2 className="text-base font-semibold text-white">Nuevo agente</h2>
              <button onClick={() => setShowForm(false)} className="text-gray-500 hover:text-white"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleCreate} className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">Nombre *</label>
                <input className={ic} autoFocus placeholder="PC-Recepción Sevilla"
                  value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">Delegación</label>
                <input className={ic} placeholder="Delegación Sevilla"
                  value={form.delegation} onChange={e => setForm({ ...form, delegation: e.target.value })} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">CIDR (opcional, informativo)</label>
                <input className={ic} placeholder="10.20.0.0/24"
                  value={form.cidr} onChange={e => setForm({ ...form, cidr: e.target.value })} />
                <p className="text-[11px] text-gray-500 mt-1">Se crea una red de Descubrimiento para esta delegación.</p>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setShowForm(false)}
                  className="px-4 py-2 text-sm text-gray-300 hover:text-white transition-colors">Cancelar</button>
                <button type="submit" disabled={saving}
                  className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors">
                  <Save className="w-4 h-4" /> {saving ? 'Creando...' : 'Crear agente'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: token recien generado (se muestra una sola vez) */}
      {newToken && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-xl shadow-2xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
              <h2 className="text-base font-semibold text-white flex items-center gap-2">
                <KeyRound className="w-5 h-5 text-amber-400" /> Token de «{newToken.agent.name}»
              </h2>
              <button onClick={() => setNewToken(null)} className="text-gray-500 hover:text-white"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-5 space-y-4">
              <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2 text-xs text-amber-300 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                Guárdalo ahora: por seguridad <strong>no se volverá a mostrar</strong>. Si lo pierdes, rota el token.
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">Token</label>
                <div className="flex items-center gap-2">
                  <code className="flex-1 bg-gray-950 border border-gray-800 rounded-lg px-3 py-2 text-xs text-green-400 font-mono break-all">{newToken.token}</code>
                  <CopyButton value={newToken.token} />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1 flex items-center gap-1"><Terminal className="w-3.5 h-3.5" /> Instalación en Windows</label>
                <div className="flex items-center gap-2">
                  <code className="flex-1 bg-gray-950 border border-gray-800 rounded-lg px-3 py-2 text-xs text-gray-300 font-mono break-all">{installWin(newToken.token)}</code>
                  <CopyButton value={installWin(newToken.token)} />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1 flex items-center gap-1"><Terminal className="w-3.5 h-3.5" /> Instalación en Linux</label>
                <div className="flex items-center gap-2">
                  <code className="flex-1 bg-gray-950 border border-gray-800 rounded-lg px-3 py-2 text-xs text-gray-300 font-mono break-all">{installLinux(newToken.token)}</code>
                  <CopyButton value={installLinux(newToken.token)} />
                </div>
              </div>
              <div className="flex justify-end pt-1">
                <button onClick={() => setNewToken(null)}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg transition-colors">Hecho</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal: eliminar */}
      {deleteModal && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-sm shadow-2xl">
            <div className="p-5">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-full bg-red-500/15 flex items-center justify-center flex-shrink-0">
                  <AlertTriangle className="w-5 h-5 text-red-400" />
                </div>
                <div>
                  <h2 className="text-base font-semibold text-white">Eliminar agente</h2>
                  <p className="text-xs text-gray-400">Esta acción no se puede deshacer.</p>
                </div>
              </div>
              <p className="text-sm text-gray-300">
                ¿Seguro que quieres eliminar «<strong>{deleteModal.name}</strong>»? El equipo dejará de poder enviar informes con su token actual.
              </p>
              <div className="flex justify-end gap-2 mt-5">
                <button onClick={() => setDeleteModal(null)}
                  className="px-4 py-2 text-sm text-gray-300 hover:text-white transition-colors">Cancelar</button>
                <button onClick={handleDelete} disabled={deleting}
                  className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors">
                  <Trash2 className="w-4 h-4" /> {deleting ? 'Eliminando...' : 'Eliminar'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
