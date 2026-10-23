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
import { formatOf, SPEC_NAME_HINT, SPEC_NAME_PATTERN, withFormat, type SpecFormat } from '../apispec/apiSpec';

interface Props {
  title: string;
  submitLabel: string;
  initialName?: string;
  initialDescription?: string | null;
  /** Also asks for the file name of the flow's OpenAPI spec (the untitled flow's first Save, when it has one). */
  spec?: { initialName: string; format: SpecFormat };
  onSubmit(name: string, description: string, specFileName?: string): Promise<void>;
  onClose(): void;
}

export function FlowFormModal({ title, submitLabel, initialName = '', initialDescription, spec, onSubmit, onClose }: Props) {
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription ?? '');
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const nameValid = FLOW_NAME_PATTERN.test(name) && name.length <= 63;
  // The spec's file name follows the flow name until it is typed in (an uploaded spec keeps its own).
  const [specName, setSpecName] = useState<string>();
  const follows = !!spec && (!spec.initialName || (!!initialName && spec.initialName === withFormat(initialName, spec.format)));
  const specTyped = (specName ?? (!spec ? '' : !follows ? spec.initialName : name ? withFormat(name, spec.format) : '')).trim();
  // As on Openapi's Save: a typed .json or .yaml picks that format, otherwise the format's extension is added.
  const specFileName = !spec || !specTyped || formatOf(specTyped) ? specTyped : withFormat(specTyped, spec.format);
  const specValid = !spec || (SPEC_NAME_PATTERN.test(specFileName) && specFileName.length <= 200);
  const valid = nameValid && specValid;

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!valid) return;
    setSaving(true);
    setError(undefined);
    try {
      await onSubmit(name, description, spec ? specFileName : undefined);
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
          {spec && (
            <FormGroup label="OpenAPI file name" isRequired fieldId="flow-spec-name">
              <TextInput
                id="flow-spec-name"
                value={specName ?? specTyped}
                onChange={(_e, v) => setSpecName(v)}
                validated={specTyped && !specValid ? 'error' : 'default'}
              />
              <FormHelperText>
                <HelperText>
                  <HelperTextItem variant={specTyped && !specValid ? 'error' : 'default'}>
                    {specValid && specFileName !== specTyped ? `Saved as ${specFileName}. ` : ''}
                    {SPEC_NAME_HINT}
                  </HelperTextItem>
                </HelperText>
              </FormHelperText>
            </FormGroup>
          )}
          <FormGroup label="Description" fieldId="flow-description">
            <TextArea id="flow-description" value={description} onChange={(_e, v) => setDescription(v)} rows={3} />
          </FormGroup>
        </Form>
      </ModalBody>
      <ModalFooter>
        <Button type="submit" form="flow-form" variant="primary" isDisabled={!valid || saving} isLoading={saving}>
          {submitLabel}
        </Button>
        <Button variant="link" onClick={onClose}>
          Cancel
        </Button>
      </ModalFooter>
    </Modal>
  );
}
