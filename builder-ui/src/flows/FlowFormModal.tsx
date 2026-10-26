import {
  Alert,
  Button,
  Form,
  FormGroup,
  FormHelperText,
  HelperText,
  HelperTextItem,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  TextArea,
  TextInput,
} from '@patternfly/react-core';
import { useRef, useState, type FormEvent } from 'react';
import { isValidDisplayName, nameTakenOf, type NameTaken } from '../api/flows';
import { flowNameHint, useFlowIdPreview, useNameTaken } from './FlowNameHint';
import { NameTakenAlert } from './NameTakenAlert';

interface Props {
  title: string;
  submitLabel: string;
  initialName?: string;
  initialDescription?: string | null;
  /** Renaming: the flow, which keeps its ID and may keep its own name. */
  renaming?: { id: number; name: string };
  onSubmit(name: string, description: string): Promise<void>;
  onClose(): void;
}

/**
 * Asks for a flow's name (any text: ECHO makes its ID from it, shown below the field) and description.
 * The name must be the flow's own: when another flow (in the Builder or published) has it, or the ID it
 * makes, the dialog says so and offers to open that flow instead.
 */
export function FlowFormModal({
  title,
  submitLabel,
  initialName = '',
  initialDescription,
  renaming,
  onSubmit,
  onClose,
}: Props) {
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription ?? '');
  const [error, setError] = useState<string>();
  const [refused, setRefused] = useState<NameTaken>();
  const [saving, setSaving] = useState(false);
  const nameInput = useRef<HTMLInputElement>(null);
  const nameValid = isValidDisplayName(name);
  const id = useFlowIdPreview(name, renaming?.name);
  const seen = useNameTaken(name, renaming);
  const taken = refused ?? seen;

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!nameValid || taken) return;
    setSaving(true);
    setError(undefined);
    try {
      await onSubmit(name.trim(), description);
    } catch (e) {
      const nameTaken = nameTakenOf(e);
      if (nameTaken) setRefused(nameTaken);
      else setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  };

  const chooseAnother = () => {
    setRefused(undefined);
    nameInput.current?.focus();
    nameInput.current?.select();
  };

  return (
    <Modal isOpen variant="small" onClose={onClose} aria-labelledby="flow-form-title">
      <ModalHeader title={title} labelId="flow-form-title" />
      <ModalBody>
        <Form id="flow-form" onSubmit={submit}>
          {error && <Alert variant="danger" isInline isPlain title={error} />}
          <FormGroup label="Name" isRequired fieldId="flow-name">
            <TextInput
              id="flow-name"
              ref={nameInput}
              value={name}
              onChange={(_e, v) => {
                setName(v);
                setRefused(undefined);
              }}
              validated={(name && !nameValid) || taken ? 'error' : 'default'}
              autoFocus
            />
            <FormHelperText>
              <HelperText>
                <HelperTextItem variant={name && !nameValid ? 'error' : 'default'}>
                  {flowNameHint(name, id, 'flow', !!renaming)}
                </HelperTextItem>
              </HelperText>
            </FormHelperText>
          </FormGroup>
          {taken && <NameTakenAlert taken={taken} onOpened={renaming ? undefined : onClose} onChooseAnother={chooseAnother} />}
          <FormGroup label="Description" fieldId="flow-description">
            <TextArea id="flow-description" value={description} onChange={(_e, v) => setDescription(v)} rows={3} />
          </FormGroup>
        </Form>
      </ModalBody>
      <ModalFooter>
        <Button type="submit" form="flow-form" variant="primary" isDisabled={!nameValid || !!taken || saving} isLoading={saving}>
          {submitLabel}
        </Button>
        <Button variant="link" onClick={onClose}>
          Cancel
        </Button>
      </ModalFooter>
    </Modal>
  );
}
