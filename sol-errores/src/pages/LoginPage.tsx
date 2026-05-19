import { useState } from 'react';
import { Eye, EyeOff, Lock, User } from 'lucide-react';
import { login } from '../api/client';
import { useAuth } from '../context/AuthContext';
import toast from 'react-hot-toast';
import { LogoLogin, APP_NAME, APP_SUBTITLE } from '../components/Logo';

export default function LoginPage() {
  const { setUser } = useAuth();
  const [form, setForm] = useState({ username: '', password: '' });
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.username || !form.password) {
      toast.error('Completa todos los campos');
      return;
    }
    setLoading(true);
    try {
      const res = await login(form.username, form.password);
      setUser(res.data);
      toast.success(`Bienvenido, ${res.data.full_name}`);
    } catch (err: unknown) {
      const error = err as { response?: { data?: { error?: string } }, message?: string };
      if (!error.response) {
        toast.error('Grave: No hay conexión con el servidor (Revisa el certificado SSL)');
        console.error('Network Error:', err);
      } else {
        toast.error(error.response.data?.error || 'Credenciales incorrectas');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-950 p-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <LogoLogin />
          <h1 className="text-2xl font-bold text-white">{APP_NAME}</h1>
          <p className="text-gray-400 mt-1 text-sm">{APP_SUBTITLE}</p>
        </div>

        {/* Card */}
        <div className="bg-gray-900 rounded-2xl border border-gray-800 p-8 shadow-2xl">
          <h2 className="text-lg font-semibold text-white mb-6">Iniciar Sesión</h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-1.5">
                Usuario
              </label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                <input
                  type="text"
                  value={form.username}
                  onChange={(e) => setForm({ ...form, username: e.target.value })}
                  placeholder="nombre.usuario"
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg py-2.5 pl-10 pr-4 text-white placeholder-gray-500 text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-400 mb-1.5">
                Contraseña
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                <input
                  type={showPass ? 'text' : 'password'}
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  placeholder="••••••••"
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg py-2.5 pl-10 pr-10 text-white placeholder-gray-500 text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors"
                />
                <button
                  type="button"
                  onClick={() => setShowPass(!showPass)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
                >
                  {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 disabled:cursor-not-allowed text-white font-semibold py-2.5 rounded-lg text-sm transition-colors mt-2 flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Entrando...
                </>
              ) : (
                'Entrar'
              )}
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-gray-600 mt-6">
          InventarioIT © {new Date().getFullYear()} — Sistema de Control de Activos
        </p>
      </div>
    </div>
  );
}
