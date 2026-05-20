import { useState, useEffect } from 'react';
import { Users2, Link2, Link2Off, Loader2, UserCheck } from 'lucide-react';
import toast from 'react-hot-toast';
import { AssetUserLink, AssetUserLinkType, ClientUser } from '../types';
import { getAssetUsers, linkAssetUser, unlinkAssetUser, getClientUsers } from '../api/client';
import { useAuth } from '../context/AuthContext';

const LINK_TYPES: { value: AssetUserLinkType; label: string; color: string }[] = [
  { value: 'asignado',          label: 'Asignado',          color: 'bg-blue-500/20 text-blue-400 border-blue-500/30' },
  { value: 'responsable',       label: 'Responsable',       color: 'bg-purple-500/20 text-purple-400 border-purple-500/30' },
  { value: 'usuario_secundario',label: 'Usuario secundario',color: 'bg-gray-500/20 text-gray-400 border-gray-500/30' },
];

const getLinkTypeLabel = (t: string) => LINK_TYPES.find(l => l.value === t)?.label || t;
const getLinkTypeColor = (t: string) => LINK_TYPES.find(l => l.value === t)?.color || '';

interface AssetUsersPanelProps {
  assetId: string;
}

export default function AssetUsersPanel({ assetId }: AssetUsersPanelProps) {
  const { user } = useAuth();
  const canEdit = user?.role === 'admin' || user?.role === 'editor';

  const [links, setLinks]         = useState<AssetUserLink[]>([]);
  const [clientUsers, setClientUsers] = useState<ClientUser[]>([]);
  const [loading, setLoading]     = useState(true);
  const [selUser, setSelUser]     = useState('');
  const [selType, setSelType]     = useState<AssetUserLinkType>('asignado');
  const [adding, setAdding]       = useState(false);

  const loadLinks = async () => {
    try {
      const res = await getAssetUsers(assetId);
      setLinks(res.data);
    } catch { /* silencioso */ }
    finally { setLoading(false); }
  };

  useEffect(() => {
    loadLinks();
    getClientUsers()
      .then(res => setClientUsers(res.data.filter((u: ClientUser) => u.active)))
      .catch(() => {});
  }, [assetId]);

  const linkedIds = new Set(links.map(l => l.client_user_id));
  const available = clientUsers.filter(u => !linkedIds.has(u.id));

  const handleLink = async () => {
    if (!selUser) return;
    setAdding(true);
    try {
      const res = await linkAssetUser(assetId, { client_user_id: parseInt(selUser), link_type: selType });
      setLinks(prev => [...prev, res.data]);
      setSelUser('');
      toast.success('Usuario vinculado al activo');
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      toast.error(e.response?.data?.error || 'Error al vincular usuario');
    } finally { setAdding(false); }
  };

  const handleUnlink = async (linkId: number) => {
    try {
      await unlinkAssetUser(linkId);
      setLinks(prev => prev.filter(l => l.id !== linkId));
      toast.success('Vínculo eliminado');
    } catch { toast.error('Error al desvincular usuario'); }
  };

  return (
    <div className="mt-5 border-t border-gray-800 pt-5 space-y-3">
      <div className="flex items-center gap-2 mb-3">
        <UserCheck className="w-4 h-4 text-emerald-400" />
        <h3 className="text-sm font-semibold text-white">
          Usuarios asignados
          {links.length > 0 && (
            <span className="ml-2 text-xs text-gray-500 font-normal">({links.length})</span>
          )}
        </h3>
      </div>

      {/* Selector para añadir */}
      {canEdit && (
        <div className="flex gap-2 flex-wrap">
          <select value={selUser} onChange={e => setSelUser(e.target.value)}
            className="flex-1 min-w-0 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500">
            <option value="">Seleccionar usuario cliente...</option>
            {available.map(u => (
              <option key={u.id} value={u.id}>
                {u.first_name} {u.last_name}{u.department ? ` — ${u.department}` : ''}
              </option>
            ))}
          </select>

          <select value={selType} onChange={e => setSelType(e.target.value as AssetUserLinkType)}
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500">
            {LINK_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>

          <button onClick={handleLink} disabled={!selUser || adding}
            className="flex items-center gap-1.5 px-3 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-900 disabled:text-emerald-400 text-white text-xs font-medium rounded-lg transition-colors">
            {adding ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Link2 className="w-3.5 h-3.5" />}
            Vincular
          </button>
        </div>
      )}

      {/* Lista de usuarios vinculados */}
      {loading ? (
        <div className="flex items-center gap-2 py-3 text-gray-500 text-sm">
          <Loader2 className="w-4 h-4 animate-spin" /> Cargando...
        </div>
      ) : links.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-6 text-gray-600 border border-dashed border-gray-800 rounded-lg">
          <Users2 className="w-8 h-8 mb-2 opacity-40" />
          <p className="text-sm">No hay usuarios vinculados</p>
          {canEdit && <p className="text-xs mt-1">Selecciona un usuario del desplegable para vincularlo</p>}
        </div>
      ) : (
        <div className="space-y-2">
          {links.map(link => (
            <div key={link.id} className="flex items-center gap-3 px-3 py-2.5 bg-gray-800/50 border border-gray-700/50 rounded-lg">
              <div className="w-7 h-7 rounded-full bg-emerald-600/30 flex items-center justify-center text-xs font-bold text-emerald-400 flex-shrink-0">
                {link.first_name?.charAt(0)}{link.last_name?.charAt(0)}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-white font-medium">
                  {link.first_name} {link.last_name}
                </p>
                <div className="flex items-center gap-2 text-xs text-gray-500">
                  {link.department && <span>{link.department}</span>}
                  {link.position && <><span>·</span><span>{link.position}</span></>}
                </div>
              </div>
              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border flex-shrink-0 ${getLinkTypeColor(link.link_type)}`}>
                {getLinkTypeLabel(link.link_type)}
              </span>
              {canEdit && (
                <button onClick={() => handleUnlink(link.id)}
                  className="text-gray-500 hover:text-red-400 transition-colors p-1 flex-shrink-0"
                  title="Desvincular">
                  <Link2Off className="w-4 h-4" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
