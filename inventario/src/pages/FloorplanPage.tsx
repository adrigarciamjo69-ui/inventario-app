import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Plus, Trash2, Save, X, Move, Square, Type,
  Server, Printer, Wifi, DoorOpen, Minus, ZoomIn, ZoomOut,
  RotateCcw, Pencil, Info, ImagePlus, Image, Upload, AlertTriangle, Filter
} from 'lucide-react';
import toast from 'react-hot-toast';
import { FloorplanItem, FloorplanItemType } from '../types';
import {
  getFloorplan, createFloorplanItem, updateFloorplanItem, deleteFloorplanItem, apiClient
} from '../api/client';
import { useAuth } from '../context/AuthContext';

// ─── Constantes ───────────────────────────────────────────────────────────────
const FLOORS = [
  { id: 0, label: 'Planta Baja' },
  { id: 1, label: 'Primera Planta' },
];

const ITEM_TYPES: {
  type: FloorplanItemType;
  label: string;
  icon: React.ReactNode;
  defaultColor: string;
  defaultW: number;
  defaultH: number;
}[] = [
    { type: 'room', label: 'Sala / Zona', icon: <Square className="w-4 h-4" />, defaultColor: '#1e3a5f', defaultW: 200, defaultH: 150 },
    { type: 'desk', label: 'Mesa / Puesto', icon: <Move className="w-4 h-4" />, defaultColor: '#1a3a2a', defaultW: 100, defaultH: 60 },
    { type: 'server_rack', label: 'Rack Servidor', icon: <Server className="w-4 h-4" />, defaultColor: '#3b1f5e', defaultW: 60, defaultH: 100 },
    { type: 'printer', label: 'Impresora', icon: <Printer className="w-4 h-4" />, defaultColor: '#3d2a0a', defaultW: 70, defaultH: 70 },
    { type: 'switch', label: 'Switch / Router', icon: <Wifi className="w-4 h-4" />, defaultColor: '#1a3a2a', defaultW: 80, defaultH: 40 },
    { type: 'wall', label: 'Pared', icon: <Minus className="w-4 h-4" />, defaultColor: '#374151', defaultW: 200, defaultH: 16 },
    { type: 'door', label: 'Puerta', icon: <DoorOpen className="w-4 h-4" />, defaultColor: '#92400e', defaultW: 60, defaultH: 16 },
    { type: 'label', label: 'Etiqueta texto', icon: <Type className="w-4 h-4" />, defaultColor: '#1f2937', defaultW: 120, defaultH: 36 },
    { type: 'asset', label: 'Activo IT', icon: <Server className="w-4 h-4" />, defaultColor: '#1e3a5f', defaultW: 80, defaultH: 80 },
  ];

const TYPE_COLORS: Record<FloorplanItemType, string> = {
  room: 'border-blue-500/40',
  desk: 'border-green-500/40',
  server_rack: 'border-purple-500/40',
  printer: 'border-orange-500/40',
  switch: 'border-teal-500/40',
  wall: 'border-gray-500/60',
  door: 'border-yellow-600/60',
  window: 'border-cyan-400/40',
  asset: 'border-blue-400/40',
  label: 'border-transparent',
};

// ─── API para imágenes de planta ──────────────────────────────────────────────
const uploadFloorImage = (floor: number, file: File) => {
  const formData = new FormData();
  formData.append('image', file);
  formData.append('floor', String(floor));
  return apiClient.post('/floorplan/image', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
};

const deleteFloorImage = (floor: number) =>
  apiClient.delete(`/floorplan/image/${floor}`);

const getFloorImages = () =>
  apiClient.get('/floorplan/images');

// ─── CanvasItem ───────────────────────────────────────────────────────────────
interface CanvasItemProps {
  item: FloorplanItem;
  selected: boolean;
  canEdit: boolean;
  onSelect: () => void;
  onDragEnd: (id: number, x: number, y: number) => void;
  onResizeEnd: (id: number, w: number, h: number) => void;
}

function CanvasItem({ item, selected, canEdit, onSelect, onDragEnd, onResizeEnd }: CanvasItemProps) {
  const ref = useRef<HTMLDivElement>(null);
  const dragStart = useRef<{ mx: number; my: number; ix: number; iy: number } | null>(null);
  const resizeStart = useRef<{ mx: number; my: number; iw: number; ih: number } | null>(null);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (!canEdit) { onSelect(); return; }
    e.stopPropagation();
    onSelect();
    dragStart.current = { mx: e.clientX, my: e.clientY, ix: item.x, iy: item.y };
    const onMove = (ev: MouseEvent) => {
      if (!dragStart.current || !ref.current) return;
      ref.current.style.left = `${dragStart.current.ix + ev.clientX - dragStart.current.mx}px`;
      ref.current.style.top = `${dragStart.current.iy + ev.clientY - dragStart.current.my}px`;
    };
    const onUp = (ev: MouseEvent) => {
      if (!dragStart.current) return;
      const nx = Math.max(0, dragStart.current.ix + ev.clientX - dragStart.current.mx);
      const ny = Math.max(0, dragStart.current.iy + ev.clientY - dragStart.current.my);
      onDragEnd(item.id, nx, ny);
      dragStart.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const handleResizeDown = (e: React.MouseEvent) => {
    if (!canEdit) return;
    e.stopPropagation();
    resizeStart.current = { mx: e.clientX, my: e.clientY, iw: item.width, ih: item.height };
    const onMove = (ev: MouseEvent) => {
      if (!resizeStart.current || !ref.current) return;
      ref.current.style.width = `${Math.max(40, resizeStart.current.iw + ev.clientX - resizeStart.current.mx)}px`;
      ref.current.style.height = `${Math.max(20, resizeStart.current.ih + ev.clientY - resizeStart.current.my)}px`;
    };
    const onUp = (ev: MouseEvent) => {
      if (!resizeStart.current) return;
      onResizeEnd(
        item.id,
        Math.max(40, resizeStart.current.iw + ev.clientX - resizeStart.current.mx),
        Math.max(20, resizeStart.current.ih + ev.clientY - resizeStart.current.my),
      );
      resizeStart.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const borderClass = TYPE_COLORS[item.type] || 'border-gray-600';
  const typeDef = ITEM_TYPES.find(t => t.type === item.type);

  return (
    <div
      ref={ref}
      onMouseDown={handleMouseDown}
      onClick={(e) => e.stopPropagation()}
      className={`absolute border-2 rounded flex flex-col items-center justify-center select-none overflow-hidden
        ${borderClass}
        ${selected ? 'ring-2 ring-blue-400 shadow-lg shadow-blue-900/50 z-20' : 'z-10'}
        ${canEdit ? 'cursor-move' : 'cursor-pointer'}
      `}
      style={{
        left: item.x,
        top: item.y,
        width: item.width,
        height: item.height,
        backgroundColor: item.type !== 'label' ? item.color + '66' : 'transparent',
        borderColor: item.type !== 'label' ? item.color : 'transparent',
      }}
    >
      {item.type !== 'label' && typeDef?.icon && (
        <div className="text-white opacity-90 mb-0.5" style={{ transform: 'scale(1.2)' }}>
          {typeDef.icon}
        </div>
      )}
      <span
        className={`text-[10px] leading-tight font-medium text-center px-1 truncate pointer-events-none
          ${item.type === 'label' ? 'text-white text-sm font-bold drop-shadow-md' : 'text-gray-100 drop-shadow-md'}
        `}
        style={{ maxWidth: item.width - 4 }}
        title={item.label}
      >
        {item.label}
      </span>

      {selected && canEdit && (
        <div
          onMouseDown={handleResizeDown}
          className="absolute bottom-0 right-0 w-4 h-4 bg-blue-500 rounded-tl cursor-se-resize flex items-center justify-center z-30"
        >
          <svg width="8" height="8" viewBox="0 0 8 8" className="text-white">
            <path d="M1 7L7 1M4 7L7 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </div>
      )}
    </div>
  );
}

// ─── Panel de propiedades ─────────────────────────────────────────────────────
interface PropsPanelProps {
  item: FloorplanItem;
  canEdit: boolean;
  onUpdate: (data: Partial<FloorplanItem>) => void;
  onDelete: () => void;
  onClose: () => void;
}

function PropertiesPanel({ item, canEdit, onUpdate, onDelete, onClose }: PropsPanelProps) {
  const [form, setForm] = useState({ label: item.label, color: item.color, notes: item.notes || '' });
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    setForm({ label: item.label, color: item.color, notes: item.notes || '' });
    setConfirmDelete(false);
  }, [item]);

  const ic = 'w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500 transition-colors';

  return (
    <div className="absolute top-0 right-0 w-64 h-full bg-gray-900/95 border-l border-gray-700 flex flex-col z-10 backdrop-blur-sm">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700 flex-shrink-0">
        <div className="flex items-center gap-2">
          <Pencil className="w-4 h-4 text-blue-400" />
          <span className="text-sm font-semibold text-white">Propiedades</span>
        </div>
        <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <div>
          <p className="text-xs text-gray-500 mb-1">Tipo</p>
          <p className="text-sm text-white">{ITEM_TYPES.find(t => t.type === item.type)?.label || item.type}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500 mb-1">Posición / Tamaño</p>
          <p className="text-xs text-gray-400 font-mono">x:{Math.round(item.x)} y:{Math.round(item.y)}</p>
          <p className="text-xs text-gray-400 font-mono">w:{Math.round(item.width)} h:{Math.round(item.height)}</p>
        </div>

        {item.notes && !canEdit && (
          <div>
            <p className="text-xs text-gray-500 mb-1">Notas</p>
            <p className="text-xs text-gray-300">{item.notes}</p>
          </div>
        )}

        {canEdit && (
          <>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Etiqueta</label>
              <input type="text" value={form.label}
                onChange={(e) => setForm(f => ({ ...f, label: e.target.value }))}
                className={ic} />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Color</label>
              <div className="flex items-center gap-2">
                <input type="color" value={form.color}
                  onChange={(e) => setForm(f => ({ ...f, color: e.target.value }))}
                  className="w-10 h-10 rounded border border-gray-700 bg-gray-800 cursor-pointer flex-shrink-0" />
                <input type="text" value={form.color}
                  onChange={(e) => setForm(f => ({ ...f, color: e.target.value }))}
                  className={ic + ' font-mono text-xs'} />
              </div>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Notas</label>
              <textarea value={form.notes}
                onChange={(e) => setForm(f => ({ ...f, notes: e.target.value }))}
                rows={3} className={ic + ' resize-none'}
                placeholder="Observaciones..." />
            </div>

            <button
              onClick={() => onUpdate({ label: form.label, color: form.color, notes: form.notes })}
              className="w-full flex items-center justify-center gap-1.5 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium rounded-lg transition-colors"
            >
              <Save className="w-3.5 h-3.5" />
              Guardar cambios
            </button>

            {confirmDelete ? (
              <div className="space-y-2">
                <p className="text-xs text-red-400 text-center">¿Eliminar este elemento?</p>
                <div className="flex gap-2">
                  <button onClick={() => setConfirmDelete(false)}
                    className="flex-1 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs rounded-lg transition-colors">
                    Cancelar
                  </button>
                  <button onClick={onDelete}
                    className="flex-1 py-1.5 bg-red-600 hover:bg-red-500 text-white text-xs rounded-lg transition-colors">
                    Eliminar
                  </button>
                </div>
              </div>
            ) : (
              <button onClick={() => setConfirmDelete(true)}
                className="w-full flex items-center justify-center gap-1.5 py-2 bg-red-500/20 hover:bg-red-500/30 text-red-400 text-xs font-medium rounded-lg border border-red-500/20 transition-colors">
                <Trash2 className="w-3.5 h-3.5" />
                Eliminar elemento
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ─── Panel de gestión de imagen de planta ────────────────────────────────────
interface FloorImagePanelProps {
  floor: number;
  imageUrl: string | null;
  canEdit: boolean;
  onImageChange: (floor: number, url: string | null) => void;
  onClose: () => void;
}

function FloorImagePanel({ floor, imageUrl, canEdit, onImageChange, onClose }: FloorImagePanelProps) {
  const [uploading, setUploading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const floorLabel = FLOORS.find(f => f.id === floor)?.label || 'Planta';

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toast.error('Solo se permiten imágenes (PNG, JPG, SVG, WebP...)');
      e.target.value = '';
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      toast.error('La imagen no puede superar 20 MB');
      e.target.value = '';
      return;
    }

    setUploading(true);
    try {
      const res = await uploadFloorImage(floor, file);
      onImageChange(floor, res.data.url);
      toast.success('Imagen de planta actualizada');
    } catch (err: unknown) {
      const error = err as { response?: { data?: { error?: string } } };
      toast.error(error.response?.data?.error || 'Error al subir la imagen');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const handleDelete = async () => {
    try {
      await deleteFloorImage(floor);
      onImageChange(floor, null);
      toast.success('Imagen eliminada');
      setConfirmDelete(false);
    } catch {
      toast.error('Error al eliminar la imagen');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
          <div className="flex items-center gap-2">
            <Image className="w-4 h-4 text-blue-400" />
            <h2 className="text-base font-semibold text-white">Imagen de {floorLabel}</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          {/* Preview */}
          {imageUrl ? (
            <div className="relative rounded-xl overflow-hidden border border-gray-700 bg-gray-800">
              <img
                src={imageUrl}
                alt={`Plano ${floorLabel}`}
                className="w-full h-48 object-contain"
              />
              <div className="absolute top-2 right-2 bg-green-500/20 border border-green-500/30 rounded-lg px-2 py-1 text-xs text-green-400">
                Imagen activa
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-48 border-2 border-dashed border-gray-700 rounded-xl text-gray-600">
              <Image className="w-12 h-12 mb-3 opacity-30" />
              <p className="text-sm">No hay imagen de planta</p>
              <p className="text-xs mt-1">Sube un plano o imagen del edificio</p>
            </div>
          )}

          <p className="text-xs text-gray-500">
            Formatos: PNG, JPG, SVG, WebP, GIF. Tamaño máximo: 20 MB.<br />
            La imagen se usará como fondo de la planta. Puedes superponer elementos encima.
          </p>

          {canEdit && (
            <div className="space-y-3">
              <label className={`flex items-center justify-center gap-2 w-full py-2.5 rounded-lg border text-sm font-medium transition-colors cursor-pointer
                ${uploading
                  ? 'bg-gray-800 border-gray-700 text-gray-500 pointer-events-none'
                  : 'bg-blue-600/20 hover:bg-blue-600/30 border-blue-500/30 text-blue-400 hover:text-blue-300'
                }`}>
                {uploading ? (
                  <><div className="w-4 h-4 border-2 border-blue-400/30 border-t-blue-400 rounded-full animate-spin" />Subiendo...</>
                ) : (
                  <><Upload className="w-4 h-4" />{imageUrl ? 'Cambiar imagen' : 'Subir imagen de planta'}</>
                )}
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleUpload}
                  disabled={uploading}
                />
              </label>

              {imageUrl && (
                confirmDelete ? (
                  <div className="space-y-2">
                    <p className="text-xs text-red-400 text-center">¿Eliminar la imagen de esta planta?</p>
                    <div className="flex gap-2">
                      <button onClick={() => setConfirmDelete(false)}
                        className="flex-1 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm rounded-lg transition-colors">
                        Cancelar
                      </button>
                      <button onClick={handleDelete}
                        className="flex-1 py-2 bg-red-600 hover:bg-red-500 text-white text-sm rounded-lg transition-colors">
                        Eliminar
                      </button>
                    </div>
                  </div>
                ) : (
                  <button onClick={() => setConfirmDelete(true)}
                    className="w-full flex items-center justify-center gap-2 py-2 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-400 text-sm rounded-lg transition-colors">
                    <Trash2 className="w-4 h-4" />
                    Eliminar imagen
                  </button>
                )
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────
export default function FloorplanPage() {
  const { user } = useAuth();
  const canEdit = user?.role === 'admin' || user?.role === 'editor';

  const [currentFloor, setCurrentFloor] = useState(0);
  const [items, setItems] = useState<FloorplanItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [zoom, setZoom] = useState(1);
  const [showTypeMenu, setShowTypeMenu] = useState(false);
  const [showFilterMenu, setShowFilterMenu] = useState(false);
  const [showImagePanel, setShowImagePanel] = useState(false);
  const [floorImages, setFloorImages] = useState<Record<number, string | null>>({ 0: null, 1: null });
  const [loadingImages, setLoadingImages] = useState(true);
  const [imgDims, setImgDims] = useState<Record<string, { w: number, h: number }>>({});
  const [visibleTypes, setVisibleTypes] = useState<FloorplanItemType[]>(ITEM_TYPES.map(t => t.type));

  const load = useCallback(() => {
    setLoading(true);
    getFloorplan()
      .then((res) => setItems(res.data))
      .catch(() => toast.error('Error al cargar el mapa'))
      .finally(() => setLoading(false));
  }, []);

  const loadImages = useCallback(() => {
    setLoadingImages(true);
    getFloorImages()
      .then((res) => {
        // res.data = [{ floor, url }, ...]
        const map: Record<number, string | null> = { 0: null, 1: null };
        (res.data as { floor: number; url: string }[]).forEach((img) => {
          map[img.floor] = img.url;
        });
        setFloorImages(map);
      })
      .catch(() => { }) // silencioso si no existe el endpoint aún
      .finally(() => setLoadingImages(false));
  }, []);

  useEffect(() => { load(); loadImages(); }, [load, loadImages]);

  const floorItems = items.filter((i) => i.floor === currentFloor && visibleTypes.includes(i.type));

  // Deseleccionar elemento si el usuario lo oculta por filtro
  useEffect(() => {
    if (selectedId) {
      const it = items.find(i => i.id === selectedId);
      if (it && !visibleTypes.includes(it.type)) setSelectedId(null);
    }
  }, [visibleTypes, items, selectedId]);

  const selectedItem = items.find((i) => i.id === selectedId) || null;
  const rawImage = floorImages[currentFloor] || null;
  const currentImage = rawImage?.startsWith('/api')
    ? rawImage.replace('/api', import.meta.env.VITE_API_URL || '/api')
    : rawImage;

  // Cargar las dimensiones reales de la imagen para calcular su proporción real
  useEffect(() => {
    if (currentImage && !imgDims[currentImage]) {
      const img = new window.Image();
      img.onload = () => {
        setImgDims(prev => ({ ...prev, [currentImage]: { w: img.width, h: img.height } }));
      };
      img.src = currentImage;
    }
  }, [currentImage, imgDims]);

  // Hacer el lienzo bien ancho (1800px) para que llene "el recuadro" azul en pantallas grandes,
  // y calcular la altura exacta para mantener la proporción de la imagen subida sin que se corte.
  const BASE_W = 1800;
  const canvasW = BASE_W;
  const canvasH = currentImage && imgDims[currentImage]
    ? Math.round(BASE_W * (imgDims[currentImage].h / imgDims[currentImage].w))
    : 1000;

  const handleImageChange = (floor: number, url: string | null) => {
    setFloorImages((prev) => ({ ...prev, [floor]: url }));
  };

  const handleAddItem = async (type: FloorplanItemType) => {
    const def = ITEM_TYPES.find((t) => t.type === type);
    setShowTypeMenu(false);
    try {
      const res = await createFloorplanItem({
        floor: currentFloor,
        x: 60, y: 60,
        width: def?.defaultW || 120,
        height: def?.defaultH || 80,
        type,
        label: def?.label || 'Elemento',
        color: def?.defaultColor || '#3b82f6',
      });
      setItems((prev) => [...prev, res.data]);
      setSelectedId(res.data.id);
      toast.success(`${def?.label || 'Elemento'} añadido`);
    } catch {
      toast.error('Error al añadir elemento');
    }
  };

  const handleDragEnd = async (id: number, x: number, y: number) => {
    const item = items.find((i) => i.id === id);
    if (!item) return;
    setItems((prev) => prev.map((i) => i.id === id ? { ...i, x, y } : i));
    try { await updateFloorplanItem(id, { ...item, x, y }); }
    catch { toast.error('Error al guardar posición'); }
  };

  const handleResizeEnd = async (id: number, width: number, height: number) => {
    const item = items.find((i) => i.id === id);
    if (!item) return;
    setItems((prev) => prev.map((i) => i.id === id ? { ...i, width, height } : i));
    try { await updateFloorplanItem(id, { ...item, width, height }); }
    catch { toast.error('Error al guardar tamaño'); }
  };

  const handleUpdate = async (data: Partial<FloorplanItem>) => {
    if (!selectedItem) return;
    const updated = { ...selectedItem, ...data };
    setItems((prev) => prev.map((i) => i.id === selectedItem.id ? updated : i));
    try { await updateFloorplanItem(selectedItem.id, updated); toast.success('Guardado'); }
    catch { toast.error('Error al guardar'); }
  };

  const handleDelete = async () => {
    if (!selectedItem) return;
    try {
      await deleteFloorplanItem(selectedItem.id);
      setItems((prev) => prev.filter((i) => i.id !== selectedItem.id));
      setSelectedId(null);
      toast.success('Elemento eliminado');
    } catch { toast.error('Error al eliminar'); }
  };

  return (
    <div className="flex flex-col h-full space-y-4">
      {/* ── Header ── */}
      <div className="flex items-center justify-between flex-shrink-0">
        <div>
          <h1 className="text-2xl font-bold text-white">Mapa de Plantas</h1>
          <p className="text-gray-400 text-sm mt-1">
            Editor visual del edificio — {floorItems.length} elementos en esta planta
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Botón imagen de planta */}
          <button
            onClick={() => setShowImagePanel(true)}
            className={`flex items-center gap-2 px-3 py-2 text-sm rounded-lg border transition-colors
              ${currentImage
                ? 'bg-green-500/20 border-green-500/30 text-green-400 hover:bg-green-500/30'
                : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-white hover:bg-gray-700'
              }`}
            title="Gestionar imagen de planta"
          >
            <ImagePlus className="w-4 h-4" />
            <span className="hidden sm:inline">{currentImage ? 'Imagen activa' : 'Subir plano'}</span>
          </button>

          {/* Zoom controls */}
          <button onClick={() => setZoom(z => Math.max(0.2, +(z - 0.1).toFixed(1)))}
            className="p-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg transition-colors">
            <ZoomOut className="w-4 h-4" />
          </button>
          <span className="text-sm text-gray-400 w-12 text-center">{Math.round(zoom * 100)}%</span>
          <button onClick={() => setZoom(z => Math.min(3, +(z + 0.1).toFixed(1)))}
            className="p-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg transition-colors">
            <ZoomIn className="w-4 h-4" />
          </button>
          <button onClick={() => setZoom(1)}
            className="p-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg transition-colors"
            title="Restablecer zoom">
            <RotateCcw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* ── Tabs de planta + botón añadir ── */}
      <div className="flex gap-2 flex-shrink-0">
        {FLOORS.map((f) => (
          <button
            key={f.id}
            onClick={() => { setCurrentFloor(f.id); setSelectedId(null); }}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-colors
              ${currentFloor === f.id
                ? 'bg-blue-600 text-white'
                : 'bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700'
              }`}
          >
            {f.label}
            <span className="text-xs opacity-70">({items.filter(i => i.floor === f.id).length})</span>
            {floorImages[f.id] && (
              <span title="Tiene imagen de planta"><Image className="w-3 h-3 opacity-70" /></span>
            )}
          </button>
        ))}

        <div className="flex items-center gap-2 ml-auto">
          {/* ── Filtro de elementos ── */}
          <div className="relative">
            <button
              onClick={() => { setShowFilterMenu(v => !v); setShowTypeMenu(false); }}
              className="flex items-center gap-2 px-3 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm font-medium rounded-lg transition-colors border border-gray-700"
            >
              <Filter className="w-4 h-4" />
              <span className="hidden sm:inline">Filtrar</span>
              {visibleTypes.length < ITEM_TYPES.length && (
                <span className="bg-blue-600 text-white text-[10px] px-1.5 py-0.5 rounded-full ml-1 leading-none">
                  {visibleTypes.length}
                </span>
              )}
            </button>
            {showFilterMenu && (
              <div className="absolute right-0 top-full mt-1 w-56 bg-gray-900 border border-gray-700 rounded-xl shadow-2xl z-50 overflow-hidden py-2" onClick={e => e.stopPropagation()}>
                <div className="px-4 py-2 border-b border-gray-800 flex justify-between items-center bg-gray-800/50">
                  <span className="text-xs font-semibold text-gray-300 uppercase">Tipos visibles</span>
                  <button
                    onClick={() => setVisibleTypes(visibleTypes.length > 0 ? [] : ITEM_TYPES.map(t => t.type))}
                    className="text-xs text-blue-400 hover:text-blue-300 font-medium"
                  >
                    {visibleTypes.length > 0 ? 'Ocultar todo' : 'Ver todo'}
                  </button>
                </div>
                <div className="max-h-60 overflow-y-auto overflow-x-hidden pt-1">
                  {ITEM_TYPES.map((t) => (
                    <label key={t.type} className="flex items-center gap-3 px-4 py-2 text-sm text-gray-300 hover:bg-gray-800 transition-colors cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={visibleTypes.includes(t.type)}
                        onChange={(e) => {
                          if (e.target.checked) setVisibleTypes(prev => [...prev, t.type]);
                          else setVisibleTypes(prev => prev.filter(vt => vt !== t.type));
                        }}
                        className="rounded border-gray-600 bg-gray-900 text-blue-500 focus:ring-blue-500/50 cursor-pointer"
                      />
                      <span className="text-gray-400 w-4 h-4 flex items-center justify-center">{t.icon}</span>
                      <span className="truncate flex-1">{t.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>

          {canEdit && (
            <div className="relative">
              <button
                onClick={() => { setShowTypeMenu(v => !v); setShowFilterMenu(false); }}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg transition-colors"
              >
                <Plus className="w-4 h-4" />
                <span className="hidden sm:inline">Añadir elemento</span>
              </button>
              {showTypeMenu && (
                <div className="absolute right-0 top-full mt-1 w-52 bg-gray-900 border border-gray-700 rounded-xl shadow-2xl z-50 overflow-hidden">
                  {ITEM_TYPES.map((t) => (
                    <button
                      key={t.type}
                      onClick={() => handleAddItem(t.type)}
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-300 hover:bg-gray-800 hover:text-white transition-colors text-left"
                    >
                      <span className="text-blue-400">{t.icon}</span>
                      {t.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Canvas ── */}
      <div className="flex-1 bg-gray-900 border border-gray-800 rounded-xl overflow-hidden relative" style={{ minHeight: 500 }}>
        {loading || loadingImages ? (
          <div className="flex items-center justify-center h-full">
            <div className="w-8 h-8 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />
          </div>
        ) : (
          <>
            {/* Scrollable canvas */}
            <div
              className="absolute inset-0 overflow-auto"
              onClick={() => { setSelectedId(null); setShowTypeMenu(false); }}
            >
              <div
                style={{
                  transform: `scale(${zoom})`,
                  transformOrigin: 'top left',
                  width: canvasW,
                  height: canvasH,
                  position: 'relative',
                  // Si hay imagen la usamos de fondo, si no mostramos la cuadrícula
                  backgroundImage: currentImage
                    ? `url(${currentImage})`
                    : 'radial-gradient(circle, #374151 1px, transparent 1px)',
                  backgroundSize: currentImage ? '100% 100%' : '24px 24px',
                  backgroundRepeat: currentImage ? 'no-repeat' : 'repeat',
                  backgroundPosition: 'top left',
                  flexShrink: 0,
                }}
              >
                {/* Overlay semitransparente encima de la imagen para que los elementos sean visibles */}
                {currentImage && (
                  <div
                    className="absolute inset-0 pointer-events-none"
                    style={{ background: 'rgba(3,7,18,0.15)' }}
                  />
                )}

                {/* Mensaje planta vacía */}
                {floorItems.length === 0 && !currentImage && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-600 pointer-events-none">
                    <Square className="w-16 h-16 mb-4 opacity-20" />
                    <p className="text-lg font-medium">Planta vacía</p>
                    {canEdit && (
                      <p className="text-sm mt-1 text-center px-8">
                        Sube una imagen de plano con el botón <span className="text-blue-400">"Subir plano"</span> y/o añade elementos
                      </p>
                    )}
                  </div>
                )}

                {floorItems.length === 0 && currentImage && (
                  <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-gray-900/80 border border-gray-700 rounded-lg px-4 py-2 text-xs text-gray-400 pointer-events-none">
                    {canEdit ? 'Plano cargado — usa "Añadir elemento" para colocar elementos encima' : 'Plano sin elementos'}
                  </div>
                )}

                {/* Elementos del canvas */}
                {floorItems.map((item) => (
                  <CanvasItem
                    key={item.id}
                    item={item}
                    selected={selectedId === item.id}
                    canEdit={canEdit}
                    onSelect={() => setSelectedId(item.id)}
                    onDragEnd={handleDragEnd}
                    onResizeEnd={handleResizeEnd}
                  />
                ))}
              </div>
            </div>

            {/* Panel de propiedades */}
            {selectedItem && (
              <PropertiesPanel
                item={selectedItem}
                canEdit={canEdit}
                onUpdate={handleUpdate}
                onDelete={handleDelete}
                onClose={() => setSelectedId(null)}
              />
            )}

            {/* Leyenda */}
            <div className="absolute bottom-3 left-3 bg-gray-900/90 border border-gray-700 rounded-lg px-3 py-2 flex items-center gap-2 text-xs text-gray-500 pointer-events-none">
              <Info className="w-3.5 h-3.5 flex-shrink-0" />
              {canEdit
                ? 'Arrastra para mover · Esquina inferior derecha para redimensionar'
                : 'Clic en un elemento para ver sus detalles'}
            </div>

            {/* Indicador imagen activa */}
            {currentImage && (
              <div
                className="absolute top-3 left-3 flex items-center gap-1.5 bg-gray-900/90 border border-green-500/30 rounded-lg px-2.5 py-1.5 text-xs text-green-400 cursor-pointer hover:bg-gray-800 transition-colors"
                onClick={(e) => { e.stopPropagation(); setShowImagePanel(true); }}
              >
                <Image className="w-3.5 h-3.5" />
                Plano cargado
                {canEdit && <span className="text-gray-500 ml-1">· Clic para cambiar</span>}
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Modal gestión imagen de planta ── */}
      {showImagePanel && (
        <FloorImagePanel
          floor={currentFloor}
          imageUrl={currentImage}
          canEdit={canEdit}
          onImageChange={handleImageChange}
          onClose={() => setShowImagePanel(false)}
        />
      )}
    </div>
  );
}
