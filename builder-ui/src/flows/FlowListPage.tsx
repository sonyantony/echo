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
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
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

/**
 * Every published flow gets a row. A Builder flow gets its own row unless it is exactly what is
 * published (then the Published row stands for both).
 */
function listRows(flows: FlowSummary[], published: PublishedFlowSummary[]): Row[] {
  const sameAsPublished = new Set(published.filter((p) => p.flowId != null && !p.draftChanged).map((p) => p.flowId));
  const rows: Row[] = [
    ...published.map((p): Row => ({ kind: 'published', published: p })),
    ...flows.filter((f) => !sameAsPublished.has(f.id)).map((f): Row => ({ kind: 'draft', flow: f })),
  ];
  const name = (r: Row) => (r.kind === 'draft' ? r.flow.name : r.published.name);
  return rows.sort((a, b) => name(a).localeCompare(name(b)) || (a.kind === 'published' ? -1 : 1));
}

/** True when the row shows as Published (a Published row, or a draft that matches what was published). */
const isPublished = (r: Row) => r.kind === 'published' || r.flow.status === 'PUBLISHED';

/** Case-insensitive match on the flow's name or description. */
function matches(r: Row, search: string) {
  const { name, description } = r.kind === 'draft' ? r.flow : r.published;
  const text = search.trim().toLowerCase();
  return !text || name.toLowerCase().includes(text) || (description ?? '').toLowerCase().includes(text);
}

export function StatusLabel({ status }: { status: FlowSummary['status'] }) {
  return status === 'PUBLISHED' ? <Label color="green">Published</Label> : <Label color="blue">Draft</Label>;
}

export function FlowListPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const flows = useQuery({ queryKey: FLOWS_KEY, queryFn: flowsApi.list });
  const published = useQuery({ queryKey: PUBLISHED_KEY, queryFn: publishedFlowsApi.list, retry: false });
  const [creating, setCreating] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [openingTemplate, setOpeningTemplate] = useState(false);
  const [renaming, setRenaming] = useState<FlowSummary>();
  const [deleting, setDeleting] = useState<Row>();
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
  const openPublished = useMutation({
    mutationFn: async (p: PublishedFlowSummary) => p.flowId ?? (await publishedFlowsApi.createDraft(p.name)).id,
    onSuccess: async (id) => {
      await refresh();
      navigate(`/flows/${id}`);
    },
  });

  const rows = flows.data ? listRows(flows.data, published.data ?? []) : undefined;
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
      Open Template
    </Button>
  );

  return (
    <>
      <PageSection>
        <Title headingLevel="h1">Flows</Title>
      </PageSection>
      <PageSection isFilled>
        {flows.isPending && <Spinner aria-label="Loading flows" />}
        {flows.isError && <Alert variant="danger" isInline title="Could not load flows" />}
        {published.isError && (
          <Alert variant="warning" isInline title="Could not read the published flows">
            {(published.error as Error).message} Only the drafts in the Builder are shown.
          </Alert>
        )}
        {openPublished.isError && (
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
              </EmptyStateActions>
            </EmptyStateFooter>
          </EmptyState>
        )}
        {rows && rows.length > 0 && (
          <>
            <Toolbar>
              <ToolbarContent>
                <ToolbarItem>{newButton}</ToolbarItem>
                <ToolbarItem>{templateButton}</ToolbarItem>
                <ToolbarItem>{uploadButton}</ToolbarItem>
                <ToolbarGroup align={{ default: 'alignEnd' }} alignItems="center">
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
                          <Link to={`/flows/${row.flow.id}`}>{row.flow.name}</Link>
                        </Td>
                        <Td dataLabel="Description">{row.flow.description}</Td>
                        <Td dataLabel="Status">
                          <StatusLabel status={row.flow.status} />
                        </Td>
                        <Td dataLabel="Last changed">
                          {new Date(row.flow.updatedAt).toLocaleString()} by {row.flow.updatedBy}
                        </Td>
                        <Td isActionCell>{deleteButton(row, row.flow.name)}</Td>
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
                          {row.published.flowId != null && !row.published.draftChanged ? (
                            <Link to={`/flows/${row.published.flowId}`}>{row.published.name}</Link>
                          ) : (
                            row.published.name
                          )}
                        </Td>
                        <Td dataLabel="Description">{row.published.description}</Td>
                        <Td dataLabel="Status">
                          <Label color="green">
                            Published{row.published.version != null && ` v${row.published.version}`}
                          </Label>
                        </Td>
                        <Td dataLabel="Last changed">
                          {row.published.publishedAt
                            ? `${new Date(row.published.publishedAt).toLocaleString()} by ${row.published.publishedBy ?? 'unknown'}`
                            : 'Added outside the Builder'}
                        </Td>
                        <Td isActionCell>{deleteButton(row, row.published.name)}</Td>
                        <Td
                          isActionCell
                          actions={{
                            items: [
                              ...(row.published.draftChanged
                                ? []
                                : [
                                    {
                                      title: row.published.flowId != null ? 'Open' : 'Edit as draft',
                                      onClick: () => openPublished.mutate(row.published),
                                    },
                                  ]),
                              { title: 'Download', onClick: () => downloadPublishedFlow(row.published.name) },
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
            navigate(`/flows/${flow.id}`);
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
          initialName={renaming.name}
          initialDescription={renaming.description}
          onClose={() => setRenaming(undefined)}
          onSubmit={async (name, description) => {
            await flowsApi.update(renaming.id, name, description);
            setRenaming(undefined);
            await refresh();
          }}
        />
      )}
      {deleting && (
        <Modal isOpen variant="small" onClose={() => setDeleting(undefined)} aria-labelledby="delete-title">
          <ModalHeader
            title={`Delete ${deleting.kind === 'draft' ? deleting.flow.name : deleting.published.name}?`}
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
