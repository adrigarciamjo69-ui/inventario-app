import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import {
  Package, Users, LogOut, Menu, X,
  ChevronRight, LayoutDashboard, Shield, Tag, Map, Package2, Users2, FileText, Settings,
  Sun, Moon
} from 'lucide-react';
import { LogoSidebar, LogoTopbar, APP_NAME, APP_SUBTITLE } from './Logo';

interface LayoutProps {
  children: React.ReactNode;
  currentPage: string;
  onNavigate: (page: string) => void;
}

const navItems = [
  { id: 'dashboard',    label: 'Dashboard',     icon: LayoutDashboard, adminOnly: false },
  { id: 'assets',       label: 'Inventario',    icon: Package,         adminOnly: false },
  { id: 'software',     label: 'Software',      icon: Package2,        adminOnly: false },
  { id: 'floorplan',    label: 'Mapa Plantas',  icon: Map,             adminOnly: false },
  { id: 'deliveries',   label: 'Doc. Entrega',  icon: FileText,        adminOnly: false },
  { id: 'client-users', label: 'Usuarios',      icon: Users2,          adminOnly: false },
  { id: 'settings',     label: 'Ajustes',       icon: Settings,        adminOnly: true  },
];

export default function Layout({ children, currentPage, onNavigate }: LayoutProps) {
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const filteredNav = navItems.filter(
    (item) => !item.adminOnly || user?.role === 'admin'
  );

  return (
    <div className="flex h-screen bg-gray-950 text-white overflow-hidden">
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-20 bg-black/60 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <aside
        className={`fixed lg:static inset-y-0 left-0 z-30 w-64 flex flex-col bg-gray-900 border-r border-gray-800 transform transition-transform duration-300
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}`}
      >
        {/* Logo */}
        <div className="flex items-center gap-3 px-6 py-5 border-b border-gray-800">
          <LogoSidebar />
          <div>
            <p className="text-sm font-bold text-white leading-tight">{APP_NAME}</p>
            <p className="text-xs text-gray-400">{APP_SUBTITLE}</p>
          </div>
          <button
            className="ml-auto lg:hidden text-gray-400 hover:text-white"
            onClick={() => setSidebarOpen(false)}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {filteredNav.map((item, idx) => {
            const Icon = item.icon;
            const active = currentPage === item.id;
            const showSeparator = idx > 0 && item.adminOnly && !filteredNav[idx - 1].adminOnly;
            return (
              <div key={item.id}>
                {showSeparator && (
                  <div className="my-2 px-3">
                    <div className="border-t border-gray-800" />
                    <p className="text-xs text-gray-600 mt-2 mb-1 px-0 font-medium uppercase tracking-wider">Administración</p>
                  </div>
                )}
                <button
                  onClick={() => { onNavigate(item.id); setSidebarOpen(false); }}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all
                    ${active
                      ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/40'
                      : 'text-gray-400 hover:bg-gray-800 hover:text-white'
                    }`}
                >
                  <Icon className="w-4 h-4 flex-shrink-0" />
                  <span>{item.label}</span>
                  {active && <ChevronRight className="w-4 h-4 ml-auto" />}
                </button>
              </div>
            );
          })}
        </nav>

        {/* Theme toggle */}
        <div className="px-3 pb-2">
          <button
            onClick={toggleTheme}
            title={theme === 'dark' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-gray-400 hover:bg-gray-800 hover:text-white transition-all"
          >
            {theme === 'dark'
              ? <><Sun className="w-4 h-4 flex-shrink-0 text-yellow-400" /><span>Modo claro</span></>
              : <><Moon className="w-4 h-4 flex-shrink-0 text-blue-400" /><span>Modo oscuro</span></>
            }
          </button>
        </div>

        {/* User info */}
        <div className="px-3 py-4 border-t border-gray-800">
          <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-gray-800">
            <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-xs font-bold flex-shrink-0 !text-white" style={{ color: 'white' }}>
              {user?.full_name?.charAt(0).toUpperCase() || 'U'}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-white truncate">{user?.full_name}</p>
              <div className="flex items-center gap-1">
                <Shield className="w-3 h-3 text-blue-400" />
                <p className="text-xs text-gray-400 capitalize">{user?.role}</p>
              </div>
            </div>
            <button
              onClick={logout}
              title="Cerrar sesión"
              className="text-gray-500 hover:text-red-400 transition-colors"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <header className="flex items-center gap-4 px-4 py-3 bg-gray-900 border-b border-gray-800 lg:hidden">
          <button onClick={() => setSidebarOpen(true)} className="text-gray-400 hover:text-white">
            <Menu className="w-6 h-6" />
          </button>
          <div className="flex items-center gap-2">
            <LogoTopbar />
            <span className="font-bold text-white text-sm">{APP_NAME}</span>
          </div>
          {/* Mobile theme toggle */}
          <button onClick={toggleTheme} className="ml-auto text-gray-400 hover:text-white transition-colors">
            {theme === 'dark' ? <Sun className="w-5 h-5 text-yellow-400" /> : <Moon className="w-5 h-5 text-blue-400" />}
          </button>
        </header>

        <main className="flex-1 overflow-y-auto bg-gray-950 p-4 md:p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
