import { useEffect, useState, useCallback, useRef } from 'react';
import {
  Plus, Search, Download, Upload, Pencil, Trash2,
  ChevronUp, ChevronDown, Filter, FileDown, AlertTriangle, Package,
  User2, X, CheckSquare, Square, Tag, Paperclip
} from 'lucide-react';
import Papa from 'papaparse';
import toast from 'react-hot-toast';
import { Asset } from '../types';
import { getAssets, createAsset, updateAsset, deleteAsset, importAssets } from '../api/client';
import AssetForm from '../components/AssetForm';
import { useAuth } from '../context/AuthContext';
import { useCategories } from '../context/CategoriesContext';
import BulkEditModal from '../components/BulkEditModal';

const statusColors: Record<string, string> = {
  activo:    'bg-green-500/20 text-green-400 border-green-500/30',
  inactivo:  'bg-gray-500/20 text-gray-400 border-gray-500/30',
  reparacion:'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  baja:      'bg-red-500/20 text-red-400 border-red-500/30',
};

const statusLabels: Record<string, string> = {
  activo: 'Activo', inactivo: 'Inactivo', reparacion: 'En reparación', baja: 'Baja',
};

const CSV_TEMPLATE_HEADERS = [
  'id', 'serial_number', 'category', 'brand', 'model',
  'price', 'purchase_date', 'purchase_order', 'assigned_to', 'status', 'notes'
];

type SortField = keyof Asset;

// ── Checkbox visual ───────────────────────────────────────────────────────────
function Checkbox({ checked, indeterminate, onChange }: {
  checked: boolean; indeterminate?: boolean; onChange: () => void;
}) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onChange(); }}
      className="flex items-center justify-center w-5 h-5 flex-shrink-0"
      type="button"
    >
      {indeterminate
        ? <CheckSquare className="w-4 h-4 text-blue-400" />
        : checked
          ? <CheckSquare className="w-4 h-4 text-blue-500" />
          : <Square className="w-4 h-4 text-gray-600 hover:text-gray-400" />
      }
    </button>
  );
}

export default function AssetsPage() {
  const { user } = useAuth();
  const { categories, getCategoryLabel } = useCategories();
  const [assets, setAssets]               = useState<Asset[]>([]);
  const [loading, setLoading]             = useState(true);
  const [search, setSearch]               = useState('');
  const [filterCategories, setFilterCategories] = useState<Set<string>>(new Set());
  const [filterStatuses, setFilterStatuses]     = useState<Set<string>>(new Set());
  const [filterDepts, setFilterDepts]           = useState<Set<string>>(new Set());
  const [filterAssignedTo, setFilterAssignedTo] = useState('');
  const [sortField, setSortField]         = useState<SortField>('brand');
  const [sortDir, setSortDir]             = useState<'asc' | 'desc'>('asc');
  const [showForm, setShowForm]           = useState(false);
  const [editAsset, setEditAsset]         = useState<Asset | null>(null);
  const [deleteModal, setDeleteModal]     = useState<Asset | null>(null);
  const [deleting, setDeleting]           = useState(false);
  const [importLoading, setImportLoading] = useState(false);

  // ── Selección múltiple ──────────────────────────────────────────────────────
  const [selected, setSelected]           = useState<Set<string>>(new Set());
  const [bulkDeleteModal, setBulkDeleteModal] = useState(false);
  const [bulkDeleting, setBulkDeleting]   = useState(false);
  const [bulkEditModal, setBulkEditModal] = useState(false);
  const [bulkStatusModal, setBulkStatusModal] = useState(false);
  const [bulkStatus, setBulkStatus]       = useState('activo');

  const canEdit = user?.role === 'admin' || user?.role === 'editor';

  // ── Dropdown open states ────────────────────────────────────────────────────
  const [openDropdown, setOpenDropdown] = useState<'category' | 'status' | 'dept' | null>(null);
  const toggleDropdown = (name: 'category' | 'status' | 'dept') =>
    setOpenDropdown(prev => (prev === name ? null : name));

  // Cerrar dropdown al hacer clic fuera
  useEffect(() => {
    if (!openDropdown) return;
    const handler = () => setOpenDropdown(null);
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [openDropdown]);

  const load = useCallback(() => {
    setLoading(true);
    getAssets()
      .then((res) => setAssets(res.data))
      .catch(() => toast.error('Error al cargar activos'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  // Limpiar selección cuando cambian los filtros
  useEffect(() => { setSelected(new Set()); }, [search, filterCategories, filterStatuses, filterDepts, filterAssignedTo]);

  const handleSort = (field: SortField) => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('asc'); }
  };

  const assignedToOptions = Array.from(
    new Set(assets.map(a => a.assigned_to).filter(Boolean))
  ).sort() as string[];

  const deptOptions = Array.from(
    new Set(assets.map(a => a.department).filter(Boolean))
  ).sort() as string[];

  const filtered = assets
    .filter((a) => {
      const q = search.toLowerCase();
      return (
        (!q ||
          a.serial_number.toLowerCase().includes(q) ||
          a.brand.toLowerCase().includes(q) ||
          a.model.toLowerCase().includes(q) ||
          (a.assigned_to?.toLowerCase().includes(q) ?? false) ||
          (a.id?.toLowerCase().includes(q) ?? false) ||
          (a.purchase_order?.toLowerCase().includes(q) ?? false)
        ) &&
        (filterCategories.size === 0 || filterCategories.has(a.category)) &&
        (filterStatuses.size   === 0 || filterStatuses.has(a.status)) &&
        (filterDepts.size      === 0 || filterDepts.has(a.department || '')) &&
        (!filterAssignedTo || a.assigned_to === filterAssignedTo)
      );
    })
    .sort((a, b) => {
      const av = String(a[sortField] ?? '');
      const bv = String(b[sortField] ?? '');
      return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
    });

  // ── Helpers de selección ────────────────────────────────────────────────────
  const filteredIds = filtered.map(a => a.id);
  const allSelected = filteredIds.length > 0 && filteredIds.every(id => selected.has(id));
  const someSelected = filteredIds.some(id => selected.has(id));

  const toggleAll = () => {
    if (allSelected) {
      setSelected(prev => { const n = new Set(prev); filteredIds.forEach(id => n.delete(id)); return n; });
    } else {
      setSelected(prev => { const n = new Set(prev); filteredIds.forEach(id => n.add(id)); return n; });
    }
  };

  const lastClickedId = useRef<string | null>(null);
  const filteredIdsRef = useRef<string[]>([]);
  filteredIdsRef.current = filteredIds;

  const toggleOne = (id: string, shiftKey = false) => {
    const ids = filteredIdsRef.current;
    if (shiftKey && lastClickedId.current && lastClickedId.current !== id) {
      const fromIdx = ids.indexOf(lastClickedId.current);
      const toIdx   = ids.indexOf(id);
      if (fromIdx !== -1 && toIdx !== -1) {
        const [start, end] = fromIdx < toIdx ? [fromIdx, toIdx] : [toIdx, fromIdx];
        const rangeIds = ids.slice(start, end + 1);
        setSelected(prev => {
          const n = new Set(prev);
          rangeIds.forEach(rid => n.add(rid));
          return n;
        });
        lastClickedId.current = id;
        return;
      }
    }
    lastClickedId.current = id;
    setSelected(prev => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };

  const clearSelection = () => { setSelected(new Set()); lastClickedId.current = null; };

  // ── Acciones masivas ────────────────────────────────────────────────────────
  const handleBulkExport = () => {
    const rows = assets
      .filter(a => selected.has(a.id))
      .map(a => ({
        id: a.id, serial_number: a.serial_number, category: a.category,
        brand: a.brand, model: a.model, price: a.price,
        purchase_date: a.purchase_date?.slice(0, 10) || '',
        purchase_order: a.purchase_order, assigned_to: a.assigned_to,
        status: a.status, notes: a.notes || '',
      }));
    const csv = Papa.unparse(rows);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `activos_seleccionados_${new Date().toISOString().slice(0,10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
    toast.success(`Exportados ${rows.length} activos seleccionados`);
  };

  const handleBulkDelete = async () => {
    setBulkDeleting(true);
    let ok = 0, fail = 0;
    for (const id of selected) {
      try { await deleteAsset(id); ok++; }
      catch { fail++; }
    }
    setBulkDeleting(false);
    setBulkDeleteModal(false);
    clearSelection();
    if (ok > 0) toast.success(`${ok} activo${ok > 1 ? 's' : ''} eliminado${ok > 1 ? 's' : ''}`);
    if (fail > 0) toast.error(`${fail} activo${fail > 1 ? 's' : ''} no se pudo${fail > 1 ? 'ron' : ''} eliminar`);
    load();
  };

  const handleBulkStatus = async () => {
    let ok = 0, fail = 0;
    for (const id of selected) {
      const asset = assets.find(a => a.id === id);
      if (!asset) continue;
      try { await updateAsset(id, { ...asset, status: bulkStatus }); ok++; }
      catch { fail++; }
    }
    setBulkStatusModal(false); clearSelection();
    if (ok > 0) toast.success(`Estado actualizado en ${ok} activo${ok > 1 ? 's' : ''}`);
    if (fail > 0) toast.error(`${fail} no se pudo${fail > 1 ? 'ron' : ''} actualizar`);
    load();
  };

  const handleBulkEdit = async (fields: Partial<Asset>) => {
    let ok = 0, fail = 0;
    for (const id of selected) {
      const asset = assets.find(a => a.id === id);
      if (!asset) continue;
      try { await updateAsset(id, { ...asset, ...fields }); ok++; }
      catch { fail++; }
    }
    setBulkEditModal(false); clearSelection();
    if (ok > 0) toast.success(`${ok} activo${ok > 1 ? 's' : ''} actualizado${ok > 1 ? 's' : ''}`);
    if (fail > 0) toast.error(`${fail} no se pudo${fail > 1 ? 'ron' : ''} actualizar`);
    load();
  };

  // ── CRUD ────────────────────────────────────────────────────────────────────
  const handleSave = async (data: Omit<Asset, 'created_at' | 'updated_at'>) => {
    try {
      if (editAsset) {
        await updateAsset(editAsset.id, data);
        toast.success('Activo actualizado correctamente');
      } else {
        await createAsset(data);
        toast.success('Activo creado correctamente');
      }
      setShowForm(false); setEditAsset(null); load();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      toast.error(e.response?.data?.error || 'Error al guardar el activo');
      throw err;
    }
  };

  const handleDelete = async () => {
    if (!deleteModal) return;
    setDeleting(true);
    try {
      await deleteAsset(deleteModal.id);
      toast.success('Activo eliminado');
      setDeleteModal(null); load();
    } catch {
      toast.error('Error al eliminar el activo');
    } finally { setDeleting(false); }
  };

  // ── CSV ─────────────────────────────────────────────────────────────────────
  const handleExport = () => {
    const rows = filtered.map((a) => ({
      id: a.id, serial_number: a.serial_number, category: a.category,
      brand: a.brand, model: a.model, price: a.price,
      purchase_date: a.purchase_date?.slice(0, 10) || '',
      purchase_order: a.purchase_order, assigned_to: a.assigned_to,
      status: a.status, notes: a.notes || '',
    }));
    const csv = Papa.unparse(rows);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `inventario_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
    toast.success(`Exportados ${rows.length} activos`);
  };

  const handleDownloadTemplate = () => {
    const example = [{
      id: 'IT-001', serial_number: 'SN-ABC12345', category: 'laptop',
      brand: 'Dell', model: 'Latitude 5540', price: '1200.00',
      purchase_date: '2024-01-15', purchase_order: 'OC-2024-001',
      assigned_to: 'Juan García', status: 'activo', notes: 'Ejemplo'
    }];
    const csv = Papa.unparse({ fields: CSV_TEMPLATE_HEADERS, data: example });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'plantilla_inventario.csv';
    a.click(); URL.revokeObjectURL(url);
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportLoading(true);
    Papa.parse<Record<string, string>>(file, {
      header: true, skipEmptyLines: true,
      complete: async (results) => {
        const rows = results.data.map((r) => ({
          id:             r.id?.trim() || '',
          serial_number:  r.serial_number?.trim() || '',
          category:       (() => {
            const raw = r.category?.trim() || 'other';
            // Match by value first, then by label (case-insensitive)
            const byValue = categories.find(c => c.value.toLowerCase() === raw.toLowerCase());
            if (byValue) return byValue.value;
            const byLabel = categories.find(c => c.label.toLowerCase() === raw.toLowerCase());
            return byLabel ? byLabel.value : 'other';
          })(),
          brand:          r.brand?.trim() || '',
          model:          r.model?.trim() || '',
          price:          parseFloat(r.price) || 0,
          purchase_date:  r.purchase_date?.trim() || '',
          purchase_order: r.purchase_order?.trim() || '',
          assigned_to:    r.assigned_to?.trim() || '',
          department:     r.department?.trim() || '',
          status:         r.status?.trim() || 'activo',
          notes:          r.notes?.trim() || '',
        }));
        try {
          const res = await importAssets(rows);
          toast.success(`Importados: ${res.data.inserted} nuevos, ${res.data.updated} actualizados`);
          load();
        } catch (err: unknown) {
          const er = err as { response?: { data?: { error?: string } } };
          toast.error(er.response?.data?.error || 'Error en la importación');
        } finally { setImportLoading(false); e.target.value = ''; }
      },
      error: () => { toast.error('Error al leer el archivo CSV'); setImportLoading(false); }
    });
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <ChevronUp className="w-3 h-3 text-gray-600" />;
    return sortDir === 'asc'
      ? <ChevronUp className="w-3 h-3 text-blue-400" />
      : <ChevronDown className="w-3 h-3 text-blue-400" />;
  };

  const selectedCount = [...selected].filter(id => filteredIds.includes(id)).length;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Inventario</h1>
          <p className="text-gray-400 text-sm mt-1">{assets.length} activos registrados</p>
        </div>
        {canEdit && (
          <button
            onClick={() => { setEditAsset(null); setShowForm(true); }}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg transition-colors"
          >
            <Plus className="w-4 h-4" />
            Nuevo activo
          </button>
        )}
      </div>

      {/* Barra de selección múltiple */}
      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 bg-blue-600/10 border border-blue-500/30 rounded-xl px-4 py-3">
          <CheckSquare className="w-4 h-4 text-blue-400 flex-shrink-0" />
          <span className="text-sm font-medium text-blue-300">
            {selected.size} activo{selected.size > 1 ? 's' : ''} seleccionado{selected.size > 1 ? 's' : ''}
          </span>
          <div className="flex gap-2 ml-2 flex-wrap">
            <button
              onClick={handleBulkExport}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 text-xs rounded-lg transition-colors"
            >
              <Download className="w-3.5 h-3.5" /> Exportar selección
            </button>
            {canEdit && (
              <>
                <button
                  onClick={() => setBulkEditModal(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/30 text-blue-400 text-xs rounded-lg transition-colors"
                >
                  <Pencil className="w-3.5 h-3.5" /> Edición masiva
                </button>
                <button
                  onClick={() => setBulkStatusModal(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 text-xs rounded-lg transition-colors"
                >
                  <Tag className="w-3.5 h-3.5" /> Cambiar estado
                </button>
                {user?.role === 'admin' && (
                  <button
                    onClick={() => setBulkDeleteModal(true)}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500/20 hover:bg-red-500/30 border border-red-500/30 text-red-400 text-xs rounded-lg transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" /> Eliminar selección
                  </button>
                )}
              </>
            )}
          </div>
          <button
            onClick={clearSelection}
            className="ml-auto text-gray-500 hover:text-white transition-colors"
            title="Limpiar selección"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Filters & Actions */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
          <input
            type="text" value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por ID, serie, marca, modelo, asignado, orden de compra..."
            className="w-full bg-gray-800 border border-gray-700 rounded-lg pl-10 pr-4 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          />
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          {/* Categoría — dropdown multiselect */}
          <div className="relative">
            <button
              onClick={(e) => { e.stopPropagation(); toggleDropdown('category'); }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border transition-colors ${
                filterCategories.size > 0
                  ? 'bg-blue-600/20 border-blue-500/50 text-blue-300'
                  : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-white'
              }`}
            >
              <Filter className="w-3 h-3" />
              Categoría{filterCategories.size > 0 ? ` (${filterCategories.size})` : ''}
              <ChevronDown className="w-3 h-3" />
            </button>
            {openDropdown === 'category' && (
              <div onClick={e => e.stopPropagation()} className="absolute top-full left-0 mt-1 z-30 bg-gray-900 border border-gray-700 rounded-xl shadow-2xl py-1 min-w-[180px]">
                {categories.map(c => (
                  <button key={c.value}
                    onClick={() => setFilterCategories(prev => {
                      const n = new Set(prev); n.has(c.value) ? n.delete(c.value) : n.add(c.value); return n;
                    })}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-gray-800 transition-colors ${
                      filterCategories.has(c.value) ? 'text-blue-400' : 'text-gray-300'
                    }`}
                  >
                    <span className={`w-3.5 h-3.5 rounded border flex-shrink-0 flex items-center justify-center ${
                      filterCategories.has(c.value) ? 'bg-blue-600 border-blue-500' : 'border-gray-600'
                    }`}>
                      {filterCategories.has(c.value) && <span className="text-white text-[9px]">✓</span>}
                    </span>
                    {c.icon} {c.label}
                  </button>
                ))}
                {filterCategories.size > 0 && (
                  <button onClick={() => setFilterCategories(new Set())}
                    className="w-full text-left px-3 py-2 text-xs text-red-400 hover:bg-gray-800 border-t border-gray-800 mt-1">
                    Limpiar categoría
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Estado — dropdown multiselect */}
          <div className="relative">
            <button
              onClick={(e) => { e.stopPropagation(); toggleDropdown('status'); }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border transition-colors ${
                filterStatuses.size > 0
                  ? 'bg-blue-600/20 border-blue-500/50 text-blue-300'
                  : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-white'
              }`}
            >
              <Filter className="w-3 h-3" />
              Estado{filterStatuses.size > 0 ? ` (${filterStatuses.size})` : ''}
              <ChevronDown className="w-3 h-3" />
            </button>
            {openDropdown === 'status' && (
              <div onClick={e => e.stopPropagation()} className="absolute top-full left-0 mt-1 z-30 bg-gray-900 border border-gray-700 rounded-xl shadow-2xl py-1 min-w-[160px]">
                {[{v:'activo',l:'Activo'},{v:'inactivo',l:'Inactivo'},{v:'reparacion',l:'Reparación'},{v:'baja',l:'Baja'}].map(s => (
                  <button key={s.v}
                    onClick={() => setFilterStatuses(prev => {
                      const n = new Set(prev); n.has(s.v) ? n.delete(s.v) : n.add(s.v); return n;
                    })}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-gray-800 transition-colors ${
                      filterStatuses.has(s.v) ? 'text-blue-400' : 'text-gray-300'
                    }`}
                  >
                    <span className={`w-3.5 h-3.5 rounded border flex-shrink-0 flex items-center justify-center ${
                      filterStatuses.has(s.v) ? 'bg-blue-600 border-blue-500' : 'border-gray-600'
                    }`}>
                      {filterStatuses.has(s.v) && <span className="text-white text-[9px]">✓</span>}
                    </span>
                    {s.l}
                  </button>
                ))}
                {filterStatuses.size > 0 && (
                  <button onClick={() => setFilterStatuses(new Set())}
                    className="w-full text-left px-3 py-2 text-xs text-red-400 hover:bg-gray-800 border-t border-gray-800 mt-1">
                    Limpiar estado
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Departamento — dropdown multiselect */}
          <div className="relative">
            <button
              onClick={(e) => { e.stopPropagation(); toggleDropdown('dept'); }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border transition-colors ${
                filterDepts.size > 0
                  ? 'bg-blue-600/20 border-blue-500/50 text-blue-300'
                  : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-white'
              }`}
            >
              <Filter className="w-3 h-3" />
              Departamento{filterDepts.size > 0 ? ` (${filterDepts.size})` : ''}
              <ChevronDown className="w-3 h-3" />
            </button>
            {openDropdown === 'dept' && (
              <div onClick={e => e.stopPropagation()} className="absolute top-full left-0 mt-1 z-30 bg-gray-900 border border-gray-700 rounded-xl shadow-2xl py-1 min-w-[180px] max-h-60 overflow-y-auto">
                {deptOptions.length === 0 ? (
                  <p className="px-3 py-2 text-xs text-gray-500">Sin departamentos</p>
                ) : deptOptions.map(d => (
                  <button key={d}
                    onClick={() => setFilterDepts(prev => {
                      const n = new Set(prev); n.has(d) ? n.delete(d) : n.add(d); return n;
                    })}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-gray-800 transition-colors ${
                      filterDepts.has(d) ? 'text-blue-400' : 'text-gray-300'
                    }`}
                  >
                    <span className={`w-3.5 h-3.5 rounded border flex-shrink-0 flex items-center justify-center ${
                      filterDepts.has(d) ? 'bg-blue-600 border-blue-500' : 'border-gray-600'
                    }`}>
                      {filterDepts.has(d) && <span className="text-white text-[9px]">✓</span>}
                    </span>
                    {d}
                  </button>
                ))}
                {filterDepts.size > 0 && (
                  <button onClick={() => setFilterDepts(new Set())}
                    className="w-full text-left px-3 py-2 text-xs text-red-400 hover:bg-gray-800 border-t border-gray-800 mt-1">
                    Limpiar departamento
                  </button>
                )}
              </div>
            )}
          </div>

          {(filterCategories.size > 0 || filterStatuses.size > 0 || filterDepts.size > 0 || search) && (
            <button onClick={() => { setSearch(''); setFilterCategories(new Set()); setFilterStatuses(new Set()); setFilterDepts(new Set()); setOpenDropdown(null); }}
              className="px-3 py-1.5 text-xs text-gray-400 hover:text-white bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg transition-colors flex items-center gap-1">
              <X className="w-3 h-3" /> Limpiar todo
            </button>
          )}
          <div className="flex-1" />
          <button onClick={handleDownloadTemplate} title="Descargar plantilla CSV"
            className="flex items-center gap-1.5 px-3 py-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 text-sm rounded-lg transition-colors">
            <FileDown className="w-4 h-4" />
            <span className="hidden sm:inline">Plantilla</span>
          </button>
          {canEdit && (
            <label className={`flex items-center gap-1.5 px-3 py-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 text-sm rounded-lg transition-colors cursor-pointer ${importLoading ? 'opacity-60 pointer-events-none' : ''}`}>
              {importLoading
                ? <div className="w-4 h-4 border-2 border-gray-500 border-t-white rounded-full animate-spin" />
                : <Upload className="w-4 h-4" />}
              <span className="hidden sm:inline">Importar</span>
              <input type="file" accept=".csv" className="hidden" onChange={handleImport} />
            </label>
          )}
          <button onClick={handleExport}
            className="flex items-center gap-1.5 px-3 py-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 text-sm rounded-lg transition-colors">
            <Download className="w-4 h-4" />
            <span className="hidden sm:inline">Exportar</span>
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-48">
            <div className="w-8 h-8 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 text-gray-500">
            <Package className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p className="font-medium">No se encontraron activos</p>
            <p className="text-sm mt-1">Prueba con otros filtros o añade un nuevo activo</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-800/50 border-b border-gray-800">
                <tr>
                  {/* Checkbox cabecera */}
                  <th className="px-3 py-3 w-10">
                    <Checkbox
                      checked={allSelected}
                      indeterminate={someSelected && !allSelected}
                      onChange={toggleAll}
                    />
                  </th>
                  {[
                    { field: 'id' as SortField,            label: 'ID (PK)' },
                    { field: 'serial_number' as SortField, label: 'Nº Serie' },
                    { field: 'category' as SortField,      label: 'Categoría' },
                    { field: 'brand' as SortField,         label: 'Marca / Modelo' },
                    { field: 'price' as SortField,         label: 'Precio' },
                    { field: 'purchase_date' as SortField, label: 'F. Compra' },
                    { field: 'purchase_order' as SortField,label: 'Orden Compra' },
                    { field: 'assigned_to' as SortField,   label: 'Asignado a' },
                    { field: 'department' as SortField,    label: 'Departamento' },
                    { field: 'status' as SortField,        label: 'Estado' },
                  ].map(({ field, label }) => (
                    <th key={field} onClick={() => handleSort(field)}
                      className="text-left text-xs font-medium text-gray-400 px-4 py-3 cursor-pointer hover:text-white transition-colors whitespace-nowrap">
                      <div className="flex items-center gap-1">{label}<SortIcon field={field} /></div>
                    </th>
                  ))}
                  <th className="px-4 py-3 text-xs font-medium text-gray-400">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {filtered.map((a) => {
                  const isSelected = selected.has(a.id);
                  return (
                    <tr key={a.id}
                      className={`hover:bg-gray-800/40 transition-colors cursor-pointer select-none ${isSelected ? 'bg-blue-600/5' : ''}`}
                      onClick={(e) => {
                        if ((e.target as HTMLElement).closest('button')) return;
                        if (e.shiftKey) e.preventDefault();
                        toggleOne(a.id, e.shiftKey);
                      }}
                    >
                      {/* Checkbox fila */}
                      <td className="px-3 py-3">
                        <Checkbox checked={isSelected} onChange={() => toggleOne(a.id)} />
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-blue-400 whitespace-nowrap font-medium">{a.id}</td>
                      <td className="px-4 py-3 font-mono text-xs text-gray-300 whitespace-nowrap">{a.serial_number}</td>
                      <td className="px-4 py-3 text-gray-300 whitespace-nowrap">
                        <span className="px-2 py-0.5 rounded bg-gray-800 text-xs">{getCategoryLabel(a.category)}</span>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <p className="text-white font-medium">{a.brand}</p>
                        <p className="text-gray-500 text-xs">{a.model}</p>
                      </td>
                      <td className="px-4 py-3 text-gray-300 whitespace-nowrap">
                        {Number(a.price).toLocaleString('es-ES', { minimumFractionDigits: 2 })} €
                      </td>
                      <td className="px-4 py-3 text-gray-400 whitespace-nowrap text-xs">
                        {a.purchase_date ? new Date(a.purchase_date).toLocaleDateString('es-ES') : '—'}
                      </td>
                      <td className="px-4 py-3 text-gray-400 text-xs whitespace-nowrap">{a.purchase_order || '—'}</td>
                      <td className="px-4 py-3 text-gray-300 whitespace-nowrap text-xs">{a.assigned_to || '—'}</td>
                      <td className="px-4 py-3 text-gray-400 whitespace-nowrap text-xs">{a.department || '—'}</td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${statusColors[a.status] || ''}`}>
                          {statusLabels[a.status] || a.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center gap-2">
                          <button onClick={() => { setEditAsset(a); setShowForm(true); }}
                            className="text-gray-500 hover:text-blue-400 transition-colors p-1" title="Editar">
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button onClick={() => { setEditAsset(a); setShowForm(true); }}
                            className="text-gray-600 hover:text-yellow-400 transition-colors p-1" title="Documentos adjuntos">
                            <Paperclip className="w-4 h-4" />
                          </button>
                          {canEdit && user?.role === 'admin' && (
                            <button onClick={() => setDeleteModal(a)}
                              className="text-gray-500 hover:text-red-400 transition-colors p-1" title="Eliminar">
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="px-4 py-3 border-t border-gray-800 text-xs text-gray-500 flex items-center justify-between">
              <span>Mostrando {filtered.length} de {assets.length} activos</span>
              {selectedCount > 0 && (
                <span className="text-blue-400">{selectedCount} seleccionado{selectedCount > 1 ? 's' : ''}</span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Asset Form Modal */}
      {showForm && (
        <AssetForm asset={editAsset} isEdit={!!editAsset} onSave={handleSave}
          onClose={() => { setShowForm(false); setEditAsset(null); }} />
      )}

      {/* Delete individual */}
      {deleteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 max-w-md w-full shadow-2xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-red-500/20 flex items-center justify-center">
                <AlertTriangle className="w-5 h-5 text-red-400" />
              </div>
              <h3 className="text-lg font-semibold text-white">Eliminar activo</h3>
            </div>
            <p className="text-gray-400 text-sm mb-2">¿Estás seguro de que quieres eliminar el activo:</p>
            <p className="text-white font-medium text-sm mb-1">{deleteModal.brand} {deleteModal.model}</p>
            <p className="text-blue-400 font-mono text-xs mb-1">ID: {deleteModal.id}</p>
            <p className="text-gray-500 font-mono text-xs mb-6">Serie: {deleteModal.serial_number}</p>
            <p className="text-red-400 text-xs mb-6">Esta acción no se puede deshacer.</p>
            <div className="flex gap-3">
              <button onClick={() => setDeleteModal(null)}
                className="flex-1 px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg text-sm">Cancelar</button>
              <button onClick={handleDelete} disabled={deleting}
                className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-500 disabled:bg-red-800 text-white rounded-lg text-sm font-medium">
                {deleting ? 'Eliminando...' : 'Eliminar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal edición masiva */}
      {bulkEditModal && (
        <BulkEditModal
          title="Hardware"
          count={[...selected].filter(id => filtered.some(a => a.id === id)).length}
          fields={[
            { key:'status', label:'Estado', type:'select', options:[
              {value:'activo',label:'Activo'},{value:'inactivo',label:'Inactivo'},
              {value:'reparacion',label:'En reparación'},{value:'baja',label:'Baja'}
            ]},
            { key:'category', label:'Categoría', type:'select', options: categories.map(c=>({value:c.value,label:`${c.icon} ${c.label}`})) },
            { key:'department', label:'Departamento', type:'text', placeholder:'TI, RRHH...' },
            { key:'assigned_to', label:'Asignado a', type:'text', placeholder:'Nombre del usuario' },
            { key:'purchase_order', label:'Orden de compra', type:'text', placeholder:'OC-2024-001' },
            { key:'notes', label:'Notas', type:'textarea', placeholder:'Observaciones...' },
          ]}
          onSave={async (fields) => { await handleBulkEdit(fields as Partial<Asset>); }}
          onClose={() => setBulkEditModal(false)}
        />
      )}

      {/* Modal eliminar múltiple */}
      {bulkDeleteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 max-w-md w-full shadow-2xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-red-500/20 flex items-center justify-center">
                <AlertTriangle className="w-5 h-5 text-red-400" />
              </div>
              <h3 className="text-lg font-semibold text-white">Eliminar {selected.size} activos</h3>
            </div>
            <p className="text-gray-400 text-sm mb-2">
              ¿Estás seguro de que quieres eliminar los <strong className="text-white">{selected.size}</strong> activos seleccionados?
            </p>
            <p className="text-red-400 text-xs mb-6">Esta acción no se puede deshacer. Se eliminarán también sus documentos y vínculos.</p>
            <div className="flex gap-3">
              <button onClick={() => setBulkDeleteModal(false)}
                className="flex-1 px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg text-sm">Cancelar</button>
              <button onClick={handleBulkDelete} disabled={bulkDeleting}
                className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-500 disabled:bg-red-800 text-white rounded-lg text-sm font-medium">
                {bulkDeleting ? 'Eliminando...' : `Eliminar ${selected.size} activos`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal cambio de estado múltiple */}
      {bulkStatusModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 max-w-sm w-full shadow-2xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-blue-500/20 flex items-center justify-center">
                <Tag className="w-5 h-5 text-blue-400" />
              </div>
              <h3 className="text-lg font-semibold text-white">Cambiar estado</h3>
            </div>
            <p className="text-gray-400 text-sm mb-4">
              Cambiar el estado de <strong className="text-white">{selected.size}</strong> activos seleccionados a:
            </p>
            <select value={bulkStatus} onChange={e => setBulkStatus(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white mb-5 focus:outline-none focus:border-blue-500">
              <option value="activo">Activo</option>
              <option value="inactivo">Inactivo</option>
              <option value="reparacion">En reparación</option>
              <option value="baja">Baja</option>
            </select>
            <div className="flex gap-3">
              <button onClick={() => setBulkStatusModal(false)}
                className="flex-1 px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg text-sm">Cancelar</button>
              <button onClick={handleBulkStatus}
                className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium">
                Aplicar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
