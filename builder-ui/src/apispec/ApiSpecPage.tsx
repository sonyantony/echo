import {
  Alert,
  AlertActionCloseButton,
  Bullseye,
  Button,
  Flex,
  FlexItem,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  PageSection,
  Spinner,
  Title,
} from '@patternfly/react-core';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useBlocker, useParams } from 'react-router-dom';
import { editorSettings, flowsApi } from '../api/flows';
import { FLOWS_KEY, StatusLabel } from '../flows/FlowListPage';
import { useAutosave } from '../flows/useAutosave';
import { ApicurioEditorHost } from './ApicurioEditorHost';
import { newApiSpec, OPENAPI_FILE } from './apiSpec';
import './ApiSpecPage.css';

/** The flow's OpenAPI spec (openapi.json in the flow folder), edited in Apicurio's editor. */
export function ApiSpecPage() {
  const id = Number(useParams().id);
  const queryClient = useQueryClient();
  const flow = useQuery({ queryKey: ['flow', id], queryFn: () => flowsApi.get(id) });
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

  useAutosave({ intervalSeconds: settings.data?.autosaveSeconds, dirty, busy: saving, save: () => save(true) });

  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && currentLocation.pathname !== nextLocation.pathname);
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  if (flow.isError || spec.isError) {
    return (
      <PageSection>
        <Alert variant="danger" isInline title="Could not open this flow's API spec">
          <Link to="/">Back to flows</Link>
        </Alert>
      </PageSection>
    );
  }
  if (!flow.data || spec.data === undefined) {
    return (
      <Bullseye>
        <Spinner aria-label="Loading API spec" />
      </Bullseye>
    );
  }

  return (
    <div className="echo-api-spec">
      <PageSection className="echo-api-spec__header" padding={{ default: 'noPadding' }}>
        <Flex alignItems={{ default: 'alignItemsCenter' }} gap={{ default: 'gapMd' }}>
          <FlexItem>
            <Link to="/">Flows</Link> / <Link to={`/flows/${id}`}>{flow.data.name}</Link> /
          </FlexItem>
          <FlexItem>
            <Title headingLevel="h1" size="lg">
              API spec
            </Title>
          </FlexItem>
          <FlexItem>
            <StatusLabel status={flow.data.status} />
          </FlexItem>
          {spec.data === null && !dirty && <FlexItem data-testid="new-spec">New: not saved yet</FlexItem>}
          {dirty ? (
            <FlexItem data-testid="unsaved">Unsaved changes</FlexItem>
          ) : (
            autosavedAt && (
              <FlexItem className="echo-api-spec__autosaved">
                Autosaved at {autosavedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </FlexItem>
            )
          )}
          <FlexItem align={{ default: 'alignRight' }}>
            <Flex gap={{ default: 'gapMd' }} alignItems={{ default: 'alignItemsCenter' }}>
              <Button variant="secondary" onClick={() => save()} isLoading={saving} isDisabled={saving || !dirty}>
                Save
              </Button>
              <Link className="echo-api-spec__back" to={`/flows/${id}`}>
                Back to the flow
              </Link>
            </Flex>
          </FlexItem>
        </Flex>
        <p className="echo-api-spec__hint">
          Tip: to build a schema from a sample request or response, use <strong>Add a data type</strong> and paste
          the sample JSON as its example. Mark required fields afterwards.
        </p>
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
      </PageSection>
      <div className="echo-api-spec__editor">
        <ApicurioEditorHost
          key={id}
          initialContent={spec.data ?? newApiSpec(flow.data.name, flow.data.description)}
          onChange={onChange}
        />
      </div>

      {blocker.state === 'blocked' && (
        <Modal isOpen variant="small" onClose={() => blocker.reset()} aria-labelledby="unsaved-spec-title">
          <ModalHeader title="Leave without saving?" titleIconVariant="warning" labelId="unsaved-spec-title" />
          <ModalBody>Your changes to this API spec have not been saved.</ModalBody>
          <ModalFooter>
            <Button variant="danger" onClick={() => blocker.proceed()}>
              Leave
            </Button>
            <Button variant="link" onClick={() => blocker.reset()}>
              Stay
            </Button>
          </ModalFooter>
        </Modal>
      )}
    </div>
  );
}
