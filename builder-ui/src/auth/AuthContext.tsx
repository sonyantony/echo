import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';
import { api, ApiError } from '../api/client';

export interface CurrentUser {
  username: string;
  roles: string[];
}

interface AuthState {
  user: CurrentUser | null;
  loading: boolean;
  login(username: string, password: string): Promise<void>;
  logout(): Promise<void>;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

const ME_KEY = ['auth', 'me'];

async function fetchMe(): Promise<CurrentUser | null> {
  try {
    return await api<CurrentUser>('/api/auth/me');
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) return null;
    throw e;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const me = useQuery({ queryKey: ME_KEY, queryFn: fetchMe, staleTime: Infinity, retry: false });

  const login = useCallback(
    async (username: string, password: string) => {
      const user = await api<CurrentUser>('/api/auth/login', { method: 'POST', json: { username, password } });
      queryClient.setQueryData(ME_KEY, user);
    },
    [queryClient],
  );

  const logout = useCallback(async () => {
    await api<void>('/api/auth/logout', { method: 'POST' });
    queryClient.setQueryData(ME_KEY, null);
  }, [queryClient]);

  const value = useMemo(
    () => ({ user: me.data ?? null, loading: me.isPending, login, logout }),
    [me.data, me.isPending, login, logout],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
