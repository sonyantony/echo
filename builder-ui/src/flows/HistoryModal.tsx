import { Alert, DropdownItem, EmptyState, Modal, ModalBody, ModalHeader, Spinner } from '@patternfly/react-core';
import { Table, Tbody, Td, Th, Thead, Tr } from '@patternfly/react-table';
import { useQuery } from '@tanstack/react-query';
import { flowHistory } from '../api/flows';
import { targetLabel } from './publishSummary';

/** The Flow menu's History item; greyed out (no `onOpen`) until the flow has been named and saved. */
export function historyMenuItem(onOpen?: () => void) {
  return (
    <DropdownItem
      key="history"
      onClick={onOpen}
      isDisabled={!onOpen}
      description={onOpen ? 'When and where the flow was published' : 'Save the flow first'}
    >
      History
    </DropdownItem>
  );
}

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
                <Th>Where</Th>
                <Th>Message</Th>
              </Tr>
            </Thead>
            <Tbody>
              {history.data.map((h) => (
                <Tr key={h.publishedAt + h.message}>
                  <Td dataLabel="When">{new Date(h.publishedAt).toLocaleString()}</Td>
                  <Td dataLabel="Who">{h.publishedBy}</Td>
                  <Td dataLabel="Where">
                    {h.targets.map((t) => (
                      <div key={t.target}>{t.error ? `${t.name} failed: ${t.error}` : targetLabel(t)}</div>
                    ))}
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
