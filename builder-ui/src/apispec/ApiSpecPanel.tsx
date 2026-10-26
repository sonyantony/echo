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
import { editorSettings, flowsApi, publishedFlowsApi, type PathClash } from '../api/flows';
import { FLOWS_KEY } from '../flows/FlowListPage';
import { useAutosave } from '../flows/useAutosave';
import { ApicurioEditorHost, type ApicurioEditorHandle } from './ApicurioEditorHost';
import {
  defaultSpecBase,
  formatOf,
  newApiSpec,
  parseSpec,
  pathsOf,
  serialize,
  SPEC_NAME_PATTERN,
  stripExtension,
  toEditorJson,
  withFormat,
  withoutPaths,
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
import { JiraImportModal } from './JiraImportModal';
import { SamplesSpecModal } from './SamplesSpecModal';
import { SpecNameModal } from './SpecNameModal';
import { specFromSamples } from './specFromSamples';
import type { ImportResult } from './jiraImport';
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
   * starts from (a renamed path keeps its operation), and when Upload replaced the spec: every
   * operation of the uploaded file counts as added (those with a route keep it) and those of the
   * spec before that it lacks as removed. Not called when Copy From Another Flow, New From Samples
   * or Discard replace the whole spec.
   */
  onOperationsChanged?(changes: { added: RoutableOperation[]; removed: RoutableOperation[] }): void;
  /**
   * Switch to the flow that has a path the user just added here (a path is in one flow only): the
   * path is already taken out of this flow's spec, which is saved. Opens that flow, the flow editor
   * saving this one first.
   */
  onSwitchToFlow?(flowId: number): Promise<void>;
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
  | { kind: 'jira' }
  | { kind: 'replace'; fileName: string; text: string }
  | { kind: 'rename-upload'; fileName: string; text: string }
  | { kind: 'path-clash'; clashes: PathClash[] }
  | { kind: 'upload-clash'; fileName: string; clashes: PathClash[] };

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
  { flowId: id, flowName, flowTitle = flowName, flowDescription, onDirtyChange, onNameChange, onFormatChange, onSaveFlow, onStored, onOperationIdsRenamed, onOperationsChanged, onSwitchToFlow, visible = true },
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
  /** The paths the editor showed at its last change, to tell a path just added (see checkNewPaths). */
  const paths = useRef<string[]>([]);
  useEffect(() => {
    operations.current = operationsOf(initialJson);
    renamedSince.current = new Map();
    paths.current = pathsOf(initialJson);
  }, [editorKey, initialJson]);

  /**
   * A path belongs to one flow: when one just added (typed in, or made from samples) is a path
   * another flow has, the user is told which, and asked to switch to that flow or take it out here.
   */
  const idRef = useRef(id);
  idRef.current = id;
  const checkNewPaths = useCallback(async (json: string, added: string[]) => {
    const flowId = idRef.current;
    if (flowId === undefined || !added.length) return;
    try {
      const clashes = await flowsApi.pathClashes(flowId, json, added);
      // Only while those paths are still there (an undo may have taken them out already).
      const now = pathsOf(latest.current ?? json);
      const still = clashes.filter((c) => now.includes(c.specPath));
      if (still.length) setDialog({ kind: 'path-clash', clashes: still });
    } catch {
      // Not told now: saving the spec refuses the path and says which flow has it.
    }
  }, []);

  const onChange = useCallback((content: string) => {
    latest.current = content;
    setContentDirty(content !== saved.current);
    const nowPaths = pathsOf(content);
    const addedPaths = nowPaths.filter((p) => !paths.current.includes(p));
    paths.current = nowPaths;
    void checkNewPaths(content, addedPaths);
    const now = operationsOf(content);
    if (!now) return;
    const before = operations.current;
    operations.current = now;
    if (!before) return;
    const { added, removed } = operationChanges(before, now);
    if (!added.length && !removed.length) return;
    const current = (op: RoutableOperation) => ({ ...op, operationId: renamedSince.current.get(op.operationId) ?? op.operationId });
    onOperationsChangedRef.current?.({ added, removed: removed.map(current) });
  }, [checkNewPaths]);

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
   * only operations without an operationId get one. With routes, each of its operations gets a
   * route (onOperationsChanged), and the routes of the operations it no longer has are dealt with
   * as when they are deleted in the editor.
   */
  const storeUpload = async (fileName: string, text: string, routes = true) => {
    setDialog(undefined);
    // Removed operations are looked up by the ids their routes start from (renamed by a save).
    const before = (operations.current ?? []).map((op) => ({ ...op, operationId: renamedSince.current.get(op.operationId) ?? op.operationId }));
    const json = toEditorJson(text);
    latest.current = undefined;
    renamedSince.current = new Map();
    const result = await store(fileName, json, false, { text });
    if (result !== undefined) {
      if (id !== undefined) saved.current = result;
      else unsavedText.current = text;
      const after = operationsOf(result);
      if (routes && after) {
        // The uploaded file's operations get routes, under the ids it came with.
        const { removed } = operationChanges(before, after);
        onOperationsChangedRef.current?.({ added: after, removed });
      }
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
      // A path belongs to one flow: a file with paths other flows have is not taken.
      const clashes = id === undefined ? [] : await flowsApi.pathClashes(id, text);
      if (clashes.length) {
        setDialog({ kind: 'upload-clash', fileName: file.name, clashes });
        return;
      }
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

  /**
   * Takes paths just added out of the spec again (and the routes made for their operations, as when
   * they are deleted), and saves the spec when it has a name, so it never keeps them.
   */
  const removePaths = async (specPaths: string[]) => {
    setDialog(undefined);
    const json = withoutPaths(currentJson(), specPaths);
    const current = (op: RoutableOperation) => ({ ...op, operationId: renamedSince.current.get(op.operationId) ?? op.operationId });
    const { removed } = operationChanges(operationsOf(currentJson()) ?? [], operationsOf(json) ?? []);
    if (removed.length) onOperationsChangedRef.current?.({ added: [], removed: removed.map(current) });
    const result = name ? await store(withFormat(name, format), json) : undefined;
    if (result !== undefined) {
      saved.current = result;
      latest.current = undefined;
    } else {
      latest.current = json;
    }
    named.current = undefined;
    setInitialJson(result ?? json);
    setEditorKey((k) => k + 1);
    setContentDirty(result === undefined && json !== saved.current);
    setDialogOpen(false);
    return result !== undefined || !name;
  };

  /** Switch: the flow is saved without the paths, then the other flow opens (a published one as a new draft). */
  const switchTo = async (clash: PathClash) => {
    const specPaths = dialog?.kind === 'path-clash' ? dialog.clashes.map((c) => c.specPath) : [clash.specPath];
    if (!(await removePaths([...new Set(specPaths)]))) return;
    try {
      const flowId = clash.flowId ?? (await publishedFlowsApi.createDraft(clash.folder!)).id;
      await onSwitchToFlow?.(flowId);
    } catch (e) {
      setStatus({ variant: 'danger', text: `Could not open ${clash.flowName}: ${(e as Error).message}` });
    }
  };

  /** The spec as it was before Import From Jira added to it, for its Undo. */
  const beforeImport = useRef<{ json: string; latest: string | undefined; dirty: boolean } | undefined>(undefined);

  /** Puts json on screen, unsaved, in place of what is there (Import From Jira and its Undo). */
  const showUnsaved = (json: string) => {
    latest.current = json;
    named.current = undefined;
    setInitialJson(json);
    setEditorKey((k) => k + 1);
    setContentDirty(json !== saved.current);
    setDialogOpen(false);
  };

  /**
   * Import From Jira: the spec with the confirmed operations added goes on screen, unsaved. The new
   * operations get routes, and a new path another flow has is asked about, as when typed in.
   */
  const applyImport = (result: ImportResult) => {
    const before = currentJson();
    beforeImport.current = { json: before, latest: latest.current, dirty: contentDirty };
    void checkNewPaths(result.json, pathsOf(result.json).filter((p) => !pathsOf(before).includes(p)));
    const { added } = operationChanges(operationsOf(before) ?? [], operationsOf(result.json) ?? []);
    if (added.length) onOperationsChangedRef.current?.({ added, removed: [] });
    showUnsaved(result.json);
    const n = result.paths.length;
    setStatus({ variant: 'success', text: `Added ${n} operation${n === 1 ? '' : 's'} from Jira: save to keep ${n === 1 ? 'it' : 'them'}.` });
  };

  const undoImport = () => {
    const before = beforeImport.current;
    if (before === undefined) return;
    beforeImport.current = undefined;
    const { removed } = operationChanges(operationsOf(currentJson()) ?? [], operationsOf(before.json) ?? []);
    if (removed.length) onOperationsChangedRef.current?.({ added: [], removed });
    showUnsaved(before.json);
    latest.current = before.latest;
    setContentDirty(before.dirty);
    setStatus(undefined);
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
      void storeUpload(fileName, text, false);
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
        {settings.data?.jiraImport && (
          <Button variant="secondary" size="sm" onClick={() => setDialog({ kind: 'jira' })} isDisabled={saving}>
            Import From Jira
          </Button>
        )}
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
            const before = pathsOf(currentJson());
            const json = specFromSamples({ ...samples, current: currentJson(), flowName: flowTitle, flowDescription });
            void checkNewPaths(json, pathsOf(json).filter((p) => !before.includes(p)));
            latest.current = json;
            setInitialJson(json);
            setEditorKey((k) => k + 1);
            setContentDirty(json !== saved.current);
            setDialogOpen(false);
            setStatus({ variant: 'success', text: `Made ${samples.method} ${samples.path} from the samples: save to keep it.` });
          }}
        />
      )}
      {dialog?.kind === 'jira' && (
        <JiraImportModal currentJson={currentJson} onApply={applyImport} onUndo={undoImport} onClose={() => setDialog(undefined)} />
      )}
      {dialog?.kind === 'path-clash' && (
        <Modal isOpen variant="small" onClose={() => void removePaths(dialog.clashes.map((c) => c.specPath))} aria-labelledby="path-clash-title">
          <ModalHeader title="This path is in another flow" titleIconVariant="warning" labelId="path-clash-title" />
          <ModalBody>
            <ul className="echo-api-spec__clashes">
              {dialog.clashes.map((c) => (
                <li key={`${c.specPath}|${c.flowName}`}>
                  <strong>{c.path}</strong> is already in flow <strong>{c.flowName}</strong>
                  {c.otherPath !== c.path ? <> (as {c.otherPath})</> : null}.
                </li>
              ))}
            </ul>
            A path can be in one flow only. Switch to that flow to work on it there? This flow is saved without the path.
          </ModalBody>
          <ModalFooter>
            {[...new Map(dialog.clashes.map((c) => [c.flowName, c])).values()].map((c, i) => (
              <Button key={c.flowName} variant={i === 0 ? 'primary' : 'secondary'} onClick={() => void switchTo(c)}>
                Switch to {c.flowName}
              </Button>
            ))}
            <Button variant="link" onClick={() => void removePaths(dialog.clashes.map((c) => c.specPath))}>
              Remove the path here
            </Button>
          </ModalFooter>
        </Modal>
      )}
      {dialog?.kind === 'upload-clash' && (
        <Modal isOpen variant="small" onClose={() => setDialog(undefined)} aria-labelledby="upload-clash-title">
          <ModalHeader title={`${dialog.fileName} cannot be uploaded`} titleIconVariant="danger" labelId="upload-clash-title" />
          <ModalBody>
            It has paths that other flows have:
            <ul className="echo-api-spec__clashes">
              {dialog.clashes.map((c) => (
                <li key={`${c.path}|${c.flowName}|${c.otherPath}`}>
                  <strong>{c.path}</strong> is in flow <strong>{c.flowName}</strong>
                  {c.otherPath !== c.path ? <> (as {c.otherPath})</> : null}
                </li>
              ))}
            </ul>
            A path can be in one flow only. Nothing was uploaded.
          </ModalBody>
          <ModalFooter>
            <Button variant="primary" onClick={() => setDialog(undefined)}>
              Close
            </Button>
          </ModalFooter>
        </Modal>
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
