import { readFileSync } from 'node:fs';
import { THEMES } from '../branding/applyBranding';

const read = (file: string) => readFileSync(new URL(file, import.meta.url), 'utf8');
const withoutComments = (css: string) => css.replace(/\/\*[^]*?\*\//g, '');

/** The --echo-* tokens a block of themes.css sets. */
function tokensOf(css: string, selector: string) {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) return null;
  const block = css.slice(start, css.indexOf('}', start));
  return new Set([...block.matchAll(/(--echo-[\w-]+)\s*:/g)].map((m) => m[1]));
}

const themes = withoutComments(read('./themes.css'));

describe('the theme file', () => {
  it('has a block for every theme, each setting the same tokens', () => {
    const studio = tokensOf(themes, ":root:root[data-echo-theme='studio']");
    expect(studio?.size).toBeGreaterThan(10);
    for (const theme of THEMES) {
      expect([...tokensOf(themes, `:root:root[data-echo-theme='${theme}']`)!].sort(), theme).toEqual([...studio!].sort());
    }
  });

  it('defines every token the mapping files use', () => {
    const defined = new Set([
      ...tokensOf(themes, ':root:root[data-echo-theme]')!,
      ...tokensOf(themes, ":root:root[data-echo-theme='studio']")!,
    ]);
    for (const file of ['./kaoto-mapping.css', './apicurio-mapping.css', './echo.css']) {
      const css = withoutComments(read(file));
      const ownTokens = new Set([...css.matchAll(/(--echo-[\w-]+)\s*:/g)].map((m) => m[1]));
      for (const [, used] of css.matchAll(/var\((--echo-[\w-]+)/g)) {
        expect(defined.has(used) || ownTokens.has(used), `${file} uses ${used}`).toBe(true);
      }
    }
  });

  it('is the only place colours are written: the mapping files hold none of their own', () => {
    for (const file of ['./kaoto-mapping.css', './apicurio-mapping.css', './echo.css']) {
      // Data URIs (icon masks) are shapes, not colours.
      const css = withoutComments(read(file)).replace(/url\("data:[^"]*"\)/g, '');
      expect(css.match(/#[0-9a-f]{3,8}\b|\b(rgb|rgba|hsl|hsla)\(/gi), file).toBeNull();
    }
  });
});
