import { useEffect, useRef } from 'react';
import { followApicurioTheme } from './apicurioTheme';

/**
 * Apicurio's OpenAPI editor, the prebuilt build from Apicurio Registry served from
 * public/apicurio-editor (see the README there). It is an Angular app, so it runs in its own frame
 * and talks to us with window messages:
 *  - we send   { type: 'apicurio-editingInfo', data: { content: { type: 'OPENAPI', value } } } once,
 *  - it sends  { type: 'apicurio_onChange', data: { content: <the spec object> } } after every edit.
 */
export const APICURIO_EDITOR_URL = '/apicurio-editor/index.html';

interface Props {
  /** The spec to open, as JSON text. */
  initialContent: string;
  /** Called with the whole spec, as formatted JSON text, after every edit. */
  onChange(content: string): void;
}

export function ApicurioEditorHost({ initialContent, onChange }: Props) {
  const frame = useRef<HTMLIFrameElement>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const timer = useRef<number>(undefined);
  const stopTheme = useRef<() => void>(undefined);

  useEffect(() => {
    const listener = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow) return;
      if (event.data?.type === 'apicurio_onChange') {
        onChangeRef.current(JSON.stringify(event.data.data.content, null, 2));
      }
    };
    window.addEventListener('message', listener);
    return () => {
      window.removeEventListener('message', listener);
      window.clearInterval(timer.current);
      stopTheme.current?.();
    };
  }, []);

  /**
   * The editor only listens once its Angular app has started, and does not say when that is.
   * So we send the spec until the editor shows up in the frame (it ignores repeats).
   */
  const onLoad = () => {
    // Same origin, so ECHO's theme can be put into the editor without changing the vendored copy.
    stopTheme.current?.();
    const frameDoc = frame.current?.contentDocument;
    stopTheme.current = frameDoc ? followApicurioTheme(frameDoc) : undefined;
    sendContent();
  };

  const sendContent = () => {
    const target = frame.current;
    let tries = 0;
    window.clearInterval(timer.current);
    timer.current = window.setInterval(() => {
      tries += 1;
      target?.contentWindow?.postMessage(
        {
          type: 'apicurio-editingInfo',
          data: {
            content: { type: 'OPENAPI', value: initialContent },
            features: { allowImports: false, allowCustomValidations: false },
            openapi: { vendorExtensions: [] },
          },
        },
        window.location.origin,
      );
      if (tries >= 75 || target?.contentDocument?.querySelector('oai-editor')) window.clearInterval(timer.current);
    }, 200);
  };

  return (
    <iframe
      ref={frame}
      className="echo-api-spec__frame"
      title="OpenAPI editor"
      src={APICURIO_EDITOR_URL}
      onLoad={onLoad}
    />
  );
}
