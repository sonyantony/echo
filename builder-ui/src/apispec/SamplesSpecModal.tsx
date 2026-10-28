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
  parseSample,
  PATH_PATTERN,
  SAMPLE_METHODS,
  splitPath,
  type SampleMethod,
} from './specFromSamples';
import { operationIdFor } from './operationIds';

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
  /**
   * Why the spec on screen is lost, if it is: shown as a warning, and the button reads Replace,
   * with Add to this spec beside it when onAdd is given.
   */
  replaces?: string;
  /** Whether the spec on screen has this method on this path already: Add to this spec replaces that method then. */
  hasOperation?(method: SampleMethod, path: string): boolean;
  onGenerate(samples: SamplesSpec): void;
  /**
   * Add to this spec: the method goes into the spec on screen, which keeps everything it has; or,
   * when the spec has it on that path, takes its place (Replace METHOD path).
   */
  onAdd?(samples: SamplesSpec): void;
  onClose(): void;
}

/**
 * Interface Specs > Interface Specs from Samples: method, path and a sample request and response,
 * from which the flow's spec is made (specFromSamples) or, when it has one, which are added to it
 * (addOperations). The operationId is the method and path, as ECHO names every operation.
 */
export function SamplesSpecModal({ replaces, hasOperation, onGenerate, onAdd, onClose }: Props) {
  const [method, setMethod] = useState<SampleMethod>('POST');
  const [path, setPath] = useState('');
  const [request, setRequest] = useState('');
  const [response, setResponse] = useState('');

  const { path: fullPath, query } = splitPath(path);
  // The operation is named after its method and path, like every operation (operationIds.ts).
  const operationId = operationIdFor(method, fullPath);
  const pathValid = PATH_PATTERN.test(fullPath);
  const optional = bodyOptional(method);
  const requestSample = sample(request, !optional);
  const responseSample = sample(response, true);
  const valid = pathValid && !requestSample.error && !responseSample.error;
  const canAdd = !!replaces && !!onAdd;
  const taken = canAdd && pathValid && !!hasOperation?.(method, fullPath);

  const samples = (): SamplesSpec => ({ method, path: fullPath, ...(query ? { query } : {}), operationId, request: requestSample.value, response: responseSample.value });
  // Enter in the Path field adds (or replaces the one method) when it can: it never throws the spec away.
  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    if (!valid) return;
    if (canAdd) onAdd!(samples());
    else onGenerate(samples());
  };
  const replace = () => {
    if (valid) onGenerate(samples());
  };

  return (
    <Modal isOpen variant="medium" onClose={onClose} aria-labelledby="spec-samples-title">
      <ModalHeader
        title="Interface Specs from Samples"
        labelId="spec-samples-title"
        description={`ECHO writes the schemas, the path and the operation from a sample request and response${canAdd ? ', as a new spec or added to the one on screen' : ''}. Fields with a value in the sample are marked required; tweak the spec afterwards in the editor.`}
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
          {replaces && (
            <Alert
              variant="warning"
              isInline
              isPlain
              title={
                !canAdd
                  ? `A flow has one OpenAPI spec: ${replaces}.`
                  : taken
                    ? `A flow has one OpenAPI spec. Replace Whole Spec makes a new one: ${replaces}.`
                    : `A flow has one OpenAPI spec. Add to this spec keeps it and adds this method; Replace makes a new one: ${replaces}.`
              }
            />
          )}
          {taken && (
            <Alert
              variant="danger"
              isInline
              isPlain
              title={`This spec has ${method} ${fullPath} already. Replace ${method} ${fullPath} puts the one made from these samples in its place (its route stays); Cancel keeps it.`}
            />
          )}
        </Form>
      </ModalBody>
      <ModalFooter>
        {canAdd ? (
          <>
            <Button type="submit" form="spec-samples-form" variant={taken ? 'warning' : 'primary'} isDisabled={!valid}>
              {taken ? `Replace ${method} ${fullPath}` : 'Add to this spec'}
            </Button>
            <Button variant="danger" isDisabled={!valid} onClick={replace}>
              {taken ? 'Replace Whole Spec' : 'Replace'}
            </Button>
          </>
        ) : (
          <Button type="submit" form="spec-samples-form" variant={replaces ? 'danger' : 'primary'} isDisabled={!valid}>
            {replaces ? 'Replace' : 'Create'}
          </Button>
        )}
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
