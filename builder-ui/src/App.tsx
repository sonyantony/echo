import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useMemo } from 'react';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { AuthProvider } from './auth/AuthContext';
import { LoginPage } from './auth/LoginPage';
import { RequireAuth } from './auth/RequireAuth';
import { FlowListPage } from './flows/FlowListPage';
import { AppLayout } from './layout/AppLayout';

export function createQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });
}

function createRouter() {
  return createBrowserRouter([
    { path: '/login', element: <LoginPage /> },
    {
      element: (
        <RequireAuth>
          <AppLayout />
        </RequireAuth>
      ),
      children: [
        { index: true, element: <FlowListPage /> },
        // Loaded on demand: the editor bundles Kaoto, which is large.
        { path: 'flows/:id', lazy: async () => ({ Component: (await import('./flows/FlowEditorPage')).FlowEditorPage }) },
      ],
    },
  ]);
}

export function App({ queryClient = createQueryClient() }: { queryClient?: QueryClient }) {
  const router = useMemo(createRouter, []);
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>
  );
}
