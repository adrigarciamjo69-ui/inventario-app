import { useEffect, useRef, useState } from 'react';
import {
  Radar, Plus, Pencil, Trash2, X, Save, KeyRound, Network,
  Server, Wifi, Terminal, Loader2, Info, Lock, Power, ScanLine,
  CheckCircle2, AlertTriangle, Clock, RefreshCw, Download, Cpu,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useCategories } from '../context/CategoriesContext';
import {
  getScanNetworks, createScanNetwork, updateScanNetwork, deleteScanNetwork,
  createScanCredential, updateScanCredential, deleteScanCredential,
  runScan, getScanJobs, getScanJob, deleteScanJob, importScanResults,
} from '../api/client';

type CredType = 'ssh' | 'snmp' | 'winrm';

interface ScanCredential {
  id: number;
  network_id: number;
  type: CredType;
  label?: string | null;
  username?: string | null;
  port?: number | null;
  priority: number;
  has_secret: boolean;
}

interface ScanNetwork {
  id: number;
  name: string;
  cidr: string;
  enabled: boolean;
  notes?: string | null;
  credentials: ScanCredential[];
}

interface ScanJob {
  id: number;
  network_id: number;
  network_name?: string;
  cidr?: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  hosts_found: number;
  error?: string | null;
  started_at?: string | null;
  finished_at?: string | null;
  result_count?: number;
  imported_count?: number;
}

interface EnrichAttempt {
  method: string;
  cred?: string;
  ok: boolean;
  error?: string | null;
}

interface ScanResult {
  id: number;
  job_id: number;
  ip: string;
  mac?: string | null;
  hostname?: string | null;
  vendor?: string | null;
  os?: string | null;
  open_ports?: string | null;
  serial_number?: string | null;
  brand?: string | null;
  model?: string | null;
  category?: string | null;
  enrich_method?: string | null;
  matched_asset_id?: string | null;
  imported: boolean;
  raw?: { attempts?: EnrichAttempt[]; [key: string]: unknown } | null;
}

// Fila editable en la revision previa.
interface ReviewRow {
  result_id: number;
  selected: boolean;
  id: string;
  serial_number: string;
  brand: string;
  model: string;
  category: string;
  status: string;
  assigned_to: string;
  department: string;
  price: string;
  notes: string;
  // solo lectura / contexto
  ip: string;
  hostname?: string | null;
  os?: string | null;
  open_ports?: string | null;
  enrich_method?: string | null;
  matched_asset_id?: string | null;
  imported: boolean;
  attempts?: EnrichAttempt[];
}

const CRED_META: Record<CredType, {
  label: string; icon: typeof Terminal; secretLabel: string; userLabel: string; port: number; badge: string;
}> = {
  ssh:   { label: 'SSH',   icon: Terminal, secretLabel: 'Contraseña', userLabel: 'Usuario',            port: 22,   badge: 'text-green-400 bg-green-500/10 border-green-500/30' },
  snmp:  { label: 'SNMP',  icon: Wifi,     secretLabel: 'Community',  userLabel: 'Usuario (opcional)', port: 161,  badge: 'text-purple-400 bg-purple-500/10 border-purple-500/30' },
  winrm: { label: 'Windows', icon: Server,   secretLabel: 'Contraseña', userLabel: 'Usuario (DOMINIO\\user opcional)', port: 5985, badge: 'text-blue-400 bg-blue-500/10 border-blue-500/30' },
};

const STATUS_META: Record<string, { label: string; cls: string; icon: typeof Clock }> = {
  pending:   { label: 'En cola',     cls: 'text-gray-400 bg-gray-600/20 border-gray-600/40', icon: Clock },
  running:   { label: 'Escaneando',  cls: 'text-blue-400 bg-blue-500/10 border-blue-500/30', icon: Loader2 },
  completed: { label: 'Completado',  cls: 'text-green-400 bg-green-500/10 border-green-500/30', icon: CheckCircle2 },
  failed:    { label: 'Fallido',     cls: 'text-red-400 bg-red-500/10 border-red-500/30', icon: AlertTriangle },
};

const emptyNet = { name: '', cidr: '', enabled: true, notes: '' };
const emptyCred = { type: 'ssh' as CredType, label: '', username: '', secret: '', port: '', priority: '0' };

const inputCls =
  'w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500';
const cellCls =
  'w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-blue-500';

export default function DiscoveryPage() {
  const { categories } = useCategories();
  const [networks, setNetworks] = useState<ScanNetwork[]>([]);
  const [jobs, setJobs] = useState<ScanJob[]>([]);
  const [loading, setLoading] = useState(true);

  // Modal de red
  const [netModal, setNetModal] = useState(false);
  const [editingNet, setEditingNet] = useState<ScanNetwork | null>(null);
  const [netForm, setNetForm] = useState(emptyNet);
  const [savingNet, setSavingNet] = useState(false);

  // Form de credencial (inline por red)
  const [credFor, setCredFor] = useState<number | null>(null);
  const [editingCred, setEditingCred] = useState<ScanCredential | null>(null);
  const [credForm, setCredForm] = useState(emptyCred);
  const [savingCred, setSavingCred] = useState(false);

  // Escaneo / revision
  const [scanning, setScanning] = useState<number | null>(null);
  const [reviewJobId, setReviewJobId] = useState<number | null>(null);
  const [reviewJob, setReviewJob] = useState<ScanJob | null>(null);
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [importing, setImporting] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const [nets, js] = await Promise.all([getScanNetworks(), getScanJobs()]);
      setNetworks(nets.data || []);
      setJobs(js.data || []);
    } catch {
      toast.error('No se pudieron cargar los datos de descubrimiento');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); return () => { if (pollRef.current) clearInterval(pollRef.current); }; }, []);

  const refreshJobs = async () => {
    try { const js = await getScanJobs(); setJobs(js.data || []); } catch { /* ignore */ }
  };

  // -------------------------------------------------------------- Redes ----
  const openNewNet = () => { setEditingNet(null); setNetForm(emptyNet); setNetModal(true); };
  const openEditNet = (n: ScanNetwork) => {
    setEditingNet(n);
    setNetForm({ name: n.name, cidr: n.cidr, enabled: n.enabled, notes: n.notes || '' });
    setNetModal(true);
  };
  const saveNet = async () => {
    if (!netForm.name.trim() || !netForm.cidr.trim()) {
      toast.error('Nombre y rango (CIDR) son obligatorios');
      return;
    }
    setSavingNet(true);
    try {
      if (editingNet) { await updateScanNetwork(editingNet.id, netForm); toast.success('Red actualizada'); }
      else { await createScanNetwork(netForm); toast.success('Red creada'); }
      setNetModal(false);
      await load();
    } catch (e: any) {
      toast.error(e?.response?.data?.error || 'Error al guardar la red');
    } finally { setSavingNet(false); }
  };
  const removeNet = async (n: ScanNetwork) => {
    if (!window.confirm(`¿Eliminar la red "${n.name}" y todas sus credenciales?`)) return;
    try { await deleteScanNetwork(n.id); toast.success('Red eliminada'); await load(); }
    catch (e: any) { toast.error(e?.response?.data?.error || 'Error al eliminar'); }
  };

  // ------------------------------------------------------- Credenciales ----
  const openNewCred = (networkId: number) => { setCredFor(networkId); setEditingCred(null); setCredForm(emptyCred); };
  const openEditCred = (c: ScanCredential) => {
    setCredFor(c.network_id);
    setEditingCred(c);
    setCredForm({
      type: c.type, label: c.label || '', username: c.username || '',
      secret: '', port: c.port ? String(c.port) : '', priority: String(c.priority ?? 0),
    });
  };
  const cancelCred = () => { setCredFor(null); setEditingCred(null); setCredForm(emptyCred); };
  const saveCred = async () => {
    if (credFor == null) return;
    setSavingCred(true);
    const payload: any = {
      type: credForm.type,
      label: credForm.label.trim() || null,
      username: credForm.username.trim() || null,
      port: credForm.port ? parseInt(credForm.port) : undefined,
      priority: credForm.priority ? parseInt(credForm.priority) : 0,
    };
    if (credForm.secret) payload.secret = credForm.secret;
    try {
      if (editingCred) { await updateScanCredential(editingCred.id, payload); toast.success('Credencial actualizada'); }
      else { await createScanCredential(credFor, payload); toast.success('Credencial añadida'); }
      cancelCred();
      await load();
    } catch (e: any) {
      toast.error(e?.response?.data?.error || 'Error al guardar la credencial');
    } finally { setSavingCred(false); }
  };
  const removeCred = async (c: ScanCredential) => {
    if (!window.confirm('¿Eliminar esta credencial?')) return;
    try { await deleteScanCredential(c.id); toast.success('Credencial eliminada'); await load(); }
    catch (e: any) { toast.error(e?.response?.data?.error || 'Error al eliminar'); }
  };

  // ------------------------------------------------------------ Escaneo ----
  const startScan = async (n: ScanNetwork) => {
    if (!n.enabled) { toast.error('La red está desactivada'); return; }
    setScanning(n.id);
    try {
      const res = await runScan(n.id);
      const jobId = res.data?.job?.id;
      toast.success('Escaneo iniciado');
      await refreshJobs();
      if (jobId) openReview(jobId);
    } catch (e: any) {
      toast.error(e?.response?.data?.error || 'Error al iniciar el escaneo');
    } finally { setScanning(null); }
  };

  const buildRows = (results: ScanResult[]): ReviewRow[] =>
    results.map((r) => ({
      result_id: r.id,
      selected: !r.imported && !r.matched_asset_id,
      id: r.matched_asset_id || (r.hostname ? r.hostname.split('.')[0] : `NET-${r.ip}`),
      serial_number: r.serial_number || '',
      brand: r.brand || r.vendor || '',
      model: r.model || '',
      category: r.category || 'other',
      status: 'activo',
      assigned_to: '',
      department: '',
      price: '',
      notes: [r.os, r.open_ports ? `Puertos: ${r.open_ports}` : '', r.mac ? `MAC: ${r.mac}` : '']
        .filter(Boolean).join(' · '),
      ip: r.ip,
      hostname: r.hostname,
      os: r.os,
      open_ports: r.open_ports,
      attempts: (r.raw && Array.isArray((r.raw as any).attempts)) ? (r.raw as any).attempts as EnrichAttempt[] : [],
      enrich_method: r.enrich_method,
      matched_asset_id: r.matched_asset_id,
      imported: r.imported,
    }));

  const openReview = (jobId: number) => {
    setReviewJobId(jobId);
    setReviewJob(null);
    setRows([]);
    if (pollRef.current) clearInterval(pollRef.current);
    const tick = async () => {
      try {
        const res = await getScanJob(jobId);
        const job: ScanJob & { results: ScanResult[] } = res.data;
        setReviewJob(job);
        setRows(buildRows(job.results || []));
        if (job.status === 'completed' || job.status === 'failed') {
          if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
          refreshJobs();
        }
      } catch { /* ignore poll errors */ }
    };
    tick();
    pollRef.current = setInterval(tick, 3000);
  };

  const closeReview = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    setReviewJobId(null);
    setReviewJob(null);
    setRows([]);
  };

  const removeJob = async (jobId: number) => {
    if (!window.confirm('¿Eliminar este escaneo y sus resultados?')) return;
    try { await deleteScanJob(jobId); toast.success('Escaneo eliminado'); await refreshJobs(); }
    catch { toast.error('Error al eliminar el escaneo'); }
  };

  const setRow = (idx: number, patch: Partial<ReviewRow>) =>
    setRows((rs) => rs.map((r, i) => (i === idx ? { ...r, ...patch } : r)));

  const toggleAll = (checked: boolean) =>
    setRows((rs) => rs.map((r) => (r.imported ? r : { ...r, selected: checked })));

  const doImport = async () => {
    if (reviewJobId == null) return;
    const selected = rows.filter((r) => r.selected && !r.imported);
    if (selected.length === 0) { toast.error('Selecciona al menos un equipo'); return; }
    const invalid = selected.find((r) => !r.id.trim() || !r.serial_number.trim() || !r.brand.trim() || !r.model.trim());
    if (invalid) {
      toast.error(`Faltan campos obligatorios (ID, serie, marca o modelo) en ${invalid.ip}`);
      return;
    }
    setImporting(true);
    try {
      const items = selected.map((r) => ({
        result_id: r.result_id,
        id: r.id.trim(),
        serial_number: r.serial_number.trim(),
        brand: r.brand.trim(),
        model: r.model.trim(),
        category: r.category,
        status: r.status,
        assigned_to: r.assigned_to.trim() || undefined,
        department: r.department.trim() || undefined,
        price: r.price || undefined,
        notes: r.notes.trim() || undefined,
        ip: r.ip,
      }));
      const res = await importScanResults(reviewJobId, items);
      const { inserted, updated, errors } = res.data || {};
      toast.success(`Importados: ${inserted || 0} nuevos, ${updated || 0} actualizados`);
      if (errors && errors.length) toast.error(`${errors.length} con error. ${errors[0]}`);
      // Recarga los resultados para reflejar los ya importados.
      openReview(reviewJobId);
    } catch (e: any) {
      toast.error(e?.response?.data?.error || 'Error en la importación');
    } finally { setImporting(false); }
  };

  const meta = CRED_META[credForm.type];
  const selectedCount = rows.filter((r) => r.selected && !r.imported).length;
  const lastJobByNet: Record<number, ScanJob> = {};
  for (const j of jobs) if (!lastJobByNet[j.network_id]) lastJobByNet[j.network_id] = j;

  return (
    <div className="max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-600/20 border border-blue-500/30 flex items-center justify-center">
            <Radar className="w-5 h-5 text-blue-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">Descubrimiento de red</h1>
            <p className="text-sm text-gray-400">Escanea rangos de red e inventaria los equipos automáticamente.</p>
          </div>
        </div>
        <button
          onClick={openNewNet}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg transition-colors"
        >
          <Plus className="w-4 h-4" /> Nueva red
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20 text-gray-500">
          <Loader2 className="w-6 h-6 animate-spin" />
        </div>
      ) : networks.length === 0 ? (
        <div className="text-center py-16 border border-dashed border-gray-800 rounded-2xl">
          <Network className="w-10 h-10 text-gray-600 mx-auto mb-3" />
          <p className="text-gray-400 font-medium">No hay rangos de red configurados</p>
          <p className="text-gray-600 text-sm mt-1">Crea el primer rango para empezar el descubrimiento.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {networks.map((n) => {
            const lastJob = lastJobByNet[n.id];
            const isScanning = scanning === n.id || lastJob?.status === 'running';
            return (
              <div key={n.id} className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
                {/* Cabecera de la red */}
                <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-gray-800 flex-wrap">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-lg bg-gray-800 flex items-center justify-center flex-shrink-0">
                      <Network className="w-4 h-4 text-blue-400" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-semibold text-white truncate">{n.name}</p>
                        {n.enabled ? (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-green-500/10 text-green-400 border border-green-500/30">Activo</span>
                        ) : (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-gray-600/20 text-gray-400 border border-gray-600/40">Desactivado</span>
                        )}
                      </div>
                      <p className="text-xs text-gray-500 font-mono">{n.cidr}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => startScan(n)}
                      disabled={isScanning || !n.enabled}
                      className="flex items-center gap-2 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors"
                    >
                      {isScanning ? <Loader2 className="w-4 h-4 animate-spin" /> : <ScanLine className="w-4 h-4" />}
                      {isScanning ? 'Escaneando' : 'Escanear'}
                    </button>
                    <button onClick={() => openEditNet(n)} className="text-gray-500 hover:text-blue-400 transition-colors p-2" title="Editar red">
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button onClick={() => removeNet(n)} className="text-gray-500 hover:text-red-400 transition-colors p-2" title="Eliminar red">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Credenciales */}
                <div className="px-5 py-4">
                  {n.notes && <p className="text-sm text-gray-400 mb-3">{n.notes}</p>}
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs uppercase tracking-wider text-gray-500 font-medium flex items-center gap-1.5">
                      <KeyRound className="w-3.5 h-3.5" /> Credenciales
                    </p>
                    <button onClick={() => openNewCred(n.id)} className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1">
                      <Plus className="w-3.5 h-3.5" /> Añadir credencial
                    </button>
                  </div>

                  {n.credentials.length === 0 ? (
                    <p className="text-sm text-gray-600 py-2">Sin credenciales. Se probarán por orden de prioridad al escanear.</p>
                  ) : (
                    <div className="space-y-2">
                      {n.credentials.map((c) => {
                        const cm = CRED_META[c.type];
                        const Icon = cm.icon;
                        return (
                          <div key={c.id} className="flex items-center gap-3 bg-gray-800/50 border border-gray-800 rounded-lg px-3 py-2">
                            <span className={`text-xs px-2 py-0.5 rounded border flex items-center gap-1 ${cm.badge}`}>
                              <Icon className="w-3 h-3" /> {cm.label}
                            </span>
                            <div className="min-w-0 flex-1">
                              <p className="text-sm text-white truncate">
                                {c.label || cm.label}
                                {c.username ? <span className="text-gray-400"> · {c.username}</span> : null}
                              </p>
                              <p className="text-xs text-gray-500">
                                Puerto {c.port || cm.port} · Prioridad {c.priority}
                                {c.has_secret && <span className="inline-flex items-center gap-1 ml-2 text-gray-500"><Lock className="w-3 h-3" /> secreto guardado</span>}
                              </p>
                            </div>
                            <button onClick={() => openEditCred(c)} className="text-gray-500 hover:text-blue-400 transition-colors p-1" title="Editar">
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button onClick={() => removeCred(c)} className="text-gray-500 hover:text-red-400 transition-colors p-1" title="Eliminar">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Último escaneo */}
                  {lastJob && (
                    <div className="mt-3 flex items-center gap-2 text-xs text-gray-500">
                      <span>Último escaneo:</span>
                      <StatusBadge status={lastJob.status} />
                      {lastJob.status === 'completed' && (
                        <span>{lastJob.hosts_found} equipos · {lastJob.imported_count || 0} importados</span>
                      )}
                      <button onClick={() => openReview(lastJob.id)} className="text-blue-400 hover:text-blue-300 ml-1">
                        Ver resultados
                      </button>
                    </div>
                  )}

                  {/* Form inline de credencial */}
                  {credFor === n.id && (
                    <div className="mt-3 p-4 rounded-xl bg-gray-800/60 border border-gray-700">
                      <p className="text-sm font-medium text-white mb-3">{editingCred ? 'Editar credencial' : 'Nueva credencial'}</p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs text-gray-400 mb-1">Tipo</label>
                          <select value={credForm.type} onChange={(e) => setCredForm((f) => ({ ...f, type: e.target.value as CredType }))} className={inputCls}>
                            <option value="ssh">SSH (Linux/Unix)</option>
                            <option value="snmp">SNMP (red/impresoras)</option>
                            <option value="winrm">Windows (WMI / SMB / WinRM)</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs text-gray-400 mb-1">Etiqueta (opcional)</label>
                          <input type="text" value={credForm.label} onChange={(e) => setCredForm((f) => ({ ...f, label: e.target.value }))} placeholder="Ej. root servidores" className={inputCls} />
                        </div>
                        <div>
                          <label className="block text-xs text-gray-400 mb-1">{meta.userLabel}</label>
                          <input type="text" value={credForm.username} onChange={(e) => setCredForm((f) => ({ ...f, username: e.target.value }))} autoComplete="off" className={inputCls} />
                        </div>
                        <div>
                          <label className="block text-xs text-gray-400 mb-1">
                            {meta.secretLabel} {editingCred && <span className="text-gray-600">(dejar vacío para no cambiar)</span>}
                          </label>
                          <input type="password" value={credForm.secret} onChange={(e) => setCredForm((f) => ({ ...f, secret: e.target.value }))} autoComplete="new-password" className={inputCls} />
                        </div>
                        <div>
                          <label className="block text-xs text-gray-400 mb-1">Puerto</label>
                          <input type="number" value={credForm.port} onChange={(e) => setCredForm((f) => ({ ...f, port: e.target.value }))} placeholder={String(meta.port)} className={inputCls} />
                        </div>
                        <div>
                          <label className="block text-xs text-gray-400 mb-1">Prioridad (menor = se prueba antes)</label>
                          <input type="number" value={credForm.priority} onChange={(e) => setCredForm((f) => ({ ...f, priority: e.target.value }))} className={inputCls} />
                        </div>
                      </div>
                      <div className="flex items-center justify-end gap-2 mt-3">
                        <button onClick={cancelCred} className="px-3 py-1.5 text-sm text-gray-400 hover:text-white transition-colors">Cancelar</button>
                        <button onClick={saveCred} disabled={savingCred} className="flex items-center gap-2 px-4 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white text-sm font-medium rounded-lg transition-colors">
                          {savingCred ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Guardar
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Historial de escaneos */}
      {jobs.length > 0 && (
        <div className="mt-8">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm uppercase tracking-wider text-gray-500 font-medium flex items-center gap-1.5">
              <Clock className="w-4 h-4" /> Historial de escaneos
            </h2>
            <button onClick={refreshJobs} className="text-xs text-gray-400 hover:text-white flex items-center gap-1">
              <RefreshCw className="w-3.5 h-3.5" /> Actualizar
            </button>
          </div>
          <div className="space-y-2">
            {jobs.map((j) => (
              <div key={j.id} className="flex items-center gap-3 bg-gray-900 border border-gray-800 rounded-lg px-4 py-2.5 flex-wrap">
                <StatusBadge status={j.status} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-white truncate">{j.network_name || 'Red'} <span className="text-gray-500 font-mono text-xs">{j.cidr}</span></p>
                  <p className="text-xs text-gray-500">
                    {j.status === 'failed' && j.error ? <span className="text-red-400">{j.error}</span> :
                      `${j.hosts_found} equipos · ${j.imported_count || 0} importados`}
                    {j.started_at && <span> · {new Date(j.started_at).toLocaleString('es-ES')}</span>}
                  </p>
                </div>
                <button onClick={() => openReview(j.id)} className="text-xs text-blue-400 hover:text-blue-300 px-2 py-1">Ver</button>
                <button onClick={() => removeJob(j.id)} className="text-gray-500 hover:text-red-400 transition-colors p-1" title="Eliminar">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Modal de red */}
      {netModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-lg shadow-2xl">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
              <h2 className="text-lg font-semibold text-white">{editingNet ? 'Editar red' : 'Nueva red'}</h2>
              <button onClick={() => setNetModal(false)} className="text-gray-400 hover:text-white transition-colors"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm text-gray-400 mb-1">Nombre *</label>
                <input type="text" value={netForm.name} onChange={(e) => setNetForm((f) => ({ ...f, name: e.target.value }))} placeholder="Ej. Oficina planta 1" className={inputCls} />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Rango de red (CIDR) *</label>
                <input type="text" value={netForm.cidr} onChange={(e) => setNetForm((f) => ({ ...f, cidr: e.target.value }))} placeholder="192.168.1.0/24" className={inputCls + ' font-mono'} />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Notas (opcional)</label>
                <textarea value={netForm.notes} rows={2} onChange={(e) => setNetForm((f) => ({ ...f, notes: e.target.value }))} className={inputCls + ' resize-none'} />
              </div>
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <button type="button" role="switch" aria-checked={netForm.enabled} onClick={() => setNetForm((f) => ({ ...f, enabled: !f.enabled }))} className={`relative inline-flex items-center shrink-0 w-11 h-6 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500/40 ${netForm.enabled ? 'bg-blue-600' : 'bg-gray-600'}`}>
                  <span className={`inline-block w-5 h-5 rounded-full bg-white shadow transform transition-transform ${netForm.enabled ? 'translate-x-[22px]' : 'translate-x-0.5'}`} />
                </button>
                <span className="text-sm text-gray-300 flex items-center gap-1"><Power className="w-3.5 h-3.5" /> Red activa para escaneo</span>
              </label>
            </div>
            <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-gray-800">
              <button onClick={() => setNetModal(false)} className="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors">Cancelar</button>
              <button onClick={saveNet} disabled={savingNet} className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white text-sm font-medium rounded-lg transition-colors">
                {savingNet ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Guardar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de revision e importacion */}
      {reviewJobId != null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-6xl max-h-[90vh] shadow-2xl flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
              <div className="flex items-center gap-3">
                <Cpu className="w-5 h-5 text-blue-400" />
                <div>
                  <h2 className="text-lg font-semibold text-white">Resultados del escaneo</h2>
                  {reviewJob && (
                    <p className="text-xs text-gray-500">
                      {reviewJob.network_name} <span className="font-mono">{reviewJob.cidr}</span> · <StatusBadge status={reviewJob.status} inline />
                    </p>
                  )}
                </div>
              </div>
              <button onClick={closeReview} className="text-gray-400 hover:text-white transition-colors"><X className="w-5 h-5" /></button>
            </div>

            <div className="flex-1 overflow-auto p-4">
              {!reviewJob || (reviewJob.status === 'running' && rows.length === 0) ? (
                <div className="flex flex-col items-center justify-center py-20 text-gray-500">
                  <Loader2 className="w-8 h-8 animate-spin mb-3" />
                  <p>Escaneando la red… esto puede tardar varios minutos.</p>
                </div>
              ) : reviewJob.status === 'failed' ? (
                <div className="flex flex-col items-center justify-center py-20 text-center">
                  <AlertTriangle className="w-8 h-8 text-red-400 mb-3" />
                  <p className="text-red-400 font-medium">El escaneo ha fallado</p>
                  <p className="text-gray-500 text-sm mt-1 max-w-md">{reviewJob.error}</p>
                </div>
              ) : rows.length === 0 ? (
                <div className="text-center py-20 text-gray-500">No se han encontrado equipos en este rango.</div>
              ) : (
                <>
                  {reviewJob.status === 'running' && (
                    <div className="flex items-center gap-2 text-xs text-blue-400 mb-3">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" /> Escaneo en curso, los resultados se actualizan automáticamente…
                    </div>
                  )}
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-xs text-gray-500 border-b border-gray-800">
                        <th className="p-2 w-8">
                          <input type="checkbox"
                            onChange={(e) => toggleAll(e.target.checked)}
                            checked={rows.length > 0 && rows.filter((r) => !r.imported).every((r) => r.selected)}
                          />
                        </th>
                        <th className="p-2 text-left">Equipo</th>
                        <th className="p-2 text-left">ID interno *</th>
                        <th className="p-2 text-left">Nº serie *</th>
                        <th className="p-2 text-left">Marca *</th>
                        <th className="p-2 text-left">Modelo *</th>
                        <th className="p-2 text-left">Categoría</th>
                        <th className="p-2 text-left">Estado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r, idx) => (
                        <tr key={r.result_id} className={`border-b border-gray-800/50 ${r.imported ? 'opacity-50' : ''}`}>
                          <td className="p-2 align-top pt-3">
                            <input type="checkbox" disabled={r.imported} checked={r.selected}
                              onChange={(e) => setRow(idx, { selected: e.target.checked })} />
                          </td>
                          <td className="p-2 align-top">
                            <div className="min-w-[150px]">
                              <p className="text-white font-mono text-xs">{r.ip}</p>
                              {r.hostname && <p className="text-gray-400 text-xs truncate">{r.hostname}</p>}
                              <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                                {r.enrich_method && (
                                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 text-gray-400 border border-gray-700">{r.enrich_method.toUpperCase()}</span>
                                )}
                                {r.matched_asset_id && (
                                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-yellow-500/10 text-yellow-400 border border-yellow-500/30">ya inventariado</span>
                                )}
                                {r.imported && (
                                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-500/10 text-green-400 border border-green-500/30">importado</span>
                                )}
                              </div>
                              {r.os && <p className="text-gray-600 text-[10px] mt-0.5 truncate" title={r.os}>{r.os}</p>}
                              {r.open_ports && (
                                <p className="text-gray-600 text-[10px] mt-0.5 truncate" title={`Puertos abiertos: ${r.open_ports}`}>
                                  <span className="text-gray-500">puertos:</span> {r.open_ports}
                                </p>
                              )}
                              {Array.isArray(r.attempts) && r.attempts.length > 0 && (
                                <div className="mt-1 space-y-0.5">
                                  {r.attempts.map((a, i) => (
                                    <p key={i}
                                       className={`text-[10px] truncate ${a.ok ? 'text-green-400' : 'text-red-400/80'}`}
                                       title={`${a.method}${a.cred && a.cred !== '-' ? ' (' + a.cred + ')' : ''}: ${a.ok ? 'OK' : (a.error || 'fallo')}`}>
                                      <span className="font-mono">{a.ok ? '✓' : '✗'}</span> {a.method}{a.cred && a.cred !== '-' ? ` · ${a.cred}` : ''}{!a.ok && a.error ? ` — ${a.error}` : ''}
                                    </p>
                                  ))}
                                </div>
                              )}
                            </div>
                          </td>
                          <td className="p-2 align-top"><input className={cellCls} value={r.id} disabled={r.imported} onChange={(e) => setRow(idx, { id: e.target.value })} /></td>
                          <td className="p-2 align-top"><input className={cellCls} value={r.serial_number} disabled={r.imported} onChange={(e) => setRow(idx, { serial_number: e.target.value })} /></td>
                          <td className="p-2 align-top"><input className={cellCls} value={r.brand} disabled={r.imported} onChange={(e) => setRow(idx, { brand: e.target.value })} /></td>
                          <td className="p-2 align-top"><input className={cellCls} value={r.model} disabled={r.imported} onChange={(e) => setRow(idx, { model: e.target.value })} /></td>
                          <td className="p-2 align-top">
                            <select className={cellCls} value={r.category} disabled={r.imported} onChange={(e) => setRow(idx, { category: e.target.value })}>
                              {categories.length === 0 && <option value="other">other</option>}
                              {categories.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                            </select>
                          </td>
                          <td className="p-2 align-top">
                            <select className={cellCls} value={r.status} disabled={r.imported} onChange={(e) => setRow(idx, { status: e.target.value })}>
                              <option value="activo">Activo</option>
                              <option value="inactivo">Inactivo</option>
                              <option value="reparacion">Reparación</option>
                              <option value="baja">Baja</option>
                            </select>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}
            </div>

            <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-gray-800 flex-wrap">
              <p className="text-sm text-gray-400">
                {selectedCount > 0 ? <span><span className="text-white font-medium">{selectedCount}</span> seleccionados para importar</span> : 'Selecciona los equipos a inventariar'}
              </p>
              <div className="flex items-center gap-2">
                <button onClick={closeReview} className="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors">Cerrar</button>
                <button onClick={doImport} disabled={importing || selectedCount === 0}
                  className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors">
                  {importing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                  Importar seleccionados
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status, inline }: { status: string; inline?: boolean }) {
  const m = STATUS_META[status] || STATUS_META.pending;
  const Icon = m.icon;
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full border inline-flex items-center gap-1 ${m.cls} ${inline ? '' : ''}`}>
      <Icon className={`w-3 h-3 ${status === 'running' ? 'animate-spin' : ''}`} /> {m.label}
    </span>
  );
}
