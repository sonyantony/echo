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
import { DownloadIcon, ImageIcon } from '@patternfly/react-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useBlocker, useParams } from 'react-router-dom';
import { downloadFlow, editorSettings, flowsApi, validateFlow, type ValidationResult } from '../api/flows';
import { ApiFlowFiles } from '../editor/apiFlowFiles';
import { KaotoEditorHost, type KaotoEditorHandle } from '../editor/KaotoEditorHost';
import { FLOWS_KEY, StatusLabel } from './FlowListPage';
import { HistoryModal } from './HistoryModal';
import { PublishModal } from './PublishModal';
import { publishSummary } from './publishSummary';
import { useAutosave } from './useAutosave';
import { ValidationPanel } from './ValidationPanel';
import './FlowEditorPage.css';

export function FlowEditorPage() {
  const id = Number(useParams().id);
  const queryClient = useQueryClient();
  const flow = useQuery({ queryKey: ['flow', id], queryFn: () => flowsApi.get(id) });
  const routeFile = flow.data?.routeFile;
  const route = useQuery({
    queryKey: ['flow', id, 'route', routeFile],
    queryFn: () => flowsApi.readFile(id, routeFile!),
    enabled: !!routeFile,
    staleTime: Infinity,
  });
  const settings = useQuery({ queryKey: ['editor-settings'], queryFn: editorSettings, staleTime: Infinity });

  const files = useMemo(() => new ApiFlowFiles(id), [id]);
  const editor = useRef<KaotoEditorHandle>(null);
  const savedYaml = useRef<string | undefined>(undefined);
  const latestYaml = useRef<string | undefined>(undefined);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ variant: 'success' | 'warning' | 'danger'; text: string }>();
  const [validation, setValidation] = useState<ValidationResult>();
  const [validating, setValidating] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [drawing, setDrawing] = useState(false);
  const [autosavedAt, setAutosavedAt] = useState<Date>();

  useEffect(() => {
    if (route.data !== undefined) savedYaml.current = route.data;
  }, [route.data]);

  const onChange = useCallback((yaml: string) => {
    latestYaml.current = yaml;
    setDirty(yaml !== savedYaml.current);
  }, []);

  /** Saves the draft. An autosave stays quiet unless it fails, and leaves other messages alone. */
  const save = useCallback(async (auto = false): Promise<boolean> => {
    if (!editor.current || !routeFile) return false;
    setSaving(true);
    if (!auto) setMessage(undefined);
    try {
      const yaml = await editor.current.getContent();
      await flowsApi.writeFile(id, routeFile, yaml);
      savedYaml.current = yaml;
      // Edits made while the save was in flight are still unsaved.
      setDirty(latestYaml.current !== undefined && latestYaml.current !== yaml);
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
  }, [id, routeFile, queryClient]);

  /** Validates what is on screen: unsaved edits are saved first. */
  const validate = useCallback(async () => {
    setValidating(true);
    setValidation(undefined);
    try {
      if (dirty && !(await save())) return;
      setMessage(undefined);
      setValidation(await validateFlow(id));
    } catch (e) {
      setMessage({ variant: 'danger', text: `Could not validate: ${(e as Error).message}` });
    } finally {
      setValidating(false);
    }
  }, [dirty, id, save]);

  /** Downloads what is on screen: unsaved edits are saved first. */
  const download = useCallback(async () => {
    if (dirty && !(await save())) return;
    downloadFlow(id);
  }, [dirty, id, save]);

  /** Saves the diagram on the canvas (unsaved edits included) as <flow name>.png. */
  const downloadDiagram = useCallback(async () => {
    if (!editor.current || !flow.data) return;
    setDrawing(true);
    try {
      await editor.current.downloadDiagram(`${flow.data.name}.png`);
    } catch (e) {
      setMessage({ variant: 'danger', text: `Could not download the diagram: ${(e as Error).message}` });
    } finally {
      setDrawing(false);
    }
  }, [flow.data]);

  useAutosave({
    intervalSeconds: settings.data?.autosaveSeconds,
    dirty,
    busy: saving || validating || publishing,
    save: () => save(true),
  });

  // Warn before leaving with unsaved changes, inside the app and when closing the tab.
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && currentLocation.pathname !== nextLocation.pathname);
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  if (flow.isError || route.isError) {
    return (
      <PageSection>
        <Alert variant="danger" isInline title="Could not open this flow">
          <Link to="/">Back to flows</Link>
        </Alert>
      </PageSection>
    );
  }
  if (!flow.data || route.data === undefined) {
    return (
      <Bullseye>
        <Spinner aria-label="Loading flow" />
      </Bullseye>
    );
  }

  return (
    <div className="echo-flow-editor">
      <PageSection className="echo-flow-editor__header" padding={{ default: 'noPadding' }}>
        <Flex alignItems={{ default: 'alignItemsCenter' }} gap={{ default: 'gapMd' }}>
          <FlexItem>
            <Link to="/">Flows</Link> /
          </FlexItem>
          <FlexItem>
            <Title headingLevel="h1" size="lg">
              {flow.data.name}
            </Title>
          </FlexItem>
          <FlexItem>
            <StatusLabel status={flow.data.status} />
          </FlexItem>
          {dirty ? (
            <FlexItem data-testid="unsaved">Unsaved changes</FlexItem>
          ) : (
            autosavedAt && (
              <FlexItem data-testid="autosaved" className="echo-flow-editor__autosaved">
                Autosaved at {autosavedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </FlexItem>
            )
          )}
          <FlexItem className="echo-no-print" align={{ default: 'alignRight' }}>
            <Flex gap={{ default: 'gapSm' }}>
              <Button variant="secondary" onClick={validate} isLoading={validating} isDisabled={validating || saving}>
                Validate
              </Button>
              <Button variant="secondary" onClick={() => save()} isLoading={saving} isDisabled={saving}>
                Save
              </Button>
              <Button
                variant="secondary"
                icon={<DownloadIcon />}
                onClick={download}
                isDisabled={saving}
                title="Save this flow to your computer as a .zip you can upload again later"
              >
                Download .zip
              </Button>
              <Button
                variant="secondary"
                icon={<ImageIcon />}
                onClick={downloadDiagram}
                isLoading={drawing}
                isDisabled={drawing}
                title="Save a picture of the whole flow diagram to your computer"
              >
                Download diagram (.png)
              </Button>
              <Button variant="primary" onClick={() => setPublishing(true)} isDisabled={saving || validating}>
                Publish
              </Button>
              <Button variant="link" onClick={() => setShowHistory(true)}>
                History
              </Button>
            </Flex>
          </FlexItem>
        </Flex>
        {message && (
          <Alert
            className="echo-flow-editor__message"
            variant={message.variant}
            isInline
            isPlain={message.variant === 'success'}
            title={message.text}
            actionClose={<AlertActionCloseButton onClose={() => setMessage(undefined)} />}
          />
        )}
        {validation && (
          <div className="echo-flow-editor__message">
            <ValidationPanel result={validation} onClose={() => setValidation(undefined)} />
          </div>
        )}
      </PageSection>
      <div className="echo-flow-editor__canvas">
        <KaotoEditorHost
          key={`${id}:${routeFile}`}
          ref={editor}
          path={routeFile!}
          initialContent={route.data ?? ''}
          files={files}
          onChange={onChange}
        />
      </div>

      {publishing && (
        <PublishModal
          flowId={id}
          flowName={flow.data.name}
          beforePublish={async () => (dirty ? save() : true)}
          onClose={() => setPublishing(false)}
          onInvalid={(result) => {
            setPublishing(false);
            setMessage(undefined);
            setValidation(result);
          }}
          onPublished={async (result) => {
            setPublishing(false);
            setValidation(undefined);
            setMessage(publishSummary(result));
            await Promise.all([
              queryClient.invalidateQueries({ queryKey: ['flow', id] }),
              queryClient.invalidateQueries({ queryKey: FLOWS_KEY }),
            ]);
          }}
        />
      )}
      {showHistory && <HistoryModal flowId={id} onClose={() => setShowHistory(false)} />}

      {blocker.state === 'blocked' && (
        <Modal isOpen variant="small" onClose={() => blocker.reset()} aria-labelledby="unsaved-title">
          <ModalHeader title="Leave without saving?" titleIconVariant="warning" labelId="unsaved-title" />
          <ModalBody>Your changes to this flow have not been saved.</ModalBody>
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
