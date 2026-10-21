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
import { UNDERLINED_CLASS } from '../editor/tabUnderline';
import { CheckCircleIcon, DownloadIcon, EllipsisVIcon, PlayIcon, UploadIcon } from '@patternfly/react-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useBlocker, useLocation, useNavigate, useParams } from 'react-router-dom';
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
import { ApiSpecPanel, type ApiSpecPanelHandle } from '../apispec/ApiSpecPanel';
import { OPENAPI_SPECIFICATION_FIELD, SpecificationPicker } from '../apispec/SpecificationPicker';
import { ApiFlowFiles } from '../editor/apiFlowFiles';
import { KaotoEditorHost, type KaotoEditorHandle } from '../editor/KaotoEditorHost';
import { DownloadButtons, downloadMenuItems } from './downloads';
import { FlowFormModal } from './FlowFormModal';
import { FLOWS_KEY, OPEN_FLOW_PATH, rememberLastFlow, StatusLabel, type OpenFlowState } from './FlowListPage';
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
  const [runMenuOpen, setRunMenuOpen] = useState(false);
  const [specMenuOpen, setSpecMenuOpen] = useState(false);
  const [savingAs, setSavingAs] = useState<'flow' | 'template'>();
  const [openingTemplate, setOpeningTemplate] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [creating, setCreating] = useState(false);
  // The API spec is opened on first use and then kept (hidden while a Kaoto view is open), so its
  // unsaved edits survive moving between views.
  const [specOpened, setSpecOpened] = useState(showSpec);
  const [specDirty, setSpecDirty] = useState(false);
  /** The spec's file name once the panel has it; until then the one the flow has (FlowDetail.apiSpec). */
  const [specName, setSpecName] = useState<string | null>();
  const specPanel = useRef<ApiSpecPanelHandle>(null);
  useEffect(() => {
    if (showSpec) setSpecOpened(true);
  }, [showSpec]);
  /** Set when Save As moves to the new flow, so leaving this one does not ask about unsaved edits. */
  const leavingAfterSaveAs = useRef(false);

  useEffect(() => {
    if (route.data !== undefined) savedYaml.current = route.data;
  }, [route.data]);

  // Cancel on the Open Flow page comes back here when it has nowhere else to go.
  useEffect(() => {
    if (flow.data) rememberLastFlow(flow.data.id);
  }, [flow.data]);

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
              onClick={startRun}
              isDisabled={starting || saving || validating}
              description={run.data ? 'Restart the flow with your latest changes' : 'Run this flow inside the Builder and send it test requests'}
            >
              {run.data ? 'Restart' : 'Run'} {flow.data.name}
            </DropdownItem>
        </DropdownList>
      </Dropdown>
    </div>
  );

  // Openapi Design, on the tab line right after File: API-first flows start from the spec, then Rest
  // and Flow Design. Like Flow Design it opens its view (the flow's OpenAPI spec, in place of Kaoto's
  // views) and a menu.
  const apiSpecMenu = (
    <div className="echo-tab-actions echo-no-print">
      <Dropdown
        isOpen={specMenuOpen}
        onOpenChange={setSpecMenuOpen}
        onSelect={() => setSpecMenuOpen(false)}
        popperProps={{ position: 'start', appendTo: () => document.body }}
        toggle={(toggleRef) => (
          <MenuToggle
            ref={toggleRef}
            variant="plainText"
            // The underline class is React's too, or opening the menu (a re-render) would drop it.
            className={`echo-tab-menu echo-api-spec-tab${showSpec ? ` ${UNDERLINED_CLASS}` : ''}`}
            data-echo-tab-current={showSpec ? '' : undefined}
            aria-current={showSpec ? 'page' : undefined}
            isExpanded={specMenuOpen}
            onClick={() => {
              showView(true);
              setSpecMenuOpen((open) => !open);
            }}
          >
            Openapi Design
          </MenuToggle>
        )}
      >
        <DropdownList>
          <DropdownItem
            key="upload"
            icon={<UploadIcon />}
            onClick={() => specPanel.current?.upload()}
            description="Store a .yaml or .json OpenAPI file in this flow, under its own name"
          >
            Upload
          </DropdownItem>
          <DropdownItem
            key="yaml"
            icon={<DownloadIcon />}
            onClick={() => specPanel.current?.download('yaml')}
            description="The spec on screen, unsaved edits included"
          >
            Download Openapi File As Yaml
          </DropdownItem>
          <DropdownItem
            key="json"
            icon={<DownloadIcon />}
            onClick={() => specPanel.current?.download('json')}
            description="The spec on screen, unsaved edits included"
          >
            Download Openapi File As Json
          </DropdownItem>
        </DropdownList>
      </Dropdown>
    </div>
  );

  // Downloads, Validate and Publish on the Flow Design canvas toolbar, where Kaoto's copy to clipboard was.
  const canvasActions = (
    <div className="echo-canvas-actions echo-no-print">
      <DownloadButtons onDownloadZip={download} onDownloadImage={downloadDiagram} zipBusy={saving} imageBusy={drawing} />
      <Button
        variant="secondary"
        icon={<CheckCircleIcon />}
        onClick={validate}
        isLoading={validating}
        isDisabled={validating || saving}
        title={`Validate ${flow.data.name}: check the flow for problems before publishing it`}
      >
        Validate
      </Button>
      <Button
        variant="primary"
        icon={<UploadIcon />}
        onClick={() => setPublishing(true)}
        isDisabled={saving || validating}
        title={`Publish ${flow.data.name} so the pipeline can build it`}
      >
        Publish
      </Button>
    </div>
  );

  // Shown at the right end of Kaoto's tab bar, styled like its tabs. On narrow screens History moves
  // into the More menu (FlowEditorPage.css).
  const actions = (
    <div className="echo-tab-actions echo-no-print">
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
    </div>
  );

  return (
    <div className="echo-flow-editor">
      <PageSection className="echo-flow-editor__header" padding={{ default: 'noPadding' }}>
        <Flex alignItems={{ default: 'alignItemsCenter' }} gap={{ default: 'gapMd' }}>
          {showSpec ? (
            // While Openapi Design is open the breadcrumb names the spec: Openapi / <file name>.
            <FlexItem className="echo-flow-editor__crumbs">
              Openapi /
              <Title headingLevel="h1" size="lg" data-testid="spec-name">
                {(specName === undefined ? flow.data.apiSpec : specName) ?? <strong>&lt;new&gt;</strong>}
              </Title>
            </FlexItem>
          ) : (
            <>
              <FlexItem className="echo-flow-editor__crumbs">
                <Link to={OPEN_FLOW_PATH} state={openFlowState}>
                  Flows
                </Link>{' '}
                /
                <Title headingLevel="h1" size="lg">
                  {flow.data.name}
                </Title>
              </FlexItem>
              <FlexItem>
                <StatusLabel status={flow.data.status} />
              </FlexItem>
            </>
          )}
          {dirty || specDirty ? (
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
          tabBarStart={
            <>
              {fileMenu}
              {apiSpecMenu}
            </>
          }
          tabBarMenus={runMenu}
          canvasToolbarActions={canvasActions}
          designMenuItems={downloadMenuItems({
            name: flow.data.name,
            onDownloadZip: download,
            onDownloadImage: downloadDiagram,
            zipBusy: saving,
            imageBusy: drawing,
          })}
          tabBarActions={actions}
          cover={
            specOpened && (
              <ApiSpecPanel
                ref={specPanel}
                flowId={id}
                flowName={flow.data.name}
                flowDescription={flow.data.description}
                onDirtyChange={setSpecDirty}
                onNameChange={setSpecName}
              />
            )
          }
          coverVisible={showSpec}
          onKaotoViewPicked={() => showView(false)}
          formFields={{
            [OPENAPI_SPECIFICATION_FIELD]: (field) => (
              <SpecificationPicker
                field={field}
                flowId={id}
                flowName={flow.data.name}
                flowDescription={flow.data.description}
                ownSpec={flow.data.apiSpec}
                specDirty={specDirty}
                onSpecReplaced={() =>
                  Promise.all([
                    queryClient.invalidateQueries({ queryKey: ['flow', id], exact: true }),
                    queryClient.invalidateQueries({ queryKey: FLOWS_KEY }),
                    specPanel.current?.reload(),
                  ])
                }
              />
            ),
          }}
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
      {showHistory && <HistoryModal flowId={id} onClose={() => setShowHistory(false)} />}

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

/** The keyboard shortcut shown at the right of a menu item (not part of its name for screen readers). */
export function Shortcut({ keys }: { keys: string }) {
  return (
    <span className="echo-menu-shortcut" aria-hidden>
      {keys}
    </span>
  );
}
