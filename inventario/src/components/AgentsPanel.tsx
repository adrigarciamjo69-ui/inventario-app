import { useEffect, useState } from 'react';
import { Cpu, RefreshCw, Copy, RotateCcw, Trash2, Link2, Unlink, Power, PowerOff, Download, Terminal as TerminalIcon, Upload, FileCheck2 } from 'lucide-react';
import toast from 'react-hot-toast';
import {
  getAgentConfig, rotateAgentEnrollKey, listAgents,
  linkAgent, unlinkAgent, disableAgent, enableAgent, deleteAgent,
  getAssets,
  listAgentBinaries, uploadAgentBinary, deleteAgentBinary,
} from '../api/client';

type BinaryInfo = { filename: string; size: number; uploaded_at: string; url: string } | null;

type AgentDevice = {
  id: number;
  machine_id: string;
  hostname: string | null;
  os: string | null;
  os_version: string | null;
  agent_version: string | null;
  status: 'active' | 'disabled';
  last_ip: string | null;
  last_seen: string | null;
  first_seen: string;
  asset_id: string | null;
};

type AssetLite = { id: string; name?: string; brand?: string; model?: string };

function fmtDate(d: string | null): string {
  if (!d) return '—';
  return new Date(d).toLocaleString('es-ES');
}

function OsBadge({ os }: { os: string | null }) {
  const label = os === 'windows' ? 'Windows' : os === 'linux' ? 'Linux' : os === 'darwin' ? 'macOS' : '—';
  const color = os === 'windows' ? 'bg-blue-500/15 text-blue-300 border-blue-500/30'
              : os === 'linux'   ? 'bg-orange-500/15 text-orange-300 border-orange-500/30'
              : os === 'darwin'  ? 'bg-gray-500/15 text-gray-300 border-gray-500/30'
              : 'bg-gray-700/30 text-gray-400 border-gray-700';
  return <span className={`px-2 py-0.5 rounded text-xs border ${color}`}>{label}</span>;
}

export default function AgentsPanel() {
  const [loading, setLoading] = useState(true);
  const [enrollKey, setEnrollKey] = useState('');
  const [agents, setAgents] = useState<AgentDevice[]>([]);
  const [assets, setAssets] = useState<AssetLite[]>([]);
  const [linkingId, setLinkingId] = useState<number | null>(null);
  const [linkValue, setLinkValue] = useState('');
  const [binaries, setBinaries] = useState<Record<string, BinaryInfo>>({});
  const [uploading, setUploading] = useState<string | null>(null);
  const [downloadOs, setDownloadOs] = useState<'windows' | 'linux' | 'darwin'>(() => {
    const ua = navigator.userAgent.toLowerCase();
    if (ua.includes('win')) return 'windows';
    if (ua.includes('mac')) return 'darwin';
    return 'linux';
  });

  function downloadInstaller(os: string) {
    // El endpoint /api/agent/download/:os es publico y dispara la descarga
    // con Content-Disposition: attachment, asi que basta con navegar a el.
    const a = document.createElement('a');
    a.href = `${serverUrl}/api/agent/download/${os}`;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  const serverUrl = `${window.location.origin}`;

  async function refreshBinaries() {
    try {
      const r = await listAgentBinaries();
      setBinaries(r.data || {});
    } catch (_) { /* silencioso */ }
  }

  async function handleUpload(os: string, file: File | null) {
    if (!file) return;
    setUploading(os);
    try {
      await uploadAgentBinary(os, file);
      toast.success(`Binario ${os} subido (${(file.size / 1024 / 1024).toFixed(1)} MB)`);
      await refreshBinaries();
    } catch (e: any) {
      // Extraer el mejor mensaje disponible:
      // 1) JSON con {error: ...}
      // 2) cuerpo de texto plano (HTML de nginx / express por defecto)
      // 3) status + statusText
      // 4) mensaje del propio Error de axios
      const status = e?.response?.status;
      const data = e?.response?.data;
      let detail: string | undefined;
      if (data && typeof data === 'object' && data.error) detail = String(data.error);
      else if (typeof data === 'string' && data.trim()) {
        // recorta HTML largo a algo legible
        detail = data.length > 220 ? data.slice(0, 220) + '…' : data;
      } else if (e?.response?.statusText) detail = e.response.statusText;
      else if (e?.message) detail = e.message;

      const prefix = status ? `HTTP ${status} — ` : '';
      const msg = `${prefix}${detail || 'Error subiendo binario'}`;
      console.error('[upload binario]', os, status, data || e);
      toast.error(msg, { duration: 8000, style: { maxWidth: 520 } });
    } finally {
      setUploading(null);
    }
  }

  async function handleDeleteBinary(os: string) {
    if (!confirm(`¿Borrar el binario subido para ${os}?`)) return;
    try {
      await deleteAgentBinary(os);
      toast.success('Binario eliminado');
      await refreshBinaries();
    } catch (e: any) {
      toast.error(e?.response?.data?.error || 'Error borrando binario');
    }
  }

  async function refresh() {
    setLoading(true);
    try {
      const [cfg, list, allAssets] = await Promise.all([
        getAgentConfig(),
        listAgents(),
        getAssets(),
      ]);
      setEnrollKey(cfg.data.enroll_key || '');
      setAgents(list.data || []);
      setAssets((allAssets.data || []).map((a: any) => ({
        id: a.id, name: a.name || a.hostname, brand: a.brand, model: a.model
      })));
    } catch (e: any) {
      toast.error(e?.response?.data?.error || 'Error cargando agentes');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { refresh(); refreshBinaries(); }, []);

  function copy(text: string, label: string) {
    navigator.clipboard.writeText(text).then(
      () => toast.success(`${label} copiado`),
      () => toast.error('No se pudo copiar')
    );
  }

  async function rotateKey() {
    if (!confirm('Al rotar la clave, los nuevos enrolamientos exigiran la clave nueva.\nLos agentes ya enrolados siguen funcionando.\n\n¿Rotar la enroll_key?')) return;
    try {
      const r = await rotateAgentEnrollKey();
      setEnrollKey(r.data.enroll_key);
      toast.success('Clave rotada');
    } catch (e: any) {
      toast.error(e?.response?.data?.error || 'Error rotando la clave');
    }
  }

  async function doLink(id: number) {
    if (!linkValue.trim()) return;
    try {
      await linkAgent(id, linkValue.trim());
      toast.success('Agente vinculado');
      setLinkingId(null); setLinkValue('');
      refresh();
    } catch (e: any) {
      toast.error(e?.response?.data?.error || 'Error al vincular');
    }
  }
  async function doUnlink(id: number) {
    try { await unlinkAgent(id); toast.success('Desvinculado'); refresh(); }
    catch (e: any) { toast.error(e?.response?.data?.error || 'Error'); }
  }
  async function doToggle(a: AgentDevice) {
    try {
      if (a.status === 'active') await disableAgent(a.id);
      else await enableAgent(a.id);
      refresh();
    } catch (e: any) { toast.error(e?.response?.data?.error || 'Error'); }
  }
  async function doDelete(id: number) {
    if (!confirm('Borrar este agente? El equipo tendra que re-enrolarse.')) return;
    try { await deleteAgent(id); toast.success('Borrado'); refresh(); }
    catch (e: any) { toast.error(e?.response?.data?.error || 'Error'); }
  }

  if (loading) {
    return <div className="flex items-center justify-center h-60">
      <div className="w-7 h-7 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />
    </div>;
  }

  const winInstall = `# PowerShell (admin)\n$Url = "${serverUrl}"\n$Key = "${enrollKey}"\nNew-Item -ItemType Directory -Force -Path "C:\\ProgramData\\inventario-agent" | Out-Null\nInvoke-WebRequest -Uri "$Url/api/agent/download/windows" -OutFile "C:\\ProgramData\\inventario-agent\\inventario-agent.exe"\n& "C:\\ProgramData\\inventario-agent\\inventario-agent.exe" enroll --server $Url --key $Key\nNew-Service -Name "InventarioAgent" -BinaryPathName "C:\\ProgramData\\inventario-agent\\inventario-agent.exe run" -StartupType Automatic\nStart-Service InventarioAgent`;

  const linuxInstall = `# bash (root)\ncurl -fsSL ${serverUrl}/api/agent/download/linux -o /usr/local/bin/inventario-agent\nchmod +x /usr/local/bin/inventario-agent\n/usr/local/bin/inventario-agent enroll --server ${serverUrl} --key ${enrollKey}\ncat >/etc/systemd/system/inventario-agent.service <<'EOF'\n[Unit]\nDescription=Inventario Agent\nAfter=network-online.target\n\n[Service]\nExecStart=/usr/local/bin/inventario-agent run\nRestart=always\nUser=root\n\n[Install]\nWantedBy=multi-user.target\nEOF\nsystemctl daemon-reload && systemctl enable --now inventario-agent`;

  const macInstall = `# bash (sudo)\nsudo curl -fsSL ${serverUrl}/api/agent/download/darwin -o /usr/local/bin/inventario-agent\nsudo chmod +x /usr/local/bin/inventario-agent\nsudo /usr/local/bin/inventario-agent enroll --server ${serverUrl} --key ${enrollKey}\nsudo tee /Library/LaunchDaemons/com.electrans.inventario-agent.plist >/dev/null <<'EOF'\n<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>\n  <key>Label</key><string>com.electrans.inventario-agent</string>\n  <key>ProgramArguments</key><array>\n    <string>/usr/local/bin/inventario-agent</string><string>run</string>\n  </array>\n  <key>KeepAlive</key><true/><key>RunAtLoad</key><true/>\n</dict></plist>\nEOF\nsudo launchctl load /Library/LaunchDaemons/com.electrans.inventario-agent.plist`;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-white flex items-center gap-2"><Cpu className="w-6 h-6 text-blue-400" /> Agentes endpoint</h2>
          <p className="text-gray-400 text-sm mt-1">Recogen system info + software sin necesitar credenciales. Funcionan en LAN y fuera de ella (telework).</p>
        </div>
        <button onClick={refresh} className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-200 rounded text-sm flex items-center gap-1.5">
          <RefreshCw className="w-4 h-4" /> Recargar
        </button>
      </div>

      {/* Enroll key card */}
      <div className="bg-gray-900/50 border border-gray-800 rounded-xl p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-white font-medium">Clave de enrolamiento</h3>
          <button onClick={rotateKey} className="text-xs px-2.5 py-1 bg-orange-500/15 hover:bg-orange-500/25 text-orange-300 border border-orange-500/30 rounded flex items-center gap-1.5">
            <RotateCcw className="w-3.5 h-3.5" /> Rotar
          </button>
        </div>
        <div className="flex items-center gap-2">
          <code className="flex-1 px-3 py-2 bg-black/40 border border-gray-800 rounded text-sm text-blue-300 font-mono break-all">{enrollKey}</code>
          <button onClick={() => copy(enrollKey, 'Clave')} className="px-3 py-2 bg-gray-800 hover:bg-gray-700 text-gray-200 rounded"><Copy className="w-4 h-4" /></button>
        </div>
        <p className="text-gray-500 text-xs">Esta clave permite que un equipo se de de alta una sola vez; el backend devuelve un token permanente unico para ese equipo.</p>
      </div>

      {/* Binarios subidos */}
      <div className="bg-gray-900/50 border border-gray-800 rounded-xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-white font-medium flex items-center gap-2"><Upload className="w-4 h-4" /> Binarios del agente</h3>
          <button onClick={refreshBinaries} className="text-xs px-2 py-0.5 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded flex items-center gap-1"><RefreshCw className="w-3 h-3" /> Refrescar</button>
        </div>
        <p className="text-gray-500 text-xs">Sube aquí los binarios compilados con <code className="text-gray-300">go build</code> (uno por SO). Los comandos de instalación los descargan desde <code className="text-blue-300">/api/agent/download/&lt;so&gt;</code>.</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {([['windows', 'Windows .exe'], ['linux', 'Linux'], ['darwin', 'macOS']] as const).map(([os, label]) => {
            const bin = binaries[os];
            return (
              <div key={os} className="border border-gray-800 rounded-lg p-3 space-y-2 bg-black/20">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2"><OsBadge os={os} /><span className="text-gray-200 text-sm">{label}</span></div>
                  {bin && <FileCheck2 className="w-4 h-4 text-green-400" />}
                </div>
                {bin ? (
                  <div className="text-xs space-y-0.5">
                    <div className="text-gray-400">{(bin.size / 1024 / 1024).toFixed(2)} MB</div>
                    <div className="text-gray-500">Subido: {fmtDate(bin.uploaded_at)}</div>
                  </div>
                ) : (
                  <div className="text-xs text-orange-400">Sin binario subido</div>
                )}
                <div className="flex gap-2">
                  <label className="flex-1 cursor-pointer text-center text-xs px-2 py-1.5 bg-blue-500/15 hover:bg-blue-500/25 text-blue-300 border border-blue-500/30 rounded flex items-center justify-center gap-1">
                    <Upload className="w-3 h-3" /> {uploading === os ? 'Subiendo…' : (bin ? 'Reemplazar' : 'Subir')}
                    <input type="file" className="hidden" disabled={uploading === os}
                      onChange={(e) => handleUpload(os, e.target.files?.[0] || null)} />
                  </label>
                  {bin && (
                    <button onClick={() => handleDeleteBinary(os)} className="text-xs px-2 py-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-300 border border-red-500/30 rounded"><Trash2 className="w-3 h-3" /></button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Descarga directa del instalador */}
      <div className="bg-gray-900/50 border border-gray-800 rounded-xl p-5 space-y-4">
        <h3 className="text-white font-medium flex items-center gap-2"><Download className="w-4 h-4" /> Descargar instalador</h3>
        <p className="text-gray-400 text-sm">Selecciona el sistema operativo del equipo donde vas a instalar el agente. El navegador descargara el binario; lanzalo desde el equipo destino con el comando <code className="text-blue-300">enroll</code> y la clave de mas arriba.</p>
        <div className="flex flex-col md:flex-row gap-3 items-stretch md:items-end">
          <div className="flex-1">
            <label className="text-xs text-gray-500 block mb-1">Sistema operativo</label>
            <div className="grid grid-cols-3 gap-2">
              {([['windows', 'Windows'], ['linux', 'Linux'], ['darwin', 'macOS']] as const).map(([os, label]) => {
                const active = downloadOs === os;
                const has = !!binaries[os];
                return (
                  <button key={os} onClick={() => setDownloadOs(os)}
                    className={`px-3 py-3 rounded-lg border text-sm flex flex-col items-center gap-1 transition-colors ${active
                      ? 'bg-blue-500/15 border-blue-500/50 text-blue-200'
                      : 'bg-gray-800/40 border-gray-700 text-gray-300 hover:border-gray-600'}`}>
                    <span className="font-medium">{label}</span>
                    {has
                      ? <span className="text-[10px] text-green-400 flex items-center gap-1"><FileCheck2 className="w-3 h-3" /> Disponible</span>
                      : <span className="text-[10px] text-orange-400">Sin binario</span>}
                  </button>
                );
              })}
            </div>
          </div>
          <button onClick={() => downloadInstaller(downloadOs)} disabled={!binaries[downloadOs]}
            className={`px-5 py-3 rounded-lg flex items-center justify-center gap-2 text-sm font-medium border transition-colors ${binaries[downloadOs]
              ? 'bg-blue-500 hover:bg-blue-600 text-white border-blue-500'
              : 'bg-gray-800 text-gray-500 border-gray-700 cursor-not-allowed'}`}>
            <Download className="w-4 h-4" /> Descargar para {downloadOs === 'windows' ? 'Windows' : downloadOs === 'darwin' ? 'macOS' : 'Linux'}
          </button>
        </div>
        {!binaries[downloadOs] && (
          <p className="text-xs text-orange-400">No hay binario para este SO. Subelo desde la seccion superior antes de descargar.</p>
        )}
        <div className="text-xs text-gray-500 border-t border-gray-800 pt-3">
          <div className="mb-1">Tras descargar:</div>
          {downloadOs === 'windows' && (
            <ol className="list-decimal pl-5 space-y-0.5">
              <li>Copia el .exe al equipo (p. ej. <code className="text-gray-300">C:\ProgramData\inventario-agent\inventario-agent.exe</code>).</li>
              <li>Abre PowerShell como administrador.</li>
              <li>Ejecuta: <code className="text-gray-300">.\inventario-agent.exe enroll --server {serverUrl} --key {enrollKey}</code></li>
              <li>Registra el servicio con <code className="text-gray-300">New-Service</code> (ver bloque de abajo).</li>
            </ol>
          )}
          {downloadOs === 'linux' && (
            <ol className="list-decimal pl-5 space-y-0.5">
              <li>Copia el binario a <code className="text-gray-300">/usr/local/bin/inventario-agent</code> y dale permisos: <code className="text-gray-300">chmod +x</code>.</li>
              <li>Ejecuta como root: <code className="text-gray-300">/usr/local/bin/inventario-agent enroll --server {serverUrl} --key {enrollKey}</code></li>
              <li>Instala el servicio systemd (ver bloque de abajo).</li>
            </ol>
          )}
          {downloadOs === 'darwin' && (
            <ol className="list-decimal pl-5 space-y-0.5">
              <li>Copia el binario a <code className="text-gray-300">/usr/local/bin/inventario-agent</code> y dale permisos: <code className="text-gray-300">chmod +x</code>.</li>
              <li>Ejecuta con sudo: <code className="text-gray-300">inventario-agent enroll --server {serverUrl} --key {enrollKey}</code></li>
              <li>Carga el LaunchDaemon (ver bloque de abajo).</li>
            </ol>
          )}
        </div>
      </div>

      {/* Comandos completos (one-liner) */}
      <div className="bg-gray-900/50 border border-gray-800 rounded-xl p-5 space-y-4">
        <h3 className="text-white font-medium flex items-center gap-2"><TerminalIcon className="w-4 h-4" /> Instalacion automatica (one-liner)</h3>
        <p className="text-gray-400 text-sm">Servidor: <code className="text-blue-300">{serverUrl}</code></p>
        {([['Windows', winInstall], ['Linux', linuxInstall], ['macOS', macInstall]] as const).map(([os, cmd]) => (
          <div key={os}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm text-gray-300 font-medium flex items-center gap-1.5"><TerminalIcon className="w-3.5 h-3.5" />{os}</span>
              <button onClick={() => copy(cmd, os)} className="text-xs px-2 py-0.5 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded flex items-center gap-1"><Copy className="w-3 h-3" /> Copiar</button>
            </div>
            <pre className="bg-black/40 border border-gray-800 rounded p-3 text-xs text-gray-300 overflow-x-auto">{cmd}</pre>
          </div>
        ))}
      </div>

      {/* Agents table */}
      <div className="bg-gray-900/50 border border-gray-800 rounded-xl overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-800 flex items-center justify-between">
          <h3 className="text-white font-medium">Agentes registrados ({agents.length})</h3>
        </div>
        {!agents.length ? (
          <div className="p-8 text-center text-gray-500 text-sm">
            Aun no hay equipos enrolados. Instala el agente en el primer equipo siguiendo los comandos de arriba.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-800/40 text-gray-300">
                <tr>
                  <th className="text-left px-3 py-2">Equipo</th>
                  <th className="text-left px-3 py-2">SO</th>
                  <th className="text-left px-3 py-2">Vinculado a</th>
                  <th className="text-left px-3 py-2">Ultimo checkin</th>
                  <th className="text-left px-3 py-2">IP</th>
                  <th className="text-left px-3 py-2">Estado</th>
                  <th className="text-right px-3 py-2">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {agents.map(a => (
                  <tr key={a.id} className="hover:bg-gray-800/30">
                    <td className="px-3 py-2">
                      <div className="text-gray-100">{a.hostname || '—'}</div>
                      <div className="text-gray-500 text-xs font-mono">{a.machine_id.slice(0, 12)}…</div>
                    </td>
                    <td className="px-3 py-2">
                      <OsBadge os={a.os} />
                      {a.os_version && <div className="text-gray-500 text-xs mt-0.5">{a.os_version}</div>}
                    </td>
                    <td className="px-3 py-2">
                      {a.asset_id
                        ? <span className="text-blue-300">{a.asset_id}</span>
                        : linkingId === a.id
                          ? <div className="flex gap-1">
                              <input value={linkValue} onChange={e => setLinkValue(e.target.value)} placeholder="ID activo" className="px-2 py-1 bg-gray-800 border border-gray-700 rounded text-xs text-gray-100 w-28" list={`assets-${a.id}`} />
                              <datalist id={`assets-${a.id}`}>
                                {assets.map(x => <option key={x.id} value={x.id}>{x.brand} {x.model}</option>)}
                              </datalist>
                              <button onClick={() => doLink(a.id)} className="px-2 py-1 bg-green-600 hover:bg-green-500 text-white rounded text-xs">OK</button>
                              <button onClick={() => { setLinkingId(null); setLinkValue(''); }} className="px-2 py-1 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded text-xs">X</button>
                            </div>
                          : <button onClick={() => { setLinkingId(a.id); setLinkValue(''); }} className="text-gray-500 hover:text-blue-300 text-xs flex items-center gap-1"><Link2 className="w-3 h-3" /> vincular</button>
                      }
                    </td>
                    <td className="px-3 py-2 text-gray-400">{fmtDate(a.last_seen)}</td>
                    <td className="px-3 py-2 text-gray-400 font-mono text-xs">{a.last_ip || '—'}</td>
                    <td className="px-3 py-2">
                      <span className={`px-2 py-0.5 rounded text-xs ${a.status === 'active' ? 'bg-green-500/15 text-green-300 border border-green-500/30' : 'bg-gray-600/30 text-gray-400 border border-gray-700'}`}>
                        {a.status === 'active' ? 'Activo' : 'Deshabilitado'}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="inline-flex gap-1">
                        {a.asset_id && (
                          <button onClick={() => doUnlink(a.id)} title="Desvincular" className="p-1.5 text-gray-400 hover:text-orange-300 hover:bg-orange-500/10 rounded"><Unlink className="w-3.5 h-3.5" /></button>
                        )}
                        <button onClick={() => doToggle(a)} title={a.status === 'active' ? 'Deshabilitar' : 'Habilitar'} className="p-1.5 text-gray-400 hover:text-yellow-300 hover:bg-yellow-500/10 rounded">
                          {a.status === 'active' ? <PowerOff className="w-3.5 h-3.5" /> : <Power className="w-3.5 h-3.5" />}
                        </button>
                        <button onClick={() => doDelete(a.id)} title="Borrar" className="p-1.5 text-gray-400 hover:text-red-300 hover:bg-red-500/10 rounded"><Trash2 className="w-3.5 h-3.5" /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
