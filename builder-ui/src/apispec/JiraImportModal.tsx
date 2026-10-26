import {
  Alert,
  Button,
  Checkbox,
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
  Spinner,
  TextArea,
  TextInput,
} from '@patternfly/react-core';
import { useMemo, useState, type FormEvent } from 'react';
import { storyExamples, type StoryExample, type StoryExamples } from '../api/jira';
import { addOperations, basePathOf, operationKeys, withoutBasePath, type ImportedOperation, type ImportResult } from './jiraImport';
import { parseSample, PATH_PATTERN, SAMPLE_METHODS, splitPath } from './specFromSamples';

interface Props {
  /** The AI engine the story is sent to, if the install has one: the user is told before reading. */
  aiEngine?: string | null;
  /** The spec on screen, as the editor's JSON. */
  currentJson(): string;
  /** Puts the spec with the operations added on screen, unsaved. */
  onApply(result: ImportResult): void;
  /** Undo on the last step: the spec as it was before. */
  onUndo(): void;
  onClose(): void;
}

/** One operation to import, as the user checks it. */
interface Card {
  key: number;
  include: boolean;
  method: string;
  /** With the sample query. */
  path: string;
  /** The example picked ('' for none); the text below it can still be edited. */
  requestPick: string;
  request: string;
  responsePick: string;
  response: string;
  /** The examples found near it, offered first. */
  near: number[];
  /** Why the AI engine paired them so. */
  reason?: string | null;
}

type Step =
  | { kind: 'link'; error?: string }
  | { kind: 'reading' }
  | { kind: 'confirm'; story: StoryExamples; cards: Card[] }
  | { kind: 'review'; story: StoryExamples; result: ImportResult };

let nextKey = 1;

function cardsOf(story: StoryExamples, basePath: string): Card[] {
  const json = (id?: number | null) => story.examples.find((e) => e.id === id)?.json ?? '';
  return story.operations.map((op) => ({
    key: nextKey++,
    include: true,
    method: SAMPLE_METHODS.includes(op.method as never) ? op.method : 'GET',
    path: op.path ? withoutBasePath(op.path, basePath) : '',
    requestPick: op.request ? String(op.request) : '',
    request: json(op.request),
    responsePick: op.response ? String(op.response) : '',
    response: json(op.response),
    near: op.examples,
    reason: op.reason,
  }));
}

const emptyCard = (): Card => ({ key: nextKey++, include: true, method: 'GET', path: '', requestPick: '', request: '', responsePick: '', response: '', near: [] });

/** What is wrong with a card, by field; empty when it can be imported. */
function problems(card: Card): { path?: string; request?: string; response?: string } {
  const result: { path?: string; request?: string; response?: string } = {};
  const { path } = splitPath(card.path);
  if (!card.path.trim()) result.path = 'A path is needed, e.g. /accounts/{accountId}/payments.';
  else if (!PATH_PATTERN.test(path)) result.path = 'Segments of letters, digits, - _ . or a {name}, split by /, then an optional ?query.';
  for (const field of ['request', 'response'] as const) {
    try {
      parseSample(card[field]);
    } catch (e) {
      result[field] = (e as Error).message;
    }
  }
  return result;
}

function toImported(card: Card): ImportedOperation {
  const { path, query } = splitPath(card.path);
  return {
    method: card.method,
    path,
    ...(query ? { query } : {}),
    ...(card.request.trim() ? { request: parseSample(card.request) } : {}),
    ...(card.response.trim() ? { response: parseSample(card.response) } : {}),
  };
}

const operationName = (card: Card) => `${card.method} ${splitPath(card.path).path}`;

/**
 * Interface > Import From Jira: reads a story, shows the operations and example payloads ECHO
 * found in it for the user to check (and pick between, when there are several), adds them to the
 * spec on screen, and lists the paths and data types it made. Nothing is saved until Save.
 */
export function JiraImportModal({ aiEngine, currentJson, onApply, onUndo, onClose }: Props) {
  const [step, setStep] = useState<Step>({ kind: 'link' });
  const [link, setLink] = useState('');

  const read = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!link.trim()) return;
    setStep({ kind: 'reading' });
    try {
      const story = await storyExamples(link.trim());
      setStep({ kind: 'confirm', story, cards: cardsOf(story, basePathOf(currentJson())) });
    } catch (e) {
      setStep({ kind: 'link', error: (e as Error).message });
    }
  };

  if (step.kind === 'link' || step.kind === 'reading') {
    return (
      <Modal isOpen variant="small" onClose={onClose} aria-labelledby="jira-import-title">
        <ModalHeader
          title="Import From Jira"
          labelId="jira-import-title"
          description={`ECHO reads the story and its comments, finds the example payloads, calls and query parameters in them, and shows you what it found before adding anything.${aiEngine ? ` The story's text is sent to the AI engine (${aiEngine}) to pair the examples.` : ''}`}
        />
        <ModalBody>
          {step.kind === 'reading' ? (
            <div className="echo-jira-import__reading" role="status">
              <Spinner size="md" aria-label="Reading the story" /> Reading the story and its comments…
            </div>
          ) : (
            <Form id="jira-import-link-form" onSubmit={read}>
              <FormGroup label="Story link" isRequired fieldId="jira-import-link">
                <TextInput
                  id="jira-import-link"
                  value={link}
                  onChange={(_e, v) => setLink(v)}
                  placeholder="https://acme.atlassian.net/browse/PAY-142, or PAY-142"
                  autoFocus
                />
              </FormGroup>
              {step.error && <Alert variant="danger" isInline isPlain title={step.error} />}
            </Form>
          )}
        </ModalBody>
        <ModalFooter>
          <Button type="submit" form="jira-import-link-form" variant="primary" isDisabled={!link.trim() || step.kind === 'reading'} isLoading={step.kind === 'reading'}>
            Read Story
          </Button>
          <Button variant="link" onClick={onClose}>
            Cancel
          </Button>
        </ModalFooter>
      </Modal>
    );
  }

  if (step.kind === 'review') {
    return <ReviewStep story={step.story} result={step.result} onKeep={onClose} onUndo={() => { onUndo(); onClose(); }} />;
  }

  return (
    <ConfirmStep
      story={step.story}
      cards={step.cards}
      existing={operationKeys(currentJson())}
      onChange={(cards) => setStep({ ...step, cards })}
      onAdd={(cards) => {
        const result = addOperations(currentJson(), cards.map(toImported));
        onApply(result);
        setStep({ kind: 'review', story: step.story, result });
      }}
      onClose={onClose}
    />
  );
}

function ConfirmStep({
  story,
  cards,
  existing,
  onChange,
  onAdd,
  onClose,
}: {
  story: StoryExamples;
  cards: Card[];
  existing: Set<string>;
  onChange(cards: Card[]): void;
  onAdd(cards: Card[]): void;
  onClose(): void;
}) {
  const update = (key: number, change: Partial<Card>) => onChange(cards.map((c) => (c.key === key ? { ...c, ...change } : c)));
  const included = cards.filter((c) => c.include);
  const names = included.map(operationName);
  const duplicates = new Set(names.filter((n, i) => names.indexOf(n) !== i));
  const valid = included.length > 0 && duplicates.size === 0 && included.every((c) => Object.keys(problems(c)).length === 0);
  const found = story.examples.length;
  const from = story.comments ? `the description and ${story.comments} comment${story.comments === 1 ? '' : 's'}` : 'the description';

  return (
    <Modal isOpen variant="large" onClose={onClose} aria-labelledby="jira-confirm-title">
      <ModalHeader
        title={`${story.key}: ${story.summary}`}
        labelId="jira-confirm-title"
        description={
          <>
            {found
              ? `Found ${found} example payload${found === 1 ? '' : 's'} in ${from}${story.engine ? `, paired by the AI engine (${story.engine})` : ''}. Check each operation before ECHO adds it to the spec.`
              : `No example payloads were found in ${from}.`}{' '}
            <a href={story.link} target="_blank" rel="noreferrer">
              Open {story.key} in Jira
            </a>
          </>
        }
      />
      <ModalBody>
        {story.notes?.map((note) => (
          <Alert key={note} variant="warning" isInline isPlain title={note} className="echo-jira-import__note" />
        ))}
        <div className="echo-jira-import__cards">
          {cards.map((card, i) => (
            <OperationCard
              key={card.key}
              index={i}
              card={card}
              examples={story.examples}
              byAi={!!story.engine}
              exists={existing.has(operationName(card))}
              duplicate={card.include && duplicates.has(operationName(card))}
              onChange={(change) => update(card.key, change)}
              onRemove={() => onChange(cards.filter((c) => c.key !== card.key))}
            />
          ))}
        </div>
        <Button variant="link" isInline className="echo-jira-import__add" onClick={() => onChange([...cards, emptyCard()])}>
          Add another operation
        </Button>
      </ModalBody>
      <ModalFooter>
        <Button variant="primary" isDisabled={!valid} onClick={() => onAdd(included)}>
          {included.length > 1 ? `Add ${included.length} Operations` : 'Add To Spec'}
        </Button>
        <Button variant="link" onClick={onClose}>
          Cancel
        </Button>
      </ModalFooter>
    </Modal>
  );
}

function OperationCard({
  index,
  card,
  examples,
  byAi,
  exists,
  duplicate,
  onChange,
  onRemove,
}: {
  index: number;
  card: Card;
  examples: StoryExample[];
  /** The AI engine paired the examples (else ECHO's own guess, which picks the newest). */
  byAi: boolean;
  exists: boolean;
  duplicate: boolean;
  onChange(change: Partial<Card>): void;
  onRemove(): void;
}) {
  const issues = problems(card);
  const id = `jira-op-${card.key}`;
  // The examples found near this operation first, then the rest.
  const ordered = useMemo(
    () => [...card.near.map((n) => examples.find((e) => e.id === n)!).filter(Boolean), ...examples.filter((e) => !card.near.includes(e.id))],
    [card.near, examples],
  );
  const several = (role: 'request' | 'response') =>
    card.near.filter((n) => examples.find((e) => e.id === n)?.role === role).length > 1;

  const bodyField = (field: 'request' | 'response') => {
    const pick = field === 'request' ? 'requestPick' : 'responsePick';
    const label = field === 'request' ? 'Request body' : 'Response body';
    return (
      <FormGroup label={label} fieldId={`${id}-${field}`}>
        <FormSelect
          id={`${id}-${field}-pick`}
          aria-label={`${label} example`}
          value={card[pick]}
          onChange={(_e, v) => onChange({ [pick]: v, [field]: examples.find((e) => String(e.id) === v)?.json ?? '' })}
        >
          <FormSelectOption value="" label={`No ${field} body`} />
          {ordered.map((e) => (
            <FormSelectOption
              key={e.id}
              value={String(e.id)}
              label={`Example ${e.id} · ${e.source}${e.role ? ` · called the ${e.role}` : ''}`}
            />
          ))}
        </FormSelect>
        <TextArea
          id={`${id}-${field}`}
          className="echo-samples-spec__json"
          value={card[field]}
          onChange={(_e, v) => onChange({ [field]: v })}
          rows={6}
          resizeOrientation="vertical"
          validated={issues[field] ? 'error' : 'default'}
          aria-label={`${label} JSON`}
        />
        <FormHelperText>
          <HelperText>
            {issues[field] ? (
              <HelperTextItem variant="error">{issues[field]}</HelperTextItem>
            ) : several(field) ? (
              <HelperTextItem variant="warning">
                The story has several {field} examples here{byAi ? '' : ': the newest is picked'}. Pick another if it is wrong.
              </HelperTextItem>
            ) : null}
          </HelperText>
        </FormHelperText>
      </FormGroup>
    );
  };

  return (
    <section className={`echo-jira-import__card${card.include ? '' : ' echo-jira-import__card--off'}`} aria-label={`Operation ${index + 1}`}>
      <div className="echo-jira-import__card-head">
        <Checkbox id={`${id}-include`} label="Import" isChecked={card.include} onChange={(_e, v) => onChange({ include: v })} />
        {exists && card.include && <Label color="orange" isCompact>Already in the spec: importing replaces it</Label>}
        {duplicate && <Label color="red" isCompact>Two operations are {operationName(card)}</Label>}
        <Button variant="link" isInline className="echo-jira-import__remove" onClick={onRemove}>
          Remove
        </Button>
      </div>
      {card.reason && <p className="echo-jira-import__reason">AI: {card.reason}</p>}
      <div className="echo-samples-spec__route">
        <FormGroup label="Method" fieldId={`${id}-method`} className="echo-samples-spec__method">
          <FormSelect id={`${id}-method`} value={card.method} onChange={(_e, v) => onChange({ method: v })}>
            {SAMPLE_METHODS.map((m) => (
              <FormSelectOption key={m} value={m} label={m} />
            ))}
          </FormSelect>
        </FormGroup>
        <FormGroup label="Path" isRequired fieldId={`${id}-path`} className="echo-samples-spec__path">
          <TextInput
            id={`${id}-path`}
            value={card.path}
            onChange={(_e, v) => onChange({ path: v })}
            placeholder="/accounts/{accountId}/payments?status=OPEN"
            validated={issues.path && card.path.trim() ? 'error' : 'default'}
          />
          <FormHelperText>
            <HelperText>
              <HelperTextItem variant={issues.path && card.path.trim() ? 'error' : 'default'}>
                {issues.path && card.path.trim() ? issues.path : 'Each {name} becomes a path parameter; a sample query after ? gives query parameters.'}
              </HelperTextItem>
            </HelperText>
          </FormHelperText>
        </FormGroup>
      </div>
      <div className="echo-jira-import__bodies">
        {bodyField('request')}
        {bodyField('response')}
      </div>
    </section>
  );
}

function ReviewStep({ story, result, onKeep, onUndo }: { story: StoryExamples; result: ImportResult; onKeep(): void; onUndo(): void }) {
  return (
    <Modal isOpen variant="medium" onClose={onKeep} aria-labelledby="jira-review-title">
      <ModalHeader
        title="Check what was added"
        labelId="jira-review-title"
        description={`From ${story.key}. Nothing is saved yet: Save keeps it, Undo takes it out again.`}
      />
      <ModalBody>
        <h3 className="echo-jira-import__heading">Paths</h3>
        <ul className="echo-jira-import__list" aria-label="Paths">
          {result.paths.map((p) => (
            <li key={`${p.method} ${p.path}`}>
              <strong>{p.method}</strong> {p.path}
              {p.replaced && <> <Label isCompact color="orange">replaced</Label></>}
            </li>
          ))}
        </ul>
        <h3 className="echo-jira-import__heading">Data types</h3>
        {result.schemas.length ? (
          <ul className="echo-jira-import__list" aria-label="Data types">
            {result.schemas.map((s) => (
              <li key={s.name}>
                {s.name} <span className="echo-jira-import__muted">· {s.fields} field{s.fields === 1 ? '' : 's'}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="echo-jira-import__muted">None: the operations have no JSON bodies.</p>
        )}
        {result.notes.length > 0 && (
          <>
            <h3 className="echo-jira-import__heading">Worth checking</h3>
            <ul className="echo-jira-import__list" aria-label="Worth checking">
              {result.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </>
        )}
        <p className="echo-jira-import__muted">Each new operation has a route in the flow. Required fields are the ones with a value in the example.</p>
      </ModalBody>
      <ModalFooter>
        <Button variant="primary" onClick={onKeep}>
          Keep
        </Button>
        <Button variant="link" onClick={onUndo}>
          Undo
        </Button>
      </ModalFooter>
    </Modal>
  );
}
