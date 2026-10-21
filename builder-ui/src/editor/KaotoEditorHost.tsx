import { KaotoEditorFactory } from '@kaoto/kaoto';
import { forwardRef, useEffect, useImperativeHandle, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { AdvancedMenu } from './AdvancedMenu';
import { KaotoTabMenu } from './KaotoTabMenu';
import type { FlowFiles } from './flowFiles';
import { captureKaotoDiagram, saveFile, tidyDiagram } from './diagramImage';
import { createEnvelopeContext } from './kaotoEnvelope';
import { trackTabUnderline } from './tabUnderline';
import './KaotoEditorHost.css';

export interface KaotoEditorHandle {
  /** Returns the current Camel YAML from the editor. */
  getContent(): Promise<string>;
  /** Saves the whole flow diagram to the user's computer as a PNG called `fileName`. */
  downloadDiagram(fileName: string): Promise<void>;
}

export interface KaotoEditorHostProps {
  /** File name of the Camel route, e.g. "orders.camel.yaml". */
  path: string;
  /** Initial Camel YAML. Later changes to this prop are ignored; remount to load another flow. */
  initialContent: string;
  files: FlowFiles;
  onChange?(content: string): void;
  /** Defaults to the Builder's catalog, cut down to what flows may use (CamelCatalogController). */
  catalogUrl?: string;
  /** Builder controls shown at the right end of Kaoto's tab bar (Design, Rest, ...), on the same line. */
  tabBarActions?: ReactNode;
  /** Builder menus shown among Kaoto's tabs, just before the Advanced menu (e.g. a Run menu). */
  tabBarMenus?: ReactNode;
  /** Items of the Flow Design menu, which stands in for Kaoto's Design tab (e.g. downloads). */
  designMenuItems?: ReactNode;
  /** Builder controls shown on Kaoto's Design canvas toolbar, right after its copy to clipboard button. */
  canvasToolbarActions?: ReactNode;
  /** Builder controls shown at the left end of Kaoto's tab bar, before its first tab (e.g. a File menu). */
  tabBarStart?: ReactNode;
  /**
   * A Builder view shown in place of Kaoto's views, below the tab bar (e.g. the API spec). It stays
   * mounted while hidden, so it keeps its state; `coverVisible` shows it.
   */
  cover?: ReactNode;
  coverVisible?: boolean;
  /** Called when one of Kaoto's views is picked on the tab line (a tab, or a menu standing in for one). */
  onKaotoViewPicked?(): void;
  /**
   * Builder controls shown in place of text fields of Kaoto's forms, by the field's name in the form
   * (e.g. "#.openApi.specification"). Kaoto's own input stays, hidden, and keeps the value.
   */
  formFields?: Record<string, (field: KaotoFormField) => ReactNode>;
}

/** A text field of one of Kaoto's forms, which the Builder shows its own control for. */
export interface KaotoFormField {
  /** The field's current text. */
  value: string;
  /** Sets the field's text as typing would, so Kaoto writes it to the flow. */
  setValue(value: string): void;
}

interface KaotoEditor {
  setContent(path: string, content: string): Promise<void>;
  getContent(): Promise<string>;
  af_componentRoot(): React.ReactElement;
}

/**
 * Embeds the Kaoto editor (canvas, step forms and DataMapper) unmodified.
 *
 * Kaoto ships its own hash router and React providers, so it is rendered into a separate
 * React root to keep it independent from the Builder's own router.
 */
export const KaotoEditorHost = forwardRef<KaotoEditorHandle, KaotoEditorHostProps>(function KaotoEditorHost(
  { path, initialContent, files, onChange, catalogUrl = '/api/camel-catalog/index.json', tabBarActions, tabBarStart, tabBarMenus, canvasToolbarActions, designMenuItems, cover, coverVisible, onKaotoViewPicked, formFields },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<KaotoEditor | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const pickRef = useRef<((files: Record<string, string> | undefined) => void) | null>(null);
  const [error, setError] = useState<string>();
  const [tabBarSlot, setTabBarSlot] = useState<HTMLElement>();
  const [tabBarStartSlot, setTabBarStartSlot] = useState<HTMLElement>();
  const [advancedSlot, setAdvancedSlot] = useState<HTMLElement>();
  const [canvasSlot, setCanvasSlot] = useState<HTMLElement>();
  const [designSlot, setDesignSlot] = useState<HTMLElement>();
  const [tabBarHeight, setTabBarHeight] = useState(0);
  const [fieldSlots, setFieldSlots] = useState<Record<string, FieldSlot>>({});
  const onKaotoViewPickedRef = useRef(onKaotoViewPicked);
  onKaotoViewPickedRef.current = onKaotoViewPicked;

  useImperativeHandle(ref, () => ({
    getContent: async () => (editorRef.current ? editorRef.current.getContent() : initialContent),
    downloadDiagram: async (fileName) => {
      if (!containerRef.current) throw new Error('The flow editor is not ready');
      saveFile(await tidyDiagram(await captureKaotoDiagram(containerRef.current)), fileName);
    },
  }));

  useEffect(() => {
    let disposed = false;
    let root: Root | undefined;
    let resolveReady: () => void;
    const ready = new Promise<void>((resolve) => (resolveReady = resolve));

    const envelope = createEnvelopeContext(new URL(catalogUrl, window.location.href).toString(), files, {
      onReady: () => resolveReady(),
      onNewEdit: (content) => onChangeRef.current?.(content),
      pickFiles: (include, canPickMany) => {
        const input = fileInputRef.current;
        if (!input) return Promise.resolve(undefined);
        input.accept = include.includes('json') ? '.json' : include.includes('xsd') ? '.xsd,.xml' : '';
        input.multiple = canPickMany;
        input.click();
        return new Promise((resolve) => (pickRef.current = resolve));
      },
    });

    // Kaoto's routes live in the URL hash; start each editor session on the canvas.
    if (window.location.hash) window.history.replaceState(null, '', window.location.pathname + window.location.search);

    new KaotoEditorFactory()
      .createEditor(envelope as never, {
        resourcesPathPrefix: '',
        fileExtension: 'yaml',
        initialLocale: 'en',
        isReadOnly: false,
        channel: 'EMBEDDED',
        workspaceRootAbsolutePosixPath: '/',
      } as never)
      .then(async (created) => {
        if (disposed || !containerRef.current) return;
        const editor = created as unknown as KaotoEditor;
        editorRef.current = editor;
        root = createRoot(containerRef.current);
        root.render(editor.af_componentRoot());
        await ready;
        if (!disposed) await editor.setContent(path, initialContent);
      })
      .catch((e: unknown) => setError(String(e)));

    return () => {
      disposed = true;
      editorRef.current = null;
      // Unmount after the current render pass; React forbids unmounting a root during render.
      const r = root;
      setTimeout(() => r?.unmount());
    };
    // The editor is created once per mount; remount (change the React key) to load another flow.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Kaoto renders its tab bar when it starts; put slots for the Builder's controls at its start and
  // end, the Flow Design menu's in place of Kaoto's Design tab, and the Advanced menu's just before
  // Kaoto's About tab.
  // Put them back should Kaoto ever render the tab bar again.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const slot = document.createElement('div');
    slot.className = 'echo-kaoto-host__tab-actions';
    const startSlot = document.createElement('li');
    startSlot.className = 'echo-kaoto-host__tab-start';
    const advanced = document.createElement('li');
    advanced.className = 'echo-kaoto-host__tab-advanced';
    const design = document.createElement('li');
    design.className = 'echo-kaoto-host__tab-design';
    const canvas = document.createElement('div');
    canvas.className = 'pf-v6-c-toolbar__item echo-kaoto-host__canvas-actions';
    const attach = () => {
      // The canvas toolbar comes and goes with the Design tab; the same slot moves into each one.
      const clipboardItem = container.querySelector(".context-toolbar [data-testid='clipboardButton']")?.closest('.pf-v6-c-toolbar__item');
      if (clipboardItem && clipboardItem.nextElementSibling !== canvas) {
        clipboardItem.after(canvas);
        setCanvasSlot(canvas);
      }
      const tabBar = container.querySelector<HTMLElement>(":scope > .shell > div[role='region']");
      if (!tabBar) return;
      if (slot.parentElement !== tabBar) {
        tabBar.appendChild(slot);
        setTabBarSlot(slot);
        heights.disconnect();
        heights.observe(tabBar);
      }
      const tabList = tabBar.querySelector(':scope > .pf-v6-c-tabs__list');
      if (tabList) {
        // Inside the tab list, so the File menu can carry the tab underline too (tabUnderline.ts).
        if (tabList.firstElementChild !== startSlot) {
          tabList.prepend(startSlot);
          setTabBarStartSlot(startSlot);
        }
        const designTab = tabList.querySelector(":scope > [data-testid='design-tab']");
        if (designTab && designTab.previousElementSibling !== design) {
          designTab.before(design);
          setDesignSlot(design);
        }
        // Kaoto wraps each tab's <li> in a link, so the list's children are the links.
        const about = tabList.querySelector(":scope > [data-testid='about-tab']");
        if (advanced.parentElement !== tabList || advanced.nextElementSibling !== about) {
          tabList.insertBefore(advanced, about);
          setAdvancedSlot(advanced);
        }
      }
    };
    // The cover sits just below the tab bar, whose height depends on the theme and font.
    const heights = new ResizeObserver(([entry]) => setTabBarHeight((entry.target as HTMLElement).offsetHeight));
    // Kaoto's tabs, and the hidden ones the Flow Design and Advanced menus press, all carry a "-tab" test id.
    const onClick = (event: MouseEvent) => {
      const tab = (event.target as Element | null)?.closest("[data-testid$='-tab']");
      if (tab?.closest(".shell > div[role='region']")) onKaotoViewPickedRef.current?.();
    };
    container.addEventListener('click', onClick, true);
    const observer = new MutationObserver(attach);
    observer.observe(container, { childList: true, subtree: true });
    attach();
    const stopUnderline = trackTabUnderline(container);
    return () => {
      container.removeEventListener('click', onClick, true);
      heights.disconnect();
      observer.disconnect();
      stopUnderline();
      slot.remove();
      startSlot.remove();
      advanced.remove();
      canvas.remove();
      design.remove();
    };
  }, []);

  // Kaoto renders a form field when its form opens; put a slot for the Builder's control in front
  // of its input, which CSS hides, and follow the field as Kaoto renders it again or closes the form.
  const fieldNames = Object.keys(formFields ?? {}).join('\n');
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !fieldNames) return;
    const names = fieldNames.split('\n');
    const slots: Record<string, FieldSlot> = {};
    const attach = () => {
      let changed = false;
      for (const name of names) {
        const wrapper = container.querySelector(`[data-testid='${CSS.escape(name)}__field-wrapper']`);
        const input = wrapper?.querySelector<HTMLInputElement>(`input[name='${CSS.escape(name)}']`);
        const current = slots[name];
        if (current && current.input === input && current.slot.isConnected) continue;
        if (!wrapper || !input) {
          if (current) {
            delete slots[name];
            changed = true;
          }
          continue;
        }
        const slot = document.createElement('div');
        slot.className = 'echo-kaoto-host__form-field';
        wrapper.classList.add('echo-kaoto-host__replaced-field');
        wrapper.querySelector('.pf-v6-c-form__group-control')?.prepend(slot);
        slots[name] = { slot, input };
        changed = true;
      }
      if (changed) setFieldSlots({ ...slots });
    };
    const observer = new MutationObserver(attach);
    observer.observe(container, { childList: true, subtree: true });
    attach();
    return () => {
      observer.disconnect();
      Object.values(slots).forEach(({ slot }) => slot.remove());
      setFieldSlots({});
    };
  }, [fieldNames]);

  const onFilesPicked = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const picked: Record<string, string> = {};
    await Promise.all(Array.from(event.target.files ?? []).map(async (f) => (picked[f.name] = await f.text())));
    event.target.value = '';
    pickRef.current?.(Object.keys(picked).length ? picked : undefined);
    pickRef.current = null;
  };

  return (
    <div className="echo-kaoto-host" data-testid="kaoto-editor-host">
      {error && <div role="alert">Could not start the flow editor: {error}</div>}
      <div ref={containerRef} className="echo-kaoto-host__editor" />
      {cover && (
        <div className="echo-kaoto-host__cover" hidden={!coverVisible} style={{ top: tabBarHeight }}>
          {cover}
        </div>
      )}
      {tabBarStartSlot && tabBarStart && createPortal(tabBarStart, tabBarStartSlot)}
      {tabBarSlot && tabBarActions && createPortal(tabBarActions, tabBarSlot)}
      {designSlot &&
        createPortal(
          <KaotoTabMenu label="Flow Design" tabTestId="design-tab" opensTab className="echo-design-menu">
            {designMenuItems}
          </KaotoTabMenu>,
          designSlot,
        )}
      {canvasSlot && canvasToolbarActions && createPortal(canvasToolbarActions, canvasSlot)}
      {advancedSlot &&
        createPortal(
          <>
            {tabBarMenus}
            <AdvancedMenu />
          </>,
          advancedSlot,
        )}
      {Object.entries(fieldSlots).map(([name, { slot, input }]) => {
        const render = formFields?.[name];
        return render && createPortal(<FormField input={input} render={render} />, slot, name);
      })}
      <input
        ref={fileInputRef}
        type="file"
        hidden
        data-testid="kaoto-file-picker"
        onChange={onFilesPicked}
      />
    </div>
  );
});

interface FieldSlot {
  slot: HTMLElement;
  input: HTMLInputElement;
}

/** Kaoto's (React) form fields hold their value in the input; set it the way typing does. */
const setInputValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;

function FormField({ input, render }: { input: HTMLInputElement; render: (field: KaotoFormField) => ReactNode }) {
  // React keeps the value attribute of Kaoto's controlled input in step with its value.
  const value = useSyncExternalStore(
    (onChange) => {
      const observer = new MutationObserver(onChange);
      observer.observe(input, { attributes: true, attributeFilter: ['value'] });
      input.addEventListener('input', onChange);
      return () => {
        observer.disconnect();
        input.removeEventListener('input', onChange);
      };
    },
    () => input.value,
  );
  return render({
    value,
    setValue: (text) => {
      setInputValue.call(input, text);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    },
  });
}
