export interface BrandingColors {
  primary?: string | null;
  primaryHover?: string | null;
  onPrimary?: string | null;
  accentText?: string | null;
  mastheadBackground?: string | null;
  mastheadText?: string | null;
}

/** The product name is fixed; only the buyer's logo and colours are configurable. */
export const PRODUCT_NAME = 'EY ECHO Builder';

/** The looks the Builder ships with; each is a block of `theme/themes.css`. */
export const THEMES = ['studio', 'graphite', 'blueprint'] as const;
export type Theme = (typeof THEMES)[number];
export const DEFAULT_THEME: Theme = 'studio';
/** Themes built on PatternFly's dark palette. */
const DARK_THEMES: ReadonlySet<Theme> = new Set(['graphite']);

/** The buyer's company logo, colours and theme, from echo.branding in the Builder's application.yaml. */
export interface Branding {
  logo?: string | null;
  logoAlt?: string | null;
  favicon?: string | null;
  theme?: string | null;
  colors?: BrandingColors | null;
}

/** Used when the backend cannot be reached; matches the built-in defaults minus the colours. */
export const DEFAULT_BRANDING: Branding = { logo: null, favicon: null, theme: DEFAULT_THEME, colors: null };

/** The theme token (theme/themes.css) each configured colour sets; a colour left out keeps the theme's. */
const TOKENS: Record<keyof BrandingColors, string> = {
  primary: '--echo-brand',
  primaryHover: '--echo-brand-hover',
  onPrimary: '--echo-on-brand',
  accentText: '--echo-accent-text',
  mastheadBackground: '--echo-masthead-background',
  mastheadText: '--echo-masthead-text',
};

/** The configured theme, or the default when it is unset or unknown. */
export function themeOf(branding: Branding): Theme {
  return THEMES.find((theme) => theme === branding.theme) ?? DEFAULT_THEME;
}

/** Sets the theme, colours, page title and favicon on the document. */
export function applyBranding(branding: Branding, doc: Document = document) {
  const root = doc.documentElement;
  const theme = themeOf(branding);
  root.dataset.echoTheme = theme;
  root.classList.toggle('pf-v6-theme-dark', DARK_THEMES.has(theme));
  for (const [key, token] of Object.entries(TOKENS) as [keyof BrandingColors, string][]) {
    const value = branding.colors?.[key];
    if (value) root.style.setProperty(token, value);
    else root.style.removeProperty(token);
  }

  doc.title = PRODUCT_NAME;

  if (branding.favicon) {
    let link = doc.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (!link) {
      link = doc.createElement('link');
      link.rel = 'icon';
      doc.head.appendChild(link);
    }
    link.href = branding.favicon;
  }
}
