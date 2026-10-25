import {
  Bullseye,
  Button,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  Radio,
  Spinner,
  Alert,
} from '@patternfly/react-core';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { editorSettings, flowsApi } from '../api/flows';
import { FLOWS_KEY } from '../flows/FlowListPage';
import { useAutosave } from '../flows/useAutosave';
import { ApicurioEditorHost, type ApicurioEditorHandle } from './ApicurioEditorHost';
import {
  defaultSpecBase,
  formatOf,
  newApiSpec,
  parseSpec,
  serialize,
  SPEC_NAME_PATTERN,
  stripExtension,
  toEditorJson,
  withFormat,
  type SpecFormat,
} from './apiSpec';
import {
  fillMissingOperationIds,
  naturalOperationIds,
  operationChanges,
  renameOperationIds,
  routableOperations,
  type OperationRename,
  type RoutableOperation,
} from './operationIds';
import { SamplesSpecModal } from './SamplesSpecModal';
import { SpecNameModal } from './SpecNameModal';
import { specFromSamples } from './specFromSamples';
import './ApiSpecPanel.css';

export interface ApiSpecPanelHandle {
  /** Saves the spec if it has unsaved edits (asking for a name if it has none). Resolves to false when it was not saved. */
  saveIfChanged(): Promise<boolean>;
  /** Interface > Design: the spec with nothing picked (right pane empty), unless an editor dialog is open. */
  showOverview(): void;
  /** Openapi > Upload: picks a .yaml or .json spec and stores it in the flow under its own name. */
  upload(): void;
  /** Openapi > New From Samples: asks for a sample request and response and puts the spec made from them on screen, unsaved. */
  newFromSamples(): void;
  /** Openapi > Download Openapi File As Yaml / Json: what is on screen, unsaved edits included. */
  download(format: SpecFormat): void;
  /** Opens the spec stored in the flow again, e.g. after Copy From Another Flow replaced it; unsaved edits are dropped. */
  reload(): Promise<void>;
  /** Puts fileName's spec on screen, unsaved (Copy From Another Flow on the untitled flow, which has nowhere to copy to yet). */
  show(fileName: string, text: string): void;
  /** The spec on screen when it has unsaved edits, for the untitled flow's first Save; undefined when there is none. */
  unsavedSpec(): UnsavedSpec | undefined;
}

export interface UnsavedSpec {
  /** The editor's JSON. */
  json: string;
  format: SpecFormat;
  /** The file name it came with (an upload or a copy), its extension following the format; null for one made here. */
  name: string | null;
  /** The file it came with (an upload or a copy), whose comments and layout are kept; undefined for one made here. */
  text?: string;
}

interface Props {
  /** Left out for the untitled flow: its spec stays on screen until the flow's first Save (onSaveFlow) stores both. */
  flowId?: number;
  /** The flow's ID, which the default spec file name is made from (orders-api.yaml). */
  flowName: string;
  /** What users call the flow: a new spec's title. The ID when left out. */
  flowTitle?: string;
  flowDescription?: string | null;
  /** Called when the spec gets, or no longer has, unsaved edits. */
  onDirtyChange?(dirty: boolean): void;
  /** Called with the spec's file name, its extension following the Yaml/Json radios, or null while it has none (new, or after Discard). */
  onNameChange?(name: string | null): void;
  /** Called with the format the Yaml/Json radios pick. */
  onFormatChange?(format: SpecFormat): void;
  /** The untitled flow's Save, which names the flow and its spec in one go. */
  onSaveFlow?(): void;
  /** Called each time the spec is stored in the flow (Save, autosave, rename, upload). */
  onStored?(): void;
  /**
   * Called when a save renamed operations (their path or method changed): the flow's routes for
   * them must start from the new direct:<operationId> (operationIds.ts).
   */
  onOperationIdsRenamed?(renames: OperationRename[]): void;
  /**
   * Called when an edit in the editor added or removed operations, by the operationId their route
   * starts from (a renamed path keeps its operation). Not called when the whole spec is replaced
   * (Upload, Copy From Another Flow, New From Samples, Discard).
   */
  onOperationsChanged?(changes: { added: RoutableOperation[]; removed: RoutableOperation[] }): void;
  /** False while a Kaoto view covers the panel; left out, it counts as shown. */
  visible?: boolean;
}

interface Loaded {
  name: string | null;
  /** The saved spec as the editor's JSON; null when the flow has none. */
  json: string | null;
  /** The file as stored, whose comments and layout a save keeps; null when the flow has none. */
  text: string | null;
}

type Dialog =
  | { kind: 'name' }
  | { kind: 'rename' }
  | { kind: 'discard' }
  | { kind: 'samples' }
  | { kind: 'replace'; fileName: string; text: string }
  | { kind: 'rename-upload'; fileName: string; text: string };

/** The operations of the editor's JSON; undefined when there is none or it cannot be read. */
function operationsOf(json: string | undefined) {
  try {
    return json === undefined ? undefined : routableOperations(json);
  } catch {
    return undefined;
  }
}

/**
 * The flow's OpenAPI spec, edited in Apicurio's editor. Shown by the flow editor in place of
 * Kaoto's views when Openapi is picked on its tab line. The spec is one file in the flow
 * folder, under the name it was uploaded or saved with, in YAML or JSON (the format buttons).
 */
export const ApiSpecPanel = forwardRef<ApiSpecPanelHandle, Props>(function ApiSpecPanel(
  { flowId: id, flowName, flowTitle = flowName, flowDescription, onDirtyChange, onNameChange, onFormatChange, onSaveFlow, onStored, onOperationIdsRenamed, onOperationsChanged, visible = true },
  ref,
) {
  const queryClient = useQueryClient();
  const spec = useQuery({
    queryKey: ['flow', id ?? 'untitled', 'api-spec'],
    queryFn: async (): Promise<Loaded> => {
      if (id === undefined) return { name: null, json: null, text: null };
      const name = (await flowsApi.get(id)).apiSpec ?? null;
      const text = name ? await flowsApi.readFile(id, name) : undefined;
      if (!name || text === undefined) return { name: null, json: null, text: null };
      try {
        return { name, json: toEditorJson(text), text };
      } catch {
        return { name, json: null, text: null };
      }
    },
    staleTime: Infinity,
    gcTime: 0,
  });
  const settings = useQuery({ queryKey: ['editor-settings'], queryFn: editorSettings, staleTime: Infinity });

  const editor = useRef<ApicurioEditorHandle>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  /** The spec's file name; null until it is saved (or after Discard). */
  const [name, setName] = useState<string | null>(null);
  /** The name of the spec stored in the flow, which a save under another name replaces. */
  const [storedName, setStoredName] = useState<string | null>(null);
  /**
   * The spec as stored: the file (a save writes only what changed, keeping its comments) and its
   * editor JSON (a save renames only operations whose path or method changed since).
   */
  const stored = useRef<{ text: string; json: string } | undefined>(undefined);
  /** The file an upload or a copy put on the untitled flow's screen, for its first Save. */
  const unsavedText = useRef<string | undefined>(undefined);
  const [format, setFormat] = useState<SpecFormat>('yaml');
  /** What the editor opens: changing editorKey reopens it with initialJson (Upload, Discard). */
  const [initialJson, setInitialJson] = useState<string>();
  const [editorKey, setEditorKey] = useState(0);
  const saved = useRef<string | null>(null);
  const latest = useRef<string | undefined>(undefined);
  const [contentDirty, setContentDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ variant: 'success' | 'danger'; text: string }>();
  const [dialog, setDialog] = useState<Dialog>();
  /** One of Apicurio's full-page dialogs (e.g. Define a New Data Type) is open. */
  const [dialogOpen, setDialogOpen] = useState(false);

  const open = useCallback((loaded: Loaded) => {
    named.current = undefined;
    stored.current = loaded.text !== null && loaded.json !== null ? { text: loaded.text, json: loaded.json } : undefined;
    unsavedText.current = undefined;
    saved.current = loaded.json;
    latest.current = undefined;
    setName(loaded.name);
    setFormat((loaded.name && formatOf(loaded.name)) || 'yaml');
    // Operations without an id (a spec from elsewhere) show one at once; it is stored on the next save.
    setInitialJson(loaded.json ? fillMissingOperationIds(loaded.json) : newApiSpec(flowTitle, flowDescription));
    setEditorKey((k) => k + 1);
    setContentDirty(false);
    setDialogOpen(false);
  }, [flowTitle, flowDescription]);

  // Opened once: a later fetch of the same spec must not throw away edits made since.
  const opened = useRef(false);
  useEffect(() => {
    if (spec.data && !opened.current) {
      opened.current = true;
      setStoredName(spec.data.name);
      open(spec.data);
    }
  }, [spec.data, open]);

  // Picking the other format is an edit too: Save writes the file again in that format.
  const formatChanged = !!name && formatOf(name) !== format;
  const dirty = contentDirty || formatChanged;

  const onDirtyChangeRef = useRef(onDirtyChange);
  onDirtyChangeRef.current = onDirtyChange;
  useEffect(() => onDirtyChangeRef.current?.(dirty), [dirty]);
  const onNameChangeRef = useRef(onNameChange);
  onNameChangeRef.current = onNameChange;
  useEffect(() => onNameChangeRef.current?.(name && withFormat(name, format)), [name, format]);
  const onStoredRef = useRef(onStored);
  onStoredRef.current = onStored;
  const onRenamedRef = useRef(onOperationIdsRenamed);
  onRenamedRef.current = onOperationIdsRenamed;
  const onFormatChangeRef = useRef(onFormatChange);
  onFormatChangeRef.current = onFormatChange;
  useEffect(() => onFormatChangeRef.current?.(format), [format]);

  const onOperationsChangedRef = useRef(onOperationsChanged);
  onOperationsChangedRef.current = onOperationsChanged;
  /** The operations the editor showed at its last change; set again each time it opens a spec. */
  const operations = useRef<RoutableOperation[]>(undefined);
  /**
   * Operations a save renamed while the editor still shows their old ids (see named below): their
   * routes start from the new id already, old id to new.
   */
  const renamedSince = useRef(new Map<string, string>());
  useEffect(() => {
    operations.current = operationsOf(initialJson);
    renamedSince.current = new Map();
  }, [editorKey, initialJson]);

  const onChange = useCallback((content: string) => {
    latest.current = content;
    setContentDirty(content !== saved.current);
    const now = operationsOf(content);
    if (!now) return;
    const before = operations.current;
    operations.current = now;
    if (!before) return;
    const { added, removed } = operationChanges(before, now);
    if (!added.length && !removed.length) return;
    const current = (op: RoutableOperation) => ({ ...op, operationId: renamedSince.current.get(op.operationId) ?? op.operationId });
    onOperationsChangedRef.current?.({ added, removed: removed.map(current) });
  }, []);

  /** What is on screen, as the editor's JSON. */
  const currentJson = () => latest.current ?? saved.current ?? initialJson ?? newApiSpec(flowTitle, flowDescription);

  /**
   * The stored spec as it is after a save named its operations (operationIds.ts), while the editor
   * still shows them as they were. The editor opens it again once it is out of sight (opening
   * again would throw the user out of what they are looking at), so it never holds out-of-date ids.
   */
  const named = useRef<string | undefined>(undefined);
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  const openNamed = useCallback(() => {
    const json = named.current;
    // Edits made since are saved (and named) first.
    if (json === undefined || (latest.current !== undefined && latest.current !== saved.current)) return;
    named.current = undefined;
    saved.current = json;
    latest.current = undefined;
    setInitialJson(json);
    setEditorKey((k) => k + 1);
    setContentDirty(false);
    setDialogOpen(false);
  }, []);
  useEffect(() => {
    if (!visible) openNamed();
  }, [visible, openNamed]);

  /**
   * Stores json (what the editor shows) as the flow's spec under fileName, written over `base` (the
   * stored file, or an upload) so that its comments stay. Operations without an operationId get
   * one, and those whose path or method changed since base are renamed, taking the flow's routes
   * along (operationIds.ts). Resolves to the spec as stored (the editor's JSON), or undefined when
   * it was not stored.
   *
   * @param base the file this replaces and its editor JSON; for an upload, the uploaded file and no JSON
   */
  const store = useCallback(async (
    fileName: string,
    json: string,
    auto = false,
    base: { text: string; json?: string } | undefined = stored.current,
  ): Promise<string | undefined> => {
    if (id === undefined) {
      // Nowhere to store it yet: it stays on screen, unsaved, under fileName until the flow's first Save.
      latest.current = json;
      setName(fileName);
      setFormat(formatOf(fileName) ?? 'yaml');
      setContentDirty(json !== saved.current);
      setStatus({ variant: 'success', text: `Opened ${fileName}: save the flow to keep it.` });
      return json; // The untitled flow's first Save names the operations.
    }
    setSaving(true);
    if (!auto) setStatus(undefined);
    try {
      // Ids a save renamed while the editor still shows the old ones are compared under their new ones.
      const naming = naturalOperationIds(renameOperationIds(json, renamedSince.current), base?.json);
      const text = serialize(naming.json, formatOf(fileName) ?? 'yaml', base?.text);
      await flowsApi.saveApiSpec(id, fileName, text);
      stored.current = { text, json: naming.json };
      saved.current = json;
      setName(fileName);
      setStoredName(fileName);
      setFormat(formatOf(fileName) ?? 'yaml');
      setContentDirty(latest.current !== undefined && latest.current !== json);
      const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      setStatus({ variant: 'success', text: auto ? `Autosaved at ${time}` : `Saved ${fileName}.` });
      if (naming.renames.length) {
        // The editor still shows the old ids (and a later save renames from them again).
        for (const r of naming.renames) {
          for (const [shown, now] of renamedSince.current) if (now === r.from) renamedSince.current.set(shown, r.to);
          renamedSince.current.set(r.from, r.to);
        }
        onRenamedRef.current?.(naming.renames);
      }
      named.current = naming.json === json ? undefined : naming.json;
      if (!visibleRef.current) openNamed();
      onStoredRef.current?.();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['flow', id], exact: true }),
        queryClient.invalidateQueries({ queryKey: FLOWS_KEY }),
      ]);
      return naming.json;
    } catch (e) {
      setStatus({ variant: 'danger', text: `Could not save: ${(e as Error).message}` });
      return undefined;
    } finally {
      setSaving(false);
    }
  }, [id, queryClient, openNamed]);

  /** Saves what is on screen as fileName, in the format its extension says. */
  const saveUnder = useCallback(async (fileName: string, auto = false) => {
    const json = latest.current ?? saved.current ?? initialJson ?? newApiSpec(flowTitle, flowDescription);
    return (await store(fileName, json, auto)) !== undefined;
  }, [store, initialJson, flowTitle, flowDescription]);

  /** Save: asks for a name the first time. */
  const save = useCallback(async (): Promise<boolean> => {
    if (id === undefined) {
      onSaveFlow?.();
      return false;
    }
    if (!name) {
      setDialog({ kind: 'name' });
      return false;
    }
    return saveUnder(withFormat(name, format));
  }, [id, name, format, saveUnder, onSaveFlow]);

  const pickUpload = () => fileInput.current?.click();

  const download = (fileFormat: SpecFormat) => {
    try {
      const current = renameOperationIds(currentJson(), renamedSince.current);
      const text = serialize(naturalOperationIds(current, stored.current?.json).json, fileFormat, stored.current?.text);
      const fileName = withFormat(name ?? storedName ?? `${defaultSpecBase(flowName)}.json`, fileFormat);
      const url = URL.createObjectURL(new Blob([text], { type: fileFormat === 'json' ? 'application/json' : 'application/yaml' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      link.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setStatus({ variant: 'danger', text: `Could not download: ${(e as Error).message}` });
    }
  };

  /**
   * Keeps an uploaded spec as it is (name, format, operationIds and comments), as the flow's spec;
   * only operations without an operationId get one.
   */
  const storeUpload = async (fileName: string, text: string) => {
    setDialog(undefined);
    const json = toEditorJson(text);
    latest.current = undefined;
    renamedSince.current = new Map();
    const result = await store(fileName, json, false, { text });
    if (result !== undefined) {
      if (id !== undefined) saved.current = result;
      else unsavedText.current = text;
      named.current = undefined;
      setInitialJson(result);
      setEditorKey((k) => k + 1);
      setContentDirty(id === undefined && result !== saved.current);
      setDialogOpen(false);
    }
  };

  const uploadPicked = async (file: File | undefined) => {
    if (fileInput.current) fileInput.current.value = '';
    if (!file) return;
    const text = await file.text();
    try {
      parseSpec(text);
    } catch (e) {
      setStatus({ variant: 'danger', text: `Could not upload ${file.name}: ${(e as Error).message}` });
      return;
    }
    if (!SPEC_NAME_PATTERN.test(file.name)) {
      setDialog({ kind: 'rename-upload', fileName: file.name, text });
    } else if (dirty || storedName) {
      setDialog({ kind: 'replace', fileName: file.name, text });
    } else {
      await storeUpload(file.name, text);
    }
  };

  const discard = () => {
    setDialog(undefined);
    setStatus(undefined);
    open({ name: null, json: null, text: null });
  };

  useImperativeHandle(ref, () => ({
    saveIfChanged: async () => (dirty ? save() : true),
    showOverview: () => {
      if (!dialogOpen) editor.current?.showNothing();
    },
    upload: pickUpload,
    newFromSamples: () => setDialog({ kind: 'samples' }),
    download,
    show: (fileName, text) => {
      setStatus(undefined);
      void storeUpload(fileName, text);
    },
    unsavedSpec: () =>
      dirty ? { json: currentJson(), format, name: name && withFormat(name, format), text: unsavedText.current } : undefined,
    reload: async () => {
      const { data } = await spec.refetch();
      if (!data) return;
      setStatus(undefined);
      setStoredName(data.name);
      open(data);
    },
  }));

  useAutosave({
    intervalSeconds: settings.data?.autosaveSeconds,
    dirty: dirty && !!name && id !== undefined,
    busy: saving || !!dialog,
    save: () => name && saveUnder(withFormat(name, format), true),
  });

  if (spec.isError) {
    return <Alert className="echo-api-spec__message" variant="danger" isInline title="Could not open this flow's OpenAPI spec" />;
  }
  if (!spec.data || initialJson === undefined) {
    return (
      <Bullseye>
        <Spinner aria-label="Loading OpenAPI spec" />
      </Bullseye>
    );
  }

  return (
    <div className="echo-api-spec">
      {/* Sits where Apicurio's title bar shows the API's name (hidden, see theme/apicurio-mapping.css); its
          undo, redo and Issues stay on the right. */}
      <div className="echo-api-spec__bar">
        <div className="echo-api-spec__formats" role="radiogroup" aria-label="File format">
          <Radio id="echo-spec-yaml" name="echo-spec-format" label="Yaml" isChecked={format === 'yaml'} onChange={() => setFormat('yaml')} />
          <Radio id="echo-spec-json" name="echo-spec-format" label="Json" isChecked={format === 'json'} onChange={() => setFormat('json')} />
        </div>
        <Button variant="primary" size="sm" onClick={() => save()} isLoading={saving} isDisabled={saving || (!dirty && !!name)}>
          Save
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setDialog({ kind: 'rename' })}
          isAriaDisabled={saving || id === undefined || !name}
          title={id === undefined ? 'Save the flow first' : !name ? 'Save names the spec the first time' : `Save ${withFormat(name, format)} under another file name`}
        >
          Rename
        </Button>
        <Button variant="secondary" size="sm" onClick={() => (dirty ? setDialog({ kind: 'discard' }) : discard())} isDisabled={saving}>
          Discard
        </Button>
        {status && (
          <span
            className={`echo-api-spec__status echo-api-spec__status--${status.variant}`}
            title={status.text}
            role={status.variant === 'danger' ? 'alert' : 'status'}
          >
            {status.text}
          </span>
        )}
        <input
          ref={fileInput}
          type="file"
          accept=".yaml,.yml,.json,application/json,application/yaml,text/yaml"
          hidden
          data-testid="spec-upload-input"
          onChange={(e) => void uploadPicked(e.target.files?.[0])}
        />
      </div>
      <div className="echo-api-spec__editor">
        <ApicurioEditorHost
          key={editorKey}
          ref={editor}
          initialContent={initialJson}
          onChange={onChange}
          onDialogChange={setDialogOpen}
          onUpload={pickUpload}
        />
      </div>

      {dialog?.kind === 'name' && (
        <SpecNameModal
          title="Save"
          initialName={withFormat(name ?? defaultSpecBase(flowName), format)}
          format={format}
          replaces={storedName}
          onClose={() => setDialog(undefined)}
          onSave={async (fileName) => {
            setDialog(undefined);
            await saveUnder(fileName);
          }}
        />
      )}
      {dialog?.kind === 'rename' && name && (
        <SpecNameModal
          title="Rename"
          description="Saves the OpenAPI spec in this flow under this file name, in place of the old one."
          initialName={withFormat(name, format)}
          format={format}
          fixedFormat
          onClose={() => setDialog(undefined)}
          onSave={async (fileName) => {
            setDialog(undefined);
            if (fileName !== withFormat(name, format)) await saveUnder(fileName);
          }}
        />
      )}
      {dialog?.kind === 'rename-upload' && (
        <SpecNameModal
          title="Name the uploaded spec"
          description={`"${dialog.fileName}" has characters a file name in the flow cannot have. Pick the name to keep it under.`}
          initialName={`${stripExtension(dialog.fileName).replace(/[^A-Za-z0-9_.-]+/g, '-').replace(/^[^A-Za-z0-9_]+/, '')}.${formatOf(dialog.fileName) ?? 'yaml'}`}
          format={formatOf(dialog.fileName) ?? 'yaml'}
          fixedFormat
          replaces={storedName}
          onClose={() => setDialog(undefined)}
          onSave={(fileName) => storeUpload(fileName, dialog.text)}
        />
      )}
      {dialog?.kind === 'replace' && (
        <Modal isOpen variant="small" onClose={() => setDialog(undefined)} aria-labelledby="spec-replace-title">
          <ModalHeader title="Replace the current spec?" titleIconVariant="warning" labelId="spec-replace-title" />
          <ModalBody>
            A flow has one OpenAPI spec. {dialog.fileName} replaces{' '}
            {storedName ? <strong>{storedName}</strong> : 'the spec on screen'}
            {dirty ? ', and your unsaved edits are lost.' : '.'}
          </ModalBody>
          <ModalFooter>
            <Button variant="danger" onClick={() => void storeUpload(dialog.fileName, dialog.text)}>
              Replace
            </Button>
            <Button variant="link" onClick={() => setDialog(undefined)}>
              Cancel
            </Button>
          </ModalFooter>
        </Modal>
      )}
      {dialog?.kind === 'samples' && (
        <SamplesSpecModal
          replaces={[
            dirty && 'your unsaved edits are lost',
            storedName && `${storedName} is overwritten when you save`,
          ]
            .filter(Boolean)
            .join(', and ')}
          onClose={() => setDialog(undefined)}
          onGenerate={(samples) => {
            setDialog(undefined);
            const json = specFromSamples({ ...samples, current: currentJson(), flowName: flowTitle, flowDescription });
            latest.current = json;
            setInitialJson(json);
            setEditorKey((k) => k + 1);
            setContentDirty(json !== saved.current);
            setDialogOpen(false);
            setStatus({ variant: 'success', text: `Made ${samples.method} ${samples.path} from the samples: save to keep it.` });
          }}
        />
      )}
      {dialog?.kind === 'discard' && (
        <Modal isOpen variant="small" onClose={() => setDialog(undefined)} aria-labelledby="spec-discard-title">
          <ModalHeader title="Discard your changes?" titleIconVariant="warning" labelId="spec-discard-title" />
          <ModalBody>
            The editor starts again from a blank spec. {storedName ? <><strong>{storedName}</strong> stays in the flow until you save over it.</> : ''}
          </ModalBody>
          <ModalFooter>
            <Button variant="danger" onClick={discard}>
              Discard
            </Button>
            <Button variant="link" onClick={() => setDialog(undefined)}>
              Cancel
            </Button>
          </ModalFooter>
        </Modal>
      )}
    </div>
  );
});
