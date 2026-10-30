import {
  Alert,
  Button,
  Checkbox,
  EmptyState,
  EmptyStateActions,
  EmptyStateBody,
  EmptyStateFooter,
  Label,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  PageSection,
  SearchInput,
  Spinner,
  Title,
  Toolbar,
  ToolbarContent,
  ToolbarGroup,
  ToolbarItem,
} from '@patternfly/react-core';
import { TrashIcon } from '@patternfly/react-icons';
import { Table, Tbody, Td, Th, Thead, Tr } from '@patternfly/react-table';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  downloadFlow,
  downloadPublishedFlow,
  flowsApi,
  publishedFlowsApi,
  type FlowSummary,
  type PublishedFlowSummary,
} from '../api/flows';
import { FlowFormModal } from './FlowFormModal';
import { OpenTemplateModal } from './OpenTemplateModal';
import { UploadFlowModal } from './UploadFlowModal';

export const FLOWS_KEY = ['flows'];
/** Under FLOWS_KEY, so refreshing the flows also refreshes what is published. */
const PUBLISHED_KEY = [...FLOWS_KEY, 'published'];

/** One row of the list: a Builder flow, or a flow as it is in the publish target. */
type Row = { kind: 'draft'; flow: FlowSummary } | { kind: 'published'; published: PublishedFlowSummary };

/** Every published flow and every Builder flow gets its own row; a flow's published row comes first. */
function listRows(flows: FlowSummary[], published: PublishedFlowSummary[]): Row[] {
  const rows: Row[] = [
    ...published.map((p): Row => ({ kind: 'published', published: p })),
    ...flows.map((f): Row => ({ kind: 'draft', flow: f })),
  ];
  return rows.sort(
    (a, b) =>
      displayName(a).localeCompare(displayName(b), undefined, { sensitivity: 'base' }) ||
      id(a).localeCompare(id(b)) ||
      (a.kind === 'published' ? -1 : 1),
  );
}

/** The row's flow ID: its folder in Git. */
const id = (r: Row) => (r.kind === 'draft' ? r.flow.name : r.published.name);
/** What users call the row's flow. */
const displayName = (r: Row) => (r.kind === 'draft' ? r.flow.displayName : r.published.displayName || r.published.name);

/** True when the row shows as Published (a Published row, or a draft that matches what was published). */
const isPublished = (r: Row) => r.kind === 'published' || r.flow.status === 'PUBLISHED';

/** Case-insensitive match on the flow's name, ID or description. */
function matches(r: Row, search: string) {
  const { description } = r.kind === 'draft' ? r.flow : r.published;
  const text = search.trim().toLowerCase();
  return !text || [displayName(r), id(r), description ?? ''].some((t) => t.toLowerCase().includes(text));
}

/** The flow's name, with its ID (Git folder) under it when the two differ. */
function NameCell({ row, children }: { row: Row; children: ReactNode }) {
  const name = displayName(row);
  return (
    <>
      {children}
      {name !== id(row) && <div className="echo-flow-id">ID: {id(row)}</div>}
    </>
  );
}

export function StatusLabel({ status }: { status: FlowSummary['status'] }) {
  return status === 'PUBLISHED' ? <Label color="green">Published</Label> : <Label color="blue">Draft</Label>;
}

/** Address of the Open Flow page (the list of flows). */
export const OPEN_FLOW_PATH = '/flows';
/** The flow editor's address with the flow's API spec open in it (where a new flow opens). */
export const apiSpecPath = (id: number) => `/flows/${id}/api`;

/** The flow last opened in the editor, kept per browser so Cancel can return to it after a reload. */
const LAST_FLOW_KEY = 'echo.lastFlowId';

export function rememberLastFlow(id: number) {
  try {
    localStorage.setItem(LAST_FLOW_KEY, String(id));
  } catch {
    // Storage blocked: Cancel then falls back to the start page.
  }
}

function lastFlowId(): number | undefined {
  try {
    const id = Number(localStorage.getItem(LAST_FLOW_KEY));
    return id > 0 ? id : undefined;
  } catch {
    return undefined;
  }
}

/** Router state the editor passes when it sends you here, so Cancel can take you back. */
export interface OpenFlowState {
  from?: string;
  /** Came from File > Manage Flows: the same page, titled Manage Flows. */
  manage?: boolean;
}

export function FlowListPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const routerState = useLocation().state as OpenFlowState | null;
  const cameFrom = routerState?.from;
  const flows = useQuery({ queryKey: FLOWS_KEY, queryFn: flowsApi.list });
  const published = useQuery({ queryKey: PUBLISHED_KEY, queryFn: publishedFlowsApi.list, retry: false });
  const [creating, setCreating] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [openingTemplate, setOpeningTemplate] = useState(false);
  const [renaming, setRenaming] = useState<FlowSummary>();
  const [deleting, setDeleting] = useState<Row>();
  /** A published flow about to be disabled: confirm first, as the next pipeline build drops it. */
  const [disabling, setDisabling] = useState<PublishedFlowSummary>();
  /** A published flow whose draft in the Builder has other changes: ask which one to open. */
  const [choosing, setChoosing] = useState<PublishedFlowSummary>();
  const [search, setSearch] = useState('');
  const [showPublished, setShowPublished] = useState(true);
  const [showUnpublished, setShowUnpublished] = useState(true);
  const refresh = () => queryClient.invalidateQueries({ queryKey: FLOWS_KEY });

  const remove = useMutation({
    mutationFn: (row: Row) =>
      row.kind === 'draft' ? flowsApi.remove(row.flow.id) : publishedFlowsApi.remove(row.published.name),
    onSuccess: () => {
      setDeleting(undefined);
      refresh();
    },
  });
  const toggleDisabled = useMutation({
    mutationFn: ({ name, disabled }: { name: string; disabled: boolean }) =>
      publishedFlowsApi.setDisabled(name, disabled),
    onSuccess: () => {
      setDisabling(undefined);
      refresh();
    },
  });
  /** Loads the published version into the editor: as a new draft, or over the existing one with replace. */
  const openPublished = useMutation({
    mutationFn: async ({ published: p, replace }: { published: PublishedFlowSummary; replace: boolean }) =>
      p.flowId != null && !replace ? p.flowId : (await publishedFlowsApi.createDraft(p.name, replace)).id,
    onSuccess: async (id) => {
      setChoosing(undefined);
      await refresh();
      navigate(`/flows/${id}`);
    },
  });
  /** A published row opens its draft when that is the same, else asks first; never overwrites silently. */
  const open = (p: PublishedFlowSummary) => {
    if (p.flowId != null && p.draftChanged) {
      openPublished.reset();
      setChoosing(p);
    } else {
      openPublished.mutate({ published: p, replace: false });
    }
  };

  const rows = flows.data ? listRows(flows.data, published.data ?? []) : undefined;
  /** Back to where you came from; else to the flow last worked on, if it still exists; else the start page. */
  const cancel = () => {
    const last = lastFlowId();
    if (cameFrom) navigate(cameFrom);
    else if (last && flows.data?.some((f) => f.id === last)) navigate(`/flows/${last}`);
    else navigate('/');
  };
  const shownRows = rows?.filter((r) => (isPublished(r) ? showPublished : showUnpublished) && matches(r, search)) ?? [];
  const publishedFor = (flowId: number) => published.data?.find((p) => p.flowId === flowId);
  const deleteButton = (row: Row, name: string) => (
    <Button
      variant="secondary"
      isDanger
      size="sm"
      icon={<TrashIcon />}
      aria-label={`Delete ${name}`}
      onClick={() => {
        remove.reset();
        setDeleting(row);
      }}
    >
      Delete
    </Button>
  );

  const newButton = (
    <Button variant="primary" onClick={() => setCreating(true)}>
      New flow
    </Button>
  );
  const uploadButton = (
    <Button variant="secondary" onClick={() => setUploading(true)}>
      Upload flow
    </Button>
  );
  const templateButton = (
    <Button variant="secondary" onClick={() => setOpeningTemplate(true)}>
      Open Flow Template
    </Button>
  );

  return (
    <>
      <PageSection>
        <Title headingLevel="h1">{routerState?.manage ? 'Manage Flows' : 'Open Flow'}</Title>
      </PageSection>
      <PageSection isFilled>
        {flows.isPending && <Spinner aria-label="Loading flows" />}
        {flows.isError && <Alert variant="danger" isInline title="Could not load flows" />}
        {published.isError && (
          <Alert variant="warning" isInline title="Could not read the published flows">
            {(published.error as Error).message} Only the drafts in the Builder are shown.
          </Alert>
        )}
        {toggleDisabled.isError && !disabling && (
          <Alert variant="danger" isInline title={(toggleDisabled.error as Error).message} />
        )}
        {openPublished.isError && !choosing && (
          <Alert variant="danger" isInline title={(openPublished.error as Error).message} />
        )}
        {rows && rows.length === 0 && (
          <EmptyState titleText="No flows yet" headingLevel="h2">
            <EmptyStateBody>Create a flow to start designing an integration, or upload one you saved.</EmptyStateBody>
            <EmptyStateFooter>
              <EmptyStateActions>
                {newButton}
                {templateButton}
                {uploadButton}
                <Button variant="secondary" onClick={cancel}>
                  Cancel
                </Button>
              </EmptyStateActions>
            </EmptyStateFooter>
          </EmptyState>
        )}
        {rows && rows.length > 0 && (
          <>
            <Toolbar>
              <ToolbarContent>
                <ToolbarGroup alignItems="center">
                  <ToolbarItem>
                    <SearchInput
                      aria-label="Search flows"
                      placeholder="Search flows"
                      value={search}
                      onChange={(_e, value) => setSearch(value)}
                      onClear={() => setSearch('')}
                    />
                  </ToolbarItem>
                  <ToolbarItem>
                    <Checkbox
                      id="filter-published"
                      label="Published"
                      isChecked={showPublished}
                      onChange={(_e, checked) => setShowPublished(checked)}
                    />
                  </ToolbarItem>
                  <ToolbarItem>
                    <Checkbox
                      id="filter-unpublished"
                      label="Unpublished"
                      isChecked={showUnpublished}
                      onChange={(_e, checked) => setShowUnpublished(checked)}
                    />
                  </ToolbarItem>
                  <ToolbarItem>
                    <Button variant="secondary" onClick={cancel}>
                      Cancel
                    </Button>
                  </ToolbarItem>
                </ToolbarGroup>
              </ToolbarContent>
            </Toolbar>
            {shownRows.length === 0 ? (
              <EmptyState titleText="No flows match" headingLevel="h2" variant="sm">
                <EmptyStateBody>
                  {showPublished || showUnpublished
                    ? 'Try a different search.'
                    : 'Tick Published or Unpublished to see flows.'}
                </EmptyStateBody>
              </EmptyState>
            ) : (
              <Table aria-label="Flows" variant="compact">
                <Thead>
                  <Tr>
                    <Th>Name</Th>
                    <Th>Description</Th>
                    <Th>Status</Th>
                    <Th>Where</Th>
                    <Th>Last changed</Th>
                    <Th screenReaderText="Delete" />
                    <Th screenReaderText="Actions" />
                  </Tr>
                </Thead>
                <Tbody>
                  {shownRows.map((row) =>
                    row.kind === 'draft' ? (
                      <Tr key={`draft-${row.flow.id}`}>
                        <Td dataLabel="Name">
                          <NameCell row={row}>
                            <Link to={`/flows/${row.flow.id}`}>{row.flow.displayName}</Link>
                          </NameCell>
                        </Td>
                        <Td dataLabel="Description">{row.flow.description}</Td>
                        <Td dataLabel="Status">
                          <StatusLabel status={row.flow.status} />
                        </Td>
                        <Td dataLabel="Where">Builder</Td>
                        <Td dataLabel="Last changed">
                          {new Date(row.flow.updatedAt).toLocaleString()} by {row.flow.updatedBy}
                        </Td>
                        <Td isActionCell>{deleteButton(row, row.flow.displayName)}</Td>
                        <Td
                          isActionCell
                          actions={{
                            items: [
                              { title: 'Open', onClick: () => navigate(`/flows/${row.flow.id}`) },
                              { title: 'Download', onClick: () => downloadFlow(row.flow.id) },
                              { title: 'Rename', onClick: () => setRenaming(row.flow) },
                            ],
                          }}
                        />
                      </Tr>
                    ) : (
                      <Tr key={`published-${row.published.name}`}>
                        <Td dataLabel="Name">
                          <NameCell row={row}>
                            <Button variant="link" isInline className="echo-text-link" onClick={() => open(row.published)}>
                              {displayName(row)}
                            </Button>
                          </NameCell>
                        </Td>
                        <Td dataLabel="Description">{row.published.description}</Td>
                        <Td dataLabel="Status">
                          <Label color="green">
                            Published{row.published.version != null && ` v${row.published.version}`}
                          </Label>
                          {row.published.disabled && (
                            <>
                              {' '}
                              <Label color="grey">Disabled</Label>
                            </>
                          )}
                        </Td>
                        <Td dataLabel="Where">{row.published.target ?? 'Git'}</Td>
                        <Td dataLabel="Last changed">
                          {row.published.publishedAt
                            ? `${new Date(row.published.publishedAt).toLocaleString()} by ${row.published.publishedBy ?? 'unknown'}`
                            : 'Added outside the Builder'}
                        </Td>
                        <Td isActionCell>{deleteButton(row, displayName(row))}</Td>
                        <Td
                          isActionCell
                          actions={{
                            items: [
                              { title: 'Open', onClick: () => open(row.published) },
                              { title: 'Download', onClick: () => downloadPublishedFlow(row.published.name) },
                              row.published.disabled
                                ? {
                                    title: 'Enable',
                                    onClick: () =>
                                      toggleDisabled.mutate({ name: row.published.name, disabled: false }),
                                  }
                                : {
                                    title: 'Disable',
                                    onClick: () => {
                                      toggleDisabled.reset();
                                      setDisabling(row.published);
                                    },
                                  },
                            ],
                          }}
                        />
                      </Tr>
                    ),
                  )}
                </Tbody>
              </Table>
            )}
          </>
        )}
      </PageSection>

      {creating && (
        <FlowFormModal
          title="New flow"
          submitLabel="Create"
          onClose={() => setCreating(false)}
          onSubmit={async (name, description) => {
            const flow = await flowsApi.create(name, description);
            setCreating(false);
            await refresh();
            // A new flow starts from its interface: Interface Specs > Design.
            navigate(apiSpecPath(flow.id));
          }}
        />
      )}
      {uploading && (
        <UploadFlowModal
          onClose={() => setUploading(false)}
          onUploaded={async (flow) => {
            setUploading(false);
            await refresh();
            navigate(`/flows/${flow.id}`);
          }}
        />
      )}
      {openingTemplate && (
        <OpenTemplateModal
          onClose={() => setOpeningTemplate(false)}
          onOpened={async (flow) => {
            setOpeningTemplate(false);
            await refresh();
            navigate(`/flows/${flow.id}`);
          }}
        />
      )}
      {renaming && (
        <FlowFormModal
          title="Rename flow"
          submitLabel="Save"
          initialName={renaming.displayName}
          initialDescription={renaming.description}
          renaming={{ id: renaming.id, name: renaming.name }}
          onClose={() => setRenaming(undefined)}
          onSubmit={async (name, description) => {
            await flowsApi.update(renaming.id, name, description);
            setRenaming(undefined);
            await refresh();
          }}
        />
      )}
      {choosing && (
        <Modal isOpen variant="small" onClose={() => setChoosing(undefined)} aria-labelledby="choose-title">
          <ModalHeader
            title={`Open ${choosing.displayName || choosing.name} from ${choosing.target ?? 'Git'}?`}
            titleIconVariant="warning"
            labelId="choose-title"
          />
          <ModalBody>
            Your draft of this flow in the Builder has changes that are not in {choosing.target ?? 'Git'}. Replace the
            draft with the {choosing.target ?? 'Git'} version (your unpublished changes are lost), or open your draft as
            it is.
            {openPublished.isError && (
              <Alert variant="danger" isInline isPlain title={(openPublished.error as Error).message} />
            )}
          </ModalBody>
          <ModalFooter>
            <Button
              variant="danger"
              isLoading={openPublished.isPending}
              onClick={() => openPublished.mutate({ published: choosing, replace: true })}
            >
              Replace draft with {choosing.target ?? 'Git'} version
            </Button>
            <Button variant="secondary" onClick={() => navigate(`/flows/${choosing.flowId}`)}>
              Open my draft
            </Button>
            <Button variant="link" onClick={() => setChoosing(undefined)}>
              Cancel
            </Button>
          </ModalFooter>
        </Modal>
      )}
      {disabling && (
        <Modal isOpen variant="small" onClose={() => setDisabling(undefined)} aria-labelledby="disable-title">
          <ModalHeader title={`Disable ${disabling.displayName || disabling.name}?`} titleIconVariant="warning" labelId="disable-title" />
          <ModalBody>
            The flow stays in {disabling.target ?? 'Git'}, but the pipeline leaves it out of the images it builds from
            now on, so it stops running once the next build is deployed. Publishing a new version keeps it disabled; use
            Enable to build it again.
            {toggleDisabled.isError && (
              <Alert variant="danger" isInline isPlain title={(toggleDisabled.error as Error).message} />
            )}
          </ModalBody>
          <ModalFooter>
            <Button
              variant="danger"
              isLoading={toggleDisabled.isPending}
              onClick={() => toggleDisabled.mutate({ name: disabling.name, disabled: true })}
            >
              Disable
            </Button>
            <Button variant="link" onClick={() => setDisabling(undefined)}>
              Cancel
            </Button>
          </ModalFooter>
        </Modal>
      )}
      {deleting && (
        <Modal isOpen variant="small" onClose={() => setDeleting(undefined)} aria-labelledby="delete-title">
          <ModalHeader
            title={`Delete ${displayName(deleting)}?`}
            titleIconVariant="warning"
            labelId="delete-title"
          />
          <ModalBody>
            {deleteMessage(deleting, deleting.kind === 'draft' ? publishedFor(deleting.flow.id) : undefined)}
            {remove.isError && <Alert variant="danger" isInline isPlain title={(remove.error as Error).message} />}
          </ModalBody>
          <ModalFooter>
            <Button variant="danger" isLoading={remove.isPending} onClick={() => remove.mutate(deleting)}>
              Delete
            </Button>
            <Button variant="link" onClick={() => setDeleting(undefined)}>
              Cancel
            </Button>
          </ModalFooter>
        </Modal>
      )}
    </>
  );
}

const FROM_TARGETS =
  'is removed from every publish target, so the pipeline stops building it (Git keeps the old version in its history).';

function deleteMessage(row: Row, publishedVersion: PublishedFlowSummary | undefined) {
  if (row.kind === 'published') {
    return row.published.flowId != null
      ? `The flow ${FROM_TARGETS} Its draft in the Builder is deleted too.`
      : `The flow ${FROM_TARGETS}`;
  }
  return publishedVersion
    ? `This deletes the draft from the Builder, and the published version ${FROM_TARGETS}`
    : 'This deletes the draft from the Builder. It was never published, so the publish targets are not changed.';
}
