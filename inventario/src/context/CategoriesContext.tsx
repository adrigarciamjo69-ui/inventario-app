import { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { Category } from '../types';
import { getCategories } from '../api/client';

interface CategoriesContextType {
  categories: Category[];
  reload: () => void;
  getCategoryLabel: (value: string) => string;
  getCategoryIcon: (value: string) => string;
  loading: boolean;
}

const CategoriesContext = createContext<CategoriesContextType>({
  categories: [],
  reload: () => {},
  getCategoryLabel: (v) => v,
  getCategoryIcon: () => '📦',
  loading: false,
});

export const CategoriesProvider = ({ children }: { children: ReactNode }) => {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(false);

  // reload se llama MANUALMENTE solo cuando el usuario ya está autenticado
  const reload = useCallback(() => {
    const token = sessionStorage.getItem('token');
    if (!token) return;
    setLoading(true);
    getCategories()
      .then((res) => setCategories(res.data))
      .catch(() => setCategories([]))
      .finally(() => setLoading(false));
  }, []);

  const getCategoryLabel = (value: string) =>
    categories.find((c) => c.value === value)?.label || value;

  const getCategoryIcon = (value: string) =>
    categories.find((c) => c.value === value)?.icon || '📦';

  return (
    <CategoriesContext.Provider value={{ categories, reload, getCategoryLabel, getCategoryIcon, loading }}>
      {children}
    </CategoriesContext.Provider>
  );
};

export const useCategories = () => useContext(CategoriesContext);
