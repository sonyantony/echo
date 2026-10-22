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
  TextArea,
  TextInput,
} from '@patternfly/react-core';
import { useState, type FormEvent } from 'react';
import {
  bodyOptional,
  OPERATION_ID_PATTERN,
  operationIdFor,
  parseSample,
  PATH_PATTERN,
  SAMPLE_METHODS,
  splitPath,
  type SampleMethod,
} from './specFromSamples';

export interface SamplesSpec {
  method: SampleMethod;
  path: string;
  /** The sample query string typed after '?', if any. */
  query?: string;
  operationId: string;
  request?: unknown;
  response: unknown;
}

interface Props {
  /** Why the spec on screen is lost, if it is: shown as a warning, and the button reads Replace. */
  replaces?: string;
  onGenerate(samples: SamplesSpec): void;
  onClose(): void;
}

/**
 * Openapi Design > New From Samples: method, path, operationId and a sample request and response,
 * from which the flow's spec is made (specFromSamples). The operationId follows the method and
 * path until the user types their own.
 */
export function SamplesSpecModal({ replaces, onGenerate, onClose }: Props) {
  const [method, setMethod] = useState<SampleMethod>('POST');
  const [path, setPath] = useState('');
  const [typedOperationId, setTypedOperationId] = useState<string>();
  const [request, setRequest] = useState('');
  const [response, setResponse] = useState('');

  const { path: fullPath, query } = splitPath(path);
  const operationId = typedOperationId ?? (fullPath ? operationIdFor(method, fullPath) : '');
  const pathValid = PATH_PATTERN.test(fullPath);
  const operationIdValid = OPERATION_ID_PATTERN.test(operationId);
  const optional = bodyOptional(method);
  const requestSample = sample(request, !optional);
  const responseSample = sample(response, true);
  const valid = pathValid && operationIdValid && !requestSample.error && !responseSample.error;

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    if (!valid) return;
    onGenerate({ method, path: fullPath, ...(query ? { query } : {}), operationId, request: requestSample.value, response: responseSample.value });
  };

  return (
    <Modal isOpen variant="medium" onClose={onClose} aria-labelledby="spec-samples-title">
      <ModalHeader
        title="New OpenAPI spec from samples"
        labelId="spec-samples-title"
        description="ECHO writes the schemas, the path and the operation from a sample request and response. Fields with a value in the sample are marked required; tweak the spec afterwards in the editor."
      />
      <ModalBody>
        <Form id="spec-samples-form" onSubmit={submit} className="echo-samples-spec">
          <div className="echo-samples-spec__route">
            <FormGroup label="Method" fieldId="spec-samples-method" className="echo-samples-spec__method">
              <FormSelect id="spec-samples-method" value={method} onChange={(_e, v) => setMethod(v as SampleMethod)}>
                {SAMPLE_METHODS.map((m) => (
                  <FormSelectOption key={m} value={m} label={m} />
                ))}
              </FormSelect>
            </FormGroup>
            <FormGroup label="Path" isRequired fieldId="spec-samples-path" className="echo-samples-spec__path">
              <TextInput
                id="spec-samples-path"
                value={path}
                onChange={(_e, v) => setPath(v)}
                placeholder="/cards/{cardId}/activate or /cards?status=ACTIVE&limit=10"
                validated={path.trim() && !pathValid ? 'error' : 'default'}
                autoFocus
              />
              <FormHelperText>
                <HelperText>
                  <HelperTextItem variant={path.trim() && !pathValid ? 'error' : 'default'}>
                    {path.trim() && !pathValid ? 'Segments of letters, digits, - _ . or a {name}, split by /, then an optional ?query.' : 'Each {name} becomes a path parameter. A sample query after ? (e.g. ?status=ACTIVE&limit=10) gives optional query parameters.'}
                  </HelperTextItem>
                </HelperText>
              </FormHelperText>
            </FormGroup>
          </div>
          <FormGroup label="operationId" isRequired fieldId="spec-samples-operation-id">
            <TextInput
              id="spec-samples-operation-id"
              value={operationId}
              onChange={(_e, v) => setTypedOperationId(v)}
              validated={operationId && !operationIdValid ? 'error' : 'default'}
            />
            <FormHelperText>
              <HelperText>
                <HelperTextItem variant={operationId && !operationIdValid ? 'error' : 'default'}>
                  {operationId && !operationIdValid
                    ? "A letter, then letters, digits and '_'."
                    : typedOperationId === undefined
                      ? 'Filled in from the method and path until you edit it. It names the route the flow implements.'
                      : 'It names the route the flow implements.'}
                </HelperTextItem>
              </HelperText>
            </FormHelperText>
          </FormGroup>
          <FormGroup label="Sample request (JSON)" isRequired={!optional} fieldId="spec-samples-request">
            <TextArea
              id="spec-samples-request"
              className="echo-samples-spec__json"
              value={request}
              onChange={(_e, v) => setRequest(v)}
              rows={7}
              resizeOrientation="vertical"
              validated={requestSample.shown ? 'error' : 'default'}
              placeholder={optional ? `Optional for ${method}: leave blank for no request body` : '{ "activationCode": "123456" }'}
            />
            {requestSample.shown && <SampleError text={requestSample.error!} />}
          </FormGroup>
          <FormGroup label="Sample response (JSON)" isRequired fieldId="spec-samples-response">
            <TextArea
              id="spec-samples-response"
              className="echo-samples-spec__json"
              value={response}
              onChange={(_e, v) => setResponse(v)}
              rows={7}
              resizeOrientation="vertical"
              validated={responseSample.shown ? 'error' : 'default'}
              placeholder='{ "cardId": "c-42", "status": "ACTIVE" }'
            />
            {responseSample.shown && <SampleError text={responseSample.error!} />}
          </FormGroup>
          {replaces && <Alert variant="warning" isInline isPlain title={`A flow has one OpenAPI spec: ${replaces}.`} />}
        </Form>
      </ModalBody>
      <ModalFooter>
        <Button type="submit" form="spec-samples-form" variant={replaces ? 'danger' : 'primary'} isDisabled={!valid}>
          {replaces ? 'Replace' : 'Create'}
        </Button>
        <Button variant="link" onClick={onClose}>
          Cancel
        </Button>
      </ModalFooter>
    </Modal>
  );
}

/** A sample's parsed value, or why it cannot be used; shown says whether the error is worth showing yet (not for a blank field). */
function sample(text: string, needed: boolean): { value?: unknown; error?: string; shown: boolean } {
  if (!text.trim()) return { error: needed ? 'A sample is needed.' : undefined, shown: false };
  try {
    return { value: parseSample(text), shown: false };
  } catch (e) {
    return { error: (e as Error).message, shown: true };
  }
}

function SampleError({ text }: { text: string }) {
  return (
    <FormHelperText>
      <HelperText>
        <HelperTextItem variant="error">{text}</HelperTextItem>
      </HelperText>
    </FormHelperText>
  );
}
