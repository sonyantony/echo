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
import { OutlinedQuestionCircleIcon } from '@patternfly/react-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { editorSettings, flowsApi } from '../api/flows';
import { FLOWS_KEY } from '../flows/FlowListPage';
import { useAutosave } from '../flows/useAutosave';
import { ApicurioEditorHost, type ApicurioEditorHandle } from './ApicurioEditorHost';
import {
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
import { SpecNameModal } from './SpecNameModal';
import './ApiSpecPanel.css';

export interface ApiSpecPanelHandle {
  /** Saves the spec if it has unsaved edits (asking for a name if it has none). Resolves to false when it was not saved. */
  saveIfChanged(): Promise<boolean>;
  /** Openapi Design > Upload: picks a .yaml or .json spec and stores it in the flow under its own name. */
  upload(): void;
  /** Openapi Design > Download Openapi File As Yaml / Json: what is on screen, unsaved edits included. */
  download(format: SpecFormat): void;
}

interface Props {
  flowId: number;
  flowName: string;
  flowDescription?: string | null;
  /** Called when the spec gets, or no longer has, unsaved edits. */
  onDirtyChange?(dirty: boolean): void;
  /** Called with the spec's file name, or null while it has none (new, or after Discard). */
  onNameChange?(name: string | null): void;
}

interface Loaded {
  name: string | null;
  /** The saved spec as the editor's JSON; null when the flow has none. */
  json: string | null;
}

type Dialog =
  | { kind: 'name'; saveAs: boolean }
  | { kind: 'discard' }
  | { kind: 'replace'; fileName: string; text: string }
  | { kind: 'rename-upload'; fileName: string; text: string };

/**
 * The flow's OpenAPI spec, edited in Apicurio's editor. Shown by the flow editor in place of
 * Kaoto's views when Openapi Design is picked on its tab line. The spec is one file in the flow
 * folder, under the name it was uploaded or saved with, in YAML or JSON (the format buttons).
 */
export const ApiSpecPanel = forwardRef<ApiSpecPanelHandle, Props>(function ApiSpecPanel(
  { flowId: id, flowName, flowDescription, onDirtyChange, onNameChange },
  ref,
) {
  const queryClient = useQueryClient();
  const spec = useQuery({
    queryKey: ['flow', id, 'api-spec'],
    queryFn: async (): Promise<Loaded> => {
      const name = (await flowsApi.get(id)).apiSpec ?? null;
      const text = name ? await flowsApi.readFile(id, name) : undefined;
      if (!name || text === undefined) return { name: null, json: null };
      try {
        return { name, json: toEditorJson(text) };
      } catch {
        return { name, json: null };
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

  const open = useCallback((loaded: Loaded) => {
    saved.current = loaded.json;
    latest.current = undefined;
    setName(loaded.name);
    setFormat((loaded.name && formatOf(loaded.name)) || 'yaml');
    setInitialJson(loaded.json ?? newApiSpec(flowName, flowDescription));
    setEditorKey((k) => k + 1);
    setContentDirty(false);
  }, [flowName, flowDescription]);

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
  useEffect(() => onNameChangeRef.current?.(name), [name]);

  const onChange = useCallback((content: string) => {
    latest.current = content;
    setContentDirty(content !== saved.current);
  }, []);

  /** What is on screen, as the editor's JSON. */
  const currentJson = () => latest.current ?? saved.current ?? initialJson ?? newApiSpec(flowName, flowDescription);

  /** Stores text as the flow's spec under fileName; the editor already shows it as json. */
  const store = useCallback(async (fileName: string, text: string, json: string, auto = false): Promise<boolean> => {
    setSaving(true);
    if (!auto) setStatus(undefined);
    try {
      await flowsApi.saveApiSpec(id, fileName, text);
      saved.current = json;
      setName(fileName);
      setStoredName(fileName);
      setFormat(formatOf(fileName) ?? 'yaml');
      setContentDirty(latest.current !== undefined && latest.current !== json);
      const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      setStatus({ variant: 'success', text: auto ? `Autosaved at ${time}` : `Saved ${fileName}.` });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['flow', id], exact: true }),
        queryClient.invalidateQueries({ queryKey: FLOWS_KEY }),
      ]);
      return true;
    } catch (e) {
      setStatus({ variant: 'danger', text: `Could not save: ${(e as Error).message}` });
      return false;
    } finally {
      setSaving(false);
    }
  }, [id, queryClient]);

  /** Saves what is on screen as fileName, in the format its extension says. */
  const saveAs = useCallback((fileName: string, auto = false) => {
    const json = latest.current ?? saved.current ?? initialJson ?? newApiSpec(flowName, flowDescription);
    return store(fileName, serialize(json, formatOf(fileName) ?? 'yaml'), json, auto);
  }, [store, initialJson, flowName, flowDescription]);

  /** Save: asks for a name the first time. */
  const save = useCallback(async (): Promise<boolean> => {
    if (!name) {
      setDialog({ kind: 'name', saveAs: false });
      return false;
    }
    return saveAs(withFormat(name, format));
  }, [name, format, saveAs]);

  const pickUpload = () => fileInput.current?.click();

  const download = (fileFormat: SpecFormat) => {
    try {
      const text = serialize(currentJson(), fileFormat);
      const fileName = withFormat(name ?? storedName ?? `${flowName}-openapi.json`, fileFormat);
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

  /** Keeps an uploaded spec exactly as it is (name, format and text), as the flow's spec. */
  const storeUpload = async (fileName: string, text: string) => {
    setDialog(undefined);
    const json = toEditorJson(text);
    latest.current = undefined;
    if (await store(fileName, text, json)) {
      setInitialJson(json);
      setEditorKey((k) => k + 1);
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
    open({ name: null, json: null });
  };

  useImperativeHandle(ref, () => ({
    saveIfChanged: async () => (dirty ? save() : true),
    upload: pickUpload,
    download,
  }));

  useAutosave({
    intervalSeconds: settings.data?.autosaveSeconds,
    dirty: dirty && !!name,
    busy: saving || !!dialog,
    save: () => name && saveAs(withFormat(name, format), true),
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
      {/* Sits where Apicurio's title bar shows the API's name (hidden, see apicurioTheme.css); its
          undo, redo and Issues stay on the right. */}
      <div className="echo-api-spec__bar">
        <div className="echo-api-spec__formats" role="radiogroup" aria-label="File format">
          <Radio id="echo-spec-yaml" name="echo-spec-format" label="YAML" isChecked={format === 'yaml'} onChange={() => setFormat('yaml')} />
          <Radio id="echo-spec-json" name="echo-spec-format" label="JSON" isChecked={format === 'json'} onChange={() => setFormat('json')} />
        </div>
        <Button variant="primary" size="sm" onClick={() => save()} isLoading={saving} isDisabled={saving || (!dirty && !!name)}>
          Save
        </Button>
        <Button variant="secondary" size="sm" onClick={() => setDialog({ kind: 'name', saveAs: true })} isDisabled={saving}>
          Save As
        </Button>
        <Button variant="secondary" size="sm" onClick={() => (dirty ? setDialog({ kind: 'discard' }) : discard())} isDisabled={saving}>
          Discard
        </Button>
        <Button variant="link" size="sm" className="echo-api-spec__info" onClick={() => editor.current?.showApiInfo()}>
          API info
        </Button>
        <span
          className="echo-api-spec__hint"
          title="To build a schema from a sample request or response, use Add a data type and paste the sample JSON as its example. Mark required fields afterwards."
        >
          <OutlinedQuestionCircleIcon /> Schema from a sample
        </span>
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
        <ApicurioEditorHost key={editorKey} ref={editor} initialContent={initialJson} onChange={onChange} />
      </div>

      {dialog?.kind === 'name' && (
        <SpecNameModal
          title={dialog.saveAs ? 'Save As' : 'Save'}
          initialName={name ? withFormat(name, format) : ''}
          format={format}
          replaces={storedName}
          onClose={() => setDialog(undefined)}
          onSave={async (fileName) => {
            setDialog(undefined);
            await saveAs(fileName);
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
