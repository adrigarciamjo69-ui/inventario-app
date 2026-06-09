import { useRef } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { X, Printer, Download } from 'lucide-react';

interface Props {
  assetId: string;
  brand: string;
  model: string;
  serialNumber: string;
  category?: string;
  onClose: () => void;
}

export default function QRModal({ assetId, brand, model, serialNumber, category, onClose }: Props) {
  const printRef = useRef<HTMLDivElement>(null);

  // URL that the QR will point to — the asset detail page
  const qrUrl = `${window.location.origin}?asset=${assetId}`;

  const handlePrint = () => {
    const content = printRef.current?.innerHTML;
    if (!content) return;
    const w = window.open('', '_blank', 'width=400,height=500');
    if (!w) return;
    w.document.write(`
      <html>
        <head>
          <title>Etiqueta QR — ${assetId}</title>
          <style>
            * { margin:0; padding:0; box-sizing:border-box; }
            body { font-family: Arial, sans-serif; background: white; }
            .label { width: 8cm; padding: 8mm; border: 1px solid #ccc; }
            .label h2 { font-size: 14px; margin-bottom: 2mm; }
            .label p  { font-size: 11px; color: #444; margin-bottom: 1mm; }
            .label .id { font-size: 10px; font-family: monospace; color: #666; }
            svg { display: block; margin: 4mm auto; }
            @media print { .label { border: none; } }
          </style>
        </head>
        <body onload="window.print();window.close()">
          <div class="label">${content}</div>
        </body>
      </html>
    `);
    w.document.close();
  };

  const handleDownloadSVG = () => {
    const svg = printRef.current?.querySelector('svg');
    if (!svg) return;
    const blob = new Blob([svg.outerHTML], { type: 'image/svg+xml' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `qr-${assetId}.svg`;
    a.click();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-sm shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
          <h2 className="text-base font-semibold text-white">Etiqueta QR</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white"><X className="w-5 h-5" /></button>
        </div>

        {/* Preview */}
        <div className="px-6 py-6 flex justify-center">
          <div ref={printRef} className="bg-white rounded-xl p-5 w-56 text-center shadow-lg">
            <h2 style={{ fontFamily: 'Arial', fontSize: 14, fontWeight: 'bold', color: '#111', marginBottom: 4 }}>
              {brand} {model}
            </h2>
            <p style={{ fontFamily: 'Arial', fontSize: 11, color: '#555', marginBottom: 2 }}>{category}</p>
            <QRCodeSVG
              value={qrUrl}
              size={140}
              bgColor="#ffffff"
              fgColor="#000000"
              level="M"
              style={{ margin: '8px auto', display: 'block' }}
            />
            <p style={{ fontFamily: 'monospace', fontSize: 10, color: '#888', marginTop: 4 }}>{assetId}</p>
            <p style={{ fontFamily: 'monospace', fontSize: 9, color: '#aaa' }}>S/N: {serialNumber}</p>
          </div>
        </div>

        <p className="text-xs text-gray-500 text-center px-6 pb-2">
          Escanea para abrir la ficha del activo
        </p>

        <div className="flex gap-3 px-6 pb-5">
          <button onClick={handleDownloadSVG}
            className="flex-1 flex items-center justify-center gap-2 px-3 py-2.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 text-sm rounded-lg transition-colors">
            <Download className="w-4 h-4" /> SVG
          </button>
          <button onClick={handlePrint}
            className="flex-1 flex items-center justify-center gap-2 px-3 py-2.5 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-lg transition-colors">
            <Printer className="w-4 h-4" /> Imprimir
          </button>
        </div>
      </div>
    </div>
  );
}
