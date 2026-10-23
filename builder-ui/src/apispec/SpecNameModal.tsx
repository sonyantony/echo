import {
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
import { formatOf, SPEC_NAME_HINT, SPEC_NAME_PATTERN, withFormat, type SpecFormat } from './apiSpec';

interface Props {
  title: string;
  description?: string;
  initialName: string;
  /** The format picked with the YAML/JSON buttons: a name typed without extension gets it. */
  format: SpecFormat;
  /** Shown while the field is empty. */
  placeholder?: string;
  /** The extension must stay the format's (an upload keeps its own format). */
  fixedFormat?: boolean;
  /** The spec stored in the flow, which a save under another name replaces. */
  replaces?: string | null;
  onSave(fileName: string): unknown;
  onClose(): void;
}

/** The file name for the flow's OpenAPI spec: on its first Save, on Rename, and when an upload's name needs fixing. */
export function SpecNameModal({ title, description, initialName, format, placeholder, fixedFormat, replaces, onSave, onClose }: Props) {
  const [name, setName] = useState(initialName);
  // A typed .json or .yaml picks that format; otherwise the format buttons' extension is added.
  const typed = name.trim();
  const fileName = !typed ? '' : fixedFormat || !formatOf(typed) ? withFormat(typed, format) : typed;
  const valid = SPEC_NAME_PATTERN.test(fileName) && fileName.length <= 200;

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    if (valid) void onSave(fileName);
  };

  return (
    <Modal isOpen variant="small" onClose={onClose} aria-labelledby="spec-name-title">
      <ModalHeader
        title={title}
        labelId="spec-name-title"
        description={description ?? 'Saves the OpenAPI spec as a draft in this flow, under this file name.'}
      />
      <ModalBody>
        <Form id="spec-name-form" onSubmit={submit}>
          <FormGroup label="File name" isRequired fieldId="spec-name">
            <TextInput
              id="spec-name"
              value={name}
              isRequired
              autoFocus
              placeholder={placeholder}
              onChange={(_e, v) => setName(v)}
              validated={!typed || valid ? 'default' : 'error'}
            />
            <FormHelperText>
              <HelperText>
                <HelperTextItem variant={!typed || valid ? 'default' : 'error'}>
                  {valid && fileName !== typed ? `Saved as ${fileName}. ` : ''}
                  {SPEC_NAME_HINT}
                </HelperTextItem>
                {valid && replaces && replaces !== fileName && (
                  <HelperTextItem variant="warning">A flow has one spec: this replaces {replaces}.</HelperTextItem>
                )}
              </HelperText>
            </FormHelperText>
          </FormGroup>
        </Form>
      </ModalBody>
      <ModalFooter>
        <Button type="submit" form="spec-name-form" variant="primary" isDisabled={!valid}>
          Save
        </Button>
        <Button variant="link" onClick={onClose}>
          Cancel
        </Button>
      </ModalFooter>
    </Modal>
  );
}
