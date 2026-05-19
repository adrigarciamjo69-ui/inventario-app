/**
 * Logo de la aplicación.
 *
 * ─── CÓMO PONER TU PROPIO LOGO ──────────────────────────────────────────────
 *
 * 1. Copia tu imagen de logo a la carpeta /public con el nombre "logo.png"
 *    (también puede ser .svg, .jpg, .webp — cambia la ruta abajo)
 *
 * 2. En la constante LOGO_SRC pon la ruta a tu imagen:
 *       const LOGO_SRC = '/logo.png';        ← imagen en /public/logo.png
 *       const LOGO_SRC = '/logo.svg';        ← imagen en /public/logo.svg
 *       const LOGO_SRC = null;               ← usa el icono por defecto (Monitor)
 *
 * 3. Si prefieres importar la imagen como módulo (carpeta /src/assets):
 *       import logoImg from '../assets/logo.png';
 *       const LOGO_SRC = logoImg;
 *
 * ────────────────────────────────────────────────────────────────────────────
 */

import { Monitor } from 'lucide-react';

// ↓↓↓ CAMBIA ESTO por la ruta a tu logo ↓↓↓
const LOGO_SRC: string | null = null;
// Ejemplos:
//   const LOGO_SRC = '/logo.png';
//   const LOGO_SRC = '/logo.svg';
//   const LOGO_SRC = null;  ← icono por defecto

// Nombre visible de la app (puedes cambiarlo también)
export const APP_NAME = 'InventarioIT';
export const APP_SUBTITLE = 'Control de Activos';

// ─────────────────────────────────────────────────────────────────────────────
// Variantes del logo
// ─────────────────────────────────────────────────────────────────────────────

/** Logo grande para la pantalla de login */
export function LogoLogin() {
  if (LOGO_SRC) {
    return (
      <img
        src={LOGO_SRC}
        alt={APP_NAME}
        className="h-20 w-auto object-contain mx-auto mb-4 drop-shadow-lg"
      />
    );
  }
  // Icono por defecto
  return (
    <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-blue-600 shadow-lg shadow-blue-900/50 mb-4">
      <Monitor className="w-8 h-8 text-white" />
    </div>
  );
}

/** Logo pequeño para el sidebar */
export function LogoSidebar() {
  if (LOGO_SRC) {
    return (
      <img
        src={LOGO_SRC}
        alt={APP_NAME}
        className="h-9 w-9 object-contain rounded-lg flex-shrink-0"
      />
    );
  }
  // Icono por defecto
  return (
    <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-blue-600 flex-shrink-0">
      <Monitor className="w-5 h-5 text-white" />
    </div>
  );
}

/** Logo muy pequeño para el topbar móvil */
export function LogoTopbar() {
  if (LOGO_SRC) {
    return (
      <img
        src={LOGO_SRC}
        alt={APP_NAME}
        className="h-7 w-7 object-contain rounded flex-shrink-0"
      />
    );
  }
  // Icono por defecto
  return <Monitor className="w-5 h-5 text-blue-500 flex-shrink-0" />;
}
