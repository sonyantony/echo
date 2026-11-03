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
  Label,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  TextArea,
  TextInput,
} from '@patternfly/react-core';
import { useState, type FormEvent, type KeyboardEvent } from 'react';
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
  /** The filled-in sets, in order: the first makes the spec, the others are added to it. */
  onGenerate(samples: SamplesSpec[]): void;
  /**
   * Add to this spec: the methods go into the spec on screen, which keeps everything it has; a
   * method the spec has on that path is put in its place (Replace METHOD path).
   */
  onAdd?(samples: SamplesSpec[]): void;
  onClose(): void;
}

/** One set of samples, as typed. */
interface SampleSet {
  key: number;
  method: SampleMethod;
  path: string;
  request: string;
  response: string;
}

/** The dialog starts with this many sets, and More Samples adds this many more. */
export const SETS_AT_A_TIME = 3;

let nextKey = 1;
const emptySet = (): SampleSet => ({ key: nextKey++, method: 'POST', path: '', request: '', response: '' });
const emptySets = () => Array.from({ length: SETS_AT_A_TIME }, emptySet);

/** A set with nothing typed in it is left out. */
const used = (set: SampleSet) => !!(set.path.trim() || set.request.trim() || set.response.trim());

/** What a set makes, and what is wrong with it. */
function check(set: SampleSet) {
  const { path: fullPath, query } = splitPath(set.path);
  const pathValid = PATH_PATTERN.test(fullPath);
  const optional = bodyOptional(set.method);
  const request = sample(set.request, !optional);
  const response = sample(set.response, true);
  const pathError = !set.path.trim() ? 'A path is needed, e.g. /cards/{cardId}/activate.' : pathValid ? undefined : 'Segments of letters, digits, - _ . or a {name}, split by /, then an optional ?query.';
  const samples: SamplesSpec = {
    method: set.method,
    path: fullPath,
    ...(query ? { query } : {}),
    // The operation is named after its method and path, like every operation (operationIds.ts).
    operationId: operationIdFor(set.method, fullPath),
    request: request.value,
    response: response.value,
  };
  return { samples, optional, pathError, request, response, valid: !pathError && !request.error && !response.error };
}

const nameOf = (s: SamplesSpec) => `${s.method} ${s.path}`;

/**
 * Interface Specs > Interface Specs from Samples: sets of method, path and a sample request and
 * response (three at first, More Samples adds three more), shown as cards like Import from Jira
 * using AI. From the filled-in sets ECHO makes the flow's spec (specFromSamples) or, when it has
 * one, adds them to it (addOperations). Each operationId is the method and path, as ECHO names
 * every operation.
 */
export function SamplesSpecModal({ replaces, hasOperation, onGenerate, onAdd, onClose }: Props) {
  const [sets, setSets] = useState<SampleSet[]>(emptySets);
  const update = (key: number, change: Partial<SampleSet>) => setSets((all) => all.map((s) => (s.key === key ? { ...s, ...change } : s)));

  const filled = sets.filter(used).map((set) => ({ set, ...check(set) }));
  const names = filled.map((f) => nameOf(f.samples));
  const duplicates = new Set(names.filter((n, i) => names.indexOf(n) !== i));
  const valid = filled.length > 0 && duplicates.size === 0 && filled.every((f) => f.valid);
  const canAdd = !!replaces && !!onAdd;
  const takenOf = (f: (typeof filled)[number]) => canAdd && !f.pathError && !!hasOperation?.(f.samples.method, f.samples.path);
  const taken = filled.filter(takenOf);
  const only = filled.length === 1 ? filled[0].samples : undefined;

  const all = () => filled.map((f) => f.samples);
  // Enter in a Path field adds (or replaces the methods the spec has) when it can: it never throws the spec away.
  const submit = (event?: FormEvent | KeyboardEvent) => {
    event?.preventDefault();
    if (!valid) return;
    if (canAdd) onAdd!(all());
    else onGenerate(all());
  };
  const replace = () => {
    if (valid) onGenerate(all());
  };
  const addLabel = taken.length === 0 ? 'Add to this spec' : only ? `Replace ${nameOf(only)}` : `Add to this spec, replacing ${taken.length}`;

  return (
    <Modal isOpen variant="large" onClose={onClose} aria-labelledby="spec-samples-title">
      <ModalHeader
        title="Interface Specs from Samples"
        labelId="spec-samples-title"
        description={`ECHO writes the schemas, the paths and the operations from each set of sample request and response${canAdd ? ', as a new spec or added to the one on screen' : ''}. Sets left blank are skipped. Fields with a value in the sample are marked required; tweak the spec afterwards in the editor.`}
      />
      <ModalBody>
        <Form id="spec-samples-form" onSubmit={submit} className="echo-samples-spec">
          <div className="echo-jira-import__cards">
            {sets.map((set, i) => {
              const c = check(set);
              const on = used(set);
              const id = `spec-samples-${set.key}`;
              const name = nameOf(c.samples);
              const isTaken = on && takenOf({ set, ...c });
              return (
                <section key={set.key} className="echo-jira-import__card" aria-label={`Sample ${i + 1}`}>
                  <div className="echo-jira-import__card-head">
                    <strong>Sample {i + 1}</strong>
                    {isTaken && <Label color="orange" isCompact>Already in the spec: replaces it (its route stays)</Label>}
                    {on && !c.pathError && duplicates.has(name) && <Label color="red" isCompact>Two sets are {name}</Label>}
                    {sets.length > 1 && (
                      <Button variant="link" isInline className="echo-jira-import__remove" onClick={() => setSets((all) => all.filter((s) => s.key !== set.key))}>
                        Remove
                      </Button>
                    )}
                  </div>
                  <div className="echo-samples-spec__route">
                    <FormGroup label="Method" fieldId={`${id}-method`} className="echo-samples-spec__method">
                      <FormSelect id={`${id}-method`} value={set.method} onChange={(_e, v) => update(set.key, { method: v as SampleMethod })}>
                        {SAMPLE_METHODS.map((m) => (
                          <FormSelectOption key={m} value={m} label={m} />
                        ))}
                      </FormSelect>
                    </FormGroup>
                    <FormGroup label="Path" isRequired fieldId={`${id}-path`} className="echo-samples-spec__path">
                      <TextInput
                        id={`${id}-path`}
                        value={set.path}
                        onChange={(_e, v) => update(set.key, { path: v })}
                        placeholder="/cards/{cardId}/activate or /cards?status=ACTIVE&limit=10"
                        validated={set.path.trim() && c.pathError ? 'error' : 'default'}
                        autoFocus={i === 0}
                        // A form with many fields submits on Enter only through its submit button, which is outside it.
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') submit(e);
                        }}
                      />
                      <FormHelperText>
                        <HelperText>
                          <HelperTextItem variant={on && c.pathError ? 'error' : 'default'}>
                            {on && c.pathError ? c.pathError : 'Each {name} becomes a path parameter. A sample query after ? (e.g. ?status=ACTIVE&limit=10) gives optional query parameters.'}
                          </HelperTextItem>
                        </HelperText>
                      </FormHelperText>
                    </FormGroup>
                  </div>
                  <div className="echo-jira-import__bodies">
                    <FormGroup label="Sample request (JSON)" isRequired={!c.optional} fieldId={`${id}-request`}>
                      <TextArea
                        id={`${id}-request`}
                        className="echo-samples-spec__json"
                        value={set.request}
                        onChange={(_e, v) => update(set.key, { request: v })}
                        rows={6}
                        resizeOrientation="vertical"
                        validated={c.request.shown ? 'error' : 'default'}
                        placeholder={c.optional ? `Optional for ${set.method}: leave blank for no request body` : '{ "activationCode": "123456" }'}
                      />
                      {on && c.request.error && <SampleError text={c.request.error} />}
                    </FormGroup>
                    <FormGroup label="Sample response (JSON)" isRequired fieldId={`${id}-response`}>
                      <TextArea
                        id={`${id}-response`}
                        className="echo-samples-spec__json"
                        value={set.response}
                        onChange={(_e, v) => update(set.key, { response: v })}
                        rows={6}
                        resizeOrientation="vertical"
                        validated={c.response.shown ? 'error' : 'default'}
                        placeholder='{ "cardId": "c-42", "status": "ACTIVE" }'
                      />
                      {on && c.response.error && <SampleError text={c.response.error} />}
                    </FormGroup>
                  </div>
                </section>
              );
            })}
          </div>
          <Button variant="secondary" className="echo-samples-spec__more" onClick={() => setSets((all) => [...all, ...emptySets()])}>
            More Samples
          </Button>
          {replaces && canAdd && taken.length === 0 && (
            <p className="echo-samples-spec__add-note">
              <strong>Add to this spec</strong>: adds {filled.length > 1 ? 'these methods' : 'this method'} to the spec.
            </p>
          )}
          {replaces && (!canAdd || taken.length > 0) && (
            <Alert
              variant="warning"
              isInline
              isPlain
              title={canAdd ? `A flow has one OpenAPI spec. Replace Whole Spec makes a new one: ${replaces}.` : `A flow has one OpenAPI spec: ${replaces}.`}
            />
          )}
          {only && taken.length > 0 && (
            <Alert
              variant="danger"
              isInline
              isPlain
              title={`This spec has ${nameOf(only)} already. Replace ${nameOf(only)} puts the one made from these samples in its place (its route stays); Cancel keeps it.`}
            />
          )}
          {!only && taken.length > 0 && (
            <Alert
              variant="danger"
              isInline
              isPlain
              title={`This spec has ${taken.map((f) => nameOf(f.samples)).join(', ')} already. ${addLabel} puts the ones made from these samples in their place (their routes stay); Cancel keeps them.`}
            />
          )}
        </Form>
      </ModalBody>
      <ModalFooter>
        {canAdd ? (
          <>
            <Button type="submit" form="spec-samples-form" variant={taken.length ? 'warning' : 'primary'} isDisabled={!valid}>
              {addLabel}
            </Button>
            <Button variant="danger" isDisabled={!valid} onClick={replace}>
              Replace Whole Spec
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
