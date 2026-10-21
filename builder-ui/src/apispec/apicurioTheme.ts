import themeCss from './apicurioTheme.css?inline';

/**
 * The --echo-* values apicurioTheme.css is written with, and the Builder's own token each one is
 * read from. They are read from the Builder page as the active theme and brand colours resolve
 * them, so the editor's frame needs neither themes.css nor PatternFly 6.
 */
const VALUES: Record<string, string> = {
  '--echo-brand': '--pf-t--global--color--brand--default',
  '--echo-brand-hover': '--pf-t--global--color--brand--hover',
  '--echo-on-brand': '--pf-t--global--text--color--on-brand--default',
  '--echo-ink': '--echo-ink',
  '--echo-text': '--pf-t--global--text--color--regular',
  '--echo-subtle': '--pf-t--global--text--color--subtle',
  '--echo-surface': '--pf-t--global--background--color--primary--default',
  '--echo-floating': '--pf-t--global--background--color--floating--default',
  '--echo-border': '--pf-t--global--border--color--default',
  '--echo-code-background': '--pf-t--global--background--color--primary--default',
  '--echo-code-gutter': '--pf-t--global--background--color--secondary--default',
};

/** Syntax colours of the code editor: muted, readable on its light background. */
const CODE_COLOURS: Record<string, string> = {
  '--echo-code-key': '#1f4e8c',
  '--echo-code-string': '#2f6b3b',
  '--echo-code-number': '#8a4b08',
};

/**
 * Apicurio's editor is built on PatternFly 3, which has no dark mode: its many hard-coded light
 * surfaces (dialogs, wizards, examples) cannot all be repainted reliably. So under a dark theme
 * (graphite) the editor stays light, like graphite's step tiles, and only takes the theme's font,
 * brand colour and controls.
 */
const LIGHT_SURFACES: Record<string, string> = {
  '--echo-text': '#151515',
  '--echo-subtle': '#4d4d4d',
  '--echo-surface': '#ffffff',
  '--echo-floating': '#ffffff',
  '--echo-border': '#d2d2d2',
  '--echo-code-background': '#ffffff',
  '--echo-code-gutter': '#f2f2f2',
};

const STYLE_ID = 'echo-apicurio-theme';

/** Gives Apicurio's editor, in `frameDoc`, the Builder's theme as it is now on `hostDoc`. */
export function applyApicurioTheme(frameDoc: Document, hostDoc: Document = document) {
  const host = hostDoc.documentElement;
  const theme = host.dataset.echoTheme;
  if (!theme || !frameDoc.head) return;

  if (!frameDoc.getElementById(STYLE_ID)) {
    const style = frameDoc.createElement('style');
    style.id = STYLE_ID;
    style.textContent = themeCss;
    frameDoc.head.appendChild(style);
  }

  // Read below <html>, where some themes set their tokens (e.g. graphite's brand text colour).
  const computed = hostDoc.defaultView!.getComputedStyle(hostDoc.body ?? host);
  const root = frameDoc.documentElement;
  for (const [name, token] of Object.entries(VALUES)) {
    const value = computed.getPropertyValue(token).trim();
    if (value) root.style.setProperty(name, value);
    else root.style.removeProperty(name);
  }
  if (host.classList.contains('pf-v6-theme-dark')) {
    for (const [name, value] of Object.entries(LIGHT_SURFACES)) root.style.setProperty(name, value);
    // The theme's ink is light on dark themes; links in the light editor use the masthead's colour.
    root.style.setProperty('--echo-ink', computed.getPropertyValue('--echo-masthead-background').trim() || '#2e2e38');
  }
  for (const [name, value] of Object.entries(CODE_COLOURS)) root.style.setProperty(name, value);
  root.dataset.echoTheme = theme;
}

/** Applies the theme now and again whenever the Builder's theme or colours change. Returns a cleanup function. */
export function followApicurioTheme(frameDoc: Document, hostDoc: Document = document) {
  applyApicurioTheme(frameDoc, hostDoc);
  const observer = new MutationObserver(() => applyApicurioTheme(frameDoc, hostDoc));
  observer.observe(hostDoc.documentElement, { attributes: true, attributeFilter: ['data-echo-theme', 'class', 'style'] });
  return () => observer.disconnect();
}
