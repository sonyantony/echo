import { applyApicurioTheme, followApicurioTheme } from './apicurioTheme';

function frameDocument() {
  return document.implementation.createHTMLDocument('editor');
}

afterEach(() => {
  delete document.documentElement.dataset.echoTheme;
  document.documentElement.removeAttribute('style');
  document.documentElement.classList.remove('pf-v6-theme-dark');
});

describe("Apicurio editor's theme", () => {
  it("copies the Builder's theme and colours into the editor's frame, with ECHO's stylesheet", () => {
    document.documentElement.dataset.echoTheme = 'studio';
    document.documentElement.style.setProperty('--pf-t--global--color--brand--default', '#ffe600');
    const frame = frameDocument();

    applyApicurioTheme(frame);
    applyApicurioTheme(frame);

    expect(frame.documentElement.dataset.echoTheme).toBe('studio');
    expect(frame.documentElement.style.getPropertyValue('--echo-brand')).toBe('#ffe600');
    // Added once, however often the theme is applied.
    expect(frame.querySelectorAll('style#echo-apicurio-theme')).toHaveLength(1);
  });

  it('waits until the Builder has a theme', () => {
    const frame = frameDocument();
    applyApicurioTheme(frame);
    expect(frame.documentElement.dataset.echoTheme).toBeUndefined();
    expect(frame.getElementById('echo-apicurio-theme')).toBeNull();
  });

  it('follows a change of theme', async () => {
    document.documentElement.dataset.echoTheme = 'studio';
    const frame = frameDocument();
    const stop = followApicurioTheme(frame);

    document.documentElement.dataset.echoTheme = 'graphite';
    document.documentElement.classList.add('pf-v6-theme-dark');
    await vi.waitFor(() => expect(frame.documentElement.dataset.echoTheme).toBe('graphite'));
    // PatternFly 3 has no dark mode, so the editor stays light under a dark theme.
    expect(frame.documentElement.style.getPropertyValue('--echo-surface')).toBe('#ffffff');
    stop();
  });
});
