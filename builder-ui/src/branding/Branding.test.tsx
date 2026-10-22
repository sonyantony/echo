import { fireEvent, render, screen } from '@testing-library/react';
import { App, createQueryClient } from '../App';
import { mockFetch } from '../test/fetchMock';
import { applyBranding } from './applyBranding';

// The blank canvas pulls in Kaoto, which does not load under jsdom.
vi.mock('../flows/UntitledFlowPage', () => ({ UntitledFlowPage: () => <p>Untitled canvas</p> }));

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.pushState({}, '', '/');
  document.documentElement.removeAttribute('style');
  document.documentElement.removeAttribute('data-echo-theme');
  document.documentElement.classList.remove('pf-v6-theme-dark');
  document.querySelector('link[rel="icon"]')?.remove();
});

describe('Branding', () => {
  it('shows the configured logo next to the fixed product name on the login page', async () => {
    mockFetch({
      'GET /api/branding': {
        status: 200,
        body: { logo: '/branding/acme.svg', logoAlt: 'Acme', favicon: '/branding/acme.ico', colors: { primary: '#123456' } },
      },
      'GET /api/auth/me': { status: 401 },
    });
    render(<App queryClient={createQueryClient()} />);

    expect(await screen.findByRole('heading', { name: 'Log in to EY ECHO Builder' })).toBeInTheDocument();
    expect(screen.getByAltText('Acme')).toHaveAttribute('src', '/branding/acme.svg');
    expect(screen.getByText('EY', { selector: '.echo-brand__ey' }).parentElement).toHaveTextContent('EY ECHO Builder');
    expect(document.title).toBe('EY ECHO Builder');
    expect(document.querySelector('link[rel="icon"]')).toHaveAttribute('href', '/branding/acme.ico');
    expect(document.documentElement.style.getPropertyValue('--echo-brand')).toBe('#123456');
  });

  it('falls back to no logo when branding cannot be loaded', async () => {
    mockFetch({ 'GET /api/auth/me': { status: 401 } });
    render(<App queryClient={createQueryClient()} />);
    expect(await screen.findByRole('heading', { name: 'Log in to EY ECHO Builder' })).toBeInTheDocument();
  });

  it('hides a logo that fails to load', async () => {
    mockFetch({
      'GET /api/branding': { status: 200, body: { logo: '/branding/missing.png', logoAlt: 'Acme' } },
      'GET /api/auth/me': { status: 401 },
    });
    render(<App queryClient={createQueryClient()} />);
    fireEvent.error(await screen.findByAltText('Acme'));
    expect(screen.queryByAltText('Acme')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Log in to EY ECHO Builder' })).toBeInTheDocument();
  });

  it('puts every configured colour on its theme token and clears unset ones', () => {
    applyBranding({
      colors: { primary: '#ffe600', onPrimary: '#2e2e38', mastheadBackground: '#2e2e38', mastheadText: '#fff' },
    });
    const style = document.documentElement.style;
    expect(style.getPropertyValue('--echo-on-brand')).toBe('#2e2e38');
    expect(style.getPropertyValue('--echo-masthead-background')).toBe('#2e2e38');

    applyBranding({ colors: { primary: '#ffe600' } });
    expect(style.getPropertyValue('--echo-masthead-background')).toBe('');
  });

  it('applies the configured theme, using the dark palette for graphite', () => {
    applyBranding({ theme: 'graphite' });
    expect(document.documentElement.dataset.echoTheme).toBe('graphite');
    expect(document.documentElement).toHaveClass('pf-v6-theme-dark');

    applyBranding({ theme: 'blueprint' });
    expect(document.documentElement.dataset.echoTheme).toBe('blueprint');
    expect(document.documentElement).not.toHaveClass('pf-v6-theme-dark');
  });

  it('falls back to the studio theme when none or an unknown one is set', () => {
    applyBranding({});
    expect(document.documentElement.dataset.echoTheme).toBe('studio');
    applyBranding({ theme: 'neon' });
    expect(document.documentElement.dataset.echoTheme).toBe('studio');
  });
});
