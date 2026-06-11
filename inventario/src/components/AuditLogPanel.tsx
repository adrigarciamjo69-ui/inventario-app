import { useEffect, useState, useCallback } from 'react';
import { History, RefreshCw, User, Plus, Pencil, Trash2, ChevronDown, ChevronUp } from 'lucide-react';
import { apiClient } from '../api/client';

interface AuditEntry {
  id: number;
  user_name: string;
  action: 'created' | 'updated' | 'deleted';
  changes: { field: string; label: string; old: string | null; new: string | null }[] | null;
  created_at: string;
}

const ACTION_CONFIG = {
  created: { label: 'Creado',      icon: <Plus className="w-3.5 h-3.5" />,   color: 'text-green-400 bg-green-500/10 border-green-500/30' },
  updated: { label: 'Modificado',  icon: <Pencil className="w-3.5 h-3.5" />, color: 'text-blue-400 bg-blue-500/10 border-blue-500/30' },
  deleted: { label: 'Eliminado',   icon: <Trash2 className="w-3.5 h-3.5" />, color: 'text-red-400 bg-red-500/10 border-red-500/30' },
};

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60000);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (d > 30) return new Date(dateStr).toLocaleDateString('es-ES');
  if (d > 0)  return `hace ${d} día${d > 1 ? 's' : ''}`;
  if (h > 0)  return `hace ${h} hora${h > 1 ? 's' : ''}`;
  if (m > 0)  return `hace ${m} min`;
  return 'ahora mismo';
}

export default function AuditLogPanel({ assetId }: { assetId: string }) {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const load = useCallback(() => {
    setLoading(true);
    apiClient.get(`/assets/${assetId}/log`)
      .then(r => setEntries(r.data || []))
      .catch(() => setEntries([]))
      .finally(() => setLoading(false));
  }, [assetId]);

  useEffect(() => { load(); }, [load]);

  const toggleExpand = (id: number) => {
    setExpanded(prev => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  };

  return (
    <div className="mt-5">
      <div className="flex items-center gap-2 mb-3">
        <History className="w-4 h-4 text-purple-400" />
        <h3 className="text-sm font-medium text-white">Historial de cambios</h3>
        {entries.length > 0 && (
          <span className="px-1.5 py-0.5 text-xs bg-purple-600/20 text-purple-400 rounded-full">{entries.length}</span>
        )}
        <button onClick={load} disabled={loading} title="Refrescar" className="ml-auto p-1 text-gray-500 hover:text-white transition-colors">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-8">
          <div className="w-5 h-5 border-2 border-purple-500/30 border-t-purple-500 rounded-full animate-spin" />
        </div>
      ) : entries.length === 0 ? (
        <div className="text-center py-8 text-gray-500 text-sm">Sin cambios registrados</div>
      ) : (
        <div className="relative">
          {/* Timeline line */}
          <div className="absolute left-4 top-2 bottom-2 w-px bg-gray-800" />

          <div className="space-y-2">
            {entries.map(entry => {
              const cfg = ACTION_CONFIG[entry.action] || ACTION_CONFIG.updated;
              const isOpen = expanded.has(entry.id);
              const hasChanges = entry.changes && entry.changes.length > 0;

              return (
                <div key={entry.id} className="relative pl-10">
                  {/* Dot */}
                  <div className={`absolute left-2.5 top-3 w-3 h-3 rounded-full border-2 border-gray-900 ${
                    entry.action === 'created' ? 'bg-green-500' :
                    entry.action === 'deleted' ? 'bg-red-500' : 'bg-blue-500'
                  }`} />

                  <div className="bg-gray-800/50 border border-gray-700/50 rounded-lg overflow-hidden">
                    <div
                      className={`flex items-center gap-2 px-3 py-2.5 ${hasChanges ? 'cursor-pointer hover:bg-gray-700/30' : ''}`}
                      onClick={() => hasChanges && toggleExpand(entry.id)}
                    >
                      <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs border ${cfg.color}`}>
                        {cfg.icon} {cfg.label}
                      </span>
                      <div className="flex items-center gap-1 text-xs text-gray-400">
                        <User className="w-3 h-3" />
                        <span className="font-medium text-gray-300">{entry.user_name}</span>
                      </div>
                      <span className="text-xs text-gray-600 ml-auto">{timeAgo(entry.created_at)}</span>
                      <span className="text-xs text-gray-600">{new Date(entry.created_at).toLocaleDateString('es-ES', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' })}</span>
                      {hasChanges && (
                        isOpen ? <ChevronUp className="w-3.5 h-3.5 text-gray-500" /> : <ChevronDown className="w-3.5 h-3.5 text-gray-500" />
                      )}
                    </div>

                    {isOpen && entry.changes && (
                      <div className="border-t border-gray-700/50 divide-y divide-gray-700/30">
                        {entry.changes.map((c, i) => (
                          <div key={i} className="px-3 py-2 grid grid-cols-3 gap-2 text-xs">
                            <span className="text-gray-400 font-medium">{c.label}</span>
                            <span className="text-red-400 line-through truncate">{c.old ?? '-'}</span>
                            <span className="text-green-400 truncate">{c.new ?? '-'}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
