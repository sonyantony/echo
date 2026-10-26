import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useMemo } from 'react';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { AuthProvider } from './auth/AuthContext';
import { LoginPage } from './auth/LoginPage';
import { RequireAuth } from './auth/RequireAuth';
import { BrandingProvider } from './branding/BrandingContext';
import { FlowListPage } from './flows/FlowListPage';
import { StartPage } from './flows/StartPage';
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
        // After login: start a new flow or open one (work always happens on a named flow).
        { index: true, element: <StartPage /> },
        { path: 'flows', element: <FlowListPage /> },
        // Loaded on demand: the editor bundles Kaoto, which is large.
        // flows/:id/api: the same editor, with the flow's API spec open in place of Kaoto's views.
        { path: 'flows/:id/api?', lazy: async () => ({ Component: (await import('./flows/FlowEditorPage')).FlowEditorPage }) },
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
