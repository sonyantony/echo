export interface BrandingColors {
  primary?: string | null;
  primaryHover?: string | null;
  onPrimary?: string | null;
  accentText?: string | null;
  mastheadBackground?: string | null;
  mastheadText?: string | null;
}

/** The install's look, from echo.branding in the Builder's application.yaml. */
export interface Branding {
  productName: string;
  logo?: string | null;
  logoAlt?: string | null;
  favicon?: string | null;
  colors?: BrandingColors | null;
}

/** Used when the backend cannot be reached; matches the built-in defaults minus the colours. */
export const DEFAULT_BRANDING: Branding = { productName: 'ECHO Builder', logo: null, favicon: null, colors: null };

/** Which PatternFly tokens (or ECHO's own variables) each configured colour sets. */
const TOKENS: Record<keyof BrandingColors, string[]> = {
  primary: ['--pf-t--global--color--brand--default'],
  primaryHover: ['--pf-t--global--color--brand--hover', '--pf-t--global--color--brand--clicked'],
  onPrimary: [
    '--pf-t--global--text--color--on-brand--default',
    '--pf-t--global--text--color--on-brand--hover',
    '--pf-t--global--text--color--on-brand--clicked',
  ],
  accentText: [
    '--pf-t--global--text--color--brand--default',
    '--pf-t--global--text--color--brand--hover',
    '--pf-t--global--text--color--brand--clicked',
  ],
  mastheadBackground: ['--echo-masthead-background'],
  mastheadText: ['--echo-masthead-text'],
};

/** Sets the colours, page title and favicon on the document. */
export function applyBranding(branding: Branding, doc: Document = document) {
  const root = doc.documentElement;
  for (const [key, tokens] of Object.entries(TOKENS) as [keyof BrandingColors, string[]][]) {
    const value = branding.colors?.[key];
    for (const token of tokens) {
      if (value) root.style.setProperty(token, value);
      else root.style.removeProperty(token);
    }
  }

  doc.title = branding.productName;

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
