import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { followApicurioTheme } from './apicurioTheme';
import { simplifyBasePathDialog } from './basePath';

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
  /** Called when one of Apicurio's full-page dialogs (e.g. Define a New Data Type) opens or closes. */
  onDialogChange?(open: boolean): void;
}

/** Apicurio's full-page dialogs (new data type, path, response...), which cover its editor. */
const DIALOG_SELECTOR = '.entity-editor';

export interface ApicurioEditorHandle {
  /**
   * Opens the spec's own details (info, servers, security...). Apicurio does this when its title
   * bar is clicked; ECHO hides that bar (apicurioTheme.css), so its title is clicked for it.
   */
  showApiInfo(): void;
}

export const ApicurioEditorHost = forwardRef<ApicurioEditorHandle, Props>(function ApicurioEditorHost(
  { initialContent, onChange, onDialogChange },
  ref,
) {
  const onDialogChangeRef = useRef(onDialogChange);
  onDialogChangeRef.current = onDialogChange;
  const stopDialogs = useRef<() => void>(undefined);
  const frame = useRef<HTMLIFrameElement>(null);
  useImperativeHandle(ref, () => ({
    showApiInfo: () => frame.current?.contentDocument?.querySelector<HTMLElement>('.editor-title-bar > h1')?.click(),
  }), []);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const timer = useRef<number>(undefined);
  const stopTheme = useRef<() => void>(undefined);
  const stopBasePath = useRef<() => void>(undefined);

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
      stopDialogs.current?.();
      stopBasePath.current?.();
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
    stopDialogs.current?.();
    stopDialogs.current = frameDoc ? watchDialogs(frameDoc) : undefined;
    stopBasePath.current?.();
    stopBasePath.current = frameDoc ? simplifyBasePathDialog(frameDoc) : undefined;
    sendContent();
  };

  /** Tells onDialogChange when a full-page dialog opens or closes (API Overview cannot work under one). */
  const watchDialogs = (doc: Document) => {
    let open = false;
    const check = () => {
      const now = !!doc.querySelector(DIALOG_SELECTOR);
      if (now !== open) {
        open = now;
        onDialogChangeRef.current?.(now);
      }
    };
    // The frame's own MutationObserver: its nodes belong to the frame's window.
    const observer = new (doc.defaultView?.MutationObserver ?? MutationObserver)(check);
    try {
      observer.observe(doc.documentElement, { childList: true, subtree: true });
    } catch {
      // A frame document the observer cannot watch (only happens in the jsdom test environment).
    }
    return () => observer.disconnect();
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
});
