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
  TextArea,
  TextInput,
} from '@patternfly/react-core';
import { useQuery } from '@tanstack/react-query';
import { useRef, useState, type FormEvent } from 'react';
import { isValidDisplayName, nameTakenOf, templatesApi, type FlowDetail, type NameTaken } from '../api/flows';
import { flowNameHint, useFlowIdPreview, useNameTaken } from './FlowNameHint';
import { NameTakenAlert } from './NameTakenAlert';

interface Props {
  onOpened(flow: FlowDetail): void;
  onClose(): void;
}

/** Open Flow Template: picks a template from Git's templates folder and makes a new draft from it. */
export function OpenTemplateModal({ onOpened, onClose }: Props) {
  const templates = useQuery({ queryKey: ['templates'], queryFn: templatesApi.list });
  const [template, setTemplate] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string>();
  const [opening, setOpening] = useState(false);
  const chosen = template || templates.data?.[0]?.name || '';
  const nameValid = isValidDisplayName(name);
  const id = useFlowIdPreview(name);
  const [refused, setRefused] = useState<NameTaken>();
  const seen = useNameTaken(name);
  const taken = refused ?? seen;
  const nameInput = useRef<HTMLInputElement>(null);
  const chosenDescription = templates.data?.find((t) => t.name === chosen)?.description;

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!chosen || !nameValid || taken) return;
    setOpening(true);
    setError(undefined);
    try {
      onOpened(await templatesApi.open(chosen, name.trim(), description));
    } catch (e) {
      const nameTaken = nameTakenOf(e);
      if (nameTaken) setRefused(nameTaken);
      else setError(e instanceof Error ? e.message : String(e));
      setOpening(false);
    }
  };

  return (
    <Modal isOpen variant="small" onClose={onClose} aria-labelledby="open-template-title">
      <ModalHeader
        title="Open Flow Template"
        labelId="open-template-title"
        description="Start a new flow from a template stored in Git. The template itself is not changed."
      />
      <ModalBody>
        {templates.isPending && <Spinner size="md" aria-label="Loading templates" />}
        {templates.isError && (
          <Alert variant="danger" isInline isPlain title={`Could not read the templates: ${templates.error.message}`} />
        )}
        {templates.data?.length === 0 && (
          <Alert variant="info" isInline isPlain title="There are no templates yet">
            Open a flow and choose Save As Template from the Save menu.
          </Alert>
        )}
        {!!templates.data?.length && (
          <Form id="open-template-form" onSubmit={submit}>
            {error && <Alert variant="danger" isInline isPlain title={error} />}
            <FormGroup label="Template" isRequired fieldId="open-template-template">
              <FormSelect id="open-template-template" value={chosen} onChange={(_e, v) => setTemplate(v)}>
                {templates.data.map((t) => (
                  <FormSelectOption key={t.name} value={t.name} label={t.displayName || t.name} />
                ))}
              </FormSelect>
              {chosenDescription && (
                <FormHelperText>
                  <HelperText>
                    <HelperTextItem>{chosenDescription}</HelperTextItem>
                  </HelperText>
                </FormHelperText>
              )}
            </FormGroup>
            <FormGroup label="New flow name" isRequired fieldId="open-template-name">
              <TextInput
                id="open-template-name"
                ref={nameInput}
                value={name}
                isRequired
                onChange={(_e, v) => {
                  setName(v);
                  setRefused(undefined);
                }}
                validated={(!name || nameValid) && !taken ? 'default' : 'error'}
              />
              <FormHelperText>
                <HelperText>
                  <HelperTextItem variant={!name || nameValid ? 'default' : 'error'}>
                    {flowNameHint(name, id)}
                  </HelperTextItem>
                </HelperText>
              </FormHelperText>
            </FormGroup>
            {taken && (
              <NameTakenAlert
                taken={taken}
                onOpened={onClose}
                onChooseAnother={() => {
                  setRefused(undefined);
                  nameInput.current?.focus();
                  nameInput.current?.select();
                }}
              />
            )}
            <FormGroup label="Description" fieldId="open-template-description">
              <TextArea
                id="open-template-description"
                value={description}
                onChange={(_e, v) => setDescription(v)}
                rows={2}
                placeholder="Leave empty to use the template's description"
              />
            </FormGroup>
          </Form>
        )}
      </ModalBody>
      <ModalFooter>
        <Button
          type="submit"
          form="open-template-form"
          variant="primary"
          isDisabled={!chosen || !nameValid || !!taken || opening}
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
