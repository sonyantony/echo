import { render, screen } from '@testing-library/react';
import { App, createQueryClient } from '../App';
import { mockFetch } from '../test/fetchMock';
import { applyBranding } from './applyBranding';

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.pushState({}, '', '/');
  document.documentElement.removeAttribute('style');
  document.querySelector('link[rel="icon"]')?.remove();
});

describe('Branding', () => {
  it('shows the configured logo and product name on the login page', async () => {
    mockFetch({
      'GET /api/branding': {
        status: 200,
        body: { productName: 'Acme Flows', logo: '/branding/acme.svg', logoAlt: 'Acme', favicon: '/branding/acme.ico', colors: { primary: '#123456' } },
      },
      'GET /api/auth/me': { status: 401 },
    });
    render(<App queryClient={createQueryClient()} />);

    expect(await screen.findByRole('heading', { name: 'Log in to Acme Flows' })).toBeInTheDocument();
    expect(screen.getByAltText('Acme')).toHaveAttribute('src', '/branding/acme.svg');
    expect(document.title).toBe('Acme Flows');
    expect(document.querySelector('link[rel="icon"]')).toHaveAttribute('href', '/branding/acme.ico');
    expect(document.documentElement.style.getPropertyValue('--pf-t--global--color--brand--default')).toBe('#123456');
  });

  it('falls back to the ECHO Builder defaults when branding cannot be loaded', async () => {
    mockFetch({ 'GET /api/auth/me': { status: 401 } });
    render(<App queryClient={createQueryClient()} />);
    expect(await screen.findByRole('heading', { name: 'Log in to ECHO Builder' })).toBeInTheDocument();
  });

  it('puts every configured colour on its PatternFly token and clears unset ones', () => {
    applyBranding({
      productName: 'X',
      colors: { primary: '#ffe600', onPrimary: '#2e2e38', mastheadBackground: '#2e2e38', mastheadText: '#fff' },
    });
    const style = document.documentElement.style;
    expect(style.getPropertyValue('--pf-t--global--text--color--on-brand--hover')).toBe('#2e2e38');
    expect(style.getPropertyValue('--echo-masthead-background')).toBe('#2e2e38');

    applyBranding({ productName: 'X', colors: { primary: '#ffe600' } });
    expect(style.getPropertyValue('--echo-masthead-background')).toBe('');
  });
});
