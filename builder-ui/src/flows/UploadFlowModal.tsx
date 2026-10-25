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
import { flowsApi, isValidDisplayName, type FlowDetail } from '../api/flows';

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

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!file || !nameValid) return;
    setUploading(true);
    setError(undefined);
    try {
      onUploaded(await flowsApi.upload(file, name.trim(), description));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
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
              onChange={(e) => setFile(e.target.files?.[0])}
            />
          </FormGroup>
          <FormGroup label="Name" fieldId="upload-flow-name">
            <TextInput
              id="upload-flow-name"
              value={name}
              onChange={(_e, v) => setName(v)}
              validated={nameValid ? 'default' : 'error'}
            />
            <FormHelperText>
              <HelperText>
                <HelperTextItem variant={nameValid ? 'default' : 'error'}>
                  Leave empty to keep the name in the file. Any name, e.g. First Flow.
                </HelperTextItem>
              </HelperText>
            </FormHelperText>
          </FormGroup>
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
          isDisabled={!file || !nameValid || uploading}
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
