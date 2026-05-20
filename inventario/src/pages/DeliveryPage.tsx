import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import {
  FileText, Plus, Search, Trash2, RefreshCw,
  CheckCircle, Clock, AlertTriangle, RotateCcw, X,
  Package, User, ChevronDown, Download, Copy, FileSpreadsheet,
  CheckSquare, Square, Calendar
} from 'lucide-react';
import toast from 'react-hot-toast';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import { apiClient } from '../api/client';
import { useAuth } from '../context/AuthContext';
import type { ClientUser, Asset } from '../types';
import type { DeliveryRecord, DeliveryDevice, DeliveryStatus } from '../types/delivery';

// ── Types ─────────────────────────────────────────────────────────────────────

interface AppSettings {
  company?: { empresa?: string; nif?: string; dir1?: string; dir2?: string; tel?: string; web?: string; email?: string; ciudad?: string; logo?: string };
  responsables?: string[];
  pdfStyle?: { entrega?: { primary?: string; accent?: string; footer?: string; fontSize?: number }; devolucion?: { primary?: string; accent?: string; footer?: string; fontSize?: number } };
  clauses?: { entrega?: string[]; devolucion?: string[] };
}

interface AssetRaw {
  id: string; serial_number: string; category: string;
  brand?: string; model?: string; status?: string; category_label?: string;
}

interface CategoryRaw { value: string; label: string; icon?: string }

// ── Constants ─────────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<DeliveryStatus, { label: string; color: string; icon: JSX.Element }> = {
  pendiente:   { label: 'Pendiente',   color: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30', icon: <Clock className="w-3 h-3" /> },
  entregado:   { label: 'Entregado',   color: 'bg-green-500/20 text-green-400 border-green-500/30',   icon: <CheckCircle className="w-3 h-3" /> },
  devuelto:    { label: 'Devuelto',    color: 'bg-blue-500/20 text-blue-400 border-blue-500/30',      icon: <RotateCcw className="w-3 h-3" /> },
  en_revision: { label: 'En revisión', color: 'bg-purple-500/20 text-purple-400 border-purple-500/30', icon: <RefreshCw className="w-3 h-3" /> },
  danado:      { label: 'Dañado',      color: 'bg-red-500/20 text-red-400 border-red-500/30',         icon: <AlertTriangle className="w-3 h-3" /> },
  perdido:     { label: 'Perdido',     color: 'bg-gray-500/20 text-gray-400 border-gray-500/30',      icon: <X className="w-3 h-3" /> },
};

const EMPTY_DEVICE: DeliveryDevice = { device_type: '', model: '', serial_number: '', observations: '', asset_id: null };

const DEFAULT_CLAUSES_E = [
  'Se ha comprobado el buen funcionamiento del equipamiento relacionado anteriormente y se encuentran en perfecto estado para su uso. Todos los equipos cuentan con el software instalado de fábrica, así como las aplicaciones necesarias con sus correspondientes licencias.',
  'El material entregado es propiedad de {empresa} y debe ser utilizado exclusivamente para fines laborales.',
  'El empleado es responsable del buen uso, mantenimiento y seguridad del dispositivo mientras esté bajo su custodia.',
  'En caso de pérdida, robo o daño, el empleado lo debe notificar inmediatamente al Departamento TIC.',
  'El material deberá ser devuelto en buen estado al finalizar la relación laboral o cuando sea solicitado por la empresa.',
];
const DEFAULT_CLAUSES_D = [
  'El trabajador {trabajador} declara devolver el material listado anteriormente a {empresa}.',
  'Se ha verificado el estado del equipo en el momento de la devolución y se acepta conforme.',
  'El empleado queda eximido de responsabilidad sobre dicho material a partir de la fecha indicada en este justificante.',
  'El material devuelto pasa a disposición de {empresa} para los fines que estime oportunos.',
];

// ── PDF ───────────────────────────────────────────────────────────────────────

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16)];
}

function generatePDF(record: Partial<DeliveryRecord> & { devices?: DeliveryDevice[] }, settings: AppSettings) {
  const isE = record.type !== 'devolucion';
  const co = settings.company || {};
  const style = (isE ? settings.pdfStyle?.entrega : settings.pdfStyle?.devolucion) || {};
  const cEmp = co.empresa || 'EMPRESA, S.A.'; const cNif = co.nif || ''; const cD1 = co.dir1 || '';
  const cD2 = co.dir2 || ''; const cTel = co.tel || ''; const cWeb = co.web || '';
  const cMail = co.email || ''; const cCity = co.ciudad || ''; const cLogo = co.logo || '';
  const cResp = record.responsible || '';
  const priColor = hexToRgb(style.primary || '#1c3ca8');
  const footColor = hexToRgb(style.footer || '#0f172a');
  const LBLUE = priColor.map(c => Math.round(c + (255-c)*0.85)) as [number,number,number];
  const GR: [number,number,number] = [100,110,125]; const BK: [number,number,number] = [17,24,39];
  const recipientName = record.first_name ? `${record.first_name} ${record.last_name}` : record.recipient_name || '';
  const parts = recipientName.split(' '); const half = Math.ceil(parts.length/2);
  const apellido = parts.slice(0,half).join(' '); const nombre = parts.slice(half).join(' ') || apellido;
  const full = apellido+(nombre && nombre!==apellido?', '+nombre:'');
  const docId = record.doc_id || 'BORRADOR';
  const fechaStr = record.delivery_date ? new Date(record.delivery_date+'T12:00:00').toLocaleDateString('es-ES',{day:'2-digit',month:'2-digit',year:'numeric'}) : 'XX/XX/XXXX';
  const rawClauses = isE ? (settings.clauses?.entrega||DEFAULT_CLAUSES_E) : (settings.clauses?.devolucion||DEFAULT_CLAUSES_D);
  const clauses = rawClauses.map(c=>c.replace(/\{empresa\}/g,cEmp).replace(/\{trabajador\}/g,full).replace(/\{ciudad\}/g,cCity));
  const doc = new jsPDF({unit:'mm',format:'a4'});
  const W=210,H=297,mL=16,mR=16,cW=W-mL-mR;
  doc.setFillColor(255,255,255); doc.rect(0,0,W,H,'F');
  let y=12; const logoW=68,logoH=18;
  if(cLogo){try{const ext=cLogo.startsWith('data:image/png')?'PNG':'JPEG';doc.addImage(cLogo,ext,mL,y,logoW,logoH);}catch{doc.setFillColor(...priColor);doc.roundedRect(mL,y,logoW,logoH,2,2,'F');doc.setTextColor(255,255,255);doc.setFont('helvetica','bold');doc.setFontSize(8);doc.text(cEmp,mL+logoW/2,y+logoH/2+1.5,{align:'center'});}}
  else{doc.setFillColor(...priColor);doc.roundedRect(mL,y,logoW,logoH,2,2,'F');doc.setTextColor(255,255,255);doc.setFont('helvetica','bold');let bFs=10;doc.setFontSize(bFs);while(doc.getTextWidth(cEmp)>logoW-6&&bFs>6.5){bFs-=0.5;doc.setFontSize(bFs);}if(doc.getTextWidth(cEmp)<=logoW-6){doc.text(cEmp,mL+logoW/2,y+logoH/2+bFs*0.18,{align:'center'});}else{const words=cEmp.split(' ');const mid=Math.ceil(words.length/2);doc.setFontSize(7);doc.text(words.slice(0,mid).join(' '),mL+logoW/2,y+6,{align:'center'});doc.text(words.slice(mid).join(' '),mL+logoW/2,y+11,{align:'center'});}}
  doc.setTextColor(...GR);doc.setFont('helvetica','normal');doc.setFontSize(7.2);
  if(cD1)doc.text(cD1,W-mR,y+3,{align:'right'});if(cD2)doc.text(cD2,W-mR,y+7.5,{align:'right'});if(cTel)doc.text(cTel,W-mR,y+12,{align:'right'});
  y+=22;doc.setDrawColor(...priColor);doc.setLineWidth(0.5);doc.line(mL,y,W-mR,y);y+=9;
  doc.setTextColor(...BK);doc.setFont('helvetica','bold');doc.setFontSize(13);
  const title=isE?'JUSTIFICANTE DE ENTREGA DE MATERIAL':'JUSTIFICANTE DE DEVOLUCIÓN DE MATERIAL';
  doc.text(title,W/2,y,{align:'center'});y+=10;
  doc.setFont('helvetica','normal');doc.setFontSize(9.5);doc.setTextColor(...BK);
  const tail=isE?`hace constar la entrega del siguiente material al trabajador ${full}, para su uso en las tareas relacionadas con su puesto de trabajo en ${cCity}, a ${fechaStr}:`:`hace constar la devolución del siguiente material por parte del trabajador ${full}, en ${cCity}, a ${fechaStr}:`;
  const intro=`La empresa ${cEmp}, a través del siguiente justificante, ${tail}`;
  const introLines=doc.splitTextToSize(intro,cW);doc.text(introLines,mL,y);y+=introLines.length*5+7;
  const tHeaders=['Dispositivo','Descripción / Modelo','Número serie','Observaciones'];
  const tCW=[46,56,42,cW-46-56-42];const rowH=8.5;const devices=record.devices||[];
  doc.setFillColor(...priColor);doc.rect(mL,y,cW,rowH,'F');doc.setTextColor(255,255,255);doc.setFont('helvetica','bold');doc.setFontSize(8);
  let cx=mL;tHeaders.forEach((h,i)=>{doc.text(h,cx+3,y+5.8);cx+=tCW[i];});
  let tableY=y+rowH;
  devices.forEach((dev,ri)=>{
    const row=[dev.device_type||'',dev.model||'',dev.serial_number||'',dev.observations||''];
    const wrapped=row.map((cell,ci)=>doc.splitTextToSize(cell,tCW[ci]-5));
    const maxLines=Math.max(...wrapped.map(w=>w.length));const rH=Math.max(rowH,maxLines*4.8+4);
    doc.setFillColor(...(ri%2===0?LBLUE.map(c=>Math.round(c+(255-c)*0.7)) as [number,number,number]:[255,255,255]));
    doc.rect(mL,tableY,cW,rH,'F');doc.setDrawColor(196,210,230);doc.setLineWidth(0.2);
    let cx2=mL;tCW.forEach(w=>{cx2+=w;doc.line(cx2,tableY,cx2,tableY+rH);});doc.line(mL,tableY+rH,mL+cW,tableY+rH);
    doc.setTextColor(...BK);doc.setFont('helvetica','bold');doc.setFontSize(8.5);
    let cx3=mL;row.forEach((cell,ci)=>{const lines=doc.splitTextToSize(cell,tCW[ci]-5);doc.text(lines,cx3+3,tableY+5.5);cx3+=tCW[ci];});
    tableY+=rH;
  });
  doc.setDrawColor(...priColor);doc.setLineWidth(0.45);doc.rect(mL,y,cW,tableY-y,'S');y=tableY+10;
  doc.setFont('helvetica','normal');doc.setFontSize(8.8);doc.setTextColor(...BK);
  clauses.forEach(c=>{const lines=doc.splitTextToSize(c,cW-7);doc.text('•',mL+0.5,y);doc.text(lines,mL+5,y);y+=lines.length*4.8+2.5;});y+=6;
  const bW=(cW-5)/2;const bH=50;const lx=mL,rx=mL+bW+5;
  doc.setFillColor(...priColor);doc.rect(lx,y,bW,9,'F');doc.setTextColor(255,255,255);doc.setFont('helvetica','bold');doc.setFontSize(8.5);
  doc.text(isE?'Recibe el material EL TRABAJADOR:':'Devuelve el material EL TRABAJADOR:',lx+3,y+6);
  doc.setFillColor(...priColor);doc.rect(rx,y,bW,9,'F');doc.text(isE?'Entrega el material LA EMPRESA:':'Recibe el material LA EMPRESA:',rx+3,y+6);
  doc.setFillColor(240,245,255);doc.rect(lx,y+9,bW,bH,'F');doc.rect(rx,y+9,bW,bH,'F');
  doc.setTextColor(...BK);doc.setFont('helvetica','bold');doc.setFontSize(8.5);if(cResp)doc.text(cResp,rx+3,y+15);
  doc.setDrawColor(...priColor);doc.setLineWidth(0.4);
  doc.line(lx+4,y+9+bH-16,lx+bW-4,y+9+bH-16);doc.line(rx+4,y+9+bH-16,rx+bW-4,y+9+bH-16);
  doc.setTextColor(...GR);doc.setFont('helvetica','normal');doc.setFontSize(8);
  doc.text('DNI:',lx+4,y+9+bH-9);if(record.recipient_dni)doc.text(record.recipient_dni,lx+16,y+9+bH-9);
  doc.text(cNif?`${cEmp} NIF ${cNif}`:cEmp,rx+4,y+9+bH-9);
  doc.setDrawColor(...priColor);doc.setLineWidth(0.45);doc.rect(lx,y,bW,9+bH,'S');doc.rect(rx,y,bW,9+bH,'S');y+=9+bH+8;
  const closing=isE?'Este justificante formaliza la entrega de los dispositivos, detalla sus características y asegura que ambas partes comprenden sus responsabilidades respecto al uso y cuidado del material.':'Este justificante formaliza la devolución del material listado, liberando al empleado de toda responsabilidad sobre el mismo a partir de la fecha indicada.';
  doc.setFont('helvetica','italic');doc.setFontSize(8);doc.setTextColor(...GR);
  doc.text(doc.splitTextToSize(closing,cW),mL,y);
  doc.setFillColor(...footColor);doc.rect(0,H-14,W,14,'F');doc.setTextColor(255,255,255);doc.setFont('helvetica','normal');doc.setFontSize(8);
  if(cWeb)doc.text(cWeb,mL,H-7);doc.text('Pag. 1',W/2,H-7,{align:'center'});if(cMail)doc.text(cMail,W-mR,H-7,{align:'right'});
  doc.save(`${docId}_${record.type||'acta'}.pdf`);
}

// ── Excel Export ──────────────────────────────────────────────────────────────

function exportExcel(records: DeliveryRecord[]) {
  if (!records.length) { toast('No hay registros para exportar', { icon: 'ℹ️' }); return; }
  const data = records.map(r => ({
    'Doc ID':       r.doc_id,
    'Tipo':         r.type === 'entrega' ? 'Entrega' : 'Devolución',
    'Receptor':     r.first_name ? `${r.first_name} ${r.last_name}` : r.recipient_name || '—',
    'DNI':          r.recipient_dni || '',
    'Departamento': r.department || '',
    'Fecha':        new Date(r.delivery_date).toLocaleDateString('es-ES'),
    'Dispositivos': r.devices?.map(d => [d.device_type, d.model, d.serial_number].filter(Boolean).join(' · ')).join(' | ') || '',
    'Responsable':  r.responsible || '',
    'Estado':       STATUS_CONFIG[r.status]?.label || r.status,
    'Notas':        r.notes || '',
    'Creado por':   r.created_by_name || '',
  }));
  const ws = XLSX.utils.json_to_sheet(data);
  const keys = Object.keys(data[0]);
  ws['!cols'] = keys.map(k => ({ wch: Math.min(60, Math.max(k.length+2, ...data.map(row => String((row as any)[k]||'').length+1))) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Actas de entrega');
  XLSX.writeFile(wb, `actas_${new Date().toISOString().slice(0,10)}.xlsx`);
  toast.success(`${data.length} registro(s) exportado(s)`);
}

// ── StatusBadge ───────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: DeliveryStatus }) {
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.pendiente;
  return <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${cfg.color}`}>{cfg.icon}{cfg.label}</span>;
}

// ── InlineStatus (portal fix) ─────────────────────────────────────────────────

function InlineStatus({ record, onUpdated }: { record: DeliveryRecord; onUpdated: () => void }) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (btnRef.current && !btnRef.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);

  const handleOpen = () => {
    if (btnRef.current) { const r = btnRef.current.getBoundingClientRect(); setPos({ top: r.bottom+4, left: r.left }); }
    setOpen(o => !o);
  };

  const change = async (status: DeliveryStatus) => {
    setSaving(true); setOpen(false);
    try { await apiClient.put(`/deliveries/${record.id}`, { status, notes: record.notes, responsible: record.responsible }); toast.success('Estado actualizado'); onUpdated(); }
    catch { toast.error('Error al actualizar'); }
    finally { setSaving(false); }
  };

  const cfg = STATUS_CONFIG[record.status] || STATUS_CONFIG.pendiente;
  return (
    <>
      <button ref={btnRef} onClick={handleOpen} disabled={saving}
        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border cursor-pointer ${cfg.color} ${saving ? 'opacity-50' : 'hover:opacity-75'}`}>
        {saving ? <div className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin" /> : cfg.icon}
        {cfg.label} <ChevronDown className="w-2.5 h-2.5" />
      </button>
      {open && createPortal(
        <div style={{ position:'fixed', top:pos.top, left:pos.left, zIndex:9999 }}
          className="bg-gray-800 border border-gray-700 rounded-xl shadow-xl overflow-hidden w-36">
          {Object.entries(STATUS_CONFIG).map(([k,v]) => (
            <button key={k} onClick={() => change(k as DeliveryStatus)}
              className={`w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-gray-700 transition-colors ${record.status===k?'text-white font-semibold':'text-gray-300'}`}>
              {v.icon} {v.label}
            </button>
          ))}
        </div>,
        document.body
      )}
    </>
  );
}

// ── SmartDeviceRow ────────────────────────────────────────────────────────────

function SmartDeviceRow({ device, index, onChange, onRemove, canRemove, allAssets, allCategories }: {
  device: DeliveryDevice; index: number;
  onChange: (i: number, updates: Partial<DeliveryDevice>) => void;
  onRemove: (i: number) => void; canRemove: boolean;
  allAssets: AssetRaw[]; allCategories: CategoryRaw[];
}) {
  const [modelSearch, setModelSearch] = useState(device.model || '');
  const [serialSearch, setSerialSearch] = useState(device.serial_number || '');
  const [modelOpen, setModelOpen] = useState(false);
  const [serialOpen, setSerialOpen] = useState(false);
  const [modelPos, setModelPos] = useState({ top:0, left:0, width:0 });
  const [serialPos, setSerialPos] = useState({ top:0, left:0, width:0 });
  const modelRef = useRef<HTMLInputElement>(null);
  const serialRef = useRef<HTMLInputElement>(null);

  // Sync local state when device prop changes (e.g. auto-fill from user)
  useEffect(() => { setModelSearch(device.model || ''); }, [device.model]);
  useEffect(() => { setSerialSearch(device.serial_number || ''); }, [device.serial_number]);

  const availableTypes = useMemo(() => {
    const used = new Set(allAssets.map(a => a.category));
    return allCategories.filter(c => used.has(c.value));
  }, [allAssets, allCategories]);

  const filteredModels = useMemo(() => {
    let assets = device.device_type ? allAssets.filter(a => a.category === device.device_type) : allAssets;
    const seen = new Set<string>(); const result: string[] = [];
    assets.forEach(a => { const key = `${a.brand||''} ${a.model||''}`.trim(); if(key && !seen.has(key)){seen.add(key);result.push(key);} });
    return modelSearch ? result.filter(m => m.toLowerCase().includes(modelSearch.toLowerCase())) : result;
  }, [allAssets, device.device_type, modelSearch]);

  const filteredSerials = useMemo(() => {
    let assets = allAssets;
    if(device.device_type) assets = assets.filter(a => a.category === device.device_type);
    if(device.model) assets = assets.filter(a => `${a.brand||''} ${a.model||''}`.trim() === device.model);
    if(serialSearch) assets = assets.filter(a => a.serial_number?.toLowerCase().includes(serialSearch.toLowerCase()));
    return assets.slice(0, 30);
  }, [allAssets, device.device_type, device.model, serialSearch]);

  const openModel = () => {
    if(modelRef.current){const r=modelRef.current.getBoundingClientRect();setModelPos({top:r.bottom+2,left:r.left,width:r.width});}
    setModelOpen(true); setSerialOpen(false);
  };
  const openSerial = () => {
    if(serialRef.current){const r=serialRef.current.getBoundingClientRect();setSerialPos({top:r.bottom+2,left:r.left,width:r.width});}
    setSerialOpen(true); setModelOpen(false);
  };

  const selectModel = (model: string) => {
    setModelSearch(model); onChange(index, { model, serial_number:'', asset_id:null }); setSerialSearch(''); setModelOpen(false);
  };
  const selectSerial = (asset: AssetRaw) => {
    const model = `${asset.brand||''} ${asset.model||''}`.trim();
    const catLabel = allCategories.find(c=>c.value===asset.category)?.label || asset.category;
    setSerialSearch(asset.serial_number); setModelSearch(model);
    onChange(index, { device_type:asset.category, model, serial_number:asset.serial_number, asset_id:asset.id });
    setSerialOpen(false);
  };

  const inp = "w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500";

  return (
    <>
      <div className="grid grid-cols-12 gap-2 items-start p-3 bg-gray-800/50 rounded-lg border border-gray-700/50">
        {/* Tipo */}
        <div className="col-span-2">
          <select className={inp} value={device.device_type}
            onChange={e => { onChange(index,{device_type:e.target.value,model:'',serial_number:'',asset_id:null}); setModelSearch(''); setSerialSearch(''); }}>
            <option value="">Tipo...</option>
            {availableTypes.map(c => <option key={c.value} value={c.value}>{c.icon?`${c.icon} `:''}{c.label}</option>)}
            <option value="__manual__">✏️ Escribir...</option>
          </select>
        </div>
        {/* Modelo */}
        <div className="col-span-3">
          <input ref={modelRef} className={inp} placeholder="Marca / Modelo"
            value={modelSearch}
            onChange={e => { setModelSearch(e.target.value); onChange(index,{model:e.target.value}); setModelOpen(true); }}
            onFocus={openModel}
            onBlur={() => setTimeout(()=>setModelOpen(false),150)}
            autoComplete="off" />
        </div>
        {/* Serie */}
        <div className="col-span-3">
          <input ref={serialRef} className={inp} placeholder="Nº Serie"
            value={serialSearch}
            onChange={e => { setSerialSearch(e.target.value); onChange(index,{serial_number:e.target.value}); setSerialOpen(true); }}
            onFocus={openSerial}
            onBlur={() => setTimeout(()=>setSerialOpen(false),150)}
            autoComplete="off" />
        </div>
        {/* Observaciones */}
        <div className="col-span-3">
          <input className={inp} placeholder="Observaciones" value={device.observations||''}
            onChange={e => onChange(index,{observations:e.target.value})} />
        </div>
        <div className="col-span-1 flex justify-center pt-1">
          {canRemove && <button onClick={()=>onRemove(index)} className="text-gray-600 hover:text-red-400 p-1"><X className="w-4 h-4"/></button>}
        </div>
      </div>

      {/* Modelo dropdown portal */}
      {modelOpen && filteredModels.length > 0 && createPortal(
        <div style={{position:'fixed',top:modelPos.top,left:modelPos.left,width:modelPos.width,zIndex:9999}}
          className="bg-gray-800 border border-gray-700 rounded-xl shadow-2xl max-h-44 overflow-y-auto">
          {filteredModels.map((m,i) => (
            <button key={i} onMouseDown={()=>selectModel(m)}
              className="w-full text-left px-3 py-2 text-sm text-gray-300 hover:bg-gray-700 hover:text-white truncate">
              {m}
            </button>
          ))}
        </div>, document.body
      )}

      {/* Serie dropdown portal */}
      {serialOpen && filteredSerials.length > 0 && createPortal(
        <div style={{position:'fixed',top:serialPos.top,left:serialPos.left,width:serialPos.width,zIndex:9999}}
          className="bg-gray-800 border border-gray-700 rounded-xl shadow-2xl max-h-44 overflow-y-auto">
          {filteredSerials.map(a => (
            <button key={a.id} onMouseDown={()=>selectSerial(a)}
              className="w-full text-left px-3 py-2 text-sm hover:bg-gray-700 flex items-center gap-2">
              <span className="font-mono text-white">{a.serial_number}</span>
              <span className="text-gray-500 text-xs truncate">{`${a.brand||''} ${a.model||''}`.trim()}</span>
            </button>
          ))}
        </div>, document.body
      )}
    </>
  );
}

// ── BulkDeleteModal ───────────────────────────────────────────────────────────

function BulkDeleteModal({ records, onClose, onDeleted }: {
  records: DeliveryRecord[]; onClose: () => void; onDeleted: () => void;
}) {
  const [range, setRange] = useState<'semana'|'mes'|'todo'|'manual'>('manual');
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [confirm, setConfirm] = useState(false);

  const getStartDate = (r: typeof range) => {
    const now = new Date();
    if(r==='semana'){const d=new Date(now);d.setDate(d.getDate()-d.getDay()+1);d.setHours(0,0,0,0);return d;}
    if(r==='mes'){return new Date(now.getFullYear(),now.getMonth(),1);}
    return null;
  };

  useEffect(() => {
    if(range==='manual'){setSelected(new Set());return;}
    const start = range==='todo' ? null : getStartDate(range);
    const ids = new Set(records.filter(r => !start || new Date(r.delivery_date+'T12:00:00') >= start).map(r=>r.id));
    setSelected(ids);
  }, [range, records]);

  const toggle = (id: number) => setSelected(prev => { const s=new Set(prev); s.has(id)?s.delete(id):s.add(id); return s; });
  const toggleAll = () => setSelected(selected.size===records.length ? new Set() : new Set(records.map(r=>r.id)));

  const handleDelete = async () => {
    setDeleting(true);
    let ok=0, fail=0;
    for(const id of selected){
      try{await apiClient.delete(`/deliveries/${id}`);ok++;}catch{fail++;}
    }
    setDeleting(false);
    if(ok>0) toast.success(`${ok} acta(s) eliminada(s)${fail>0?` (${fail} fallaron)`:''}`);
    else toast.error('Error al eliminar');
    onDeleted(); onClose();
  };

  const RANGES: {id: typeof range; label: string}[] = [
    {id:'semana', label:'Esta semana'},
    {id:'mes', label:'Este mes'},
    {id:'todo', label:'Todos'},
    {id:'manual', label:'Manual'},
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/70 overflow-y-auto py-8">
      <div className="w-full max-w-2xl mx-4 bg-gray-900 rounded-2xl border border-gray-800 shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-red-600/20 flex items-center justify-center"><Trash2 className="w-5 h-5 text-red-400"/></div>
            <div><h2 className="text-base font-semibold text-white">Eliminar registros</h2><p className="text-xs text-gray-500">Selecciona qué actas quieres eliminar</p></div>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white"><X className="w-5 h-5"/></button>
        </div>

        <div className="p-6 space-y-4">
          {/* Filtros rápidos */}
          <div>
            <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2 flex items-center gap-1.5"><Calendar className="w-3.5 h-3.5"/>Selección rápida</p>
            <div className="flex gap-2">
              {RANGES.map(r => (
                <button key={r.id} onClick={()=>setRange(r.id)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${range===r.id?'bg-red-600 text-white':'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-white'}`}>
                  {r.label}
                </button>
              ))}
            </div>
          </div>

          {/* Lista */}
          <div className="bg-gray-800/40 rounded-xl border border-gray-700/50 overflow-hidden max-h-72 overflow-y-auto">
            <div className="flex items-center gap-3 px-4 py-2.5 border-b border-gray-700/50 sticky top-0 bg-gray-800/80">
              <button onClick={toggleAll} className="text-gray-400 hover:text-white">
                {selected.size===records.length ? <CheckSquare className="w-4 h-4 text-red-400"/> : <Square className="w-4 h-4"/>}
              </button>
              <span className="text-xs text-gray-400">{selected.size} de {records.length} seleccionados</span>
            </div>
            {records.map(r => {
              const name = r.first_name ? `${r.first_name} ${r.last_name}` : r.recipient_name||'—';
              const isSelected = selected.has(r.id);
              return (
                <button key={r.id} onClick={()=>toggle(r.id)}
                  className={`w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-gray-700/50 transition-colors border-b border-gray-700/30 last:border-0 ${isSelected?'bg-red-600/10':''}`}>
                  {isSelected ? <CheckSquare className="w-4 h-4 text-red-400 flex-shrink-0"/> : <Square className="w-4 h-4 text-gray-600 flex-shrink-0"/>}
                  <span className="font-mono text-xs text-gray-500 w-24 flex-shrink-0">{r.doc_id}</span>
                  <span className="text-sm text-white flex-1 truncate">{name}</span>
                  <span className="text-xs text-gray-500">{new Date(r.delivery_date).toLocaleDateString('es-ES')}</span>
                  <span className={`text-xs px-1.5 py-0.5 rounded ${r.type==='entrega'?'text-blue-400':'text-purple-400'}`}>{r.type==='entrega'?'📤':'📥'}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-800">
          <button onClick={()=>exportExcel(records.filter(r=>selected.has(r.id)))}
            disabled={selected.size===0}
            className="flex items-center gap-1.5 px-3 py-2 text-sm text-gray-400 hover:text-white border border-gray-700 hover:border-gray-600 rounded-lg transition-colors disabled:opacity-40">
            <FileSpreadsheet className="w-4 h-4"/> Exportar selección
          </button>
          <div className="flex items-center gap-3">
            <button onClick={onClose} className="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors">Cancelar</button>
            {!confirm ? (
              <button onClick={()=>setConfirm(true)} disabled={selected.size===0}
                className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-500 disabled:opacity-40 text-white text-sm font-medium rounded-lg transition-colors">
                <Trash2 className="w-4 h-4"/> Eliminar {selected.size>0?`(${selected.size})`:''}
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-xs text-red-400">¿Seguro? Se eliminarán {selected.size} acta(s)</span>
                <button onClick={handleDelete} disabled={deleting}
                  className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white text-sm font-medium rounded-lg transition-colors">
                  {deleting?'Eliminando...':'Confirmar'}
                </button>
                <button onClick={()=>setConfirm(false)} className="text-xs text-gray-500 hover:text-white">Cancelar</button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── CreateModal ───────────────────────────────────────────────────────────────

function CreateModal({ onClose, onCreated, records, settings }: {
  onClose: () => void; onCreated: () => void; records: DeliveryRecord[]; settings: AppSettings;
}) {
  const { user } = useAuth();
  const [type, setType] = useState<'entrega'|'devolucion'>('entrega');
  const [deliveryDate, setDeliveryDate] = useState(new Date().toISOString().slice(0,10));
  const [responsible, setResponsible] = useState(settings.responsables?.[0]||user?.full_name||'');
  const [status, setStatus] = useState<DeliveryStatus>('pendiente');
  const [notes, setNotes] = useState(''); const [dni, setDni] = useState('');
  const [devices, setDevices] = useState<DeliveryDevice[]>([{...EMPTY_DEVICE}]);
  const [saving, setSaving] = useState(false);
  const [userSearch, setUserSearch] = useState(''); const [userResults, setUserResults] = useState<ClientUser[]>([]);
  const [selectedUser, setSelectedUser] = useState<ClientUser|null>(null); const [userDropdown, setUserDropdown] = useState(false);
  const [loadingAssets, setLoadingAssets] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false); const [templateSearch, setTemplateSearch] = useState('');
  const templateRef = useRef<HTMLDivElement>(null);
  const [allAssets, setAllAssets] = useState<AssetRaw[]>([]);
  const [allCategories, setAllCategories] = useState<CategoryRaw[]>([]);

  // Load assets + categories for autocomplete
  useEffect(() => {
    Promise.all([apiClient.get('/assets'), apiClient.get('/categories')]).then(([a,c]) => {
      setAllAssets(a.data); setAllCategories(c.data);
    }).catch(()=>{});
  }, []);

  useEffect(() => {
    const h=(e:MouseEvent)=>{if(templateRef.current&&!templateRef.current.contains(e.target as Node))setTemplateOpen(false);};
    document.addEventListener('mousedown',h); return()=>document.removeEventListener('mousedown',h);
  },[]);

  useEffect(()=>{
    if(userSearch.length<2){setUserResults([]);return;}
    const t=setTimeout(async()=>{
      try{const res=await apiClient.get('/client-users');const q=userSearch.toLowerCase();
        setUserResults((res.data as ClientUser[]).filter(u=>`${u.first_name} ${u.last_name}`.toLowerCase().includes(q)||u.employee_id?.toLowerCase().includes(q)||u.department?.toLowerCase().includes(q)).slice(0,8));
        setUserDropdown(true);}catch{setUserResults([]);}
    },250);return()=>clearTimeout(t);
  },[userSearch]);

  const selectUser=async(u:ClientUser)=>{
    setSelectedUser(u);setUserSearch(`${u.first_name} ${u.last_name}`);setUserDropdown(false);setLoadingAssets(true);
    try{const res=await apiClient.get(`/client-users/${u.id}/assets`);const assets:(Asset&{category_label:string})[]=res.data;
      if(assets.length>0){setDevices(assets.map(a=>({asset_id:a.id,device_type:a.category_label||a.category,model:`${a.brand||''} ${a.model||''}`.trim(),serial_number:a.serial_number,observations:''})));toast.success(`${assets.length} dispositivo(s) cargado(s)`);}
      else{setDevices([{...EMPTY_DEVICE}]);toast(`${u.first_name} no tiene material asignado`,{icon:'ℹ️'});}
    }catch{toast.error('No se pudieron cargar los activos');}finally{setLoadingAssets(false);}
  };

  const clearUser=()=>{setSelectedUser(null);setUserSearch('');setDni('');setDevices([{...EMPTY_DEVICE}]);};

  const loadTemplate=(r:DeliveryRecord)=>{
    setType(r.type);setResponsible(r.responsible||'');setNotes(r.notes||'');
    setUserSearch(r.first_name?`${r.first_name} ${r.last_name}`:r.recipient_name||'');
    if(r.devices?.length)setDevices(r.devices.map(d=>({asset_id:d.asset_id||null,device_type:d.device_type||'',model:d.model||'',serial_number:d.serial_number||'',observations:d.observations||''})));
    setTemplateOpen(false);setTemplateSearch('');toast.success(`Plantilla cargada desde ${r.doc_id}`);
  };

  const filteredTemplates=records.filter(r=>{const q=templateSearch.toLowerCase();const name=r.first_name?`${r.first_name} ${r.last_name}`:r.recipient_name||'';return!q||name.toLowerCase().includes(q)||r.doc_id.toLowerCase().includes(q);}).slice(0,8);

  const updateDevice=(i:number,updates:Partial<DeliveryDevice>)=>setDevices(prev=>prev.map((d,idx)=>idx===i?{...d,...updates}:d));
  const removeDevice=(i:number)=>setDevices(prev=>prev.filter((_,idx)=>idx!==i));

  const handleSubmit=async()=>{
    if(!deliveryDate)return toast.error('La fecha es obligatoria');
    if(devices.every(d=>!d.serial_number&&!d.model))return toast.error('Añade al menos un dispositivo');
    setSaving(true);
    try{await apiClient.post('/deliveries',{type,client_user_id:selectedUser?.id||null,recipient_name:selectedUser?`${selectedUser.first_name} ${selectedUser.last_name}`:userSearch||null,recipient_dni:dni||null,delivery_date:deliveryDate,responsible,notes,status,devices:devices.filter(d=>d.serial_number||d.model)});toast.success('Acta creada correctamente');onCreated();onClose();}
    catch(err:any){toast.error(err?.response?.data?.error||'Error al crear el acta');}finally{setSaving(false);}
  };

  const previewPDF=()=>generatePDF({type,doc_id:'BORRADOR',recipient_name:selectedUser?`${selectedUser.first_name} ${selectedUser.last_name}`:userSearch||'—',recipient_dni:dni,responsible,delivery_date:deliveryDate,devices:devices.filter(d=>d.serial_number||d.model)},settings);

  const inp="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500";
  const lbl="block text-xs font-medium text-gray-400 mb-1.5";

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/70 overflow-y-auto py-8">
      <div className="w-full max-w-3xl mx-4 bg-gray-900 rounded-2xl border border-gray-800 shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-blue-600/20 flex items-center justify-center"><FileText className="w-5 h-5 text-blue-400"/></div>
            <div><h2 className="text-base font-semibold text-white">Nueva acta</h2><p className="text-xs text-gray-500">Entrega o devolución de material</p></div>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative" ref={templateRef}>
              <button onClick={()=>setTemplateOpen(o=>!o)} className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-400 hover:text-white border border-gray-700 hover:border-gray-600 rounded-lg transition-colors">
                <Copy className="w-3.5 h-3.5"/> Cargar plantilla
              </button>
              {templateOpen&&(
                <div className="absolute right-0 top-full mt-1 w-72 bg-gray-800 border border-gray-700 rounded-xl shadow-2xl z-10 overflow-hidden">
                  <div className="p-2 border-b border-gray-700">
                    <div className="relative"><Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500"/>
                      <input className="w-full bg-gray-700 rounded-lg pl-8 pr-3 py-1.5 text-xs text-white placeholder-gray-500 focus:outline-none" placeholder="Buscar acta anterior..." value={templateSearch} onChange={e=>setTemplateSearch(e.target.value)} autoFocus/>
                    </div>
                  </div>
                  <div className="max-h-52 overflow-y-auto">
                    {filteredTemplates.length===0?<p className="text-xs text-gray-500 text-center py-4">No hay actas anteriores</p>
                      :filteredTemplates.map(r=>{const name=r.first_name?`${r.first_name} ${r.last_name}`:r.recipient_name||'—';return(
                        <button key={r.id} onClick={()=>loadTemplate(r)} className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-gray-700 transition-colors text-left">
                          <div className="flex-1"><p className="text-xs font-medium text-white">{name}</p><p className="text-xs text-gray-500">{r.doc_id} · {new Date(r.delivery_date).toLocaleDateString('es-ES')}</p></div>
                          <span className={`text-xs px-1.5 py-0.5 rounded font-medium flex-shrink-0 ${r.type==='entrega'?'bg-blue-600/20 text-blue-400':'bg-purple-600/20 text-purple-400'}`}>{r.type==='entrega'?'📤':'📥'}</span>
                        </button>);})
                    }
                  </div>
                </div>
              )}
            </div>
            <button onClick={onClose} className="text-gray-500 hover:text-white"><X className="w-5 h-5"/></button>
          </div>
        </div>

        <div className="p-6 space-y-5">
          <div className="grid grid-cols-3 gap-4">
            <div><label className={lbl}>Tipo *</label>
              <div className="flex rounded-lg overflow-hidden border border-gray-700">
                {(['entrega','devolucion']as const).map(t=>(
                  <button key={t} onClick={()=>setType(t)} className={`flex-1 py-2.5 text-sm font-medium transition-colors ${type===t?'bg-blue-600 text-white':'bg-gray-800 text-gray-400 hover:text-white'}`}>{t==='entrega'?'📤 Entrega':'📥 Devolución'}</button>
                ))}
              </div>
            </div>
            <div><label className={lbl}>Fecha *</label><input type="date" className={inp} value={deliveryDate} onChange={e=>setDeliveryDate(e.target.value)}/></div>
            <div><label className={lbl}>Estado</label>
              <select className={inp} value={status} onChange={e=>setStatus(e.target.value as DeliveryStatus)}>
                {Object.entries(STATUS_CONFIG).map(([k,v])=><option key={k} value={k}>{v.label}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className={lbl}><User className="w-3 h-3 inline mr-1"/>Receptor</label>
            <div className="relative">
              {selectedUser?(
                <div className="flex items-center gap-3 p-3 bg-blue-600/10 border border-blue-600/30 rounded-lg">
                  <div className="w-8 h-8 rounded-full bg-blue-600/20 flex items-center justify-center text-sm font-bold text-blue-400">{selectedUser.first_name.charAt(0)}</div>
                  <div className="flex-1"><p className="text-sm font-medium text-white">{selectedUser.first_name} {selectedUser.last_name}</p><p className="text-xs text-gray-400">{selectedUser.department||''}{selectedUser.employee_id?` · ${selectedUser.employee_id}`:''}</p></div>
                  {loadingAssets&&<div className="w-4 h-4 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin"/>}
                  <button onClick={clearUser} className="text-gray-500 hover:text-red-400"><X className="w-4 h-4"/></button>
                </div>
              ):(
                <>
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 pointer-events-none"/>
                  <input className={`${inp} pl-9`} placeholder="Busca por nombre, departamento o ID..." value={userSearch}
                    onChange={e=>{setUserSearch(e.target.value);if(!e.target.value)setUserDropdown(false);}}
                    onFocus={()=>userResults.length>0&&setUserDropdown(true)}/>
                  {userDropdown&&userResults.length>0&&(
                    <div className="absolute z-10 top-full mt-1 w-full bg-gray-800 border border-gray-700 rounded-xl shadow-xl overflow-hidden">
                      {userResults.map(u=>(
                        <button key={u.id} onClick={()=>selectUser(u)} className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-gray-700 transition-colors text-left">
                          <div className="w-7 h-7 rounded-full bg-blue-600/20 flex items-center justify-center text-xs font-bold text-blue-400 flex-shrink-0">{u.first_name.charAt(0)}</div>
                          <div><p className="text-sm text-white">{u.first_name} {u.last_name}</p><p className="text-xs text-gray-400">{u.department||'—'}{u.employee_id?` · ${u.employee_id}`:''}</p></div>
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div><label className={lbl}>DNI / NIE del receptor</label><input className={inp} placeholder="12345678A" value={dni} onChange={e=>setDni(e.target.value)}/></div>
            <div><label className={lbl}>Responsable (firma empresa)</label>
              <select className={inp} value={responsible} onChange={e=>setResponsible(e.target.value)}>
                {(settings.responsables||['Responsable TI']).map(r=><option key={r} value={r}>{r}</option>)}
                <option value={user?.full_name||''}>{user?.full_name||'Usuario actual'}</option>
              </select>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className={`${lbl} mb-0`}><Package className="w-3 h-3 inline mr-1"/>Dispositivos</label>
              <button onClick={()=>setDevices(p=>[...p,{...EMPTY_DEVICE}])} className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 transition-colors">
                <Plus className="w-3 h-3"/> Añadir dispositivo
              </button>
            </div>
            <div className="grid grid-cols-12 gap-2 px-3 mb-1">
              {['Tipo','Marca / Modelo','Nº Serie','Observaciones',''].map((h,i)=>(
                <div key={i} className={`text-xs text-gray-500 font-medium ${i===0?'col-span-2':i===4?'col-span-1':'col-span-3'}`}>{h}</div>
              ))}
            </div>
            <div className="space-y-2">
              {devices.map((dev,i)=>(
                <SmartDeviceRow key={i} device={dev} index={i} onChange={updateDevice} onRemove={removeDevice} canRemove={devices.length>1} allAssets={allAssets} allCategories={allCategories}/>
              ))}
            </div>
          </div>

          <div><label className={lbl}>Notas internas</label><textarea className={`${inp} resize-none`} rows={2} placeholder="Notas internas (no aparecen en el PDF)..." value={notes} onChange={e=>setNotes(e.target.value)}/></div>
        </div>

        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-800">
          <button onClick={previewPDF} className="flex items-center gap-1.5 px-3 py-2 text-sm text-gray-400 hover:text-white border border-gray-700 hover:border-gray-600 rounded-lg transition-colors">
            <Download className="w-4 h-4"/> Vista previa PDF
          </button>
          <div className="flex items-center gap-3">
            <button onClick={onClose} className="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors">Cancelar</button>
            <button onClick={handleSubmit} disabled={saving}
              className="flex items-center gap-2 px-5 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors">
              {saving?<div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"/>:<FileText className="w-4 h-4"/>}
              Crear acta
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── DetailModal ───────────────────────────────────────────────────────────────

function DetailModal({ record, onClose, onUpdated, onDelete, settings }: {
  record: DeliveryRecord; onClose: () => void; onUpdated: () => void; onDelete: () => void; settings: AppSettings;
}) {
  const { user } = useAuth();
  const [confirmDelete, setConfirmDelete] = useState(false); const [deleting, setDeleting] = useState(false);
  const canEdit = user?.role==='admin'||user?.role==='editor';
  const handleDelete=async()=>{setDeleting(true);try{await apiClient.delete(`/deliveries/${record.id}`);toast.success('Acta eliminada');onDelete();onClose();}catch{toast.error('Error al eliminar');}finally{setDeleting(false);}};
  const recipientName=record.first_name?`${record.first_name} ${record.last_name}`:record.recipient_name||'—';
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 py-8">
      <div className="w-full max-w-2xl mx-4 bg-gray-900 rounded-2xl border border-gray-800 shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
          <div className="flex items-center gap-3">
            <span className="text-xs font-mono bg-gray-800 px-2 py-1 rounded text-gray-400">{record.doc_id}</span>
            <span className={`text-xs px-2 py-0.5 rounded font-medium ${record.type==='entrega'?'bg-blue-600/20 text-blue-400':'bg-purple-600/20 text-purple-400'}`}>{record.type==='entrega'?'📤 Entrega':'📥 Devolución'}</span>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={()=>generatePDF(record,settings)} className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-400 hover:text-white border border-gray-700 hover:border-gray-600 rounded-lg transition-colors">
              <Download className="w-3.5 h-3.5"/> Descargar PDF
            </button>
            <button onClick={onClose} className="text-gray-500 hover:text-white"><X className="w-5 h-5"/></button>
          </div>
        </div>
        <div className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div><p className="text-xs text-gray-500 mb-0.5">Receptor</p><p className="text-white font-medium">{recipientName}</p>{record.recipient_dni&&<p className="text-xs text-gray-400">DNI: {record.recipient_dni}</p>}{record.department&&<p className="text-xs text-gray-400">{record.department}</p>}</div>
            <div><p className="text-xs text-gray-500 mb-0.5">Fecha</p><p className="text-white">{new Date(record.delivery_date).toLocaleDateString('es-ES')}</p></div>
            <div><p className="text-xs text-gray-500 mb-0.5">Responsable</p><p className="text-white">{record.responsible||'—'}</p></div>
            <div><p className="text-xs text-gray-500 mb-0.5">Estado</p><StatusBadge status={record.status}/></div>
          </div>
          {record.devices&&record.devices.length>0&&(
            <div><p className="text-xs font-medium text-gray-400 mb-2">Dispositivos ({record.devices.length})</p>
              <div className="space-y-1.5">
                {record.devices.map((d,i)=>(
                  <div key={i} className="flex items-center gap-3 p-2.5 bg-gray-800/60 rounded-lg text-sm">
                    <Package className="w-4 h-4 text-gray-500 flex-shrink-0"/>
                    <span className="text-gray-400 text-xs w-20 flex-shrink-0">{d.device_type}</span>
                    <span className="text-white flex-1">{d.model}</span>
                    <span className="font-mono text-xs text-gray-400">{d.serial_number}</span>
                    {d.observations&&<span className="text-gray-500 text-xs">· {d.observations}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
          {record.notes&&<div><p className="text-xs font-medium text-gray-400 mb-1">Notas</p><p className="text-sm text-gray-300 bg-gray-800/60 rounded-lg p-3">{record.notes}</p></div>}
        </div>
        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-800">
          <div>
            {canEdit&&!confirmDelete&&<button onClick={()=>setConfirmDelete(true)} className="flex items-center gap-1.5 text-sm text-red-500 hover:text-red-400"><Trash2 className="w-4 h-4"/>Eliminar</button>}
            {confirmDelete&&<div className="flex items-center gap-2"><span className="text-xs text-red-400">¿Seguro?</span><button onClick={handleDelete} disabled={deleting} className="text-xs px-3 py-1 bg-red-600 hover:bg-red-500 text-white rounded-lg">{deleting?'Eliminando...':'Confirmar'}</button><button onClick={()=>setConfirmDelete(false)} className="text-xs text-gray-500 hover:text-white">Cancelar</button></div>}
          </div>
          <button onClick={onClose} className="text-sm text-gray-400 hover:text-white px-4 py-2">Cerrar</button>
        </div>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function DeliveryPage() {
  const { user } = useAuth();
  const [records, setRecords] = useState<DeliveryRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState(''); const [filterType, setFilterType] = useState(''); const [filterStatus, setFilterStatus] = useState('');
  const [showCreate, setShowCreate] = useState(false); const [selected, setSelected] = useState<DeliveryRecord|null>(null);
  const [settings, setSettings] = useState<AppSettings>({});
  const [showBulkDelete, setShowBulkDelete] = useState(false);
  const canEdit = user?.role==='admin'||user?.role==='editor';

  const load=useCallback(()=>{
    setLoading(true);
    Promise.all([apiClient.get('/deliveries'),apiClient.get('/settings')]).then(([recs,sets])=>{setRecords(recs.data);setSettings(sets.data);}).catch(()=>{}).finally(()=>setLoading(false));
  },[]);

  useEffect(()=>{load();},[load]);

  const filtered=records.filter(r=>{
    const name=r.first_name?`${r.first_name} ${r.last_name}`:r.recipient_name||'';const q=search.toLowerCase();
    return(!q||name.toLowerCase().includes(q)||r.doc_id.toLowerCase().includes(q)||r.devices?.some(d=>d.serial_number?.toLowerCase().includes(q)||d.model?.toLowerCase().includes(q)))&&(!filterType||r.type===filterType)&&(!filterStatus||r.status===filterStatus);
  });

  const stats={total:records.length,entregas:records.filter(r=>r.type==='entrega').length,devoluciones:records.filter(r=>r.type==='devolucion').length,pendientes:records.filter(r=>r.status==='pendiente').length};

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-bold text-white">Doc. Entrega</h1><p className="text-gray-400 text-sm mt-1">Gestión de actas de entrega y devolución de material</p></div>
        {canEdit&&<button onClick={()=>setShowCreate(true)} className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg transition-colors shadow-lg shadow-blue-900/30"><Plus className="w-4 h-4"/>Nueva acta</button>}
      </div>

      <div className="grid grid-cols-4 gap-4">
        {[
          {label:'Total actas',value:stats.total,color:'text-white',bg:'bg-gray-800/60',icon:<FileText className="w-5 h-5 text-gray-400"/>},
          {label:'Entregas',value:stats.entregas,color:'text-blue-400',bg:'bg-blue-600/10',icon:<FileText className="w-5 h-5 text-blue-400"/>},
          {label:'Devoluciones',value:stats.devoluciones,color:'text-purple-400',bg:'bg-purple-600/10',icon:<RotateCcw className="w-5 h-5 text-purple-400"/>},
          {label:'Pendientes',value:stats.pendientes,color:'text-yellow-400',bg:'bg-yellow-600/10',icon:<Clock className="w-5 h-5 text-yellow-400"/>},
        ].map(s=>(
          <div key={s.label} className={`${s.bg} rounded-xl p-4 border border-gray-800 flex items-center gap-4`}>
            <div className="w-10 h-10 rounded-lg bg-gray-800/60 flex items-center justify-center">{s.icon}</div>
            <div><p className={`text-2xl font-bold ${s.color}`}>{s.value}</p><p className="text-xs text-gray-500">{s.label}</p></div>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500"/>
          <input className="w-full bg-gray-800 border border-gray-700 rounded-lg pl-9 pr-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500" placeholder="Nombre, doc ID, serie..." value={search} onChange={e=>setSearch(e.target.value)}/>
        </div>
        <select className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500" value={filterType} onChange={e=>setFilterType(e.target.value)}>
          <option value="">Todos los tipos</option><option value="entrega">Entrega</option><option value="devolucion">Devolución</option>
        </select>
        <select className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500" value={filterStatus} onChange={e=>setFilterStatus(e.target.value)}>
          <option value="">Todos los estados</option>
          {Object.entries(STATUS_CONFIG).map(([k,v])=><option key={k} value={k}>{v.label}</option>)}
        </select>
        <button onClick={load} className="p-2 text-gray-500 hover:text-white transition-colors"><RefreshCw className="w-4 h-4"/></button>
        <div className="flex items-center gap-2 ml-auto">
          <button onClick={()=>exportExcel(filtered)}
            className="flex items-center gap-1.5 px-3 py-2 text-sm text-gray-400 hover:text-white border border-gray-700 hover:border-gray-600 rounded-lg transition-colors">
            <FileSpreadsheet className="w-4 h-4"/> Exportar Excel
          </button>
          {canEdit&&<button onClick={()=>setShowBulkDelete(true)}
            className="flex items-center gap-1.5 px-3 py-2 text-sm text-red-400 hover:text-red-300 border border-red-800/50 hover:border-red-600/50 rounded-lg transition-colors">
            <Trash2 className="w-4 h-4"/> Eliminar registros
          </button>}
        </div>
      </div>

      <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
        {loading?(
          <div className="flex items-center justify-center h-40"><div className="w-7 h-7 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin"/></div>
        ):filtered.length===0?(
          <div className="flex flex-col items-center justify-center h-40 text-gray-500 gap-3">
            <FileText className="w-10 h-10 opacity-30"/>
            <p className="text-sm">{records.length===0?'Todavía no hay actas registradas':'No hay resultados'}</p>
            {records.length===0&&canEdit&&<button onClick={()=>setShowCreate(true)} className="text-xs text-blue-400 hover:text-blue-300">Crear primera acta →</button>}
          </div>
        ):(
          <table className="w-full text-sm">
            <thead><tr className="border-b border-gray-800">
              {['Doc ID','Tipo','Receptor','Fecha','Dispositivos','Estado','PDF'].map(h=>(
                <th key={h} className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">{h}</th>
              ))}
            </tr></thead>
            <tbody className="divide-y divide-gray-800/60">
              {filtered.map(r=>{
                const recipientName=r.first_name?`${r.first_name} ${r.last_name}`:r.recipient_name||'—';
                return(
                  <tr key={r.id} className="hover:bg-gray-800/30 transition-colors">
                    <td className="px-4 py-3"><button onClick={()=>setSelected(r)} className="font-mono text-xs text-gray-400 hover:text-blue-400 transition-colors">{r.doc_id}</button></td>
                    <td className="px-4 py-3"><span className={`text-xs px-2 py-0.5 rounded font-medium ${r.type==='entrega'?'bg-blue-600/20 text-blue-400':'bg-purple-600/20 text-purple-400'}`}>{r.type==='entrega'?'📤 Entrega':'📥 Devolución'}</span></td>
                    <td className="px-4 py-3"><p className="text-white font-medium">{recipientName}</p>{r.department&&<p className="text-xs text-gray-500">{r.department}</p>}</td>
                    <td className="px-4 py-3 text-gray-300">{new Date(r.delivery_date).toLocaleDateString('es-ES')}</td>
                    <td className="px-4 py-3 text-gray-300">{r.devices?.length?`${r.devices.length} dispositivo${r.devices.length!==1?'s':''}`:<span className="text-gray-600">—</span>}</td>
                    <td className="px-4 py-3">{canEdit?<InlineStatus record={r} onUpdated={load}/>:<StatusBadge status={r.status}/>}</td>
                    <td className="px-4 py-3"><button onClick={()=>generatePDF(r,settings)} title="Descargar PDF" className="text-gray-600 hover:text-blue-400 transition-colors p-1"><Download className="w-4 h-4"/></button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {showCreate&&<CreateModal onClose={()=>setShowCreate(false)} onCreated={load} records={records} settings={settings}/>}
      {selected&&<DetailModal record={selected} onClose={()=>setSelected(null)} onUpdated={load} onDelete={()=>{setSelected(null);load();}} settings={settings}/>}
      {showBulkDelete&&<BulkDeleteModal records={filtered.length>0?filtered:records} onClose={()=>setShowBulkDelete(false)} onDeleted={load}/>}
    </div>
  );
}
