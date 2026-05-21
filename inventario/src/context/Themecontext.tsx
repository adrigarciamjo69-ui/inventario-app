import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { apiClient } from '../api/client';

type Theme = 'dark' | 'light';

interface ThemeContextType {
  theme: Theme;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType>({
  theme: 'dark',
  toggleTheme: () => {},
});

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (theme === 'light') {
    root.classList.add('light');
    root.classList.remove('dark');
  } else {
    root.classList.remove('light');
    root.classList.add('dark');
  }
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Carga inicial: intenta desde sessionStorage para evitar parpadeo
  const [theme, setTheme] = useState<Theme>(() => {
    const cached = sessionStorage.getItem('theme') as Theme | null;
    return cached || 'dark';
  });

  // Aplica el tema al DOM siempre que cambie
  useEffect(() => {
    applyTheme(theme);
    sessionStorage.setItem('theme', theme);
  }, [theme]);

  // Cuando hay sesión activa, carga la preferencia guardada en la BD
  useEffect(() => {
    const token = sessionStorage.getItem('token');
    if (!token) return;
    apiClient.get('/auth/me')
      .then(res => {
        const savedTheme = res.data?.preferences?.theme as Theme | undefined;
        if (savedTheme && savedTheme !== theme) {
          setTheme(savedTheme);
        }
      })
      .catch(() => {});
  // Solo al montar
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme(prev => {
      const next: Theme = prev === 'dark' ? 'light' : 'dark';
      // Guarda en BD de forma silenciosa
      apiClient.patch('/auth/preferences', { theme: next }).catch(() => {});
      return next;
    });
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
