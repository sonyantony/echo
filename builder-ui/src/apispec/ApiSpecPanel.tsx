import { Alert, AlertActionCloseButton, Bullseye, Button, Flex, FlexItem, Spinner } from '@patternfly/react-core';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { editorSettings, flowsApi } from '../api/flows';
import { FLOWS_KEY } from '../flows/FlowListPage';
import { useAutosave } from '../flows/useAutosave';
import { ApicurioEditorHost } from './ApicurioEditorHost';
import { newApiSpec, OPENAPI_FILE } from './apiSpec';
import './ApiSpecPanel.css';

export interface ApiSpecPanelHandle {
  /** Saves the spec if it has unsaved edits. Resolves to false when saving failed. */
  saveIfChanged(): Promise<boolean>;
}

interface Props {
  flowId: number;
  flowName: string;
  flowDescription?: string | null;
  /** Called when the spec gets, or no longer has, unsaved edits. */
  onDirtyChange?(dirty: boolean): void;
}

/**
 * The flow's OpenAPI spec (openapi.json in the flow folder), edited in Apicurio's editor. Shown by
 * the flow editor in place of Kaoto's views when API spec is picked on its tab line.
 */
export const ApiSpecPanel = forwardRef<ApiSpecPanelHandle, Props>(function ApiSpecPanel(
  { flowId: id, flowName, flowDescription, onDirtyChange },
  ref,
) {
  const queryClient = useQueryClient();
  const spec = useQuery({
    queryKey: ['flow', id, 'file', OPENAPI_FILE],
    queryFn: async () => (await flowsApi.readFile(id, OPENAPI_FILE)) ?? null,
    staleTime: Infinity,
    gcTime: 0,
  });
  const settings = useQuery({ queryKey: ['editor-settings'], queryFn: editorSettings, staleTime: Infinity });

  const saved = useRef<string | null | undefined>(undefined);
  const latest = useRef<string | undefined>(undefined);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ variant: 'success' | 'danger'; text: string }>();
  const [autosavedAt, setAutosavedAt] = useState<Date>();

  useEffect(() => {
    if (spec.data !== undefined) saved.current = spec.data;
  }, [spec.data]);

  const onDirtyChangeRef = useRef(onDirtyChange);
  onDirtyChangeRef.current = onDirtyChange;
  useEffect(() => onDirtyChangeRef.current?.(dirty), [dirty]);

  const onChange = useCallback((content: string) => {
    latest.current = content;
    setDirty(content !== saved.current);
  }, []);

  const save = useCallback(async (auto = false): Promise<boolean> => {
    const content = latest.current;
    if (content === undefined) return true;
    setSaving(true);
    if (!auto) setMessage(undefined);
    try {
      await flowsApi.writeFile(id, OPENAPI_FILE, content);
      saved.current = content;
      setDirty(latest.current !== content);
      if (auto) {
        setAutosavedAt(new Date());
      } else {
        setAutosavedAt(undefined);
        setMessage({ variant: 'success', text: 'Saved.' });
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['flow', id], exact: true }),
        queryClient.invalidateQueries({ queryKey: FLOWS_KEY }),
      ]);
      return true;
    } catch (e) {
      setMessage({ variant: 'danger', text: `Could not save: ${(e as Error).message}` });
      return false;
    } finally {
      setSaving(false);
    }
  }, [id, queryClient]);

  useImperativeHandle(ref, () => ({
    saveIfChanged: async () => (latest.current !== undefined && latest.current !== saved.current ? save() : true),
  }), [save]);

  useAutosave({ intervalSeconds: settings.data?.autosaveSeconds, dirty, busy: saving, save: () => save(true) });

  if (spec.isError) {
    return (
      <Alert className="echo-api-spec__message" variant="danger" isInline title="Could not open this flow's API spec" />
    );
  }
  if (spec.data === undefined) {
    return (
      <Bullseye>
        <Spinner aria-label="Loading API spec" />
      </Bullseye>
    );
  }

  return (
    <div className="echo-api-spec">
      <div className="echo-api-spec__header">
        <Flex alignItems={{ default: 'alignItemsCenter' }} gap={{ default: 'gapMd' }} flexWrap={{ default: 'nowrap' }}>
          <FlexItem className="echo-api-spec__hint">
            Tip: to build a schema from a sample request or response, use <strong>Add a data type</strong> and paste
            the sample JSON as its example. Mark required fields afterwards.
          </FlexItem>
          <FlexItem align={{ default: 'alignRight' }}>
            <Flex gap={{ default: 'gapMd' }} alignItems={{ default: 'alignItemsCenter' }} flexWrap={{ default: 'nowrap' }}>
              {spec.data === null && !dirty && <FlexItem data-testid="new-spec" className="echo-api-spec__status">New: not saved yet</FlexItem>}
              {/* Unsaved edits show as the editor's "Unsaved changes", next to the flow's name. */}
              {!dirty && autosavedAt && (
                <FlexItem className="echo-api-spec__status echo-api-spec__autosaved">
                  Autosaved at {autosavedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </FlexItem>
              )}
              <Button variant="secondary" onClick={() => save()} isLoading={saving} isDisabled={saving || !dirty}>
                Save API spec
              </Button>
            </Flex>
          </FlexItem>
        </Flex>
        {message && (
          <Alert
            className="echo-api-spec__message"
            variant={message.variant}
            isInline
            isPlain={message.variant === 'success'}
            title={message.text}
            actionClose={<AlertActionCloseButton onClose={() => setMessage(undefined)} />}
          />
        )}
      </div>
      <div className="echo-api-spec__editor">
        <ApicurioEditorHost initialContent={spec.data ?? newApiSpec(flowName, flowDescription)} onChange={onChange} />
      </div>
    </div>
  );
});
