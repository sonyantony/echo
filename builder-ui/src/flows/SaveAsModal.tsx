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
import { useRef, useState, type FormEvent } from 'react';
import { flowIdFor, isValidDisplayName, nameTakenOf, needsOverwriteConfirmation, type NameTaken } from '../api/flows';
import { flowNameHint, useFlowIdPreview } from './FlowNameHint';
import { NameTakenAlert } from './NameTakenAlert';

interface Props {
  title: string;
  description: string;
  initialName: string;
  /** What is saved: a flow (the default) or a template. */
  kind?: 'flow' | 'template';
  /** Saves under name; rejects with a 409 confirmOverwrite error when it would replace something. */
  onSave(name: string, overwrite: boolean): Promise<unknown>;
  onClose(): void;
}

/**
 * Asks for a name for Save As and Save As Template, and for confirmation before replacing anything.
 * Save As replaces only a Builder flow of that name: a name a published flow has, or that makes
 * another flow's ID, is refused with an offer to open that flow.
 */
export function SaveAsModal({ title, description, initialName, kind = 'flow', onSave, onClose }: Props) {
  const [name, setName] = useState(initialName);
  const [error, setError] = useState<string>();
  const [confirm, setConfirm] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [taken, setTaken] = useState<NameTaken>();
  const nameInput = useRef<HTMLInputElement>(null);
  const nameValid = isValidDisplayName(name);
  const flowId = useFlowIdPreview(name);
  // A template's folder is made from its name; saving to a folder that exists asks before replacing it.
  const id = kind === 'flow' ? flowId : flowIdFor(name);

  const save = async (overwrite: boolean) => {
    setSaving(true);
    setError(undefined);
    try {
      await onSave(name.trim(), overwrite);
    } catch (e) {
      if (!overwrite && needsOverwriteConfirmation(e)) {
        setConfirm((e as Error).message);
      } else if (nameTakenOf(e)) {
        setTaken(nameTakenOf(e));
        setConfirm(undefined);
      } else {
        setError(e instanceof Error ? e.message : String(e));
        setConfirm(undefined);
      }
      setSaving(false);
    }
  };

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    if (nameValid && !confirm && !taken) void save(false);
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
              ref={nameInput}
              value={name}
              isRequired
              onChange={(_e, v) => {
                setName(v);
                setConfirm(undefined);
                setTaken(undefined);
              }}
              validated={(!name || nameValid) && !taken ? 'default' : 'error'}
            />
            <FormHelperText>
              <HelperText>
                <HelperTextItem variant={!name || nameValid ? 'default' : 'error'}>
                  {flowNameHint(name, id, kind)}
                </HelperTextItem>
              </HelperText>
            </FormHelperText>
          </FormGroup>
          {taken && (
            <NameTakenAlert
              taken={taken}
              onOpened={onClose}
              onChooseAnother={() => {
                setTaken(undefined);
                nameInput.current?.focus();
                nameInput.current?.select();
              }}
            />
          )}
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
            isDisabled={!nameValid || !!taken || saving}
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
