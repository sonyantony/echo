import {
  Alert,
  AlertActionCloseButton,
  Bullseye,
  Button,
  Divider,
  Dropdown,
  DropdownItem,
  DropdownList,
  Flex,
  FlexItem,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  MenuToggle,
  PageSection,
  Spinner,
  Title,
} from '@patternfly/react-core';
import { CodeIcon, EllipsisVIcon, PlayIcon } from '@patternfly/react-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useBlocker, useNavigate, useParams } from 'react-router-dom';
import { ApiError } from '../api/client';
import {
  downloadFlow,
  editorSettings,
  flowsApi,
  runApi,
  templatesApi,
  validateFlow,
  type ValidationResult,
} from '../api/flows';
import { ApiFlowFiles } from '../editor/apiFlowFiles';
import { KaotoEditorHost, type KaotoEditorHandle } from '../editor/KaotoEditorHost';
import { FLOWS_KEY, StatusLabel } from './FlowListPage';
import { HistoryModal } from './HistoryModal';
import { OpenTemplateModal } from './OpenTemplateModal';
import { PublishModal } from './PublishModal';
import { publishSummary } from './publishSummary';
import { RunPanel } from './RunPanel';
import { SaveAsModal } from './SaveAsModal';
import { UploadFlowModal } from './UploadFlowModal';
import { useAutosave } from './useAutosave';
import { ValidationPanel } from './ValidationPanel';
import './FlowEditorPage.css';

/** One editor per flow: moving to another flow (e.g. after Save As) starts a fresh editor. */
export function FlowEditorPage() {
  const { id } = useParams();
  return <FlowEditor key={id} />;
}

function FlowEditor() {
  const id = Number(useParams().id);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const flow = useQuery({ queryKey: ['flow', id], queryFn: () => flowsApi.get(id) });
  const routeFile = flow.data?.routeFile;
  const route = useQuery({
    queryKey: ['flow', id, 'route', routeFile],
    queryFn: () => flowsApi.readFile(id, routeFile!),
    enabled: !!routeFile,
    staleTime: Infinity,
  });
  const settings = useQuery({ queryKey: ['editor-settings'], queryFn: editorSettings, staleTime: Infinity });
  const runEnabled = settings.data?.runEnabled ?? false;
  // Checked now and then, so a run stopped elsewhere (or for being idle) disappears.
  const run = useQuery({
    queryKey: ['flow', id, 'run'],
    queryFn: () => runApi.status(id),
    enabled: runEnabled,
    refetchInterval: 15000,
  });

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
  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [fileMenuOpen, setFileMenuOpen] = useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [savingAs, setSavingAs] = useState<'flow' | 'template'>();
  const [openingTemplate, setOpeningTemplate] = useState(false);
  const [uploading, setUploading] = useState(false);
  /** Set when Save As moves to the new flow, so leaving this one does not ask about unsaved edits. */
  const leavingAfterSaveAs = useRef(false);

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

  /** Runs what is on screen inside the Builder: unsaved edits are saved and the draft validated first. */
  const startRun = useCallback(async () => {
    setStarting(true);
    setValidation(undefined);
    try {
      if (dirty && !(await save())) return;
      setMessage(undefined);
      queryClient.setQueryData(['flow', id, 'run'], await runApi.start(id));
    } catch (e) {
      if (e instanceof ApiError && e.status === 422) {
        setValidation(e.details as ValidationResult);
      } else {
        setMessage({ variant: 'danger', text: `Could not run: ${(e as Error).message}` });
      }
    } finally {
      setStarting(false);
    }
  }, [dirty, id, save, queryClient]);

  const stopRun = useCallback(async () => {
    setStopping(true);
    try {
      await runApi.stop(id);
      queryClient.setQueryData(['flow', id, 'run'], null);
    } catch (e) {
      setMessage({ variant: 'danger', text: `Could not stop: ${(e as Error).message}` });
    } finally {
      setStopping(false);
    }
  }, [id, queryClient]);

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
    busy: saving || validating || publishing || starting,
    save: () => save(true),
  });

  // Warn before leaving with unsaved changes, inside the app and when closing the tab.
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirty && !leavingAfterSaveAs.current && currentLocation.pathname !== nextLocation.pathname,
  );
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

  /** Opens a draft just made by Open Template or Upload Flow (leaving this one asks about unsaved edits). */
  const openNewDraft = async (newId: number) => {
    setOpeningTemplate(false);
    setUploading(false);
    await queryClient.invalidateQueries({ queryKey: FLOWS_KEY });
    navigate(`/flows/${newId}`);
  };

  // The File menu, first on the line with Kaoto's tabs as in most desktop software.
  const fileMenu = (
    <div className="echo-tab-actions echo-no-print">
      <Dropdown
        isOpen={fileMenuOpen}
        onOpenChange={setFileMenuOpen}
        onSelect={() => setFileMenuOpen(false)}
        popperProps={{ position: 'start', appendTo: () => document.body }}
        toggle={(toggleRef) => (
          <MenuToggle
            ref={toggleRef}
            variant="plainText"
            isExpanded={fileMenuOpen}
            onClick={() => setFileMenuOpen((open) => !open)}
          >
            File
          </MenuToggle>
        )}
      >
        <DropdownList>
          <DropdownItem
            key="open-template"
            onClick={() => setOpeningTemplate(true)}
            description="Start a new flow from a template stored in Git"
          >
            Open Template
          </DropdownItem>
          <DropdownItem
            key="upload"
            onClick={() => setUploading(true)}
            description="Open a flow .zip saved with Download, as a new draft"
          >
            Upload Flow
          </DropdownItem>
          <Divider component="li" key="open-divider" />
          <DropdownItem key="save" onClick={() => save()} isDisabled={saving}>
            Save
          </DropdownItem>
          <DropdownItem
            key="save-as"
            onClick={() => setSavingAs('flow')}
            description="Save this flow under another name and continue there"
          >
            Save As
          </DropdownItem>
          <DropdownItem
            key="save-as-template"
            onClick={() => setSavingAs('template')}
            description="Store this flow in Git's templates folder for Open Template"
          >
            Save As Template
          </DropdownItem>
          <Divider component="li" key="save-divider" />
          <DropdownItem
            key="zip"
            onClick={download}
            isDisabled={saving}
            description="The flow as a .zip you can upload again later"
          >
            Download .zip
          </DropdownItem>
          <DropdownItem
            key="png"
            onClick={downloadDiagram}
            isDisabled={drawing}
            description="A picture of the whole flow diagram"
          >
            Download diagram (.png)
          </DropdownItem>
        </DropdownList>
      </Dropdown>
    </div>
  );

  // Shown at the right end of Kaoto's tab bar, styled like its tabs. On narrow screens History moves
  // into the More menu (FlowEditorPage.css).
  const actions = (
    <div className="echo-tab-actions echo-no-print">
      <Button variant="plain" onClick={validate} isLoading={validating} isDisabled={validating || saving}>
        Validate
      </Button>
      {runEnabled && (
        <Button
          variant="plain"
          icon={<PlayIcon />}
          onClick={startRun}
          isLoading={starting}
          isDisabled={starting || saving || validating}
          title={run.data ? 'Restart the flow with your latest changes' : 'Run this flow inside the Builder and send it test requests'}
        >
          {run.data ? 'Restart' : 'Run'}
        </Button>
      )}
      <Button
        variant="plain"
        icon={<CodeIcon />}
        onClick={() => navigate(`/flows/${id}/api`)}
        isDisabled={saving}
        title="Design the REST API this flow offers, as an OpenAPI spec"
      >
        API spec
      </Button>
      <Button variant="plain" className="echo-tab-actions__wide" onClick={() => setShowHistory(true)}>
        History
      </Button>
      <Dropdown
        isOpen={moreMenuOpen}
        onOpenChange={setMoreMenuOpen}
        onSelect={() => setMoreMenuOpen(false)}
        popperProps={{ position: 'end', appendTo: () => document.body }}
        toggle={(toggleRef) => (
          <MenuToggle
            ref={toggleRef}
            className="echo-tab-actions__more"
            variant="plain"
            isExpanded={moreMenuOpen}
            onClick={() => setMoreMenuOpen((open) => !open)}
            aria-label="More actions"
            icon={<EllipsisVIcon />}
          />
        )}
      >
        <DropdownList>
          <DropdownItem key="history" onClick={() => setShowHistory(true)}>
            History
          </DropdownItem>
        </DropdownList>
      </Dropdown>
      <span className="echo-tab-actions__divider" />
      <Button variant="primary" size="sm" onClick={() => setPublishing(true)} isDisabled={saving || validating}>
        Publish
      </Button>
    </div>
  );

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
        {run.data && (
          <div className="echo-flow-editor__message">
            <RunPanel flowId={id} run={run.data} onStop={stopRun} stopping={stopping} />
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
          tabBarStart={fileMenu}
          tabBarActions={actions}
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
      {savingAs === 'flow' && (
        <SaveAsModal
          title="Save As"
          description="Saves what is on screen as a draft with another name and opens it. This flow keeps its last saved version."
          initialName={`${flow.data.name}-copy`}
          onClose={() => setSavingAs(undefined)}
          onSave={async (name, overwrite) => {
            const yaml = await editor.current!.getContent();
            const copy = await flowsApi.saveAs(id, name, yaml, overwrite);
            setSavingAs(undefined);
            await queryClient.invalidateQueries({ queryKey: FLOWS_KEY });
            if (copy.id === id) {
              savedYaml.current = yaml;
              setDirty(latestYaml.current !== undefined && latestYaml.current !== yaml);
              setMessage({ variant: 'success', text: 'Saved.' });
              return;
            }
            queryClient.removeQueries({ queryKey: ['flow', copy.id] });
            leavingAfterSaveAs.current = true;
            navigate(`/flows/${copy.id}`);
          }}
        />
      )}
      {savingAs === 'template' && (
        <SaveAsModal
          title="Save As Template"
          description="Saves what is on screen as a template in Git's templates folder. Pipelines do not build templates."
          initialName={flow.data.name}
          onClose={() => setSavingAs(undefined)}
          onSave={async (name, overwrite) => {
            const yaml = await editor.current!.getContent();
            await templatesApi.saveFromFlow(id, name, yaml, overwrite);
            setSavingAs(undefined);
            setMessage({ variant: 'success', text: `Saved as template ${name}.` });
            await queryClient.invalidateQueries({ queryKey: ['templates'] });
          }}
        />
      )}
      {openingTemplate && (
        <OpenTemplateModal onClose={() => setOpeningTemplate(false)} onOpened={(created) => openNewDraft(created.id)} />
      )}
      {uploading && (
        <UploadFlowModal onClose={() => setUploading(false)} onUploaded={(created) => openNewDraft(created.id)} />
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
