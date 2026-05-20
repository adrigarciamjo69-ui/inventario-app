import { useEffect, useState, useRef, useCallback } from 'react';
import {
  Building2, FileText, RotateCcw, Save, Plus, Trash2,
  Upload, X, Settings, Palette, AlignLeft, ChevronRight,
  Tag, Users, HardDrive, Database, AlertTriangle, RefreshCw
} from 'lucide-react';
import toast from 'react-hot-toast';
import { apiClient } from '../api/client';
import CategoriesPage from './CategoriesPage';
import UsersPage from './UsersPage';

// ── Types ─────────────────────────────────────────────────────────────────────

interface CompanySettings {
  empresa: string; nif: string; dir1: string; dir2: string;
  tel: string; web: string; email: string; ciudad: string; logo: string;
}

interface PdfStyle {
  primary: string; accent: string; footer: string; fontSize: number;
}

interface AppSettings {
  company: CompanySettings;
  responsables: string[];
  pdfStyle: { entrega: PdfStyle; devolucion: PdfStyle };
  clauses: { entrega: string[]; devolucion: string[] };
}

interface DiskInfo { total: number; used: number; available: number; pct_used: number }
interface TableInfo { table_name: string; size_bytes: number; row_count: number; size_pretty: string }
interface SystemStats { disk: DiskInfo | null; db: { total_bytes: number; total_pretty: string; tables: TableInfo[] } | null }

// ── Defaults ──────────────────────────────────────────────────────────────────

const DEFAULT_COMPANY: CompanySettings = {
  empresa: '', nif: '', dir1: '', dir2: '', tel: '', web: '', email: '', ciudad: '', logo: '',
};

const DEFAULT_PDF_STYLE: PdfStyle = { primary: '#1c3ca8', accent: '#1c3ca8', footer: '#0f172a', fontSize: 9 };
const DEFAULT_PDF_STYLE_DEV: PdfStyle = { primary: '#b45309', accent: '#b45309', footer: '#1c0a00', fontSize: 9 };

const DEFAULT_CLAUSES_ENTREGA = [
  'Se ha comprobado el buen funcionamiento del equipamiento relacionado anteriormente y se encuentran en perfecto estado para su uso. Todos los equipos cuentan con el software instalado de fábrica, así como las aplicaciones necesarias con sus correspondientes licencias.',
  'El material entregado es propiedad de {empresa} y debe ser utilizado exclusivamente para fines laborales.',
  'El empleado es responsable del buen uso, mantenimiento y seguridad del dispositivo mientras esté bajo su custodia.',
  'En caso de pérdida, robo o daño, el empleado lo debe notificar inmediatamente al Departamento TIC.',
  'El material deberá ser devuelto en buen estado al finalizar la relación laboral o cuando sea solicitado por la empresa.',
];

const DEFAULT_CLAUSES_DEVOLUCION = [
  'El trabajador {trabajador} declara devolver el material listado anteriormente a {empresa}.',
  'Se ha verificado el estado del equipo en el momento de la devolución y se acepta conforme.',
  'El empleado queda eximido de responsabilidad sobre dicho material a partir de la fecha indicada en este justificante.',
  'El material devuelto pasa a disposición de {empresa} para los fines que estime oportunos.',
];

const PDF_PRESETS = [
  { name: 'Azul corporativo', primary: '#1c3ca8', accent: '#1c3ca8', footer: '#0f172a' },
  { name: 'Marino oscuro',    primary: '#1e3a5f', accent: '#1e3a5f', footer: '#0a1929' },
  { name: 'Verde empresa',    primary: '#166534', accent: '#166534', footer: '#052e16' },
  { name: 'Rojo institucional',primary:'#991b1b', accent: '#991b1b', footer: '#450a0a' },
  { name: 'Gris ejecutivo',   primary: '#374151', accent: '#374151', footer: '#111827' },
  { name: 'Naranja ámbar',    primary: '#b45309', accent: '#b45309', footer: '#1c0a00' },
];

// ── Helper ────────────────────────────────────────────────────────────────────

const inp = "w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/20";
const lbl = "block text-xs font-medium text-gray-400 mb-1.5 uppercase tracking-wide";

// ── ColorPicker ───────────────────────────────────────────────────────────────

function ColorPicker({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className={lbl}>{label}</label>
      <div className="flex gap-2 items-center">
        <input type="color" value={value} onChange={e => onChange(e.target.value)}
          className="w-10 h-9 rounded cursor-pointer border border-gray-700 bg-gray-800 p-0.5" />
        <input className={`${inp} font-mono`} value={value}
          onChange={e => { if (/^#[0-9a-f]{0,6}$/i.test(e.target.value)) onChange(e.target.value); }}
          placeholder="#1c3ca8" />
      </div>
    </div>
  );
}

// ── PdfStylePanel ─────────────────────────────────────────────────────────────

function PdfStylePanel({ type, style, onChange }: {
  type: 'entrega' | 'devolucion';
  style: PdfStyle;
  onChange: (s: PdfStyle) => void;
}) {
  const set = (key: keyof PdfStyle, val: string | number) => onChange({ ...style, [key]: val });

  return (
    <div className="space-y-5">
      {/* Presets */}
      <div className="bg-gray-800/50 rounded-xl p-4 border border-gray-700/50">
        <h4 className="text-sm font-semibold text-white mb-3">🎨 Paletas predefinidas</h4>
        <div className="flex flex-wrap gap-2">
          {PDF_PRESETS.map((p, i) => (
            <button key={i} onClick={() => onChange({ ...style, primary: p.primary, accent: p.accent, footer: p.footer })}
              title={p.name}
              className={`w-8 h-8 rounded-full border-2 transition-transform hover:scale-110 ${style.primary === p.primary ? 'border-white scale-110' : 'border-transparent'}`}
              style={{ background: p.primary }} />
          ))}
        </div>
      </div>

      {/* Colores */}
      <div className="bg-gray-800/50 rounded-xl p-4 border border-gray-700/50">
        <h4 className="text-sm font-semibold text-white mb-4">🖌 Colores</h4>
        <div className="grid grid-cols-3 gap-4">
          <ColorPicker label="Color principal" value={style.primary} onChange={v => set('primary', v)} />
          <ColorPicker label="Color acento" value={style.accent} onChange={v => set('accent', v)} />
          <ColorPicker label="Pie de página" value={style.footer} onChange={v => set('footer', v)} />
        </div>
      </div>

      {/* Tipografía */}
      <div className="bg-gray-800/50 rounded-xl p-4 border border-gray-700/50">
        <h4 className="text-sm font-semibold text-white mb-3">⚙ Tipografía</h4>
        <div>
          <label className={lbl}>Tamaño de fuente base — <span className="text-blue-400">{style.fontSize}pt</span></label>
          <input type="range" min="7" max="11" step="0.5" value={style.fontSize}
            onChange={e => set('fontSize', parseFloat(e.target.value))}
            className="w-full accent-blue-500" />
          <div className="flex justify-between text-xs text-gray-600 mt-1"><span>7pt</span><span>11pt</span></div>
        </div>
      </div>
    </div>
  );
}

// ── ClausesPanel ──────────────────────────────────────────────────────────────

function ClausesPanel({ clauses, onChange }: { clauses: string[]; onChange: (c: string[]) => void }) {
  const set = (i: number, val: string) => onChange(clauses.map((c, idx) => idx === i ? val : c));
  const remove = (i: number) => onChange(clauses.filter((_, idx) => idx !== i));
  const add = () => onChange([...clauses, '']);

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-500">Puedes usar <code className="bg-gray-800 px-1 rounded text-blue-400">{'{empresa}'}</code> y <code className="bg-gray-800 px-1 rounded text-blue-400">{'{trabajador}'}</code> como variables.</p>
      {clauses.map((c, i) => (
        <div key={i} className="flex gap-2">
          <div className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-600/20 flex items-center justify-center text-xs text-blue-400 font-bold mt-2">{i + 1}</div>
          <textarea value={c} onChange={e => set(i, e.target.value)}
            rows={3} className={`${inp} resize-none flex-1`} placeholder="Texto de la cláusula..." />
          <button onClick={() => remove(i)} className="text-gray-600 hover:text-red-400 transition-colors mt-2 flex-shrink-0">
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      ))}
      <button onClick={add}
        className="flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300 transition-colors mt-2">
        <Plus className="w-3.5 h-3.5" /> Añadir cláusula
      </button>
    </div>
  );
}

// ── StoragePanel ──────────────────────────────────────────────────────────────

function fmt(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(i > 1 ? 1 : 0)} ${sizes[i]}`;
}

function UsageBar({ pct, color }: { pct: number; color: string }) {
  const clamped = Math.min(100, Math.max(0, pct));
  return (
    <div className="w-full bg-gray-700/50 rounded-full h-2.5 overflow-hidden">
      <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${clamped}%` }} />
    </div>
  );
}

function StoragePanel() {
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [diskThreshold, setDiskThreshold] = useState(20);
  const [dbLimitGB, setDbLimitGB] = useState(10);
  const [savingCfg, setSavingCfg] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [statsRes, settingsRes] = await Promise.all([
        apiClient.get('/system/stats'),
        apiClient.get('/settings'),
      ]);
      setStats(statsRes.data);
      if (settingsRes.data.diskThreshold != null) setDiskThreshold(settingsRes.data.diskThreshold);
      if (settingsRes.data.dbLimitGB != null)    setDbLimitGB(settingsRes.data.dbLimitGB);
    } catch { toast.error('No se pudieron cargar las estadísticas'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const saveCfg = async () => {
    setSavingCfg(true);
    try {
      await apiClient.post('/settings', { diskThreshold, dbLimitGB });
      toast.success('Configuración guardada');
    } catch { toast.error('Error al guardar'); }
    finally { setSavingCfg(false); }
  };

  if (loading) return (
    <div className="flex items-center justify-center h-40">
      <div className="w-7 h-7 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />
    </div>
  );

  const disk = stats?.disk;
  const db   = stats?.db;
  const diskFreePct = disk ? Math.round((disk.available / disk.total) * 100) : null;
  const showDiskWarning = diskFreePct !== null && diskFreePct < diskThreshold;
  const dbUsedBytes = db?.total_bytes || 0;
  const dbLimitBytes = dbLimitGB * 1024 * 1024 * 1024;
  const dbPct = dbLimitBytes > 0 ? Math.round((dbUsedBytes / dbLimitBytes) * 100) : 0;

  const barColor = (pct: number) =>
    pct >= 90 ? 'bg-red-500' : pct >= 70 ? 'bg-yellow-500' : 'bg-blue-500';

  return (
    <div className="space-y-5">

      {/* Banner de aviso */}
      {showDiskWarning && (
        <div className="flex items-start gap-3 p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-xl">
          <AlertTriangle className="w-5 h-5 text-yellow-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-yellow-400">Espacio en disco bajo</p>
            <p className="text-xs text-yellow-300/80 mt-0.5">
              Solo queda un {diskFreePct}% libre ({fmt(disk!.available)}). El umbral configurado es {diskThreshold}%.
              Considera liberar espacio o ampliar el disco.
            </p>
          </div>
        </div>
      )}

      {/* Configuración de umbrales */}
      <div className="bg-gray-900 rounded-xl border border-gray-800 p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-white flex items-center gap-2">
            <Settings className="w-4 h-4 text-blue-400" /> Configuración de umbrales
          </h3>
          <div className="flex gap-2">
            <button onClick={load} className="p-1.5 text-gray-500 hover:text-white transition-colors">
              <RefreshCw className="w-4 h-4" />
            </button>
            <button onClick={saveCfg} disabled={savingCfg}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium rounded-lg transition-colors disabled:opacity-50">
              <Save className="w-3.5 h-3.5" /> Guardar
            </button>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-5">
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1.5 uppercase tracking-wide">
              Umbral aviso disco — <span className="text-yellow-400 normal-case tracking-normal">aviso si libre &lt; {diskThreshold}%</span>
            </label>
            <input type="range" min="5" max="50" step="5" value={diskThreshold}
              onChange={e => setDiskThreshold(parseInt(e.target.value))}
              className="w-full accent-yellow-500" />
            <div className="flex justify-between text-xs text-gray-600 mt-1"><span>5%</span><span>50%</span></div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1.5 uppercase tracking-wide">
              Límite referencia BD — <span className="text-blue-400 normal-case tracking-normal">{dbLimitGB} GB máximo</span>
            </label>
            <input type="range" min="1" max="100" step="1" value={dbLimitGB}
              onChange={e => setDbLimitGB(parseInt(e.target.value))}
              className="w-full accent-blue-500" />
            <div className="flex justify-between text-xs text-gray-600 mt-1"><span>1 GB</span><span>100 GB</span></div>
          </div>
        </div>
      </div>

      {/* Disco del servidor */}
      <div className="bg-gray-900 rounded-xl border border-gray-800 p-5">
        <h3 className="text-sm font-semibold text-white flex items-center gap-2 mb-4">
          <HardDrive className="w-4 h-4 text-blue-400" /> Disco del servidor
        </h3>
        {!disk ? (
          <p className="text-sm text-gray-500">No se pudo obtener información del disco.</p>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-4 mb-4">
              {[
                { label: 'Total',     value: fmt(disk.total),     color: 'text-white' },
                { label: 'Usado',     value: fmt(disk.used),      color: 'text-red-400' },
                { label: 'Disponible',value: fmt(disk.available), color: 'text-green-400' },
              ].map(s => (
                <div key={s.label} className="bg-gray-800/60 rounded-lg p-3 text-center">
                  <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{s.label}</p>
                </div>
              ))}
            </div>
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs text-gray-400">
                <span>Uso del disco</span>
                <span className={disk.pct_used >= 90 ? 'text-red-400' : disk.pct_used >= 70 ? 'text-yellow-400' : 'text-gray-400'}>
                  {disk.pct_used}% usado · {diskFreePct}% libre
                </span>
              </div>
              <UsageBar pct={disk.pct_used} color={barColor(disk.pct_used)} />
            </div>
          </>
        )}
      </div>

      {/* Base de datos */}
      <div className="bg-gray-900 rounded-xl border border-gray-800 p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-white flex items-center gap-2">
            <Database className="w-4 h-4 text-blue-400" /> Base de datos PostgreSQL
          </h3>
          {db && <span className="text-xs text-gray-400">Total: <span className="text-white font-medium">{db.total_pretty}</span></span>}
        </div>
        {!db ? (
          <p className="text-sm text-gray-500">No se pudo obtener información de la base de datos.</p>
        ) : (
          <>
            {/* Barra total BD vs límite */}
            <div className="mb-5 space-y-1.5">
              <div className="flex justify-between text-xs text-gray-400">
                <span>Uso respecto al límite de referencia ({dbLimitGB} GB)</span>
                <span className={dbPct >= 90 ? 'text-red-400' : dbPct >= 70 ? 'text-yellow-400' : 'text-blue-400'}>
                  {dbPct}% — {db.total_pretty} / {dbLimitGB} GB
                </span>
              </div>
              <UsageBar pct={dbPct} color={barColor(dbPct)} />
            </div>

            {/* Tabla de tablas */}
            <div className="overflow-hidden rounded-lg border border-gray-800">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-800/60 border-b border-gray-800">
                    <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500 uppercase">Tabla</th>
                    <th className="text-right px-4 py-2.5 text-xs font-medium text-gray-500 uppercase">Filas</th>
                    <th className="text-right px-4 py-2.5 text-xs font-medium text-gray-500 uppercase">Tamaño</th>
                    <th className="px-4 py-2.5 text-xs font-medium text-gray-500 uppercase">% del límite</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800/60">
                  {db.tables.map(t => {
                    const pct = dbLimitBytes > 0 ? (t.size_bytes / dbLimitBytes) * 100 : 0;
                    const barPct = dbUsedBytes > 0 ? (t.size_bytes / dbUsedBytes) * 100 : 0;
                    return (
                      <tr key={t.table_name} className="hover:bg-gray-800/30 transition-colors">
                        <td className="px-4 py-2.5 font-mono text-xs text-white">{t.table_name}</td>
                        <td className="px-4 py-2.5 text-right text-xs text-gray-400">
                          {t.row_count.toLocaleString('es-ES')}
                        </td>
                        <td className="px-4 py-2.5 text-right text-xs text-gray-300 font-medium whitespace-nowrap">
                          {t.size_pretty}
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-2">
                            <div className="flex-1"><UsageBar pct={barPct} color="bg-blue-500/70" /></div>
                            <span className="text-xs text-gray-500 w-10 text-right">{pct.toFixed(2)}%</span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Main SettingsPage ─────────────────────────────────────────────────────────

type Section = 'empresa' | 'entrega' | 'devolucion' | 'categories' | 'users' | 'storage';
type DocTab = 'pdf' | 'clausulas';

export default function SettingsPage() {
  const [section, setSection] = useState<Section>('empresa');
  const [docTab, setDocTab] = useState<{ entrega: DocTab; devolucion: DocTab }>({ entrega: 'pdf', devolucion: 'pdf' });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [company, setCompany] = useState<CompanySettings>(DEFAULT_COMPANY);
  const [responsables, setResponsables] = useState<string[]>(['Responsable TI']);
  const [newResp, setNewResp] = useState('');
  const [pdfStyle, setPdfStyle] = useState({ entrega: DEFAULT_PDF_STYLE, devolucion: DEFAULT_PDF_STYLE_DEV });
  const [clauses, setClauses] = useState({ entrega: DEFAULT_CLAUSES_ENTREGA, devolucion: DEFAULT_CLAUSES_DEVOLUCION });

  const logoInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiClient.get('/settings');
      const s = res.data;
      if (s.company)      setCompany(c => ({ ...DEFAULT_COMPANY, ...s.company }));
      if (s.responsables) setResponsables(s.responsables);
      if (s.pdfStyle)     setPdfStyle(p => ({ entrega: { ...DEFAULT_PDF_STYLE, ...s.pdfStyle?.entrega }, devolucion: { ...DEFAULT_PDF_STYLE_DEV, ...s.pdfStyle?.devolucion } }));
      if (s.clauses)      setClauses(c => ({ entrega: s.clauses?.entrega || DEFAULT_CLAUSES_ENTREGA, devolucion: s.clauses?.devolucion || DEFAULT_CLAUSES_DEVOLUCION }));
    } catch { /* first time, use defaults */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    setSaving(true);
    try {
      await apiClient.post('/settings', { company, responsables, pdfStyle, clauses });
      toast.success('Configuración guardada correctamente');
    } catch { toast.error('Error al guardar'); }
    finally { setSaving(false); }
  };

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { toast.error('El logo no puede superar 2MB'); return; }
    const reader = new FileReader();
    reader.onload = ev => setCompany(c => ({ ...c, logo: ev.target?.result as string || '' }));
    reader.readAsDataURL(file);
  };

  const addResponsable = () => {
    if (!newResp.trim()) return;
    setResponsables(r => [...r, newResp.trim()]);
    setNewResp('');
  };

  const navItems: { id: Section; label: string; icon: JSX.Element; separator?: boolean }[] = [
    { id: 'empresa',    label: 'Empresa',      icon: <Building2 className="w-4 h-4" /> },
    { id: 'entrega',    label: 'Entrega',      icon: <FileText className="w-4 h-4" /> },
    { id: 'devolucion', label: 'Devolución',   icon: <RotateCcw className="w-4 h-4" /> },
    { id: 'categories', label: 'Categorías',   icon: <Tag className="w-4 h-4" />, separator: true },
    { id: 'users',      label: 'Usuarios App', icon: <Users className="w-4 h-4" /> },
    { id: 'storage',    label: 'Almacenamiento', icon: <HardDrive className="w-4 h-4" />, separator: true },
  ];

  if (loading) return (
    <div className="flex items-center justify-center h-60">
      <div className="w-7 h-7 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Ajustes</h1>
          <p className="text-gray-400 text-sm mt-1">Configuración de empresa, PDF y cláusulas</p>
        </div>
        <button onClick={save} disabled={saving}
          className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors">
          {saving ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Save className="w-4 h-4" />}
          Guardar todo
        </button>
      </div>

      <div className="flex gap-6 items-start">
        {/* Sidebar */}
        <aside className="w-48 flex-shrink-0 bg-gray-900 rounded-xl border border-gray-800 p-2 sticky top-4">
          {navItems.map(item => (
            <div key={item.id}>
              {item.separator && (
                <div className="my-2 px-1">
                  <div className="border-t border-gray-800" />
                  <p className="text-xs text-gray-600 mt-2 mb-1 font-medium uppercase tracking-wider px-2">Administración</p>
                </div>
              )}
              <button onClick={() => setSection(item.id)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all mb-0.5
                  ${section === item.id ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-white'}`}>
                {item.icon} {item.label}
                {section === item.id && <ChevronRight className="w-3.5 h-3.5 ml-auto" />}
              </button>
            </div>
          ))}
        </aside>

        {/* Content */}
        <div className="flex-1 min-w-0 space-y-5">

          {/* ── EMPRESA ── */}
          {section === 'empresa' && (
            <>
              <div className="bg-gray-900 rounded-xl border border-gray-800 p-6">
                <h3 className="text-base font-semibold text-white mb-5 flex items-center gap-2">
                  <Building2 className="w-4 h-4 text-blue-400" /> Datos de la empresa
                </h3>
                <div className="grid grid-cols-2 gap-4">
                  <div className="col-span-2">
                    <label className={lbl}>Nombre empresa <span className="text-gray-600 normal-case tracking-normal">(se usa en el texto del documento)</span></label>
                    <input className={inp} placeholder="ELECTROSISTEMAS BACH, S.A." value={company.empresa}
                      onChange={e => setCompany(c => ({ ...c, empresa: e.target.value }))} />
                  </div>

                  {/* Logo */}
                  <div className="col-span-2">
                    <label className={lbl}>Logo en el PDF <span className="text-gray-600 normal-case tracking-normal">(PNG/JPG — recomendado fondo transparente, máx. 2MB)</span></label>
                    {company.logo ? (
                      <div className="flex items-center gap-4 p-3 bg-gray-800/60 border border-gray-700 rounded-lg">
                        <div className="w-36 h-12 bg-white rounded flex items-center justify-center overflow-hidden border border-gray-300">
                          <img src={company.logo} alt="logo" className="max-h-10 max-w-32 object-contain" />
                        </div>
                        <div className="flex-1">
                          <p className="text-sm text-white">Logo cargado</p>
                          <p className="text-xs text-gray-500">Aparecerá en el encabezado del PDF</p>
                        </div>
                        <button onClick={() => setCompany(c => ({ ...c, logo: '' }))}
                          className="text-gray-500 hover:text-red-400 transition-colors"><X className="w-4 h-4" /></button>
                      </div>
                    ) : (
                      <div onClick={() => logoInputRef.current?.click()}
                        className="flex flex-col items-center justify-center gap-2 p-6 bg-gray-800/40 border-2 border-dashed border-gray-700 hover:border-blue-500 rounded-lg cursor-pointer transition-colors">
                        <Upload className="w-8 h-8 text-gray-600" />
                        <p className="text-sm text-gray-400 font-medium">Haz clic para subir un logo</p>
                        <p className="text-xs text-gray-600">PNG con fondo transparente para mejor resultado</p>
                      </div>
                    )}
                    <input ref={logoInputRef} type="file" accept="image/*" className="hidden" onChange={handleLogoUpload} />
                  </div>

                  <div>
                    <label className={lbl}>NIF</label>
                    <input className={`${inp} font-mono`} placeholder="A08513749" value={company.nif}
                      onChange={e => setCompany(c => ({ ...c, nif: e.target.value }))} />
                  </div>
                  <div>
                    <label className={lbl}>Ciudad (texto intro)</label>
                    <input className={inp} placeholder="Santa Perpètua de Mogoda" value={company.ciudad}
                      onChange={e => setCompany(c => ({ ...c, ciudad: e.target.value }))} />
                  </div>
                  <div className="col-span-2">
                    <label className={lbl}>Dirección (línea 1)</label>
                    <input className={inp} placeholder='C/ de la Mar Mediterrània, 9 - Pol. Ind. "La Torre del Rector"'
                      value={company.dir1} onChange={e => setCompany(c => ({ ...c, dir1: e.target.value }))} />
                  </div>
                  <div className="col-span-2">
                    <label className={lbl}>Localidad y CP</label>
                    <input className={inp} placeholder="Santa Perpètua de Mogoda · 08130 Barcelona"
                      value={company.dir2} onChange={e => setCompany(c => ({ ...c, dir2: e.target.value }))} />
                  </div>
                  <div>
                    <label className={lbl}>Teléfono / Fax</label>
                    <input className={inp} placeholder="Tel. +34 93 574 74 40 · Fax +34 93 574 34 27"
                      value={company.tel} onChange={e => setCompany(c => ({ ...c, tel: e.target.value }))} />
                  </div>
                  <div>
                    <label className={lbl}>Web</label>
                    <input className={inp} placeholder="www.empresa.es" value={company.web}
                      onChange={e => setCompany(c => ({ ...c, web: e.target.value }))} />
                  </div>
                  <div className="col-span-2">
                    <label className={lbl}>Email</label>
                    <input className={inp} placeholder="info@empresa.es" value={company.email}
                      onChange={e => setCompany(c => ({ ...c, email: e.target.value }))} />
                  </div>
                </div>
              </div>

              {/* Responsables */}
              <div className="bg-gray-900 rounded-xl border border-gray-800 p-6">
                <h3 className="text-base font-semibold text-white mb-1 flex items-center gap-2">
                  <Settings className="w-4 h-4 text-blue-400" /> Responsables que firman como empresa
                </h3>
                <p className="text-xs text-gray-500 mb-4">Aparecen en el desplegable al crear documentos. Al menos uno es necesario.</p>
                <div className="space-y-2 mb-3">
                  {responsables.map((r, i) => (
                    <div key={i} className="flex items-center gap-2 px-3 py-2 bg-gray-800/60 border border-gray-700/50 rounded-lg">
                      <span className="text-sm text-white flex-1">{r}</span>
                      {responsables.length > 1 && (
                        <button onClick={() => setResponsables(p => p.filter((_, idx) => idx !== i))}
                          className="text-gray-600 hover:text-red-400 transition-colors"><X className="w-3.5 h-3.5" /></button>
                      )}
                    </div>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input className={`${inp} flex-1`} placeholder="Nombre y apellidos del responsable..."
                    value={newResp} onChange={e => setNewResp(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && addResponsable()} />
                  <button onClick={addResponsable}
                    className="flex items-center gap-1.5 px-3 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-lg transition-colors">
                    <Plus className="w-4 h-4" /> Añadir
                  </button>
                </div>
              </div>
            </>
          )}

          {/* ── ENTREGA / DEVOLUCIÓN ── */}
          {(section === 'entrega' || section === 'devolucion') && (
            <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
              {/* Sub-tabs */}
              <div className="flex border-b border-gray-800">
                {([['pdf', <Palette className="w-4 h-4" />, '🎨 PDF'], ['clausulas', <AlignLeft className="w-4 h-4" />, '📝 Cláusulas']] as const).map(([tab, , label]) => (
                  <button key={tab}
                    onClick={() => setDocTab(p => ({ ...p, [section]: tab as DocTab }))}
                    className={`flex items-center gap-2 px-5 py-3.5 text-sm font-medium transition-colors border-b-2
                      ${docTab[section] === tab
                        ? 'text-blue-400 border-blue-500 bg-blue-600/5'
                        : 'text-gray-500 border-transparent hover:text-gray-300'}`}>
                    {label as string}
                  </button>
                ))}
              </div>

              <div className="p-6">
                {docTab[section] === 'pdf' && (
                  <PdfStylePanel
                    type={section}
                    style={pdfStyle[section]}
                    onChange={s => setPdfStyle(p => ({ ...p, [section]: s }))}
                  />
                )}
                {docTab[section] === 'clausulas' && (
                  <ClausesPanel
                    clauses={clauses[section]}
                    onChange={c => setClauses(p => ({ ...p, [section]: c }))}
                  />
                )}
              </div>
            </div>
          )}

          {/* ── ALMACENAMIENTO ── */}
          {section === 'storage' && (
            <StoragePanel />
          )}

          {/* ── CATEGORÍAS ── */}
          {section === 'categories' && (
            <div className="-mx-1">
              <CategoriesPage />
            </div>
          )}

          {/* ── USUARIOS APP ── */}
          {section === 'users' && (
            <div className="-mx-1">
              <UsersPage />
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
