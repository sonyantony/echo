import { useQuery } from '@tanstack/react-query';
import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { api } from '../api/client';
import { applyBranding, DEFAULT_BRANDING, type Branding } from './applyBranding';

const BrandingContext = createContext<Branding>(DEFAULT_BRANDING);

/** Loads the install's branding once and applies it before the first screen shows. */
export function BrandingProvider({ children }: { children: ReactNode }) {
  const query = useQuery({
    queryKey: ['branding'],
    queryFn: () => api<Branding>('/api/branding'),
    staleTime: Infinity,
    retry: false,
  });
  const branding = query.data ?? DEFAULT_BRANDING;

  useEffect(() => {
    if (!query.isPending) applyBranding(branding);
  }, [branding, query.isPending]);

  // Wait for the answer (or its failure) so the default look never flashes before the buyer's.
  if (query.isPending) return null;
  return <BrandingContext.Provider value={branding}>{children}</BrandingContext.Provider>;
}

export function useBranding(): Branding {
  return useContext(BrandingContext);
}
