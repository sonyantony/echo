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
  TextInput,
} from '@patternfly/react-core';
import { useState, type FormEvent } from 'react';
import { FLOW_NAME_HINT, FLOW_NAME_PATTERN, needsOverwriteConfirmation } from '../api/flows';

interface Props {
  title: string;
  description: string;
  initialName: string;
  /** Saves under name; rejects with a 409 confirmOverwrite error when it would replace something. */
  onSave(name: string, overwrite: boolean): Promise<unknown>;
  onClose(): void;
}

/** Asks for a name for Save As and Save As Template, and for confirmation before replacing anything. */
export function SaveAsModal({ title, description, initialName, onSave, onClose }: Props) {
  const [name, setName] = useState(initialName);
  const [error, setError] = useState<string>();
  const [confirm, setConfirm] = useState<string>();
  const [saving, setSaving] = useState(false);
  const nameValid = FLOW_NAME_PATTERN.test(name) && name.length <= 63;

  const save = async (overwrite: boolean) => {
    setSaving(true);
    setError(undefined);
    try {
      await onSave(name, overwrite);
    } catch (e) {
      if (!overwrite && needsOverwriteConfirmation(e)) {
        setConfirm((e as Error).message);
      } else {
        setError(e instanceof Error ? e.message : String(e));
        setConfirm(undefined);
      }
      setSaving(false);
    }
  };

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    if (nameValid && !confirm) void save(false);
  };

  return (
    <Modal isOpen variant="small" onClose={onClose} aria-labelledby="save-as-title">
      <ModalHeader title={title} labelId="save-as-title" description={description} />
      <ModalBody>
        <Form id="save-as-form" onSubmit={submit}>
          {error && <Alert variant="danger" isInline isPlain title={error} />}
          {confirm && (
            <Alert variant="warning" isInline title={confirm} data-testid="overwrite-warning">
              Its current content will be replaced by this flow.
            </Alert>
          )}
          <FormGroup label="Name" isRequired fieldId="save-as-name">
            <TextInput
              id="save-as-name"
              value={name}
              isRequired
              onChange={(_e, v) => {
                setName(v);
                setConfirm(undefined);
              }}
              validated={!name || nameValid ? 'default' : 'error'}
            />
            <FormHelperText>
              <HelperText>
                <HelperTextItem variant={!name || nameValid ? 'default' : 'error'}>{FLOW_NAME_HINT}</HelperTextItem>
              </HelperText>
            </FormHelperText>
          </FormGroup>
        </Form>
      </ModalBody>
      <ModalFooter>
        {confirm ? (
          <Button variant="danger" onClick={() => save(true)} isLoading={saving} isDisabled={saving}>
            Replace
          </Button>
        ) : (
          <Button
            type="submit"
            form="save-as-form"
            variant="primary"
            isDisabled={!nameValid || saving}
            isLoading={saving}
          >
            Save
          </Button>
        )}
        <Button variant="link" onClick={onClose}>
          Cancel
        </Button>
      </ModalFooter>
    </Modal>
  );
}
