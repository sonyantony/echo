import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useMemo } from 'react';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { AuthProvider } from './auth/AuthContext';
import { LoginPage } from './auth/LoginPage';
import { RequireAuth } from './auth/RequireAuth';
import { BrandingProvider } from './branding/BrandingContext';
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
        // After login: a blank canvas with the File menu open (nothing is stored until it is saved).
        { index: true, lazy: async () => ({ Component: (await import('./flows/UntitledFlowPage')).UntitledFlowPage }) },
        { path: 'flows', element: <FlowListPage /> },
        // Loaded on demand: the editor bundles Kaoto, which is large.
        { path: 'flows/:id/api', lazy: async () => ({ Component: (await import('./apispec/ApiSpecPage')).ApiSpecPage }) },
        { path: 'flows/:id', lazy: async () => ({ Component: (await import('./flows/FlowEditorPage')).FlowEditorPage }) },
      ],
    },
  ]);
}

export function App({ queryClient = createQueryClient() }: { queryClient?: QueryClient }) {
  const router = useMemo(createRouter, []);
  return (
    <QueryClientProvider client={queryClient}>
      <BrandingProvider>
        <AuthProvider>
          <RouterProvider router={router} />
        </AuthProvider>
      </BrandingProvider>
    </QueryClientProvider>
  );
}
