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
    document.documentElement.style.setProperty('--echo-brand', '#ffe600');
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
    await vi.waitFor(() => expect(frame.documentElement.dataset.echoTheme).toBe('graphite'));
    // The colours come from the theme file in the frame; only the install's brand colours are copied.
    document.documentElement.style.setProperty('--echo-brand', '#123456');
    await vi.waitFor(() => expect(frame.documentElement.style.getPropertyValue('--echo-brand')).toBe('#123456'));
    expect(frame.documentElement.style.getPropertyValue('--echo-surface')).toBe('');
    stop();
  });
});
