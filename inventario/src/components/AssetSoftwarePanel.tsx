import { useEffect, useMemo, useState } from 'react';
import { Package, Search } from 'lucide-react';
import { getAssetSoftware } from '../api/client';
import toast from 'react-hot-toast';

type SoftwareItem = {
  name: string;
  version?: string;
  publisher?: string;
  install_date?: string;
  arch?: string;
};

type SoftwareInfo = {
  asset_id: string;
  software: SoftwareItem[];
  scanned_at: string | null;
  source: string | null;
  updated_at: string | null;
};

function formatInstallDate(d?: string): string {
  if (!d) return '';
  if (/^\d{8}$/.test(d)) return d.slice(6, 8) + '/' + d.slice(4, 6) + '/' + d.slice(0, 4);
  return d;
}

export default function AssetSoftwarePanel({ assetId }: { assetId: string }) {
  const [data, setData] = useState<SoftwareInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getAssetSoftware(assetId)
      .then((r) => { if (!cancelled) setData(r.data); })
      .catch(() => { if (!cancelled) toast.error('No se pudo cargar el software del equipo'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [assetId]);

  const filtered = useMemo(() => {
    const list = (data?.software || []) as SoftwareItem[];
    const needle = q.trim().toLowerCase();
    if (!needle) return list;
    return list.filter((s) =>
      (s.name || '').toLowerCase().includes(needle) ||
      (s.publisher || '').toLowerCase().includes(needle) ||
      (s.version || '').toLowerCase().includes(needle)
    );
  }, [data, q]);

  if (loading) {
    return <div className="text-gray-400 py-6 text-center">Cargando software instalado...</div>;
  }

  const list = data?.software || [];

  if (!list.length) {
    return (
      <div className="bg-gray-900/40 border border-gray-800 rounded-lg p-6 text-center">
        <Package className="w-10 h-10 mx-auto text-gray-500 mb-3" />
        <p className="text-gray-300 font-medium">Sin software inventariado</p>
        <p className="text-gray-500 text-sm mt-1 max-w-md mx-auto">
          Aun no se ha escaneado este equipo o el escaneo no consiguio leer el registro de aplicaciones.
          Lanza un escaneo WMI exitoso (manual o programado) para rellenar esta pestaña.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="text-sm text-gray-400">
          <span className="text-gray-200 font-medium">{list.length}</span> aplicaciones detectadas
          {data?.scanned_at && (<> &middot; ultimo escaneo: {new Date(data.scanned_at).toLocaleString('es-ES')}</>)}
          {data?.source && (<> &middot; fuente: {data.source}</>)}
        </div>
        <div className="relative">
          <Search className="w-4 h-4 absolute left-2 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar aplicacion, fabricante, version..."
            className="pl-8 pr-3 py-1.5 bg-gray-800 border border-gray-700 rounded text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-blue-500 w-64"
          />
        </div>
      </div>
      <div className="overflow-x-auto border border-gray-800 rounded-lg">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-800/60 text-gray-300">
            <tr>
              <th className="text-left px-3 py-2 font-medium">Aplicacion</th>
              <th className="text-left px-3 py-2 font-medium">Version</th>
              <th className="text-left px-3 py-2 font-medium">Fabricante</th>
              <th className="text-left px-3 py-2 font-medium">Instalado</th>
              <th className="text-left px-3 py-2 font-medium">Arch.</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800">
            {filtered.map((s, i) => (
              <tr key={i} className="hover:bg-gray-800/40">
                <td className="px-3 py-1.5 text-gray-100">{s.name}</td>
                <td className="px-3 py-1.5 text-gray-400">{s.version || '-'}</td>
                <td className="px-3 py-1.5 text-gray-400">{s.publisher || '-'}</td>
                <td className="px-3 py-1.5 text-gray-400">{formatInstallDate(s.install_date)}</td>
                <td className="px-3 py-1.5 text-gray-500">{s.arch || ''}</td>
              </tr>
            ))}
            {!filtered.length && (
              <tr>
                <td colSpan={5} className="px-3 py-4 text-center text-gray-500">Sin resultados</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
