import themesCss from '../theme/themes.css?inline';
import mappingCss from '../theme/apicurio-mapping.css?inline';

const STYLE_ID = 'echo-apicurio-theme';

/**
 * Gives Apicurio's editor, in `frameDoc`, the Builder's theme as it is now on `hostDoc`: the same
 * theme file as the Builder, Apicurio's mapping onto it, the theme's name, and the install's brand
 * colours (which applyBranding sets inline on the Builder's <html>).
 */
export function applyApicurioTheme(frameDoc: Document, hostDoc: Document = document) {
  const host = hostDoc.documentElement;
  const theme = host.dataset.echoTheme;
  if (!theme || !frameDoc.head) return;

  if (!frameDoc.getElementById(STYLE_ID)) {
    const style = frameDoc.createElement('style');
    style.id = STYLE_ID;
    // The mapping first: its @import has to lead the stylesheet.
    style.textContent = `${mappingCss}\n${themesCss}`;
    frameDoc.head.appendChild(style);
  }

  const root = frameDoc.documentElement;
  for (const name of echoProperties(root.style)) root.style.removeProperty(name);
  for (const name of echoProperties(host.style)) root.style.setProperty(name, host.style.getPropertyValue(name));
  root.dataset.echoTheme = theme;
}

function echoProperties(style: CSSStyleDeclaration) {
  return Array.from({ length: style.length }, (_, i) => style.item(i)).filter((name) => name.startsWith('--echo-'));
}

/** Applies the theme now and again whenever the Builder's theme or colours change. Returns a cleanup function. */
export function followApicurioTheme(frameDoc: Document, hostDoc: Document = document) {
  applyApicurioTheme(frameDoc, hostDoc);
  const observer = new MutationObserver(() => applyApicurioTheme(frameDoc, hostDoc));
  observer.observe(hostDoc.documentElement, { attributes: true, attributeFilter: ['data-echo-theme', 'style'] });
  return () => observer.disconnect();
}
