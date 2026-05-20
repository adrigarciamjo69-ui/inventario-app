import { useState, useEffect } from 'react';
import { Toaster } from 'react-hot-toast';
import { AuthProvider, useAuth } from './context/AuthContext';
import { CategoriesProvider, useCategories } from './context/CategoriesContext';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import AssetsPage from './pages/AssetsPage';
import SoftwarePage from './pages/SoftwarePage';
import UsersPage from './pages/UsersPage';
import ClientUsersPage from './pages/ClientUsersPage';
import CategoriesPage from './pages/CategoriesPage';
import FloorplanPage from './pages/FloorplanPage';
import DeliveryPage from './pages/DeliveryPage';
import SettingsPage from './pages/SettingsPage';
import Layout from './components/Layout';

function AuthenticatedApp() {
  const { user } = useAuth();
  const { reload } = useCategories();
  const [currentPage, setCurrentPage] = useState('dashboard');

  useEffect(() => {
    if (user) reload();
  }, [user, reload]);

  const renderPage = () => {
    switch (currentPage) {
      case 'dashboard':    return <DashboardPage />;
      case 'assets':       return <AssetsPage />;
      case 'software':     return <SoftwarePage />;
      case 'floorplan':    return <FloorplanPage />;
      case 'deliveries':   return <DeliveryPage />;
      case 'client-users': return <ClientUsersPage />;
      case 'categories':   return user?.role === 'admin' ? <CategoriesPage />   : <DashboardPage />;
      case 'users':        return user?.role === 'admin' ? <UsersPage />         : <DashboardPage />;
      case 'settings':     return user?.role === 'admin' ? <SettingsPage />      : <DashboardPage />;
      default:             return <DashboardPage />;
    }
  };

  return (
    <Layout currentPage={currentPage} onNavigate={setCurrentPage}>
      {renderPage()}
    </Layout>
  );
}

function AppContent() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-950">
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />
          <p className="text-gray-500 text-sm">Cargando...</p>
        </div>
      </div>
    );
  }

  if (!user) return <LoginPage />;
  return <AuthenticatedApp />;
}

export function App() {
  return (
    <AuthProvider>
      <CategoriesProvider>
        <Toaster
          position="top-right"
          toastOptions={{
            style: {
              background: '#1f2937',
              color: '#f9fafb',
              border: '1px solid #374151',
              fontSize: '14px',
            },
            success: { iconTheme: { primary: '#22c55e', secondary: '#fff' } },
            error:   { iconTheme: { primary: '#ef4444', secondary: '#fff' } },
          }}
        />
        <AppContent />
      </CategoriesProvider>
    </AuthProvider>
  );
}
