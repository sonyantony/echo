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
import { flowsApi, isValidDisplayName, nameTakenOf, type FlowDetail, type NameTaken } from '../api/flows';
import { useNameTaken } from './FlowNameHint';
import { NameTakenAlert } from './NameTakenAlert';

interface Props {
  onUploaded(flow: FlowDetail): void;
  onClose(): void;
}

/** Opens a flow zip saved earlier with Download, as a new draft. */
export function UploadFlowModal({ onUploaded, onClose }: Props) {
  const [file, setFile] = useState<File>();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string>();
  const [uploading, setUploading] = useState(false);
  const nameValid = !name.trim() || isValidDisplayName(name);
  // A typed name is checked as it is typed; the name in the file only when the server reads it.
  const [refused, setRefused] = useState<NameTaken>();
  const seen = useNameTaken(name);
  const taken = refused ?? seen;
  const nameInput = useRef<HTMLInputElement>(null);

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!file || !nameValid || taken) return;
    setUploading(true);
    setError(undefined);
    try {
      onUploaded(await flowsApi.upload(file, name.trim(), description));
    } catch (e) {
      const nameTaken = nameTakenOf(e);
      if (nameTaken) setRefused(nameTaken);
      else setError(e instanceof Error ? e.message : String(e));
      setUploading(false);
    }
  };

  return (
    <Modal isOpen variant="small" onClose={onClose} aria-labelledby="upload-flow-title">
      <ModalHeader
        title="Upload flow"
        labelId="upload-flow-title"
        description="Choose a flow .zip saved with Download. It opens as a new draft."
      />
      <ModalBody>
        <Form id="upload-flow-form" onSubmit={submit}>
          {error && <Alert variant="danger" isInline isPlain title={error} />}
          <FormGroup label="Flow file" isRequired fieldId="upload-flow-file">
            <input
              id="upload-flow-file"
              type="file"
              accept=".zip,application/zip"
              onChange={(e) => {
                setFile(e.target.files?.[0]);
                setRefused(undefined);
              }}
            />
          </FormGroup>
          <FormGroup label="Name" fieldId="upload-flow-name">
            <TextInput
              id="upload-flow-name"
              ref={nameInput}
              value={name}
              onChange={(_e, v) => {
                setName(v);
                setRefused(undefined);
              }}
              validated={nameValid && !taken ? 'default' : 'error'}
            />
            <FormHelperText>
              <HelperText>
                <HelperTextItem variant={nameValid ? 'default' : 'error'}>
                  Leave empty to keep the name in the file. Any name, e.g. First Flow.
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
          <FormGroup label="Description" fieldId="upload-flow-description">
            <TextArea
              id="upload-flow-description"
              value={description}
              onChange={(_e, v) => setDescription(v)}
              rows={2}
            />
          </FormGroup>
        </Form>
      </ModalBody>
      <ModalFooter>
        <Button
          type="submit"
          form="upload-flow-form"
          variant="primary"
          isDisabled={!file || !nameValid || !!taken || uploading}
          isLoading={uploading}
        >
          Upload
        </Button>
        <Button variant="link" onClick={onClose}>
          Cancel
        </Button>
      </ModalFooter>
    </Modal>
  );
}
