import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Filter, ChevronDown } from 'lucide-react';
​
export interface FilterOption {
  value: string;
  label: string;
  icon?: ReactNode;
}
​
interface FilterDropdownProps {
  label: string;
  options: FilterOption[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
  emptyText?: string;
}
​
/**
 * Filtro desplegable multiselección con el mismo estilo que la página de Hardware.
 * Sustituye a los antiguos "pills" de filtro.
 */
export default function FilterDropdown({
  label,
  options,
  selected,
  onChange,
  emptyText,
}: FilterDropdownProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
​
  // Cerrar al hacer clic fuera
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [open]);
​
  const toggle = (v: string) => {
    const n = new Set(selected);
    n.has(v) ? n.delete(v) : n.add(v);
    onChange(n);
  };
​
  return (
    <div className="relative" ref={ref}>
      <button
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border transition-colors ${
          selected.size > 0
            ? 'bg-blue-600/20 border-blue-500/50 text-blue-300'
            : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-white'
        }`}
      >
        <Filter className="w-3 h-3" />
        {label}{selected.size > 0 ? ` (${selected.size})` : ''}
        <ChevronDown className="w-3 h-3" />
      </button>
      {open && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="absolute top-full left-0 mt-1 z-30 bg-gray-900 border border-gray-700 rounded-xl shadow-2xl py-1 min-w-[180px] max-h-60 overflow-y-auto"
        >
          {options.length === 0 ? (
            <p className="px-3 py-2 text-xs text-gray-500">{emptyText || 'Sin opciones'}</p>
          ) : (
            options.map((o) => (
              <button
                key={o.value}
                onClick={() => toggle(o.value)}
                className={`w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-gray-800 transition-colors ${
                  selected.has(o.value) ? 'text-blue-400' : 'text-gray-300'
                }`}
              >
                <span
                  className={`w-3.5 h-3.5 rounded border flex-shrink-0 flex items-center justify-center ${
                    selected.has(o.value) ? 'bg-blue-600 border-blue-500' : 'border-gray-600'
                  }`}
                >
                  {selected.has(o.value) && <span className="text-white text-[9px]">✓</span>}
                </span>
                {o.icon} {o.label}
              </button>
            ))
          )}
          {selected.size > 0 && (
            <button
              onClick={() => onChange(new Set())}
              className="w-full text-left px-3 py-2 text-xs text-red-400 hover:bg-gray-800 border-t border-gray-800 mt-1"
            >
              Limpiar {label.toLowerCase()}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
​
