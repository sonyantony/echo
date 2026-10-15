import { Alert, EmptyState, Modal, ModalBody, ModalHeader, Spinner } from '@patternfly/react-core';
import { Table, Tbody, Td, Th, Thead, Tr } from '@patternfly/react-table';
import { useQuery } from '@tanstack/react-query';
import { flowHistory } from '../api/flows';

export function HistoryModal({ flowId, onClose }: { flowId: number; onClose(): void }) {
  const history = useQuery({ queryKey: ['flow', flowId, 'history'], queryFn: () => flowHistory(flowId) });
  return (
    <Modal isOpen variant="medium" onClose={onClose} aria-labelledby="history-title">
      <ModalHeader title="Publish history" labelId="history-title" />
      <ModalBody>
        {history.isPending && <Spinner aria-label="Loading history" />}
        {history.isError && <Alert variant="danger" isInline title="Could not load the history" />}
        {history.data?.length === 0 && <EmptyState titleText="Not published yet" headingLevel="h3" />}
        {!!history.data?.length && (
          <Table aria-label="Publish history" variant="compact">
            <Thead>
              <Tr>
                <Th>When</Th>
                <Th>Who</Th>
                <Th>Commit</Th>
                <Th>Message</Th>
              </Tr>
            </Thead>
            <Tbody>
              {history.data.map((h) => (
                <Tr key={h.commitSha + h.publishedAt}>
                  <Td dataLabel="When">{new Date(h.publishedAt).toLocaleString()}</Td>
                  <Td dataLabel="Who">{h.publishedBy}</Td>
                  <Td dataLabel="Commit">
                    <code>{h.commitSha.slice(0, 8)}</code> on {h.branch}
                  </Td>
                  <Td dataLabel="Message">{h.message}</Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        )}
      </ModalBody>
    </Modal>
  );
}
