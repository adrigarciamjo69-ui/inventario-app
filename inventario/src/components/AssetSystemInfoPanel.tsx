import { useEffect, useState } from 'react';
import {
  Cpu, HardDrive, MemoryStick, Network, Monitor, Volume2, Server,
  Shield, Building2, Save, RefreshCw, Info, User, Calendar,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { getAssetInfo, updateAssetInfo } from '../api/client';

// Tipos del bloque scanned_data (espejo del JSON que devuelve wmi_query.py).
// Todos los campos son opcionales: distintos enriquecedores (WMI/SSH/SNMP/SMB)
// rellenan partes diferentes.
interface SysOS {
  name?: string; version?: string; build?: string; architecture?: string;
  install_date?: string; last_boot?: string; language?: string; locale?: string;
}
interface SysCPU { name?: string; cores?: number; threads?: number; speed_mhz?: number; manufacturer?: string; }
interface SysMemModule { capacity_gb?: number; speed?: number; manufacturer?: string; part_number?: string; slot?: string; }
interface SysMemory { total_gb?: number; modules?: SysMemModule[]; }
interface SysMobo { manufacturer?: string; product?: string; serial?: string; }
interface SysBIOS { vendor?: string; version?: string; release_date?: string; serial?: string; }
interface SysGPU { name?: string; driver_version?: string; ram_mb?: number; }
interface SysAudio { name?: string; manufacturer?: string; }
interface SysDiskP { model?: string; size_gb?: number; interface?: string; serial?: string; }
interface SysDiskL { drive?: string; filesystem?: string; size_gb?: number; free_gb?: number; }
interface SysHardware {
  manufacturer?: string; model?: string; sku?: string; system_type?: string; system_family?: string;
  cpu?: SysCPU[]; memory?: SysMemory; motherboard?: SysMobo; bios?: SysBIOS;
  graphics?: SysGPU[]; audio?: SysAudio[];
  disks_physical?: SysDiskP[]; disks_logical?: SysDiskL[];
}
interface SysNetAdapter { description?: string; mac?: string; ip?: string; gateway?: string; dns?: string; dhcp?: boolean; }
interface SysAD { domain?: string; workgroup?: string; part_of_domain?: boolean; domain_role?: string; }
export interface ScannedSystemData {
  os?: SysOS; hardware?: SysHardware; network?: SysNetAdapter[]; ad?: SysAD; last_user?: string;
}

interface AssetInfo {
  asset_id: string;
  scanned_data: ScannedSystemData | null;
  manual_notes: string;
  scanned_at: string | null;
  source: string | null;
  updated_at: string | null;
}

// -- helpers de UI -----------------------------------------------------------
const lbl = 'text-xs font-medium text-gray-500 uppercase tracking-wide';
const val = 'text-sm text-gray-200';

function Row({ label, value }: { label: string; value?: React.ReactNode }) {
  if (value === undefined || value === null || value === '' || value === 0) return null;
  return (
    <div className="grid grid-cols-[140px_1fr] gap-3 py-1.5 border-b border-gray-800/60 last:border-0">
      <span className={lbl}>{label}</span>
      <span className={val + ' break-words'}>{value}</span>
    </div>
  );
}

function SectionCard({ icon, title, children }: {
  icon: React.ReactNode; title: string; children: React.ReactNode;
}) {
  return (
    <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-4">
      <div className="flex items-center gap-2 mb-3 pb-2 border-b border-gray-800">
        <div className="text-blue-400">{icon}</div>
        <h3 className="text-sm font-semibold text-white">{title}</h3>
      </div>
      <div>{children}</div>
    </div>
  );
}

function fmtDate(s?: string | null) {
  if (!s) return '';
  try { return new Date(s).toLocaleString('es-ES'); } catch { return s; }
}

function sourceLabel(src?: string | null) {
  if (!src) return '';
  const map: Record<string, string> = {
    wmi: 'WMI (Windows)', ssh: 'SSH (Linux/macOS)', snmp: 'SNMP',
    smb: 'SMB (nmap)', winrm: 'WinRM',
  };
  return map[src] || src.toUpperCase();
}

export default function AssetSystemInfoPanel({ assetId }: { assetId: string }) {
  const [info, setInfo] = useState<AssetInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const r = await getAssetInfo(assetId);
      setInfo(r.data as AssetInfo);
      setNotes(((r.data as AssetInfo).manual_notes) || '');
    } catch {
      toast.error('No se pudo cargar la info del sistema');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [assetId]);

  const saveNotes = async () => {
    setSaving(true);
    try {
      const r = await updateAssetInfo(assetId, { manual_notes: notes });
      setInfo(r.data as AssetInfo);
      toast.success('Notas guardadas');
    } catch {
      toast.error('No se pudieron guardar las notas');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-gray-500 py-8 justify-center">
        <div className="w-3 h-3 border border-gray-600 border-t-blue-500 rounded-full animate-spin" />
        Cargando información del sistema…
      </div>
    );
  }

  const sd = info && info.scanned_data;
  const hasScan = !!sd && (!!sd.os || !!sd.hardware || (sd.network && sd.network.length > 0));

  return (
    <div className="space-y-4">
      {/* Cabecera con metadatos del ultimo escaneo */}
      <div className="flex items-center justify-between gap-3 px-4 py-3 bg-gray-900/40 border border-gray-800 rounded-xl">
        <div className="flex items-center gap-2 text-xs text-gray-400">
          <Info className="w-4 h-4 text-blue-400" />
          {info && info.scanned_at ? (
            <span>
              Último escaneo: <span className="text-gray-200">{fmtDate(info.scanned_at)}</span>
              {info.source && <span className="ml-2 px-1.5 py-0.5 text-[10px] bg-blue-500/10 text-blue-400 border border-blue-500/20 rounded">{sourceLabel(info.source)}</span>}
            </span>
          ) : (
            <span>Sin datos de escaneo aún. Cuando se descubra el equipo por escaneo, esta sección se rellenará automáticamente.</span>
          )}
        </div>
        <button onClick={load} title="Refrescar"
          className="flex items-center gap-1 px-2 py-1 text-xs text-gray-400 hover:text-white border border-gray-700 hover:border-gray-600 rounded-lg transition-colors">
          <RefreshCw className="w-3 h-3" /> Refrescar
        </button>
      </div>

      {hasScan && sd && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

          {/* Sistema operativo */}
          {sd.os && (
            <SectionCard icon={<Server className="w-4 h-4" />} title="Sistema operativo">
              <Row label="Nombre" value={sd.os.name} />
              <Row label="Versión" value={sd.os.version} />
              <Row label="Build" value={sd.os.build} />
              <Row label="Arquitectura" value={sd.os.architecture} />
              <Row label="Idioma" value={sd.os.locale || sd.os.language} />
              <Row label="Instalado" value={fmtDate(sd.os.install_date)} />
              <Row label="Último arranque" value={fmtDate(sd.os.last_boot)} />
            </SectionCard>
          )}

          {/* Hardware general + CPU */}
          {sd.hardware && (
            <SectionCard icon={<Cpu className="w-4 h-4" />} title="Hardware">
              <Row label="Fabricante" value={sd.hardware.manufacturer} />
              <Row label="Modelo" value={sd.hardware.model} />
              <Row label="SKU" value={sd.hardware.sku} />
              <Row label="Familia" value={sd.hardware.system_family} />
              <Row label="Tipo" value={sd.hardware.system_type} />
              {sd.hardware.cpu && sd.hardware.cpu.length > 0 && (
                <div className="mt-3 pt-3 border-t border-gray-800">
                  <p className={lbl + ' mb-2'}>CPU</p>
                  {sd.hardware.cpu.map((c, i) => (
                    <div key={i} className="text-xs text-gray-300 mb-1">
                      <span className="text-white">{c.name || 'CPU'}</span>
                      {c.cores && <span className="text-gray-500"> · {c.cores}c</span>}
                      {c.threads && <span className="text-gray-500">/{c.threads}t</span>}
                      {c.speed_mhz && <span className="text-gray-500"> · {c.speed_mhz} MHz</span>}
                    </div>
                  ))}
                </div>
              )}
              {sd.hardware.bios && (
                <div className="mt-3 pt-3 border-t border-gray-800">
                  <p className={lbl + ' mb-2'}>BIOS</p>
                  <Row label="Vendor" value={sd.hardware.bios.vendor} />
                  <Row label="Versión" value={sd.hardware.bios.version} />
                  <Row label="Fecha" value={fmtDate(sd.hardware.bios.release_date)} />
                  <Row label="Serie" value={sd.hardware.bios.serial} />
                </div>
              )}
              {sd.hardware.motherboard && (
                <div className="mt-3 pt-3 border-t border-gray-800">
                  <p className={lbl + ' mb-2'}>Placa base</p>
                  <Row label="Fabricante" value={sd.hardware.motherboard.manufacturer} />
                  <Row label="Producto" value={sd.hardware.motherboard.product} />
                  <Row label="Serie" value={sd.hardware.motherboard.serial} />
                </div>
              )}
            </SectionCard>
          )}

          {/* Memoria */}
          {sd.hardware && sd.hardware.memory && (
            <SectionCard icon={<MemoryStick className="w-4 h-4" />} title="Memoria">
              <Row label="Total" value={sd.hardware.memory.total_gb ? `${sd.hardware.memory.total_gb} GB` : null} />
              {sd.hardware.memory.modules && sd.hardware.memory.modules.length > 0 && (
                <div className="mt-2 space-y-1">
                  {sd.hardware.memory.modules.map((m, i) => (
                    <div key={i} className="text-xs text-gray-300">
                      <span className="text-white">{m.slot || `Módulo ${i + 1}`}</span>
                      {m.capacity_gb && <span className="text-gray-500"> · {m.capacity_gb} GB</span>}
                      {m.speed && <span className="text-gray-500"> · {m.speed} MHz</span>}
                      {m.manufacturer && <span className="text-gray-500"> · {m.manufacturer}</span>}
                      {m.part_number && <span className="text-gray-500"> · {m.part_number}</span>}
                    </div>
                  ))}
                </div>
              )}
            </SectionCard>
          )}

          {/* Discos fisicos + logicos */}
          {sd.hardware && (sd.hardware.disks_physical || sd.hardware.disks_logical) && (
            <SectionCard icon={<HardDrive className="w-4 h-4" />} title="Almacenamiento">
              {sd.hardware.disks_physical && sd.hardware.disks_physical.length > 0 && (
                <div>
                  <p className={lbl + ' mb-2'}>Discos físicos</p>
                  {sd.hardware.disks_physical.map((d, i) => (
                    <div key={i} className="text-xs text-gray-300 mb-1">
                      <span className="text-white">{d.model || 'Disco'}</span>
                      {d.size_gb && <span className="text-gray-500"> · {d.size_gb} GB</span>}
                      {d.interface && <span className="text-gray-500"> · {d.interface}</span>}
                    </div>
                  ))}
                </div>
              )}
              {sd.hardware.disks_logical && sd.hardware.disks_logical.length > 0 && (
                <div className="mt-3 pt-3 border-t border-gray-800">
                  <p className={lbl + ' mb-2'}>Volumenes lógicos</p>
                  {sd.hardware.disks_logical.map((d, i) => {
                    const pct = (d.size_gb && d.free_gb && d.size_gb > 0)
                      ? Math.round((1 - d.free_gb / d.size_gb) * 100) : null;
                    return (
                      <div key={i} className="text-xs text-gray-300 mb-2">
                        <div className="flex items-baseline justify-between">
                          <span><span className="text-white font-mono">{d.drive}</span>
                            {d.filesystem && <span className="text-gray-500"> · {d.filesystem}</span>}
                          </span>
                          {d.size_gb && d.free_gb !== undefined && (
                            <span className="text-gray-400">{d.free_gb} / {d.size_gb} GB libres</span>
                          )}
                        </div>
                        {pct !== null && (
                          <div className="mt-1 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                            <div className={`h-full ${pct > 90 ? "bg-red-500" : pct > 75 ? "bg-yellow-500" : "bg-blue-500"}`} style={{ width: pct + "%" }} />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </SectionCard>
          )}

          {/* Tarjetas graficas */}
          {sd.hardware && sd.hardware.graphics && sd.hardware.graphics.length > 0 && (
            <SectionCard icon={<Monitor className="w-4 h-4" />} title="Gráficos">
              {sd.hardware.graphics.map((g, i) => (
                <div key={i} className="text-xs text-gray-300 mb-1">
                  <span className="text-white">{g.name || 'GPU'}</span>
                  {g.ram_mb && <span className="text-gray-500"> · {g.ram_mb} MB</span>}
                  {g.driver_version && <span className="text-gray-500"> · driver {g.driver_version}</span>}
                </div>
              ))}
            </SectionCard>
          )}

          {/* Audio */}
          {sd.hardware && sd.hardware.audio && sd.hardware.audio.length > 0 && (
            <SectionCard icon={<Volume2 className="w-4 h-4" />} title="Audio">
              {sd.hardware.audio.map((a, i) => (
                <div key={i} className="text-xs text-gray-300 mb-1">
                  <span className="text-white">{a.name || 'Dispositivo'}</span>
                  {a.manufacturer && <span className="text-gray-500"> · {a.manufacturer}</span>}
                </div>
              ))}
            </SectionCard>
          )}

          {/* Red */}
          {sd.network && sd.network.length > 0 && (
            <SectionCard icon={<Network className="w-4 h-4" />} title="Red">
              {sd.network.map((n, i) => (
                <div key={i} className="text-xs text-gray-300 mb-2 pb-2 border-b border-gray-800/60 last:border-0">
                  <div className="text-white truncate">{n.description || 'Adaptador'}</div>
                  {n.mac && <div className="text-gray-400 font-mono">{n.mac}</div>}
                  {n.ip && <div className="text-gray-400">IP: {n.ip}</div>}
                  {n.gateway && <div className="text-gray-500">Gateway: {n.gateway}</div>}
                  {n.dns && <div className="text-gray-500">DNS: {n.dns}</div>}
                  {typeof n.dhcp === 'boolean' && <div className="text-gray-500">DHCP: {n.dhcp ? 'Sí' : 'No'}</div>}
                </div>
              ))}
            </SectionCard>
          )}

          {/* Active Directory */}
          {sd.ad && (sd.ad.part_of_domain || sd.ad.domain || sd.ad.workgroup) && (
            <SectionCard icon={<Building2 className="w-4 h-4" />} title="Active Directory">
              <Row label="En dominio" value={sd.ad.part_of_domain ? 'Sí' : 'No'} />
              <Row label="Dominio" value={sd.ad.domain} />
              <Row label="Workgroup" value={sd.ad.workgroup} />
              <Row label="Rol" value={sd.ad.domain_role} />
              <Row label="Último usuario" value={sd.last_user} />
            </SectionCard>
          )}

          {/* Ultimo usuario (si no esta en AD card) */}
          {(!sd.ad || (!sd.ad.part_of_domain && !sd.ad.domain && !sd.ad.workgroup)) && sd.last_user && (
            <SectionCard icon={<User className="w-4 h-4" />} title="Sesión">
              <Row label="Último usuario" value={sd.last_user} />
            </SectionCard>
          )}
        </div>
      )}

      {!hasScan && (
        <div className="px-4 py-6 bg-gray-900/40 border border-dashed border-gray-700 rounded-xl text-center">
          <Shield className="w-8 h-8 text-gray-600 mx-auto mb-2" />
          <p className="text-sm text-gray-400">Este activo aún no se ha escaneado.</p>
          <p className="text-xs text-gray-500 mt-1">Puedes apuntar notas manuales abajo. Cuando se escanee, esta sección se rellenará con los datos del equipo (CPU, RAM, discos, red, AD, etc.) sin borrar tus notas.</p>
        </div>
      )}

      {/* Notas manuales — siempre editables, independientes del escaneo */}
      <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-blue-400" />
            <h3 className="text-sm font-semibold text-white">Notas manuales</h3>
          </div>
          <button onClick={saveNotes} disabled={saving}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 disabled:cursor-not-allowed text-white rounded-lg transition-colors">
            {saving ? <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Save className="w-3 h-3" />}
            Guardar notas
          </button>
        </div>
        <textarea
          value={notes}
          onChange={e => setNotes(e.target.value)}
          rows={6}
          placeholder="Anota aquí cualquier observación del equipo (ubicación exacta, periféricos asociados, histórico de incidencias, configuración especial, etc.). Estas notas no se sobrescriben al escanear."
          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/20 resize-none"
        />
      </div>
    </div>
  );
}
