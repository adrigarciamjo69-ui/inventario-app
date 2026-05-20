import { useEffect, useState, useCallback } from 'react';
import { Package, Activity, TrendingUp, AlertCircle, AlertTriangle, CheckCircle, User, Loader2 } from 'lucide-react';
import { getAssets, apiClient } from '../api/client';
import { Asset } from '../types';
import { useCategories } from '../context/CategoriesContext';

const statusColors: Record<string, string> = {
  activo:    'bg-green-500/20 text-green-400 border-green-500/30',
  inactivo:  'bg-gray-500/20 text-gray-400 border-gray-500/30',
  reparacion:'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  baja:      'bg-red-500/20 text-red-400 border-red-500/30',
};

const statusLabels: Record<string, string> = {
  activo: 'Activo', inactivo: 'Inactivo', reparacion: 'En reparación', baja: 'Baja',
};

// ── Types ─────────────────────────────────────────────────────────────────────

interface UnassignedItem {
  delivery_id: number;
  doc_id: string;
  client_user_id: number;
  delivery_date: string;
  first_name: string;
  last_name: string;
  asset_id: string;
  serial_number: string;
  brand: string;
  model: string;
  category: string;
  category_label: string;
  category_icon: string;
}

// ── UnassignedAssetsWidget ────────────────────────────────────────────────────

function UnassignedAssetsWidget() {
  const [items, setItems]       = useState<UnassignedItem[]>([]);
  const [loading, setLoading]   = useState(true);
  const [assigning, setAssigning] = useState<string | null>(null); // asset_id being assigned

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
      await apiClient.post('/deliveries/assign-asset', {
        asset_id: item.asset_id,
        client_user_id: item.client_user_id,
      });
      setItems(prev => prev.filter(i => !(i.asset_id === item.asset_id && i.client_user_id === item.client_user_id)));
    } catch {
      // error silenciado, el usuario puede reintentar
    } finally {
      setAssigning(null);
    }
  };

  // No mostrar el widget si no hay items (y no está cargando)
  if (!loading && items.length === 0) return null;

  return (
    <div className="bg-gray-900 border border-yellow-500/30 rounded-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-4 bg-yellow-500/5 border-b border-yellow-500/20">
        <div className="w-8 h-8 rounded-lg bg-yellow-500/20 flex items-center justify-center flex-shrink-0">
          <AlertTriangle className="w-4 h-4 text-yellow-400" />
        </div>
        <div className="flex-1">
          <h3 className="text-sm font-semibold text-white">Material entregado sin asignar en inventario</h3>
          <p className="text-xs text-gray-400 mt-0.5">
            Activos que aparecen en actas de entrega pero no tienen asignación en inventario
          </p>
        </div>
        {!loading && (
          <span className="flex-shrink-0 px-2.5 py-1 bg-yellow-500/20 text-yellow-400 text-xs font-bold rounded-full border border-yellow-500/30">
            {items.length}
          </span>
        )}
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center h-20">
          <div className="w-5 h-5 border-2 border-yellow-500/30 border-t-yellow-400 rounded-full animate-spin" />
        </div>
      ) : (
        <div className="divide-y divide-gray-800/60">
          {items.map(item => {
            const isAssigning = assigning === item.asset_id;
            return (
              <div key={`${item.asset_id}-${item.client_user_id}`}
                className="flex items-center gap-4 px-5 py-3.5 hover:bg-gray-800/30 transition-colors">

                {/* Categoría icono */}
                <span className="text-xl flex-shrink-0 w-7 text-center">
                  {item.category_icon || '💻'}
                </span>

                {/* Info activo */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-white">
                      {item.brand} {item.model}
                    </span>
                    <span className="text-xs text-gray-500 font-mono">{item.serial_number}</span>
                    <span className="text-xs px-1.5 py-0.5 rounded bg-gray-800 text-gray-400">
                      {item.category_label || item.category}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <User className="w-3 h-3 text-gray-500" />
                    <span className="text-xs text-gray-400">
                      {item.first_name} {item.last_name}
                    </span>
                    <span className="text-gray-700">·</span>
                    <span className="text-xs text-gray-500 font-mono">{item.doc_id}</span>
                    <span className="text-gray-700">·</span>
                    <span className="text-xs text-gray-500">
                      {new Date(item.delivery_date).toLocaleDateString('es-ES')}
                    </span>
                  </div>
                </div>

                {/* Botón asignar */}
                <button
                  onClick={() => assign(item)}
                  disabled={isAssigning}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white text-xs font-medium rounded-lg transition-colors flex-shrink-0"
                >
                  {isAssigning
                    ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    : <CheckCircle className="w-3.5 h-3.5" />
                  }
                  {isAssigning ? 'Asignando...' : 'Asignar'}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── StatCard ──────────────────────────────────────────────────────────────────

function StatCard({ title, value, icon, bg, border }: {
  title: string; value: string; icon: React.ReactNode; bg: string; border: string;
}) {
  return (
    <div className={`bg-gradient-to-br ${bg} border ${border} rounded-xl p-5`}>
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm text-gray-400">{title}</p>
        <div className="p-2 bg-gray-800/60 rounded-lg">{icon}</div>
      </div>
      <p className="text-2xl font-bold text-white">{value}</p>
    </div>
  );
}

// ── DashboardPage ─────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { getCategoryLabel, getCategoryIcon } = useCategories();
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getAssets()
      .then(res => setAssets(res.data))
      .catch(() => setAssets([]))
      .finally(() => setLoading(false));
  }, []);

  const totalValue = assets.reduce((acc, a) => acc + Number(a.price || 0), 0);

  const byCategory = assets.reduce<Record<string, number>>((acc, a) => {
    acc[a.category] = (acc[a.category] || 0) + 1;
    return acc;
  }, {});

  const byStatus = assets.reduce<Record<string, number>>((acc, a) => {
    acc[a.status] = (acc[a.status] || 0) + 1;
    return acc;
  }, {});

  const recentAssets = [...assets]
    .sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())
    .slice(0, 5);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Dashboard</h1>
        <p className="text-gray-400 text-sm mt-1">Resumen del inventario de activos informáticos</p>
      </div>

      {/* Widget material sin asignar — aparece solo si hay items */}
      <UnassignedAssetsWidget />

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard title="Total Activos"  value={assets.length.toString()}
          icon={<Package className="w-5 h-5 text-blue-400" />}
          bg="from-blue-600/20 to-blue-900/10" border="border-blue-500/20" />
        <StatCard title="Activos en uso" value={(byStatus['activo'] || 0).toString()}
          icon={<Activity className="w-5 h-5 text-green-400" />}
          bg="from-green-600/20 to-green-900/10" border="border-green-500/20" />
        <StatCard title="En reparación"  value={(byStatus['reparacion'] || 0).toString()}
          icon={<AlertCircle className="w-5 h-5 text-yellow-400" />}
          bg="from-yellow-600/20 to-yellow-900/10" border="border-yellow-500/20" />
        <StatCard title="Valor total"
          value={`${totalValue.toLocaleString('es-ES', { minimumFractionDigits: 2 })} €`}
          icon={<TrendingUp className="w-5 h-5 text-purple-400" />}
          bg="from-purple-600/20 to-purple-900/10" border="border-purple-500/20" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* By Category */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
            <Package className="w-4 h-4 text-blue-400" /> Activos por Categoría
          </h3>
          <div className="space-y-2.5">
            {Object.entries(byCategory).sort(([,a],[,b]) => b - a).map(([cat, count]) => (
              <div key={cat} className="flex items-center gap-3">
                <span className="text-lg flex-shrink-0 w-6 text-center">{getCategoryIcon(cat)}</span>
                <span className="text-sm text-gray-300 flex-1">{getCategoryLabel(cat)}</span>
                <div className="flex items-center gap-2">
                  <div className="w-24 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                    <div className="h-full bg-blue-500 rounded-full"
                      style={{ width: `${(count / assets.length) * 100}%` }} />
                  </div>
                  <span className="text-sm font-medium text-white w-6 text-right">{count}</span>
                </div>
              </div>
            ))}
            {Object.keys(byCategory).length === 0 && (
              <p className="text-gray-500 text-sm text-center py-4">Sin datos</p>
            )}
          </div>
        </div>

        {/* By Status */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
            <Activity className="w-4 h-4 text-green-400" /> Estado de los Activos
          </h3>
          <div className="grid grid-cols-2 gap-3">
            {Object.entries(byStatus).map(([status, count]) => (
              <div key={status}
                className={`rounded-lg border px-4 py-3 ${statusColors[status] || 'bg-gray-700/30 text-gray-400 border-gray-700'}`}>
                <p className="text-2xl font-bold">{count}</p>
                <p className="text-xs mt-1">{statusLabels[status] || status}</p>
              </div>
            ))}
            {Object.keys(byStatus).length === 0 && (
              <p className="col-span-2 text-gray-500 text-sm text-center py-4">Sin datos</p>
            )}
          </div>
        </div>
      </div>

      {/* Recent Assets */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
        <h3 className="text-sm font-semibold text-white mb-4">Últimos activos registrados</h3>
        {recentAssets.length === 0 ? (
          <p className="text-gray-500 text-sm text-center py-6">No hay activos registrados aún</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800">
                  <th className="text-left text-gray-500 font-medium pb-2 pr-4">Serie</th>
                  <th className="text-left text-gray-500 font-medium pb-2 pr-4">Marca / Modelo</th>
                  <th className="text-left text-gray-500 font-medium pb-2 pr-4">Categoría</th>
                  <th className="text-left text-gray-500 font-medium pb-2 pr-4">Asignado a</th>
                  <th className="text-left text-gray-500 font-medium pb-2">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {recentAssets.map(a => (
                  <tr key={a.serial_number} className="hover:bg-gray-800/50 transition-colors">
                    <td className="py-2.5 pr-4 text-gray-300 font-mono text-xs">{a.serial_number}</td>
                    <td className="py-2.5 pr-4 text-white font-medium">{a.brand} {a.model}</td>
                    <td className="py-2.5 pr-4 text-gray-400">
                      <span className="flex items-center gap-1">
                        <span>{getCategoryIcon(a.category)}</span>
                        <span>{getCategoryLabel(a.category)}</span>
                      </span>
                    </td>
                    <td className="py-2.5 pr-4 text-gray-400">{a.assigned_to || '—'}</td>
                    <td className="py-2.5">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${statusColors[a.status] || ''}`}>
                        {statusLabels[a.status] || a.status}
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
