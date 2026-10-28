import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { followApicurioTheme } from './apicurioTheme';
import { fillNewOperationId } from './operationIdFiller';
import { fillSampleExample, newlyTyped, type NewlyTyped } from './sampleExampleFiller';
import { simplifyBasePathDialog } from './basePath';
import { titleCaseSectionLabels } from './sectionLabels';
import { addSourceUpload } from './sourceToolbar';
import { addOverviewNav, showPane } from './overviewNav';

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
  /** Called by the Upload button on the Source tab's toolbar. */
  onUpload?(): void;
}

/** Apicurio's full-page dialogs (new data type, path, response...), which cover its editor. */
const DIALOG_SELECTOR = '.entity-editor';

export interface ApicurioEditorHandle {
  /**
   * Leaves the right pane empty: nothing picked in the list on the left (overviewNav.ts), where Info,
   * Tag Definitions and Source open the spec's own details.
   */
  showNothing(): void;
}

export const ApicurioEditorHost = forwardRef<ApicurioEditorHandle, Props>(function ApicurioEditorHost(
  { initialContent, onChange, onDialogChange, onUpload },
  ref,
) {
  const onDialogChangeRef = useRef(onDialogChange);
  onDialogChangeRef.current = onDialogChange;
  const stopDialogs = useRef<() => void>(undefined);
  const frame = useRef<HTMLIFrameElement>(null);
  useImperativeHandle(ref, () => ({
    showNothing: () => {
      const doc = frame.current?.contentDocument;
      if (!doc) return;
      // Apicurio always has something picked; its main form is, and ECHO shows none of it.
      doc.querySelector<HTMLElement>('.editor-title-bar > h1')?.click();
      showPane(doc, 'none');
    },
  }), []);
  const onUploadRef = useRef(onUpload);
  onUploadRef.current = onUpload;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const timer = useRef<number>(undefined);
  const fillTimer = useRef<number>(undefined);
  const exampleTimer = useRef<number>(undefined);
  /** The spec as the editor last reported it, to see which bodies just got a type. */
  const previous = useRef<string | undefined>(initialContent);
  const stopTheme = useRef<() => void>(undefined);
  const stopBasePath = useRef<() => void>(undefined);
  const stopLabels = useRef<() => void>(undefined);
  const stopUpload = useRef<() => void>(undefined);
  const stopNav = useRef<() => void>(undefined);

  useEffect(() => {
    const listener = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow) return;
      if (event.data?.type === 'apicurio_onChange') {
        const content = JSON.stringify(event.data.data.content, null, 2);
        onChangeRef.current(content);
        nameNewOperation(content);
        exampleFromSample(newlyTyped(previous.current, content));
        previous.current = content;
      }
    };
    window.addEventListener('message', listener);
    return () => {
      window.removeEventListener('message', listener);
      window.clearInterval(timer.current);
      window.clearInterval(fillTimer.current);
      window.clearInterval(exampleTimer.current);
      stopTheme.current?.();
      stopDialogs.current?.();
      stopBasePath.current?.();
      stopLabels.current?.();
      stopUpload.current?.();
      stopNav.current?.();
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
    stopLabels.current?.();
    stopLabels.current = frameDoc ? titleCaseSectionLabels(frameDoc) : undefined;
    stopUpload.current?.();
    stopUpload.current = frameDoc ? addSourceUpload(frameDoc, () => onUploadRef.current?.()) : undefined;
    stopNav.current?.();
    stopNav.current = frameDoc ? addOverviewNav(frameDoc) : undefined;
    sendContent();
  };

  /**
   * A new operation gets its operationId at once (operationIdFiller.ts). Its form may show up a
   * moment after the change is reported, so this looks a few times.
   */
  const nameNewOperation = (content: string) => {
    window.clearInterval(fillTimer.current);
    let tries = 0;
    fillTimer.current = window.setInterval(() => {
      const doc = frame.current?.contentDocument;
      if (++tries >= 10 || !doc || fillNewOperationId(doc, content)) window.clearInterval(fillTimer.current);
    }, 100);
  };

  /**
   * A body or response just set to a data type made from a sample gets the sample as its example
   * at once (sampleExampleFiller.ts), a step at a time as Apicurio's form and dialog show up.
   */
  const exampleFromSample = (targets: NewlyTyped[]) => {
    if (!targets.length) return;
    window.clearInterval(exampleTimer.current);
    const queue = [...targets];
    let tries = 0;
    exampleTimer.current = window.setInterval(() => {
      const doc = frame.current?.contentDocument;
      const step = doc && queue.length ? fillSampleExample(doc, queue[0]) : 'none';
      // A row may show up a moment after the change is reported.
      if (step === 'done' || (step === 'none' && tries >= 5)) queue.shift();
      if (!queue.length || ++tries >= 40) window.clearInterval(exampleTimer.current);
    }, 100);
  };

  /** Tells onDialogChange when a full-page dialog opens or closes (Interface > Design cannot work under one). */
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
