import {
  Alert,
  AlertActionCloseButton,
  Button,
  Divider,
  Dropdown,
  DropdownItem,
  DropdownList,
  EmptyState,
  EmptyStateBody,
  MenuToggle,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  PageSection,
} from '@patternfly/react-core';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useBlocker, useNavigate } from 'react-router-dom';
import { flowsApi } from '../api/flows';
import { ApiSpecMenu } from '../apispec/ApiSpecMenu';
import { ApiSpecPanel, type ApiSpecPanelHandle, type UnsavedSpec } from '../apispec/ApiSpecPanel';
import { CopySpecModal } from '../apispec/CopySpecModal';
import { descriptionOf, flowNameFromTitle, formatOf, serialize, titleOf } from '../apispec/apiSpec';
import { naturalOperationIds, renameDirectRoutes } from '../apispec/operationIds';
import { InMemoryFlowFiles } from '../editor/flowFiles';
import { KaotoEditorHost, type KaotoEditorHandle } from '../editor/KaotoEditorHost';
import { useKaotoTabSelected } from '../editor/KaotoTabMenu';
import { useDismissMenu } from '../editor/menuDismiss';
import { DownloadButtons, downloadMenuItems } from './downloads';
import { apiSpecPath, FlowNameTag, Shortcut } from './FlowEditorPage';
import { FlowFormModal } from './FlowFormModal';
import { addOperationRouteMenuItem } from './AddOperationRouteModal';
import { historyMenuItem } from './HistoryModal';
import { FLOWS_KEY, OPEN_FLOW_PATH, type OpenFlowState } from './FlowListPage';
import { OpenTemplateModal } from './OpenTemplateModal';
import { UploadFlowModal } from './UploadFlowModal';
import { useOperationRoutes } from './useOperationRoutes';
import './FlowEditorPage.css';
import './UntitledFlowPage.css';

const UNTITLED_PATH = 'untitled.camel.yaml';
/** The untitled flow's name in Openapi (its starter spec's title): not offered as the flow's name on Save. */
const UNTITLED_NAME = 'untitled';

/** Kaoto reports an empty canvas as one of these. */
const isEmpty = (yaml: string | undefined) => !yaml || ['', '[]'].includes(yaml.trim());

/**
 * Where you land after logging in: a blank canvas with the File menu open. Nothing is stored until
 * you save, which asks for a name and creates the draft then (so logging in leaves no stray drafts,
 * and there is nothing to autosave). Openapi works here too, so a flow can start from its
 * API: the spec stays on screen until that Save, which also asks for its file name.
 */
export function UntitledFlowPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const files = useMemo(() => new InMemoryFlowFiles(), []);
  const editor = useRef<KaotoEditorHandle>(null);
  const [dirty, setDirty] = useState(false);
  // The "No flow is open" card belongs to the canvas; About, Rest and the other views show as usual.
  const designOpen = useKaotoTabSelected('design-tab', true);
  const [fileMenuOpen, setFileMenuOpen] = useState(false);
  useDismissMenu(fileMenuOpen, setFileMenuOpen);
  /** The Save dialog is open; spec is the OpenAPI spec it saves with the flow, if there is one. */
  const [saving, setSaving] = useState<{ spec?: UnsavedSpec }>();
  const specPanel = useRef<ApiSpecPanelHandle>(null);
  const [showSpec, setShowSpec] = useState(false);
  // Opened on first use and then kept (hidden while a Kaoto view is open), as in the flow editor.
  const [specOpened, setSpecOpened] = useState(false);
  const [specDirty, setSpecDirty] = useState(false);
  const [copyingSpec, setCopyingSpec] = useState(false);
  const [creating, setCreating] = useState(false);
  const [openingTemplate, setOpeningTemplate] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<string>();
  /** Set once this canvas is saved as a flow, so moving to it does not ask about unsaved edits. */
  const leaving = useRef(false);

  const onChange = useCallback((yaml: string) => setDirty(!isEmpty(yaml)), []);
  // Methods added in Interface get a route on the canvas, as in the flow editor (only failures are told).
  const operationRoutes = useOperationRoutes(editor, (variant, text) => variant === 'danger' && setMessage(text));
  const openFlowState: OpenFlowState = { from: '/' };

  const openDraft = async (id: number, spec = false) => {
    leaving.current = true;
    await queryClient.invalidateQueries({ queryKey: FLOWS_KEY });
    navigate(spec ? apiSpecPath(id) : `/flows/${id}`);
  };

  /** File > Save and Ctrl+S: asks for the flow's name, and its spec's file name when Openapi has one. */
  const startSave = useCallback(() => setSaving({ spec: specPanel.current?.unsavedSpec() }), []);

  /** Set once the draft is created, so trying again after a failed write does not create it twice. */
  const created = useRef<{ id: number; routeFile: string }>(undefined);

  /**
   * Creates the draft with what is on the canvas (an empty canvas keeps the usual starter route) and
   * the spec in Openapi, stored under specFileName in the format its extension says.
   */
  const saveAsFlow = async (name: string, description: string, specFileName?: string) => {
    // The spec's operations get their natural operationIds, and routes already on the canvas for
    // operations that had other ids (an uploaded spec) follow them (operationIds.ts).
    const spec = saving?.spec;
    const naming = spec && specFileName ? naturalOperationIds(spec.json) : undefined;
    const canvas = await editor.current!.getContent();
    const yaml = naming ? renameDirectRoutes(canvas, naming.renames) : canvas;
    created.current ??= await flowsApi.create(name, description);
    const flow = created.current;
    if (!isEmpty(yaml)) await flowsApi.writeFile(flow.id, flow.routeFile, yaml);
    for (const [path, content] of files.files) await flowsApi.writeFile(flow.id, path, content);
    if (spec && specFileName && naming) {
      await flowsApi.saveApiSpec(flow.id, specFileName, serialize(naming.json, formatOf(specFileName) ?? spec.format));
    }
    setSaving(undefined);
    await openDraft(flow.id, showSpec);
  };

  // Ctrl+S saves and Ctrl+O opens a template (Cmd on a Mac), as in the flow editor.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
      const key = e.key.toLowerCase();
      if (key !== 's' && key !== 'o') return;
      e.preventDefault();
      e.stopPropagation();
      if (document.querySelector('.pf-v6-c-modal-box')) return;
      setFileMenuOpen(false);
      if (key === 's') startSave();
      else setOpeningTemplate(true);
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [startSave]);

  const unsaved = dirty || specDirty;
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      unsaved && !leaving.current && currentLocation.pathname !== nextLocation.pathname,
  );
  useEffect(() => {
    if (!unsaved) return;
    const handler = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [unsaved]);

  const openSpec = () => {
    setSpecOpened(true);
    setShowSpec(true);
  };

  /** Copy From Another Flow: there is no folder to copy into yet, so the copy goes on screen. */
  const copySpec = async ({ flowId, fileName }: { flowId: number; fileName: string }) => {
    const text = await flowsApi.readFile(flowId, fileName);
    if (text === undefined) throw new Error(`${fileName} is not in that flow any more.`);
    specPanel.current?.show(fileName, text);
  };

  /** What the Save dialog offers: the flow and its spec named after the spec's title, e.g. Card API is card-api and card-api.yaml. */
  const saveDialogNames = (spec: UnsavedSpec) => {
    const title = titleOf(spec.json);
    const flowName = title === UNTITLED_NAME ? '' : flowNameFromTitle(title);
    return {
      initialName: flowName,
      initialDescription: descriptionOf(spec.json),
      spec: { initialName: spec.name ?? (flowName ? `${flowName}.${spec.format}` : ''), format: spec.format },
    };
  };

  const downloadDiagram = async () => {
    try {
      await editor.current?.downloadDiagram('untitled.png');
    } catch (e) {
      setMessage(`Could not download the diagram: ${(e as Error).message}`);
    }
  };

  const fileMenu = (
    <div className="echo-tab-actions echo-no-print">
      <OpenOnMount onMount={() => setFileMenuOpen(true)} />
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
          <DropdownItem
            key="save"
            onClick={startSave}
            description="Give this flow a name and save it as a draft"
            aria-keyshortcuts="Control+S"
          >
            Save
            <Shortcut keys="Ctrl+S" />
          </DropdownItem>
          {/* Shown greyed out so the menu matches the flow editor's; they need a saved flow. */}
          <DropdownItem key="save-as" isDisabled description="Save the flow first">
            Save As
          </DropdownItem>
          <DropdownItem key="save-as-template" isDisabled description="Save the flow first">
            Save As Template
          </DropdownItem>
        </DropdownList>
      </Dropdown>
    </div>
  );

  return (
    <div className="echo-flow-editor">
      <PageSection className="echo-flow-editor__header" padding={{ default: 'noPadding' }}>
        {message && (
          <Alert
            className="echo-flow-editor__message"
            variant="danger"
            isInline
            title={message}
            actionClose={<AlertActionCloseButton onClose={() => setMessage(undefined)} />}
          />
        )}
      </PageSection>
      <div className="echo-flow-editor__canvas echo-untitled">
        {/* Replaces Kaoto's "There are no routes defined" card (hidden in UntitledFlowPage.css). */}
        {!dirty && designOpen && !showSpec && (
          <div className="echo-untitled__empty">
            <EmptyState titleText="No flow is open" headingLevel="h2" variant="sm">
              <EmptyStateBody>
                Start a new flow, or open an existing one, from the File menu. To start from the flow's API, pick Interface.
              </EmptyStateBody>
            </EmptyState>
          </div>
        )}
        <KaotoEditorHost
          ref={editor}
          path={UNTITLED_PATH}
          initialContent=""
          files={files}
          loadSpec={async () => {
            const unsaved = specPanel.current?.unsavedSpec();
            return unsaved ? (JSON.parse(unsaved.json) as Record<string, unknown>) : undefined;
          }}
          onChange={onChange}
          tabBarStart={
            <>
              {fileMenu}
              <ApiSpecMenu current={showSpec} onShow={openSpec} panel={specPanel} onCopy={() => setCopyingSpec(true)} />
            </>
          }
          tabBarActions={
            <FlowNameTag name="Untitled flow">
              <span className="echo-flow-editor__autosaved" data-testid="not-saved">
                Not saved yet
              </span>
            </FlowNameTag>
          }
          designMenuItems={[
            addOperationRouteMenuItem(),
            historyMenuItem(),
            <Divider component="li" key="history-divider" />,
            ...downloadMenuItems({ name: 'Untitled flow', onDownloadImage: dirty ? downloadDiagram : undefined }),
          ]}
          cover={
            specOpened && (
              <ApiSpecPanel
                ref={specPanel}
                flowName={UNTITLED_NAME}
                onDirtyChange={setSpecDirty}
                onSaveFlow={startSave}
                onOperationsChanged={operationRoutes.onOperationsChanged}
              />
            )
          }
          coverVisible={showSpec}
          onKaotoViewPicked={() => setShowSpec(false)}
          canvasToolbarActions={
            <div className="echo-canvas-actions echo-no-print">
              {/* Greyed out like Download Flow while the canvas is empty: there is no picture to save. */}
              <DownloadButtons onDownloadImage={dirty ? downloadDiagram : undefined} />
            </div>
          }
        />
      </div>

      {saving && (
        <FlowFormModal
          title="Save flow"
          submitLabel="Save"
          {...(saving.spec && saveDialogNames(saving.spec))}
          onClose={() => setSaving(undefined)}
          onSubmit={saveAsFlow}
        />
      )}
      {operationRoutes.dialog}
      {copyingSpec && (
        <CopySpecModal specDirty={specDirty} onClose={() => setCopyingSpec(false)} onCopy={copySpec} />
      )}
      {creating && (
        <FlowFormModal
          title="New flow"
          submitLabel="Create"
          onClose={() => setCreating(false)}
          onSubmit={async (name, description) => openDraft((await flowsApi.create(name, description)).id)}
        />
      )}
      {openingTemplate && (
        <OpenTemplateModal onClose={() => setOpeningTemplate(false)} onOpened={(created) => openDraft(created.id)} />
      )}
      {uploading && (
        <UploadFlowModal onClose={() => setUploading(false)} onUploaded={(created) => openDraft(created.id)} />
      )}

      {blocker.state === 'blocked' && (
        <Modal isOpen variant="small" onClose={() => blocker.reset()} aria-labelledby="unsaved-title">
          <ModalHeader title="Leave without saving?" titleIconVariant="warning" labelId="unsaved-title" />
          <ModalBody>
            {dirty ? 'What you drew on this canvas has not been saved.' : 'The OpenAPI spec you made has not been saved.'}
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
 * Opens the File menu once its toggle is on the page. The menu sits in Kaoto's tab bar, which Kaoto
 * draws after the page, so opening it straight away would place it with nothing to hang from.
 */
function OpenOnMount({ onMount }: { onMount(): void }) {
  const onMountRef = useRef(onMount);
  onMountRef.current = onMount;
  useEffect(() => {
    const frame = requestAnimationFrame(() => onMountRef.current());
    return () => cancelAnimationFrame(frame);
  }, []);
  return null;
}
