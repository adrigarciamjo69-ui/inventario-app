import { useEffect, useState, useCallback } from 'react';
import {
  Package, Activity, TrendingUp, AlertCircle, AlertTriangle,
  CheckCircle, User, Loader2, Package2, Globe, Building2,
  Monitor, RefreshCw, Clock, ShieldAlert
} from 'lucide-react';
import { getAssets, apiClient } from '../api/client';
import { Asset, Software, Service } from '../types';
import { useCategories } from '../context/CategoriesContext';

// ── Types ─────────────────────────────────────────────────────────────────────

type ViewMode = 'general' | 'hardware' | 'software' | 'services' | 'department';

interface UnassignedItem {
  delivery_id: number; doc_id: string; client_user_id: number;
  delivery_date: string; first_name: string; last_name: string;
  asset_id: string; serial_number: string; brand: string; model: string;
  category: string; category_label: string; category_icon: string;
}

// ── Colour maps ───────────────────────────────────────────────────────────────

const assetStatusColors: Record<string, string> = {
  activo:    'bg-green-500/20 text-green-400 border-green-500/30',
  inactivo:  'bg-gray-500/20 text-gray-400 border-gray-500/30',
  reparacion:'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  baja:      'bg-red-500/20 text-red-400 border-red-500/30',
};
const assetStatusLabels: Record<string,string> = {
  activo:'Activo', inactivo:'Inactivo', reparacion:'En reparación', baja:'Baja'
};
const swStatusColors: Record<string,string> = {
  activo:  'bg-green-500/20 text-green-400 border-green-500/30',
  inactivo:'bg-gray-500/20 text-gray-400 border-gray-500/30',
  expirado:'bg-red-500/20 text-red-400 border-red-500/30',
  baja:    'bg-orange-500/20 text-orange-400 border-orange-500/30',
};
const swStatusLabels: Record<string,string> = {
  activo:'Activo', inactivo:'Inactivo', expirado:'Expirado', baja:'Baja'
};
const svcStatusColors: Record<string,string> = {
  activo:   'bg-green-500/20 text-green-400 border-green-500/30',
  inactivo: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
  cancelado:'bg-red-500/20 text-red-400 border-red-500/30',
  pendiente:'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
};
const svcStatusLabels: Record<string,string> = {
  activo:'Activo', inactivo:'Inactivo', cancelado:'Cancelado', pendiente:'Pendiente'
};

// ── Small reusable components ─────────────────────────────────────────────────

function StatCard({ title, value, sub, icon, gradient, border }: {
  title: string; value: string | number; sub?: string;
  icon: React.ReactNode; gradient: string; border: string;
}) {
  return (
    <div className={`bg-gradient-to-br ${gradient} border ${border} rounded-xl p-5`}>
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm text-gray-400">{title}</p>
        <div className="p-2 bg-gray-800/60 rounded-lg">{icon}</div>
      </div>
      <p className="text-2xl font-bold text-white">{value}</p>
      {sub && <p className="text-xs text-gray-500 mt-1">{sub}</p>}
    </div>
  );
}

function BarRow({ label, count, total, color = 'bg-blue-500', icon }: {
  label: string; count: number; total: number; color?: string; icon?: string;
}) {
  return (
    <div className="flex items-center gap-3">
      {icon && <span className="text-base flex-shrink-0 w-6 text-center">{icon}</span>}
      <span className="text-sm text-gray-300 flex-1 truncate">{label}</span>
      <div className="flex items-center gap-2 flex-shrink-0">
        <div className="w-24 h-1.5 bg-gray-800 rounded-full overflow-hidden">
          <div className={`h-full ${color} rounded-full transition-all`}
            style={{ width: total ? `${(count / total) * 100}%` : '0%' }} />
        </div>
        <span className="text-sm font-medium text-white w-6 text-right">{count}</span>
      </div>
    </div>
  );
}

function StatusGrid({ byStatus, colors, labels }: {
  byStatus: Record<string,number>; colors: Record<string,string>; labels: Record<string,string>;
}) {
  const entries = Object.entries(byStatus).sort(([,a],[,b]) => b - a);
  if (!entries.length) return <p className="text-gray-500 text-sm text-center py-4">Sin datos</p>;
  return (
    <div className="grid grid-cols-2 gap-3">
      {entries.map(([status, count]) => (
        <div key={status} className={`rounded-lg border px-4 py-3 ${colors[status] || 'bg-gray-700/30 text-gray-400 border-gray-700'}`}>
          <p className="text-2xl font-bold">{count}</p>
          <p className="text-xs mt-1">{labels[status] || status}</p>
        </div>
      ))}
    </div>
  );
}

// ── UnassignedAssetsWidget ────────────────────────────────────────────────────

function UnassignedAssetsWidget() {
  const [items, setItems]     = useState<UnassignedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [assigning, setAssigning] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    apiClient.get('/deliveries/unassigned-assets')
      .then(r => setItems(r.data || []))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const assign = async (item: UnassignedItem) => {
    setAssigning(item.asset_id);
    try {
      await apiClient.post('/deliveries/assign-asset', { asset_id: item.asset_id, client_user_id: item.client_user_id });
      setItems(prev => prev.filter(i => !(i.asset_id === item.asset_id && i.client_user_id === item.client_user_id)));
    } catch {} finally { setAssigning(null); }
  };

  if (!loading && items.length === 0) return null;

  return (
    <div className="bg-gray-900 border border-yellow-500/30 rounded-xl overflow-hidden">
      <div className="flex items-center gap-3 px-5 py-4 bg-yellow-500/5 border-b border-yellow-500/20">
        <div className="w-8 h-8 rounded-lg bg-yellow-500/20 flex items-center justify-center flex-shrink-0">
          <AlertTriangle className="w-4 h-4 text-yellow-400" />
        </div>
        <div className="flex-1">
          <h3 className="text-sm font-semibold text-white">Material entregado sin asignar en inventario</h3>
          <p className="text-xs text-gray-400 mt-0.5">Activos en actas de entrega sin asignación en Hardware</p>
        </div>
        {!loading && <span className="px-2.5 py-1 bg-yellow-500/20 text-yellow-400 text-xs font-bold rounded-full border border-yellow-500/30">{items.length}</span>}
      </div>
      {loading ? (
        <div className="flex items-center justify-center h-20">
          <div className="w-5 h-5 border-2 border-yellow-500/30 border-t-yellow-400 rounded-full animate-spin" />
        </div>
      ) : (
        <div className="divide-y divide-gray-800/60">
          {items.map(item => {
            const busy = assigning === item.asset_id;
            return (
              <div key={`${item.asset_id}-${item.client_user_id}`}
                className="flex items-center gap-4 px-5 py-3.5 hover:bg-gray-800/30 transition-colors">
                <span className="text-xl flex-shrink-0 w-7 text-center">{item.category_icon || '💻'}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-white">{item.brand} {item.model}</span>
                    <span className="text-xs text-gray-500 font-mono">{item.serial_number}</span>
                    <span className="text-xs px-1.5 py-0.5 rounded bg-gray-800 text-gray-400">{item.category_label || item.category}</span>
                  </div>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <User className="w-3 h-3 text-gray-500" />
                    <span className="text-xs text-gray-400">{item.first_name} {item.last_name}</span>
                    <span className="text-gray-700">·</span>
                    <span className="text-xs text-gray-500 font-mono">{item.doc_id}</span>
                    <span className="text-gray-700">·</span>
                    <span className="text-xs text-gray-500">{new Date(item.delivery_date).toLocaleDateString('es-ES')}</span>
                  </div>
                </div>
                <button onClick={() => assign(item)} disabled={busy}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white text-xs font-medium rounded-lg transition-colors flex-shrink-0">
                  {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle className="w-3.5 h-3.5" />}
                  {busy ? 'Asignando...' : 'Asignar'}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── View: General ─────────────────────────────────────────────────────────────

function GeneralView({ assets, software, services }: { assets: Asset[]; software: Software[]; services: Service[] }) {
  const totalHwValue = assets.reduce((a, x) => a + Number(x.price || 0), 0);
  const totalSwValue = software.reduce((a, x) => a + Number(x.price || 0), 0);
  const monthlySvc   = services.reduce((a, s) => {
    return a + (s.billing_cycle === 'mensual' ? Number(s.cost) : s.billing_cycle === 'anual' ? Number(s.cost) / 12 : 0);
  }, 0);

  const swExpiringSoon = software.filter(s => {
    if (!s.expiry_date) return false;
    const days = Math.ceil((new Date(s.expiry_date).getTime() - Date.now()) / 86400000);
    return days >= 0 && days <= 30;
  });
  const svcRenewingSoon = services.filter(s => {
    if (!s.renewal_date) return false;
    const days = Math.ceil((new Date(s.renewal_date).getTime() - Date.now()) / 86400000);
    return days >= 0 && days <= 30;
  });

  // Departments across all
  const allDepts = [
    ...assets.map(a => a.department).filter(Boolean),
    ...software.map(s => (s as any).department).filter(Boolean),
    ...services.map(s => s.department).filter(Boolean),
  ] as string[];
  const deptCount = allDepts.reduce<Record<string,number>>((acc, d) => { acc[d] = (acc[d]||0)+1; return acc; }, {});

  return (
    <div className="space-y-6">
      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Hardware" value={assets.length}
          sub={`${totalHwValue.toLocaleString('es-ES',{maximumFractionDigits:0})} € valor total`}
          icon={<Package className="w-5 h-5 text-blue-400" />}
          gradient="from-blue-600/20 to-blue-900/10" border="border-blue-500/20" />
        <StatCard title="Software" value={software.length}
          sub={`${software.filter(s=>s.status==='activo').length} activos`}
          icon={<Package2 className="w-5 h-5 text-purple-400" />}
          gradient="from-purple-600/20 to-purple-900/10" border="border-purple-500/20" />
        <StatCard title="Servicios" value={services.length}
          sub={`${monthlySvc.toLocaleString('es-ES',{minimumFractionDigits:2})} €/mes`}
          icon={<Globe className="w-5 h-5 text-cyan-400" />}
          gradient="from-cyan-600/20 to-cyan-900/10" border="border-cyan-500/20" />
        <StatCard title="Alertas"
          value={swExpiringSoon.length + svcRenewingSoon.length + assets.filter(a=>a.status==='reparacion').length}
          sub="licencias, renovaciones, reparaciones"
          icon={<ShieldAlert className="w-5 h-5 text-yellow-400" />}
          gradient="from-yellow-600/20 to-yellow-900/10" border="border-yellow-500/20" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Hardware por estado */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
            <Package className="w-4 h-4 text-blue-400" /> Hardware por estado
          </h3>
          <StatusGrid
            byStatus={assets.reduce<Record<string,number>>((a,x)=>{a[x.status]=(a[x.status]||0)+1;return a;},{})}
            colors={assetStatusColors} labels={assetStatusLabels} />
        </div>

        {/* Software por estado */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
            <Package2 className="w-4 h-4 text-purple-400" /> Software por estado
          </h3>
          <StatusGrid
            byStatus={software.reduce<Record<string,number>>((a,x)=>{a[x.status]=(a[x.status]||0)+1;return a;},{})}
            colors={swStatusColors} labels={swStatusLabels} />
        </div>

        {/* Departamentos */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
            <Building2 className="w-4 h-4 text-green-400" /> Por departamento
          </h3>
          <div className="space-y-2.5">
            {Object.entries(deptCount).sort(([,a],[,b])=>b-a).slice(0,6).map(([dept,count])=>(
              <BarRow key={dept} label={dept} count={count} total={allDepts.length} color="bg-green-500" />
            ))}
            {!Object.keys(deptCount).length && <p className="text-gray-500 text-sm text-center py-4">Sin departamentos asignados</p>}
          </div>
        </div>
      </div>

      {/* Alertas */}
      {(swExpiringSoon.length > 0 || svcRenewingSoon.length > 0) && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-yellow-400" /> Próximas a vencer (30 días)
          </h3>
          <div className="space-y-2">
            {swExpiringSoon.map(s => (
              <div key={s.id} className="flex items-center gap-3 px-3 py-2 bg-yellow-500/5 border border-yellow-500/20 rounded-lg">
                <Package2 className="w-4 h-4 text-yellow-400 flex-shrink-0" />
                <span className="text-sm text-white flex-1">{s.name}</span>
                <span className="text-xs text-yellow-400">{s.expiry_date ? new Date(s.expiry_date+'T12:00:00').toLocaleDateString('es-ES') : ''}</span>
              </div>
            ))}
            {svcRenewingSoon.map(s => (
              <div key={s.id} className="flex items-center gap-3 px-3 py-2 bg-orange-500/5 border border-orange-500/20 rounded-lg">
                <Globe className="w-4 h-4 text-orange-400 flex-shrink-0" />
                <span className="text-sm text-white flex-1">{s.name}</span>
                <span className="text-xs text-orange-400">{s.renewal_date ? new Date(s.renewal_date+'T12:00:00').toLocaleDateString('es-ES') : ''}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── View: Hardware ────────────────────────────────────────────────────────────

function HardwareView({ assets }: { assets: Asset[] }) {
  const { getCategoryLabel, getCategoryIcon } = useCategories();
  const [activeCat,  setActiveCat]  = useState<string | null>(null);
  const [activeDept, setActiveDept] = useState<string | null>(null);

  // Filtered subset used for KPIs and table
  const filtered = assets.filter(a =>
    (!activeCat  || a.category   === activeCat) &&
    (!activeDept || a.department === activeDept)
  );

  const totalValue = filtered.reduce((a, x) => a + Number(x.price || 0), 0);
  const byStatus   = filtered.reduce<Record<string,number>>((a,x)=>{a[x.status]=(a[x.status]||0)+1;return a;},{});

  // Always computed on full set for the bar lists
  const byCategory = assets.reduce<Record<string,number>>((a,x)=>{a[x.category]=(a[x.category]||0)+1;return a;},{});
  const byDept     = assets
    .filter(a => !activeCat || a.category === activeCat)   // dept list narrows by active category
    .reduce<Record<string,number>>((a,x)=>{ if(x.department){a[x.department]=(a[x.department]||0)+1;} return a; },{});

  const recent = [...filtered].sort((a,b)=>new Date(b.created_at||0).getTime()-new Date(a.created_at||0).getTime()).slice(0,5);

  const filterLabel = [
    activeCat  ? getCategoryLabel(activeCat)  : null,
    activeDept ? activeDept : null,
  ].filter(Boolean).join(' · ');

  return (
    <div className="space-y-6">

      {/* Active filter pill */}
      {filterLabel && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-400">Filtrando por:</span>
          <span className="flex items-center gap-1.5 px-2.5 py-1 bg-blue-600/20 border border-blue-500/40 rounded-full text-xs text-blue-300 font-medium">
            {filterLabel}
            <button onClick={() => { setActiveCat(null); setActiveDept(null); }}
              className="ml-1 hover:text-white transition-colors">✕</button>
          </span>
        </div>
      )}

      {/* KPIs — reflect filtered data */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title={activeCat ? getCategoryLabel(activeCat) : 'Total Hardware'} value={filtered.length}
          sub={filterLabel || undefined}
          icon={<Package className="w-5 h-5 text-blue-400" />}
          gradient="from-blue-600/20 to-blue-900/10" border="border-blue-500/20" />
        <StatCard title="Activos" value={byStatus['activo']||0}
          icon={<Activity className="w-5 h-5 text-green-400" />}
          gradient="from-green-600/20 to-green-900/10" border="border-green-500/20" />
        <StatCard title="En reparación" value={byStatus['reparacion']||0}
          icon={<AlertCircle className="w-5 h-5 text-yellow-400" />}
          gradient="from-yellow-600/20 to-yellow-900/10" border="border-yellow-500/20" />
        <StatCard title="Valor total"
          value={`${totalValue.toLocaleString('es-ES',{minimumFractionDigits:2})} €`}
          sub={filterLabel ? `solo ${filterLabel}` : undefined}
          icon={<TrendingUp className="w-5 h-5 text-purple-400" />}
          gradient="from-purple-600/20 to-purple-900/10" border="border-purple-500/20" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Categorías — clickables */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-white flex items-center gap-2"><Package className="w-4 h-4 text-blue-400"/>Por categoría</h3>
            {activeCat && <button onClick={()=>{setActiveCat(null);setActiveDept(null);}} className="text-xs text-gray-500 hover:text-white transition-colors">Limpiar</button>}
          </div>
          <div className="space-y-2.5">
            {Object.entries(byCategory).sort(([,a],[,b])=>b-a).map(([cat,count])=>(
              <button key={cat} onClick={()=>{ setActiveCat(p=>p===cat?null:cat); setActiveDept(null); }}
                className={`w-full flex items-center gap-3 rounded-lg px-2 py-1 transition-colors text-left ${activeCat===cat ? 'bg-blue-600/20 ring-1 ring-blue-500/40' : 'hover:bg-gray-800/60'}`}>
                <span className="text-base flex-shrink-0 w-6 text-center">{getCategoryIcon(cat)}</span>
                <span className={`text-sm flex-1 ${activeCat===cat ? 'text-blue-300 font-medium' : 'text-gray-300'}`}>{getCategoryLabel(cat)}</span>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <div className="w-20 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full transition-all ${activeCat===cat ? 'bg-blue-400' : 'bg-blue-500'}`}
                      style={{ width: `${(count/assets.length)*100}%` }} />
                  </div>
                  <span className={`text-sm font-medium w-6 text-right ${activeCat===cat ? 'text-blue-300' : 'text-white'}`}>{count}</span>
                </div>
              </button>
            ))}
            {!Object.keys(byCategory).length && <p className="text-gray-500 text-sm text-center py-4">Sin datos</p>}
          </div>
        </div>

        {/* Estado */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-white mb-4 flex items-center gap-2"><Activity className="w-4 h-4 text-green-400"/>Por estado {filterLabel && <span className="text-xs text-gray-500 font-normal">({filterLabel})</span>}</h3>
          <StatusGrid byStatus={byStatus} colors={assetStatusColors} labels={assetStatusLabels} />
        </div>

        {/* Departamentos — clickables */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-white flex items-center gap-2"><Building2 className="w-4 h-4 text-cyan-400"/>Por departamento {activeCat && <span className="text-xs text-gray-500 font-normal">({getCategoryLabel(activeCat)})</span>}</h3>
            {activeDept && <button onClick={()=>setActiveDept(null)} className="text-xs text-gray-500 hover:text-white transition-colors">Limpiar</button>}
          </div>
          <div className="space-y-2.5">
            {Object.entries(byDept).sort(([,a],[,b])=>b-a).map(([d,c])=>(
              <button key={d} onClick={()=>setActiveDept(p=>p===d?null:d)}
                className={`w-full flex items-center gap-3 rounded-lg px-2 py-1 transition-colors text-left ${activeDept===d ? 'bg-cyan-600/20 ring-1 ring-cyan-500/40' : 'hover:bg-gray-800/60'}`}>
                <span className={`text-sm flex-1 ${activeDept===d ? 'text-cyan-300 font-medium' : 'text-gray-300'}`}>{d}</span>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <div className="w-20 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full transition-all ${activeDept===d ? 'bg-cyan-400' : 'bg-cyan-500'}`}
                      style={{ width: `${(c/Object.values(byDept).reduce((a,b)=>a+b,0))*100}%` }} />
                  </div>
                  <span className={`text-sm font-medium w-6 text-right ${activeDept===d ? 'text-cyan-300' : 'text-white'}`}>{c}</span>
                </div>
              </button>
            ))}
            {!Object.keys(byDept).length && <p className="text-gray-500 text-sm text-center py-4">Sin departamentos asignados</p>}
          </div>
        </div>
      </div>

      {/* Tabla — refleja el filtro */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
        <h3 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
          <Clock className="w-4 h-4 text-gray-400"/>
          {filterLabel ? `Activos — ${filterLabel}` : 'Últimos registrados'}
          <span className="ml-auto text-xs text-gray-500 font-normal">{filtered.length} resultado(s)</span>
        </h3>
        {filtered.length === 0 ? <p className="text-gray-500 text-sm text-center py-6">Sin activos para este filtro</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-gray-800">
                {['Serie','Marca / Modelo','Categoría','Asignado a','Departamento','Estado'].map(h=>(
                  <th key={h} className="text-left text-gray-500 font-medium pb-2 pr-4 text-xs">{h}</th>
                ))}
              </tr></thead>
              <tbody className="divide-y divide-gray-800">
                {recent.map(a=>(
                  <tr key={a.id} className="hover:bg-gray-800/50 transition-colors">
                    <td className="py-2.5 pr-4 text-gray-300 font-mono text-xs">{a.serial_number}</td>
                    <td className="py-2.5 pr-4 text-white font-medium">{a.brand} {a.model}</td>
                    <td className="py-2.5 pr-4 text-gray-400 text-xs">{getCategoryIcon(a.category)} {getCategoryLabel(a.category)}</td>
                    <td className="py-2.5 pr-4 text-gray-400 text-xs">{a.assigned_to||'—'}</td>
                    <td className="py-2.5 pr-4 text-gray-400 text-xs">{a.department||'—'}</td>
                    <td className="py-2.5">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${assetStatusColors[a.status]||''}`}>
                        {assetStatusLabels[a.status]||a.status}
                      </span>
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

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Total Hardware" value={assets.length}
          icon={<Package className="w-5 h-5 text-blue-400" />}
          gradient="from-blue-600/20 to-blue-900/10" border="border-blue-500/20" />
        <StatCard title="Activos" value={byStatus['activo']||0}
          icon={<Activity className="w-5 h-5 text-green-400" />}
          gradient="from-green-600/20 to-green-900/10" border="border-green-500/20" />
        <StatCard title="En reparación" value={byStatus['reparacion']||0}
          icon={<AlertCircle className="w-5 h-5 text-yellow-400" />}
          gradient="from-yellow-600/20 to-yellow-900/10" border="border-yellow-500/20" />
        <StatCard title="Valor total"
          value={`${totalValue.toLocaleString('es-ES',{minimumFractionDigits:2})} €`}
          icon={<TrendingUp className="w-5 h-5 text-purple-400" />}
          gradient="from-purple-600/20 to-purple-900/10" border="border-purple-500/20" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-white mb-4 flex items-center gap-2"><Package className="w-4 h-4 text-blue-400"/>Por categoría</h3>
          <div className="space-y-2.5">
            {Object.entries(byCategory).sort(([,a],[,b])=>b-a).map(([cat,count])=>(
              <BarRow key={cat} label={getCategoryLabel(cat)} count={count} total={assets.length} icon={getCategoryIcon(cat)} />
            ))}
            {!Object.keys(byCategory).length && <p className="text-gray-500 text-sm text-center py-4">Sin datos</p>}
          </div>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-white mb-4 flex items-center gap-2"><Activity className="w-4 h-4 text-green-400"/>Por estado</h3>
          <StatusGrid byStatus={byStatus} colors={assetStatusColors} labels={assetStatusLabels} />
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-white mb-4 flex items-center gap-2"><Building2 className="w-4 h-4 text-cyan-400"/>Por departamento</h3>
          <div className="space-y-2.5">
            {Object.entries(byDept).sort(([,a],[,b])=>b-a).map(([d,c])=>(
              <BarRow key={d} label={d} count={c} total={assets.length} color="bg-cyan-500" />
            ))}
            {!Object.keys(byDept).length && <p className="text-gray-500 text-sm text-center py-4">Sin departamentos asignados</p>}
          </div>
        </div>
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
        <h3 className="text-sm font-semibold text-white mb-4 flex items-center gap-2"><Clock className="w-4 h-4 text-gray-400"/>Últimos registrados</h3>
        {recent.length === 0 ? <p className="text-gray-500 text-sm text-center py-6">Sin activos</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-gray-800">
                {['Serie','Marca / Modelo','Categoría','Asignado a','Departamento','Estado'].map(h=>(
                  <th key={h} className="text-left text-gray-500 font-medium pb-2 pr-4 text-xs">{h}</th>
                ))}
              </tr></thead>
              <tbody className="divide-y divide-gray-800">
                {recent.map(a=>(
                  <tr key={a.id} className="hover:bg-gray-800/50 transition-colors">
                    <td className="py-2.5 pr-4 text-gray-300 font-mono text-xs">{a.serial_number}</td>
                    <td className="py-2.5 pr-4 text-white font-medium">{a.brand} {a.model}</td>
                    <td className="py-2.5 pr-4 text-gray-400 text-xs">{getCategoryIcon(a.category)} {getCategoryLabel(a.category)}</td>
                    <td className="py-2.5 pr-4 text-gray-400 text-xs">{a.assigned_to||'—'}</td>
                    <td className="py-2.5 pr-4 text-gray-400 text-xs">{a.department||'—'}</td>
                    <td className="py-2.5">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${assetStatusColors[a.status]||''}`}>
                        {assetStatusLabels[a.status]||a.status}
                      </span>
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

// ── View: Software ────────────────────────────────────────────────────────────

function SoftwareView({ software }: { software: Software[] }) {
  const totalValue   = software.reduce((a,x)=>a+Number(x.price||0),0);
  const totalSeats   = software.reduce((a,x)=>a+Number(x.seats||0),0);
  const byStatus     = software.reduce<Record<string,number>>((a,x)=>{a[x.status]=(a[x.status]||0)+1;return a;},{});
  const byType       = software.reduce<Record<string,number>>((a,x)=>{a[x.license_type]=(a[x.license_type]||0)+1;return a;},{});
  const byDept       = software.reduce<Record<string,number>>((a,x)=>{ const d=(x as any).department; if(d){a[d]=(a[d]||0)+1;} return a; },{});
  const expiringSoon = software.filter(s=>{ if(!s.expiry_date)return false; const d=Math.ceil((new Date(s.expiry_date).getTime()-Date.now())/86400000); return d>=0&&d<=30; });

  const licenseLabels: Record<string,string> = {
    perpetua:'Perpetua', suscripcion:'Suscripción', freeware:'Freeware',
    opensource:'Open Source', trial:'Trial', volumen:'Volumen'
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Total Software" value={software.length}
          icon={<Package2 className="w-5 h-5 text-purple-400" />}
          gradient="from-purple-600/20 to-purple-900/10" border="border-purple-500/20" />
        <StatCard title="Activos" value={byStatus['activo']||0}
          icon={<Activity className="w-5 h-5 text-green-400" />}
          gradient="from-green-600/20 to-green-900/10" border="border-green-500/20" />
        <StatCard title="Licencias (puestos)" value={totalSeats}
          icon={<Monitor className="w-5 h-5 text-blue-400" />}
          gradient="from-blue-600/20 to-blue-900/10" border="border-blue-500/20" />
        <StatCard title="Inversión total"
          value={`${totalValue.toLocaleString('es-ES',{minimumFractionDigits:2})} €`}
          icon={<TrendingUp className="w-5 h-5 text-cyan-400" />}
          gradient="from-cyan-600/20 to-cyan-900/10" border="border-cyan-500/20" />
      </div>

      {expiringSoon.length > 0 && (
        <div className="flex items-start gap-3 bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-4">
          <AlertTriangle className="w-4 h-4 text-yellow-400 mt-0.5 flex-shrink-0" />
          <p className="text-sm text-yellow-300">
            {expiringSoon.length} licencia(s) expiran en los próximos 30 días:{' '}
            <span className="font-medium">{expiringSoon.map(s=>s.name).join(', ')}</span>
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-white mb-4 flex items-center gap-2"><Activity className="w-4 h-4 text-purple-400"/>Por estado</h3>
          <StatusGrid byStatus={byStatus} colors={swStatusColors} labels={swStatusLabels} />
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-white mb-4 flex items-center gap-2"><Package2 className="w-4 h-4 text-blue-400"/>Por tipo de licencia</h3>
          <div className="space-y-2.5">
            {Object.entries(byType).sort(([,a],[,b])=>b-a).map(([t,c])=>(
              <BarRow key={t} label={licenseLabels[t]||t} count={c} total={software.length} color="bg-purple-500" />
            ))}
            {!Object.keys(byType).length && <p className="text-gray-500 text-sm text-center py-4">Sin datos</p>}
          </div>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-white mb-4 flex items-center gap-2"><Building2 className="w-4 h-4 text-cyan-400"/>Por departamento</h3>
          <div className="space-y-2.5">
            {Object.entries(byDept).sort(([,a],[,b])=>b-a).map(([d,c])=>(
              <BarRow key={d} label={d} count={c} total={software.length} color="bg-cyan-500" />
            ))}
            {!Object.keys(byDept).length && <p className="text-gray-500 text-sm text-center py-4">Sin departamentos asignados</p>}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── View: Services ────────────────────────────────────────────────────────────

function ServicesView({ services }: { services: Service[] }) {
  const byStatus   = services.reduce<Record<string,number>>((a,x)=>{a[x.status]=(a[x.status]||0)+1;return a;},{});
  const byCategory = services.reduce<Record<string,number>>((a,x)=>{a[x.category]=(a[x.category]||0)+1;return a;},{});
  const byDept     = services.reduce<Record<string,number>>((a,x)=>{ if(x.department){a[x.department]=(a[x.department]||0)+1;} return a; },{});
  const monthly    = services.reduce((a,s)=>a+(s.billing_cycle==='mensual'?Number(s.cost):s.billing_cycle==='anual'?Number(s.cost)/12:0),0);
  const renewing   = services.filter(s=>{ if(!s.renewal_date)return false; const d=Math.ceil((new Date(s.renewal_date).getTime()-Date.now())/86400000); return d>=0&&d<=30; });

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Total Servicios" value={services.length}
          icon={<Globe className="w-5 h-5 text-cyan-400" />}
          gradient="from-cyan-600/20 to-cyan-900/10" border="border-cyan-500/20" />
        <StatCard title="Activos" value={byStatus['activo']||0}
          icon={<Activity className="w-5 h-5 text-green-400" />}
          gradient="from-green-600/20 to-green-900/10" border="border-green-500/20" />
        <StatCard title="Renueva pronto" value={renewing.length}
          icon={<Clock className="w-5 h-5 text-yellow-400" />}
          gradient="from-yellow-600/20 to-yellow-900/10" border="border-yellow-500/20" />
        <StatCard title="Coste mensual"
          value={`${monthly.toLocaleString('es-ES',{minimumFractionDigits:2})} €`}
          icon={<TrendingUp className="w-5 h-5 text-purple-400" />}
          gradient="from-purple-600/20 to-purple-900/10" border="border-purple-500/20" />
      </div>

      {renewing.length > 0 && (
        <div className="flex items-start gap-3 bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-4">
          <AlertTriangle className="w-4 h-4 text-yellow-400 mt-0.5 flex-shrink-0" />
          <p className="text-sm text-yellow-300">
            {renewing.length} servicio(s) con renovación en los próximos 30 días:{' '}
            <span className="font-medium">{renewing.map(s=>s.name).join(', ')}</span>
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-white mb-4 flex items-center gap-2"><Activity className="w-4 h-4 text-cyan-400"/>Por estado</h3>
          <StatusGrid byStatus={byStatus} colors={svcStatusColors} labels={svcStatusLabels} />
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-white mb-4 flex items-center gap-2"><Globe className="w-4 h-4 text-blue-400"/>Por categoría</h3>
          <div className="space-y-2.5">
            {Object.entries(byCategory).sort(([,a],[,b])=>b-a).map(([c,n])=>(
              <BarRow key={c} label={c} count={n} total={services.length} color="bg-cyan-500" />
            ))}
            {!Object.keys(byCategory).length && <p className="text-gray-500 text-sm text-center py-4">Sin datos</p>}
          </div>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-white mb-4 flex items-center gap-2"><Building2 className="w-4 h-4 text-green-400"/>Por departamento</h3>
          <div className="space-y-2.5">
            {Object.entries(byDept).sort(([,a],[,b])=>b-a).map(([d,c])=>(
              <BarRow key={d} label={d} count={c} total={services.length} color="bg-green-500" />
            ))}
            {!Object.keys(byDept).length && <p className="text-gray-500 text-sm text-center py-4">Sin departamentos asignados</p>}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── View: Department ──────────────────────────────────────────────────────────

function DepartmentView({ assets, software, services }: { assets: Asset[]; software: Software[]; services: Service[] }) {
  const { getCategoryLabel } = useCategories();

  const allDepts = [...new Set([
    ...assets.map(a=>a.department),
    ...software.map(s=>(s as any).department),
    ...services.map(s=>s.department),
  ].filter(Boolean))] as string[];

  const [activeDept, setActiveDept] = useState(allDepts[0] || '');

  const deptAssets   = assets.filter(a=>a.department===activeDept);
  const deptSoftware = software.filter(s=>(s as any).department===activeDept);
  const deptServices = services.filter(s=>s.department===activeDept);

  if (!allDepts.length) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-gray-500">
        <Building2 className="w-12 h-12 mb-3 opacity-20" />
        <p>No hay departamentos asignados aún.</p>
        <p className="text-xs mt-1">Asigna departamentos en Hardware, Software o Servicios.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Dept tabs */}
      <div className="flex flex-wrap gap-2">
        {allDepts.map(d=>(
          <button key={d} onClick={()=>setActiveDept(d)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${activeDept===d ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'}`}>
            {d}
          </button>
        ))}
      </div>

      {/* KPIs del dept */}
      <div className="grid grid-cols-3 gap-4">
        <StatCard title="Hardware" value={deptAssets.length}
          icon={<Package className="w-5 h-5 text-blue-400" />}
          gradient="from-blue-600/20 to-blue-900/10" border="border-blue-500/20" />
        <StatCard title="Software" value={deptSoftware.length}
          icon={<Package2 className="w-5 h-5 text-purple-400" />}
          gradient="from-purple-600/20 to-purple-900/10" border="border-purple-500/20" />
        <StatCard title="Servicios" value={deptServices.length}
          icon={<Globe className="w-5 h-5 text-cyan-400" />}
          gradient="from-cyan-600/20 to-cyan-900/10" border="border-cyan-500/20" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Hardware del dept */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2"><Package className="w-4 h-4 text-blue-400"/>Hardware</h3>
          {deptAssets.length === 0 ? <p className="text-gray-500 text-sm">Sin activos</p> : (
            <div className="space-y-2">
              {deptAssets.slice(0,8).map(a=>(
                <div key={a.id} className="flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-white truncate">{a.brand} {a.model}</p>
                    <p className="text-xs text-gray-500 font-mono">{a.serial_number}</p>
                  </div>
                  <span className={`px-1.5 py-0.5 rounded-full text-xs border ${assetStatusColors[a.status]||''}`}>
                    {assetStatusLabels[a.status]||a.status}
                  </span>
                </div>
              ))}
              {deptAssets.length > 8 && <p className="text-xs text-gray-500">+{deptAssets.length-8} más</p>}
            </div>
          )}
        </div>

        {/* Software del dept */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2"><Package2 className="w-4 h-4 text-purple-400"/>Software</h3>
          {deptSoftware.length === 0 ? <p className="text-gray-500 text-sm">Sin software</p> : (
            <div className="space-y-2">
              {deptSoftware.slice(0,8).map(s=>(
                <div key={s.id} className="flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-white truncate">{s.name}</p>
                    <p className="text-xs text-gray-500">{s.vendor}</p>
                  </div>
                  <span className={`px-1.5 py-0.5 rounded-full text-xs border ${swStatusColors[s.status]||''}`}>
                    {swStatusLabels[s.status]||s.status}
                  </span>
                </div>
              ))}
              {deptSoftware.length > 8 && <p className="text-xs text-gray-500">+{deptSoftware.length-8} más</p>}
            </div>
          )}
        </div>

        {/* Servicios del dept */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2"><Globe className="w-4 h-4 text-cyan-400"/>Servicios</h3>
          {deptServices.length === 0 ? <p className="text-gray-500 text-sm">Sin servicios</p> : (
            <div className="space-y-2">
              {deptServices.slice(0,8).map(s=>(
                <div key={s.id} className="flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-white truncate">{s.name}</p>
                    <p className="text-xs text-gray-500">{s.provider}</p>
                  </div>
                  <span className={`px-1.5 py-0.5 rounded-full text-xs border ${svcStatusColors[s.status]||''}`}>
                    {svcStatusLabels[s.status]||s.status}
                  </span>
                </div>
              ))}
              {deptServices.length > 8 && <p className="text-xs text-gray-500">+{deptServices.length-8} más</p>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main Dashboard ────────────────────────────────────────────────────────────

const VIEWS: { id: ViewMode; label: string; icon: React.ReactNode }[] = [
  { id: 'general',    label: 'General',        icon: <Activity className="w-4 h-4" /> },
  { id: 'hardware',   label: 'Hardware',        icon: <Package className="w-4 h-4" /> },
  { id: 'software',   label: 'Software',        icon: <Package2 className="w-4 h-4" /> },
  { id: 'services',   label: 'Servicios',       icon: <Globe className="w-4 h-4" /> },
  { id: 'department', label: 'Departamentos',   icon: <Building2 className="w-4 h-4" /> },
];

export default function DashboardPage() {
  const [view, setView]         = useState<ViewMode>('general');
  const [assets, setAssets]     = useState<Asset[]>([]);
  const [software, setSoftware] = useState<Software[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading]   = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      apiClient.get('/assets'),
      apiClient.get('/software'),
      apiClient.get('/services'),
    ]).then(([a, sw, svc]) => {
      setAssets(a.data || []);
      setSoftware(sw.data || []);
      setServices(svc.data || []);
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Dashboard</h1>
          <p className="text-gray-400 text-sm mt-1">Resumen del inventario de activos informáticos</p>
        </div>
        <button onClick={load} className="p-2 text-gray-400 hover:text-white bg-gray-900 border border-gray-800 rounded-lg transition-colors">
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* View selector */}
      <div className="flex flex-wrap gap-1.5 bg-gray-900 border border-gray-800 rounded-xl p-1.5">
        {VIEWS.map(v => (
          <button key={v.id} onClick={() => setView(v.id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              view === v.id ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/40' : 'text-gray-400 hover:text-white hover:bg-gray-800'
            }`}>
            {v.icon}{v.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="w-8 h-8 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />
        </div>
      ) : (
        <>
          <UnassignedAssetsWidget />
          {view === 'general'    && <GeneralView    assets={assets} software={software} services={services} />}
          {view === 'hardware'   && <HardwareView   assets={assets} />}
          {view === 'software'   && <SoftwareView   software={software} />}
          {view === 'services'   && <ServicesView   services={services} />}
          {view === 'department' && <DepartmentView assets={assets} software={software} services={services} />}
        </>
      )}
    </div>
  );
}
