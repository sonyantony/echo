import {
  Alert,
  AlertActionCloseButton,
  Bullseye,
  Button,
  Checkbox,
  Divider,
  Dropdown,
  DropdownItem,
  DropdownList,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  MenuToggle,
  PageSection,
  Spinner,
} from '@patternfly/react-core';
import { CheckCircleIcon, FileIcon, PlayIcon, UploadIcon } from '@patternfly/react-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useBlocker, useLocation, useNavigate, useParams } from 'react-router-dom';
import { ApiError } from '../api/client';
import {
  downloadFlow,
  editorSettings,
  flowsApi,
  runApi,
  type RunFile,
  type RunValues,
  templatesApi,
  validateFlow,
  type ValidationResult,
} from '../api/flows';
import { ApiSpecMenu } from '../apispec/ApiSpecMenu';
import { ApiSpecPanel, type ApiSpecPanelHandle } from '../apispec/ApiSpecPanel';
import { CopySpecModal } from '../apispec/CopySpecModal';
import { parseSpec } from '../apispec/apiSpec';
import {
  appendRoute,
  directRoutes,
  operationLabel,
  renameDirectRoutes,
  routableOperations,
  routeForOperation,
  type OperationRename,
  type RoutableOperation,
} from '../apispec/operationIds';
import { SpecMappingWarnings } from '../datamapper/SpecMappingWarnings';
import { useSpecMappingReview } from '../datamapper/useSpecMappingReview';
import { ApiFlowFiles } from '../editor/apiFlowFiles';
import { KaotoEditorHost, type KaotoEditorHandle } from '../editor/KaotoEditorHost';
import { useDismissMenu } from '../editor/menuDismiss';
import { readRestSettings, writeRestSetting, type RestSetting, type RestSettings } from '../editor/restSettings';
import { AddOperationRouteModal, addOperationRouteMenuItem } from './AddOperationRouteModal';
import { DownloadButtons, downloadMenuItems } from './downloads';
import { FlowFormModal } from './FlowFormModal';
import { FLOWS_KEY, OPEN_FLOW_PATH, rememberLastFlow, StatusLabel, type OpenFlowState } from './FlowListPage';
import { HistoryModal, historyMenuItem } from './HistoryModal';
import { OpenTemplateModal } from './OpenTemplateModal';
import { PublishModal } from './PublishModal';
import { publishSummary } from './publishSummary';
import { RunPanel } from './RunPanel';
import { RunWithModal } from './RunWithModal';
import { SaveAsModal } from './SaveAsModal';
import { UploadFlowModal } from './UploadFlowModal';
import { useOperationRoutes } from './useOperationRoutes';
import { useAutosave } from './useAutosave';
import { ValidationPanel } from './ValidationPanel';
import './FlowEditorPage.css';

/** The flow editor's address with the flow's API spec open in it. */
export const apiSpecPath = (id: number) => `/flows/${id}/api`;
/** The editor's address without the view part: moving between its views is not leaving it. */
const editorPathOf = (pathname: string) => pathname.replace(/\/api$/, '');

/**
 * One editor per flow: moving to another flow (e.g. after Save As) starts a fresh editor. The same
 * editor shows the flow's API spec (/flows/:id/api), so the tab line stays.
 */
export function FlowEditorPage() {
  const { id } = useParams();
  return <FlowEditor key={id} />;
}

function FlowEditor() {
  const id = Number(useParams().id);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const showSpec = useLocation().pathname.endsWith('/api');
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
  // The properties file this user chose for the flow's test runs (Run With...).
  const runValues = useQuery({ queryKey: ['flow', id, 'run-values'], queryFn: () => runApi.values(id), enabled: runEnabled });

  const apiFiles = useMemo(() => new ApiFlowFiles(id), [id]);
  const editor = useRef<KaotoEditorHandle>(null);
  const readSavedSpec = useCallback(async () => {
    const name = (await flowsApi.get(id)).apiSpec;
    const text = name ? await flowsApi.readFile(id, name) : undefined;
    return text === undefined ? undefined : parseSpec(text);
  }, [id]);
  // DataMapper schemas made from the spec follow it; mappings using fields it no longer has are listed.
  const mappingReview = useSpecMappingReview({
    files: apiFiles,
    readSpec: readSavedSpec,
    readRoute: async () => editor.current?.getContent(),
  });
  const { files, review: reviewMappings } = mappingReview;
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
  const [runMenuOpen, setRunMenuOpen] = useState(false);
  const [runWith, setRunWith] = useState<RunValues>();
  useDismissMenu(fileMenuOpen, setFileMenuOpen);
  useDismissMenu(runMenuOpen, setRunMenuOpen);
  const [savingAs, setSavingAs] = useState<'flow' | 'template'>();
  const [openingTemplate, setOpeningTemplate] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [copyingSpec, setCopyingSpec] = useState(false);
  const [addingRoutes, setAddingRoutes] = useState<{ operations: RoutableOperation[]; routes: Map<string, boolean> }>();
  /** Renaming routes after a spec save renamed operations; Add Route For Operation waits for it. */
  const renaming = useRef<Promise<void>>(undefined);
  // Methods added in Interface get a route at once; deleted ones ask about theirs.
  const operationRoutes = useOperationRoutes(editor, (variant, text) => setMessage({ variant, text }));
  /** Client Request Validation and Enable CORS, as the route on screen has them (Flow menu). */
  const [restSettings, setRestSettings] = useState<RestSettings>();
  // The API spec is opened on first use and then kept (hidden while a Kaoto view is open), so its
  // unsaved edits survive moving between views.
  const [specOpened, setSpecOpened] = useState(showSpec);
  const [specDirty, setSpecDirty] = useState(false);
  const specPanel = useRef<ApiSpecPanelHandle>(null);
  useEffect(() => {
    if (showSpec) setSpecOpened(true);
  }, [showSpec]);
  /** Set when Save As moves to the new flow, so leaving this one does not ask about unsaved edits. */
  const leavingAfterSaveAs = useRef(false);

  useEffect(() => {
    const yaml = route.data;
    if (yaml === undefined) return;
    savedYaml.current = yaml;
    setRestSettings((current) => current ?? readRestSettings(yaml));
  }, [route.data]);

  const reviewed = useRef(false);
  useEffect(() => {
    if (route.data === undefined || reviewed.current) return;
    reviewed.current = true;
    void reviewMappings(true);
  }, [route.data, reviewMappings]);

  /** Attach Schema offers the spec on screen, unsaved edits included. */
  const loadSpecForSchemas = useCallback(async () => {
    const unsaved = specPanel.current?.unsavedSpec();
    return unsaved ? (JSON.parse(unsaved.json) as Record<string, unknown>) : readSavedSpec();
  }, [readSavedSpec]);

  // Cancel on the Open Flow page comes back here when it has nowhere else to go.
  useEffect(() => {
    if (flow.data) rememberLastFlow(flow.data.id);
  }, [flow.data]);

  const onChange = useCallback((yaml: string) => {
    latestYaml.current = yaml;
    setDirty(yaml !== savedYaml.current);
    const now = readRestSettings(yaml);
    setRestSettings((was) =>
      was && was.clientRequestValidation === now.clientRequestValidation && was.enableCORS === now.enableCORS ? was : now,
    );
  }, []);

  /** Flow > Client Request Validation / Enable CORS: changes the route's restConfiguration in the editor. */
  const toggleRestSetting = useCallback(async (key: RestSetting) => {
    if (!editor.current) return;
    try {
      const yaml = await editor.current.getContent();
      await editor.current.setContent(writeRestSetting(yaml, key, !readRestSettings(yaml)[key]));
    } catch (e) {
      setMessage({ variant: 'danger', text: `Could not change the setting: ${(e as Error).message}` });
    }
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

  /**
   * A spec save renamed operations (their path or method changed): the routes for them now start
   * from the new direct:<operationId>, in the editor and in the saved draft (operationIds.ts).
   */
  const renameRoutes = useCallback((renames: OperationRename[]) => {
    renaming.current = (async () => {
      try {
        if (!editor.current) {
          if (!routeFile) return;
          const yaml = await flowsApi.readFile(id, routeFile);
          const renamed = yaml === undefined ? yaml : renameDirectRoutes(yaml, renames);
          if (renamed !== undefined && renamed !== yaml) await flowsApi.writeFile(id, routeFile, renamed);
          return;
        }
        const yaml = await editor.current.getContent();
        const renamed = renameDirectRoutes(yaml, renames);
        if (renamed === yaml) return;
        await editor.current.setContent(renamed);
        await save(true);
      } catch (e) {
        setMessage({ variant: 'danger', text: `Could not rename the routes of renamed operations: ${(e as Error).message}` });
      }
    })();
  }, [id, routeFile, save]);

  /** Flow > Add Route For Operation: lists the spec's operations (unsaved spec edits are saved first). */
  const openAddRoutes = useCallback(async () => {
    if (!editor.current) return;
    try {
      if (specPanel.current && !(await specPanel.current.saveIfChanged())) {
        setMessage({ variant: 'warning', text: 'Save the Openapi spec first.' });
        return;
      }
      await renaming.current;
      const spec = await readSavedSpec();
      if (!spec) {
        setMessage({ variant: 'warning', text: 'The flow has no Openapi spec yet: design its operations in Interface first.' });
        return;
      }
      const yaml = await editor.current.getContent();
      setAddingRoutes({ operations: routableOperations(JSON.stringify(spec)), routes: directRoutes(yaml) });
    } catch (e) {
      setMessage({ variant: 'danger', text: `Could not list the operations: ${(e as Error).message}` });
    }
  }, [readSavedSpec]);

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

  /**
   * Runs what is on screen inside the Builder: unsaved edits are saved and the draft validated first.
   * A flow using {{placeholders}} runs with the properties file chosen before (file, when given, replaces
   * it); without one, or when it no longer sets every value, Run With... opens to choose one.
   */
  const startRun = useCallback(
    async (file?: RunFile) => {
      setStarting(true);
      setValidation(undefined);
      try {
        if (dirty && !(await save())) return;
        setMessage(undefined);
        queryClient.setQueryData(['flow', id, 'run'], await runApi.start(id, file));
        setRunWith(undefined);
      } catch (e) {
        if (e instanceof ApiError && e.status === 409) {
          setRunWith(e.details as RunValues);
        } else if (e instanceof ApiError && e.status === 422) {
          setRunWith(undefined);
          setValidation(e.details as ValidationResult);
        } else if (file) {
          throw e;
        } else {
          setMessage({ variant: 'danger', text: `Could not run: ${(e as Error).message}` });
        }
      } finally {
        setStarting(false);
        void queryClient.invalidateQueries({ queryKey: ['flow', id, 'run-values'] });
      }
    },
    [dirty, id, save, queryClient],
  );

  /** Run With...: choose a properties file for the values the saved draft uses (unsaved edits are saved first). */
  const chooseRunFile = useCallback(async () => {
    try {
      if (dirty && !(await save())) return;
      setRunWith({ ...(await runApi.values(id)), missing: [] });
    } catch (e) {
      setMessage({ variant: 'danger', text: `Could not run: ${(e as Error).message}` });
    }
  }, [dirty, id, save]);

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

  /** File > Save and Ctrl+S: the flow, and the API spec when it has unsaved edits. */
  const saveAll = useCallback(async () => {
    if (await save()) await specPanel.current?.saveIfChanged();
  }, [save]);

  // Ctrl+S saves and Ctrl+O opens a template (Cmd on a Mac), instead of the browser's own save and
  // open. Caught before Kaoto's editors see them, and left alone while a dialog is open.
  const saveRef = useRef(saveAll);
  saveRef.current = saveAll;
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
      const key = e.key.toLowerCase();
      if (key !== 's' && key !== 'o') return;
      e.preventDefault();
      e.stopPropagation();
      if (document.querySelector('.pf-v6-c-modal-box')) return;
      if (key === 's') void saveRef.current();
      else setOpeningTemplate(true);
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, []);

  // Warn before leaving with unsaved changes (the flow's or its API spec's), inside the app and when
  // closing the tab. Moving between the editor's views is not leaving.
  const unsaved = dirty || specDirty;
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      unsaved &&
      !leavingAfterSaveAs.current &&
      editorPathOf(currentLocation.pathname) !== editorPathOf(nextLocation.pathname),
  );
  useEffect(() => {
    if (!unsaved) return;
    const handler = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [unsaved]);

  /** Moves between the editor's views, keeping Kaoto's own place (in the URL hash). */
  const showView = (spec: boolean) => {
    if (spec === showSpec) return;
    navigate({ pathname: spec ? apiSpecPath(id) : `/flows/${id}`, hash: window.location.hash });
  };

  if (flow.isError || route.isError) {
    return (
      <PageSection>
        <Alert variant="danger" isInline title="Could not open this flow">
          <Link to={OPEN_FLOW_PATH}>Back to flows</Link>
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

  /** Opens a draft just made by New Flow, Open Template or Upload Flow (leaving this one asks about unsaved edits). */
  const openNewDraft = async (newId: number) => {
    setCreating(false);
    setOpeningTemplate(false);
    setUploading(false);
    await queryClient.invalidateQueries({ queryKey: FLOWS_KEY });
    navigate(`/flows/${newId}`);
  };

  /** Lets Cancel on the Open Flow page come back to this flow. */
  const openFlowState: OpenFlowState = { from: `/flows/${flow.data.id}` };

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
            className="echo-file-menu"
            isExpanded={fileMenuOpen}
            onClick={() => setFileMenuOpen((open) => !open)}
          >
            File
          </MenuToggle>
        )}
      >
        <DropdownList>
          <DropdownItem key="new" onClick={() => setCreating(true)} description="Start a new, empty flow">
            New Flow
          </DropdownItem>
          <DropdownItem
            key="open-template"
            onClick={() => setOpeningTemplate(true)}
            description="Start a new flow from a template stored in Git"
            aria-keyshortcuts="Control+O"
          >
            Open Template
            <Shortcut keys="Ctrl+O" />
          </DropdownItem>
          <DropdownItem
            key="open-flow"
            onClick={() => navigate(OPEN_FLOW_PATH, { state: openFlowState })}
            description="Pick a flow from the list of flows"
          >
            Open Flow
          </DropdownItem>
          <DropdownItem
            key="upload"
            onClick={() => setUploading(true)}
            description="Open a flow .zip saved with Download, as a new draft"
          >
            Upload Flow
          </DropdownItem>
          <Divider component="li" key="open-divider" />
          <DropdownItem key="save" onClick={() => saveAll()} isDisabled={saving} aria-keyshortcuts="Control+S">
            Save
            <Shortcut keys="Ctrl+S" />
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
        </DropdownList>
      </Dropdown>
    </div>
  );

  // The Run menu, among Kaoto's tabs just before Advanced: runs the flow inside the Builder.
  const runMenu = runEnabled && (
    <div className="echo-tab-actions echo-no-print">
      <Dropdown
        isOpen={runMenuOpen}
        onOpenChange={setRunMenuOpen}
        onSelect={() => setRunMenuOpen(false)}
        popperProps={{ position: 'start', appendTo: () => document.body }}
        toggle={(toggleRef) => (
          <MenuToggle
            ref={toggleRef}
            variant="plainText"
            className="echo-run-menu"
            isExpanded={runMenuOpen}
            onClick={() => setRunMenuOpen((open) => !open)}
          >
            Run
          </MenuToggle>
        )}
      >
        <DropdownList>
          <DropdownItem
              key="run"
              icon={<PlayIcon />}
              onClick={() => void startRun()}
              isDisabled={starting || saving || validating}
              description={
                runValues.data?.fileName
                  ? `With the values in ${runValues.data.fileName}`
                  : run.data
                    ? 'Restart the flow with your latest changes'
                    : 'Run this flow inside the Builder and send it test requests'
              }
            >
              {run.data ? 'Restart' : 'Run'} {flow.data.displayName}
            </DropdownItem>
            <DropdownItem
              key="run-with"
              icon={<FileIcon />}
              onClick={() => void chooseRunFile()}
              isDisabled={starting || saving || validating}
              description="Choose a properties file and run with its values"
            >
              Run {flow.data.displayName} With...
            </DropdownItem>
        </DropdownList>
      </Dropdown>
    </div>
  );

  // Downloads, Validate, the REST settings and Publish on the Flow canvas toolbar, where Kaoto's copy to clipboard was.
  const canvasActions = (
    <div className="echo-canvas-actions echo-no-print">
      <DownloadButtons onDownloadZip={download} onDownloadImage={downloadDiagram} zipBusy={saving} imageBusy={drawing} />
      <Button
        variant="secondary"
        icon={<CheckCircleIcon />}
        onClick={validate}
        isLoading={validating}
        isDisabled={validating || saving}
        title={`Validate ${flow.data.displayName}: check the flow for problems before publishing it`}
      >
        Validate
      </Button>
      <RestSettingChecks settings={restSettings} hasSpec={!!flow.data.apiSpec} toggle={toggleRestSetting} />
      <Button
        variant="primary"
        icon={<UploadIcon />}
        onClick={() => setPublishing(true)}
        isDisabled={saving || validating}
        title={`Publish ${flow.data.displayName} so the pipeline can build it`}
      >
        Publish
      </Button>
    </div>
  );

  return (
    <div className="echo-flow-editor">
      <PageSection className="echo-flow-editor__header" padding={{ default: 'noPadding' }}>
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
        <SpecMappingWarnings
          className="echo-flow-editor__message"
          warnings={mappingReview.warnings}
          error={mappingReview.error}
        />
        {runWith && (
          <RunWithModal
            flowName={flow.data.displayName}
            values={runWith}
            onRun={(file) => startRun(file)}
            onClose={() => setRunWith(undefined)}
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
          loadSpec={loadSpecForSchemas}
          onChange={onChange}
          tabBarStart={
            <>
              {fileMenu}
              <ApiSpecMenu current={showSpec} onOpen={() => setSpecOpened(true)} onShow={() => showView(true)} panel={specPanel} onCopy={() => setCopyingSpec(true)} />
            </>
          }
          tabBarMenus={runMenu}
          canvasToolbarActions={canvasActions}
          tabBarActions={
            <FlowNameTag name={flow.data.displayName} id={flow.data.name}>
              <StatusLabel status={flow.data.status} />
              {dirty || specDirty ? (
                <span data-testid="unsaved">Unsaved changes</span>
              ) : (
                autosavedAt && (
                  <span data-testid="autosaved" className="echo-flow-editor__autosaved">
                    Autosaved at {autosavedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                )
              )}
            </FlowNameTag>
          }
          designMenuItems={[
            addOperationRouteMenuItem(() => void openAddRoutes()),
            historyMenuItem(() => setShowHistory(true)),
            <Divider component="li" key="history-divider" />,
            ...downloadMenuItems({
              name: flow.data.name,
              onDownloadZip: download,
              onDownloadImage: downloadDiagram,
              zipBusy: saving,
              imageBusy: drawing,
            }),
          ]}
          cover={
            specOpened && (
              <ApiSpecPanel
                ref={specPanel}
                flowId={id}
                flowName={flow.data.name}
                flowTitle={flow.data.displayName}
                flowDescription={flow.data.description}
                onDirtyChange={setSpecDirty}
                onStored={() => void reviewMappings(true)}
                onOperationIdsRenamed={renameRoutes}
                onOperationsChanged={operationRoutes.onOperationsChanged}
                onSwitchToFlow={async (otherId) => {
                  await operationRoutes.idle();
                  if (!(await save())) return;
                  leavingAfterSaveAs.current = true;
                  await queryClient.invalidateQueries({ queryKey: FLOWS_KEY });
                  navigate(`/flows/${otherId}`);
                }}
                visible={showSpec}
              />
            )
          }
          coverVisible={showSpec}
          onKaotoViewPicked={() => showView(false)}
        />
      </div>

      {publishing && (
        <PublishModal
          flowId={id}
          flowName={flow.data.displayName}
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
          initialName={`${flow.data.displayName} copy`}
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
          initialName={flow.data.displayName}
          kind="template"
          onClose={() => setSavingAs(undefined)}
          onSave={async (name, overwrite) => {
            const yaml = await editor.current!.getContent();
            const template = await templatesApi.saveFromFlow(id, name, yaml, overwrite);
            setSavingAs(undefined);
            setMessage({ variant: 'success', text: `Saved as template ${template.displayName || template.name}.` });
            await queryClient.invalidateQueries({ queryKey: ['templates'] });
          }}
        />
      )}
      {creating && (
        <FlowFormModal
          title="New flow"
          submitLabel="Create"
          onClose={() => setCreating(false)}
          onSubmit={async (name, description) => openNewDraft((await flowsApi.create(name, description)).id)}
        />
      )}
      {openingTemplate && (
        <OpenTemplateModal onClose={() => setOpeningTemplate(false)} onOpened={(created) => openNewDraft(created.id)} />
      )}
      {uploading && (
        <UploadFlowModal onClose={() => setUploading(false)} onUploaded={(created) => openNewDraft(created.id)} />
      )}
      {copyingSpec && (
        <CopySpecModal
          flowId={id}
          ownSpec={flow.data.apiSpec}
          specDirty={specDirty}
          onClose={() => setCopyingSpec(false)}
          onCopied={() =>
            Promise.all([
              queryClient.invalidateQueries({ queryKey: ['flow', id], exact: true }),
              queryClient.invalidateQueries({ queryKey: FLOWS_KEY }),
              specPanel.current?.reload(),
              reviewMappings(true),
            ])
          }
        />
      )}
      {operationRoutes.dialog}
      {showHistory && <HistoryModal flowId={id} onClose={() => setShowHistory(false)} />}
      {addingRoutes && (
        <AddOperationRouteModal
          operations={addingRoutes.operations}
          routes={addingRoutes.routes}
          onClose={() => setAddingRoutes(undefined)}
          onAdd={async (operations) => {
            setAddingRoutes(undefined);
            try {
              const yaml = await editor.current!.getContent();
              await editor.current!.setContent(operations.reduce((y, op) => appendRoute(y, routeForOperation(op)), yaml));
              setMessage({
                variant: 'success',
                text: `Added a route for ${operations.map(operationLabel).join(', ')}. Design it on the canvas.`,
              });
              showView(false);
            } catch (e) {
              setMessage({ variant: 'danger', text: `Could not add the route: ${(e as Error).message}` });
            }
          }}
        />
      )}

      {blocker.state === 'blocked' && (
        <Modal isOpen variant="small" onClose={() => blocker.reset()} aria-labelledby="unsaved-title">
          <ModalHeader title="Leave without saving?" titleIconVariant="warning" labelId="unsaved-title" />
          <ModalBody>
            {dirty ? 'Your changes to this flow have not been saved.' : "Your changes to this flow's OpenAPI spec have not been saved."}
          </ModalBody>
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

/**
 * The REST settings next to Publish, written to the route's restConfiguration. They apply to the
 * REST service ECHO makes from the flow's OpenAPI spec, so they wait for a spec (but one already on
 * can always be turned off).
 */
function RestSettingChecks({
  settings,
  hasSpec,
  toggle,
}: {
  settings: RestSettings | undefined;
  hasSpec: boolean;
  toggle: (key: RestSetting) => void;
}) {
  const check = (key: RestSetting, label: string, description: string) => {
    const on = !!settings?.[key];
    return (
      <Checkbox
        id={`echo-rest-${key}`}
        label={label}
        isChecked={on}
        isDisabled={!settings || (!hasSpec && !on)}
        onChange={() => toggle(key)}
        title={hasSpec || on ? description : 'Needs an OpenAPI spec: design one in Interface'}
      />
    );
  };
  return (
    <div className="echo-rest-settings">
      {check('clientRequestValidation', 'Client Request Validation', 'A request missing a body, query parameter or header the spec requires, or of the wrong content type, gets a 4xx before the flow runs')}
      {check('enableCORS', 'Enable CORS', 'Lets web pages on other sites call this flow from the browser')}
    </div>
  );
}

/**
 * "Flow: <name>" at the right end of the editor's tab line, where History used to be, after the
 * flow's state (Draft or Published, unsaved or autosaved), which had a line of its own above the editor.
 * Hovering shows the flow's ID (made from its name, used in Git and image names).
 */
export function FlowNameTag({ name, id, children }: { name: string; id?: string; children?: ReactNode }) {
  return (
    <div className="echo-tab-actions echo-flow-state">
      {children}
      <span
        className="echo-flow-name-tag"
        data-testid="flow-name-tag"
        title={id ? `Flow: ${name} (ID: ${id}, its folder in Git is flows/${id}/)` : `Flow: ${name}`}
      >
        Flow: {name}
      </span>
    </div>
  );
}

/** The keyboard shortcut shown at the right of a menu item (not part of its name for screen readers). */

export function Shortcut({ keys }: { keys: string }) {
  return (
    <span className="echo-menu-shortcut" aria-hidden>
      {keys}
    </span>
  );
}
