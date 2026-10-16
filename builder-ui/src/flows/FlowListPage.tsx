import {
  Alert,
  Button,
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
  Spinner,
  Title,
  Toolbar,
  ToolbarContent,
  ToolbarItem,
} from '@patternfly/react-core';
import { TrashIcon } from '@patternfly/react-icons';
import { Table, Tbody, Td, Th, Thead, Tr } from '@patternfly/react-table';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { downloadFlow, flowsApi, type FlowSummary } from '../api/flows';
import { FlowFormModal } from './FlowFormModal';
import { UploadFlowModal } from './UploadFlowModal';

export const FLOWS_KEY = ['flows'];

export function StatusLabel({ status }: { status: FlowSummary['status'] }) {
  return status === 'PUBLISHED' ? <Label color="green">Published</Label> : <Label color="blue">Draft</Label>;
}

export function FlowListPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const flows = useQuery({ queryKey: FLOWS_KEY, queryFn: flowsApi.list });
  const [creating, setCreating] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [renaming, setRenaming] = useState<FlowSummary>();
  const [deleting, setDeleting] = useState<FlowSummary>();
  const refresh = () => queryClient.invalidateQueries({ queryKey: FLOWS_KEY });

  const remove = useMutation({
    mutationFn: (id: number) => flowsApi.remove(id),
    onSuccess: () => {
      setDeleting(undefined);
      refresh();
    },
  });

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

  return (
    <>
      <PageSection>
        <Title headingLevel="h1">Flows</Title>
      </PageSection>
      <PageSection isFilled>
        {flows.isPending && <Spinner aria-label="Loading flows" />}
        {flows.isError && <Alert variant="danger" isInline title="Could not load flows" />}
        {flows.data && flows.data.length === 0 && (
          <EmptyState titleText="No flows yet" headingLevel="h2">
            <EmptyStateBody>Create a flow to start designing an integration, or upload one you saved.</EmptyStateBody>
            <EmptyStateFooter>
              <EmptyStateActions>
                {newButton}
                {uploadButton}
              </EmptyStateActions>
            </EmptyStateFooter>
          </EmptyState>
        )}
        {flows.data && flows.data.length > 0 && (
          <>
            <Toolbar>
              <ToolbarContent>
                <ToolbarItem>{newButton}</ToolbarItem>
                <ToolbarItem>{uploadButton}</ToolbarItem>
              </ToolbarContent>
            </Toolbar>
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
                {flows.data.map((flow) => (
                  <Tr key={flow.id}>
                    <Td dataLabel="Name">
                      <Link to={`/flows/${flow.id}`}>{flow.name}</Link>
                    </Td>
                    <Td dataLabel="Description">{flow.description}</Td>
                    <Td dataLabel="Status">
                      <StatusLabel status={flow.status} />
                    </Td>
                    <Td dataLabel="Last changed">
                      {new Date(flow.updatedAt).toLocaleString()} by {flow.updatedBy}
                    </Td>
                    <Td isActionCell>
                      <Button
                        variant="secondary"
                        isDanger
                        size="sm"
                        icon={<TrashIcon />}
                        aria-label={`Delete ${flow.name}`}
                        onClick={() => {
                          remove.reset();
                          setDeleting(flow);
                        }}
                      >
                        Delete
                      </Button>
                    </Td>
                    <Td
                      isActionCell
                      actions={{
                        items: [
                          { title: 'Open', onClick: () => navigate(`/flows/${flow.id}`) },
                          { title: 'Download', onClick: () => downloadFlow(flow.id) },
                          { title: 'Rename', onClick: () => setRenaming(flow) },
                        ],
                      }}
                    />
                  </Tr>
                ))}
              </Tbody>
            </Table>
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
          <ModalHeader title={`Delete ${deleting.name}?`} titleIconVariant="warning" labelId="delete-title" />
          <ModalBody>
            This deletes the flow from the Builder. If it was published, its folder is also removed from Git with a
            commit, so the pipeline stops building it (the old version stays in Git history).
            {remove.isError && <Alert variant="danger" isInline isPlain title={(remove.error as Error).message} />}
          </ModalBody>
          <ModalFooter>
            <Button variant="danger" isLoading={remove.isPending} onClick={() => remove.mutate(deleting.id)}>
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
