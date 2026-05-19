import { useState, useEffect, useRef } from 'react';
import {
  Paperclip, Upload, Trash2, Download, FileText, FileImage,
  File, AlertTriangle, X, Loader2
} from 'lucide-react';
import toast from 'react-hot-toast';
import { AssetDocument } from '../types';
import { getDocuments, uploadDocument, downloadDocument, deleteDocument } from '../api/client';
import { useAuth } from '../context/AuthContext';

interface DocumentsPanelProps {
  serial: string;
}

const MAX_SIZE_MB = 20;
const ALLOWED_EXTENSIONS = '.pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.gif,.webp,.txt,.zip';

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getFileIcon(mimetype: string) {
  if (mimetype.startsWith('image/')) return <FileImage className="w-4 h-4 text-blue-400" />;
  if (mimetype === 'application/pdf') return <FileText className="w-4 h-4 text-red-400" />;
  if (mimetype.includes('word')) return <FileText className="w-4 h-4 text-blue-500" />;
  if (mimetype.includes('excel') || mimetype.includes('spreadsheet')) return <FileText className="w-4 h-4 text-green-500" />;
  return <File className="w-4 h-4 text-gray-400" />;
}

export default function DocumentsPanel({ serial }: DocumentsPanelProps) {
  const { user } = useAuth();
  const [docs, setDocs] = useState<AssetDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [deleteModal, setDeleteModal] = useState<AssetDocument | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [downloadingId, setDownloadingId] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const canEdit = user?.role === 'admin' || user?.role === 'editor';

  const loadDocs = async () => {
    try {
      const res = await getDocuments(serial);
      setDocs(res.data);
    } catch {
      // silencioso si no hay docs todavía
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDocs();
  }, [serial]);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > MAX_SIZE_MB * 1024 * 1024) {
      toast.error(`El archivo supera el límite de ${MAX_SIZE_MB} MB`);
      e.target.value = '';
      return;
    }

    setUploading(true);
    try {
      await uploadDocument(serial, file);
      toast.success(`Documento "${file.name}" subido correctamente`);
      await loadDocs();
    } catch (err: unknown) {
      const error = err as { response?: { data?: { error?: string } } };
      toast.error(error.response?.data?.error || 'Error al subir el documento');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const handleDownload = async (doc: AssetDocument) => {
    setDownloadingId(doc.id);
    try {
      const res = await downloadDocument(doc.id);
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement('a');
      a.href = url;
      a.download = doc.original_name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch {
      toast.error('Error al descargar el documento');
    } finally {
      setDownloadingId(null);
    }
  };

  const handleDelete = async () => {
    if (!deleteModal) return;
    setDeleting(true);
    try {
      await deleteDocument(deleteModal.id);
      toast.success('Documento eliminado');
      setDeleteModal(null);
      await loadDocs();
    } catch (err: unknown) {
      const error = err as { response?: { data?: { error?: string } } };
      toast.error(error.response?.data?.error || 'Error al eliminar el documento');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="mt-6 border-t border-gray-800 pt-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Paperclip className="w-4 h-4 text-gray-400" />
          <h3 className="text-sm font-semibold text-white">
            Documentos adjuntos
            {docs.length > 0 && (
              <span className="ml-2 text-xs text-gray-500 font-normal">({docs.length})</span>
            )}
          </h3>
        </div>

        {canEdit && (
          <label
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors cursor-pointer
              ${uploading
                ? 'bg-gray-800 border-gray-700 text-gray-500 pointer-events-none'
                : 'bg-gray-800 hover:bg-gray-700 border-gray-700 text-gray-300 hover:text-white'
              }`}
          >
            {uploading ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Upload className="w-3.5 h-3.5" />
            )}
            {uploading ? 'Subiendo...' : 'Subir documento'}
            <input
              ref={fileInputRef}
              type="file"
              accept={ALLOWED_EXTENSIONS}
              className="hidden"
              onChange={handleFileChange}
              disabled={uploading}
            />
          </label>
        )}
      </div>

      <p className="text-xs text-gray-600 mb-3">
        Formatos permitidos: PDF, Word, Excel, imágenes, TXT, ZIP. Tamaño máximo: {MAX_SIZE_MB} MB.
      </p>

      {/* Document list */}
      {loading ? (
        <div className="flex items-center gap-2 py-4 text-gray-500 text-sm">
          <Loader2 className="w-4 h-4 animate-spin" />
          Cargando documentos...
        </div>
      ) : docs.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-6 text-gray-600 border border-dashed border-gray-800 rounded-lg">
          <Paperclip className="w-8 h-8 mb-2 opacity-40" />
          <p className="text-sm">No hay documentos adjuntos</p>
          {canEdit && (
            <p className="text-xs mt-1">Usa el botón "Subir documento" para añadir archivos</p>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {docs.map((doc) => (
            <div
              key={doc.id}
              className="flex items-center gap-3 px-3 py-2.5 bg-gray-800/50 border border-gray-700/50 rounded-lg group hover:bg-gray-800 transition-colors"
            >
              <div className="flex-shrink-0">
                {getFileIcon(doc.mimetype)}
              </div>

              <div className="flex-1 min-w-0">
                <p className="text-sm text-white truncate">{doc.original_name}</p>
                <div className="flex items-center gap-2 text-xs text-gray-500">
                  <span>{formatSize(doc.size)}</span>
                  {doc.uploaded_by_name && (
                    <>
                      <span>·</span>
                      <span>{doc.uploaded_by_name}</span>
                    </>
                  )}
                  {doc.created_at && (
                    <>
                      <span>·</span>
                      <span>{new Date(doc.created_at).toLocaleDateString('es-ES')}</span>
                    </>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-1 flex-shrink-0">
                <button
                  onClick={() => handleDownload(doc)}
                  disabled={downloadingId === doc.id}
                  className="p-1.5 text-gray-500 hover:text-blue-400 transition-colors rounded"
                  title="Descargar"
                >
                  {downloadingId === doc.id ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Download className="w-4 h-4" />
                  )}
                </button>

                {canEdit && (
                  <button
                    onClick={() => setDeleteModal(doc)}
                    className="p-1.5 text-gray-500 hover:text-red-400 transition-colors rounded"
                    title="Eliminar"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Delete confirm modal */}
      {deleteModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 max-w-sm w-full shadow-2xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-red-500/20 flex items-center justify-center flex-shrink-0">
                <AlertTriangle className="w-5 h-5 text-red-400" />
              </div>
              <h3 className="text-base font-semibold text-white">Eliminar documento</h3>
              <button
                onClick={() => setDeleteModal(null)}
                className="ml-auto text-gray-500 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-sm text-gray-400 mb-2">¿Seguro que quieres eliminar:</p>
            <p className="text-sm text-white font-medium mb-4 break-all">{deleteModal.original_name}</p>
            <p className="text-xs text-red-400 mb-5">Esta acción no se puede deshacer.</p>
            <div className="flex gap-3">
              <button
                onClick={() => setDeleteModal(null)}
                className="flex-1 px-3 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg text-sm transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="flex-1 px-3 py-2 bg-red-600 hover:bg-red-500 disabled:bg-red-800 text-white rounded-lg text-sm font-medium transition-colors"
              >
                {deleting ? 'Eliminando...' : 'Eliminar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
