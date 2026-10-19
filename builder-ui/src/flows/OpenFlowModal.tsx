import {
  Alert,
  Button,
  Form,
  FormGroup,
  FormHelperText,
  FormSelect,
  FormSelectOption,
  HelperText,
  HelperTextItem,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  Spinner,
} from '@patternfly/react-core';
import { useQuery } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { flowsApi, publishedFlowsApi } from '../api/flows';
import { FLOWS_KEY } from './FlowListPage';

interface Props {
  /** Unpublished: drafts in the Builder with changes not yet published. Published: flows in Git (or S3). */
  kind: 'unpublished' | 'published';
  /** The flow open in the editor, left out of the list. */
  currentId: number;
  onOpen(flowId: number): void;
  onClose(): void;
}

interface Choice {
  name: string;
  hint?: string | null;
  /** The Builder flow to open; unset when a published flow has to be copied into the Builder first. */
  flowId?: number | null;
}

/** File > Open Flow: picks a saved draft, or a published flow, and opens it in the editor. */
export function OpenFlowModal({ kind, currentId, onOpen, onClose }: Props) {
  const published = kind === 'published';
  const choices = useQuery({
    queryKey: [...FLOWS_KEY, 'open', kind],
    queryFn: async (): Promise<Choice[]> =>
      published
        ? (await publishedFlowsApi.list()).map((p) => ({
            name: p.name,
            flowId: p.flowId,
            hint: p.draftChanged
              ? 'This flow has newer unpublished changes in the Builder; those open.'
              : p.description,
          }))
        : (await flowsApi.list())
            .filter((f) => f.status === 'DRAFT')
            .map((f) => ({ name: f.name, flowId: f.id, hint: f.description })),
    select: (all) => all.filter((c) => c.flowId !== currentId).sort((a, b) => a.name.localeCompare(b.name)),
    retry: false,
  });
  const [picked, setPicked] = useState('');
  const [error, setError] = useState<string>();
  const [opening, setOpening] = useState(false);
  const chosen = choices.data?.find((c) => c.name === picked) ?? choices.data?.[0];
  const title = published ? 'Open Flow (Published)' : 'Open Flow (Unpublished)';

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!chosen) return;
    setOpening(true);
    setError(undefined);
    try {
      onOpen(chosen.flowId ?? (await publishedFlowsApi.createDraft(chosen.name)).id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setOpening(false);
    }
  };

  return (
    <Modal isOpen variant="small" onClose={onClose} aria-labelledby="open-flow-title">
      <ModalHeader
        title={title}
        labelId="open-flow-title"
        description={
          published
            ? 'Open a flow as it is published. It opens as a draft you can edit and publish again.'
            : 'Open a flow saved in the Builder that has changes not yet published.'
        }
      />
      <ModalBody>
        {choices.isPending && <Spinner size="md" aria-label="Loading flows" />}
        {choices.isError && (
          <Alert variant="danger" isInline isPlain title={`Could not read the flows: ${choices.error.message}`} />
        )}
        {choices.data?.length === 0 && (
          <Alert
            variant="info"
            isInline
            isPlain
            title={published ? 'There are no other published flows' : 'There are no other unpublished flows'}
          />
        )}
        {!!choices.data?.length && (
          <Form id="open-flow-form" onSubmit={submit}>
            {error && <Alert variant="danger" isInline isPlain title={error} />}
            <FormGroup label="Flow" isRequired fieldId="open-flow-name">
              <FormSelect id="open-flow-name" value={chosen?.name ?? ''} onChange={(_e, v) => setPicked(v)}>
                {choices.data.map((c) => (
                  <FormSelectOption key={c.name} value={c.name} label={c.name} />
                ))}
              </FormSelect>
              {chosen?.hint && (
                <FormHelperText>
                  <HelperText>
                    <HelperTextItem>{chosen.hint}</HelperTextItem>
                  </HelperText>
                </FormHelperText>
              )}
            </FormGroup>
          </Form>
        )}
      </ModalBody>
      <ModalFooter>
        <Button
          type="submit"
          form="open-flow-form"
          variant="primary"
          isDisabled={!chosen || opening}
          isLoading={opening}
        >
          Open
        </Button>
        <Button variant="link" onClick={onClose}>
          Cancel
        </Button>
      </ModalFooter>
    </Modal>
  );
}
