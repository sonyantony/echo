import {
  Alert,
  AlertActionCloseButton,
  Button,
  Divider,
  Dropdown,
  DropdownItem,
  DropdownList,
  Flex,
  FlexItem,
  MenuToggle,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  PageSection,
  Title,
} from '@patternfly/react-core';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useBlocker, useNavigate } from 'react-router-dom';
import { flowsApi } from '../api/flows';
import { InMemoryFlowFiles } from '../editor/flowFiles';
import { KaotoEditorHost, type KaotoEditorHandle } from '../editor/KaotoEditorHost';
import { Shortcut } from './FlowEditorPage';
import { FlowFormModal } from './FlowFormModal';
import { FLOWS_KEY, OPEN_FLOW_PATH, type OpenFlowState } from './FlowListPage';
import { OpenTemplateModal } from './OpenTemplateModal';
import { UploadFlowModal } from './UploadFlowModal';
import './FlowEditorPage.css';

const UNTITLED_PATH = 'untitled.camel.yaml';

/** Kaoto reports an empty canvas as one of these. */
const isEmpty = (yaml: string | undefined) => !yaml || ['', '[]'].includes(yaml.trim());

/**
 * Where you land after logging in: a blank canvas with the File menu open. Nothing is stored until
 * you save, which asks for a name and creates the draft then (so logging in leaves no stray drafts,
 * and there is nothing to autosave).
 */
export function UntitledFlowPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const files = useMemo(() => new InMemoryFlowFiles(), []);
  const editor = useRef<KaotoEditorHandle>(null);
  const [dirty, setDirty] = useState(false);
  const [fileMenuOpen, setFileMenuOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);
  const [openingTemplate, setOpeningTemplate] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<string>();
  /** Set once this canvas is saved as a flow, so moving to it does not ask about unsaved edits. */
  const leaving = useRef(false);

  const onChange = useCallback((yaml: string) => setDirty(!isEmpty(yaml)), []);
  const openFlowState: OpenFlowState = { from: '/' };

  const openDraft = async (id: number) => {
    leaving.current = true;
    await queryClient.invalidateQueries({ queryKey: FLOWS_KEY });
    navigate(`/flows/${id}`);
  };

  /** Creates the draft with what is on the canvas (an empty canvas keeps the usual starter route). */
  const saveAsFlow = async (name: string, description: string) => {
    const yaml = await editor.current!.getContent();
    const flow = await flowsApi.create(name, description);
    if (!isEmpty(yaml)) await flowsApi.writeFile(flow.id, flow.routeFile, yaml);
    for (const [path, content] of files.files) await flowsApi.writeFile(flow.id, path, content);
    setSaving(false);
    await openDraft(flow.id);
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
      if (key === 's') setSaving(true);
      else setOpeningTemplate(true);
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, []);

  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirty && !leaving.current && currentLocation.pathname !== nextLocation.pathname,
  );
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

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
            onClick={() => setSaving(true)}
            description="Give this canvas a name and save it as a draft"
            aria-keyshortcuts="Control+S"
          >
            Save
            <Shortcut keys="Ctrl+S" />
          </DropdownItem>
          <Divider component="li" key="save-divider" />
          <DropdownItem key="png" onClick={downloadDiagram} description="A picture of the whole flow diagram">
            Download diagram (.png)
          </DropdownItem>
        </DropdownList>
      </Dropdown>
    </div>
  );

  return (
    <div className="echo-flow-editor">
      <PageSection className="echo-flow-editor__header" padding={{ default: 'noPadding' }}>
        <Flex alignItems={{ default: 'alignItemsCenter' }} gap={{ default: 'gapMd' }}>
          <FlexItem>
            <Title headingLevel="h1" size="lg">
              Untitled flow
            </Title>
          </FlexItem>
          <FlexItem className="echo-flow-editor__autosaved" data-testid="not-saved">
            Not saved yet
          </FlexItem>
        </Flex>
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
      <div className="echo-flow-editor__canvas">
        <KaotoEditorHost
          ref={editor}
          path={UNTITLED_PATH}
          initialContent=""
          files={files}
          onChange={onChange}
          tabBarStart={fileMenu}
        />
      </div>

      {saving && (
        <FlowFormModal title="Save flow" submitLabel="Save" onClose={() => setSaving(false)} onSubmit={saveAsFlow} />
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
          <ModalBody>What you drew on this canvas has not been saved.</ModalBody>
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
