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
import { useState, type FormEvent } from 'react';
import { FLOW_NAME_HINT, FLOW_NAME_PATTERN } from '../api/flows';

interface Props {
  title: string;
  submitLabel: string;
  initialName?: string;
  initialDescription?: string | null;
  onSubmit(name: string, description: string): Promise<void>;
  onClose(): void;
}

export function FlowFormModal({ title, submitLabel, initialName = '', initialDescription, onSubmit, onClose }: Props) {
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription ?? '');
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const nameValid = FLOW_NAME_PATTERN.test(name) && name.length <= 63;

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!nameValid) return;
    setSaving(true);
    setError(undefined);
    try {
      await onSubmit(name, description);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
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
              value={name}
              onChange={(_e, v) => setName(v)}
              validated={name && !nameValid ? 'error' : 'default'}
              autoFocus
            />
            <FormHelperText>
              <HelperText>
                <HelperTextItem variant={name && !nameValid ? 'error' : 'default'}>{FLOW_NAME_HINT}</HelperTextItem>
              </HelperText>
            </FormHelperText>
          </FormGroup>
          <FormGroup label="Description" fieldId="flow-description">
            <TextArea id="flow-description" value={description} onChange={(_e, v) => setDescription(v)} rows={3} />
          </FormGroup>
        </Form>
      </ModalBody>
      <ModalFooter>
        <Button type="submit" form="flow-form" variant="primary" isDisabled={!nameValid || saving} isLoading={saving}>
          {submitLabel}
        </Button>
        <Button variant="link" onClick={onClose}>
          Cancel
        </Button>
      </ModalFooter>
    </Modal>
  );
}
