import { Alert, Button, Modal, ModalBody, ModalFooter, ModalHeader, Radio, Spinner } from '@patternfly/react-core';
import { useEffect, useMemo, useState } from 'react';
import { specSchemaParts, type SpecSchemaPart } from './specSchemas';
import './SpecSchemaPickerModal.css';

interface Props {
  /** Reads the flow's Openapi spec; undefined when the flow has none. */
  loadSpec(): Promise<Record<string, unknown> | undefined>;
  onAttach(part: SpecSchemaPart, spec: Record<string, unknown>): Promise<void>;
  /** Picks a JSON Schema or XSD file from the user's computer instead. */
  onUpload(): void;
  onCancel(): void;
}

interface Operation {
  key: string;
  title: string;
  parts: SpecSchemaPart[];
}

function byOperation(parts: SpecSchemaPart[]): Operation[] {
  const operations = new Map<string, Operation>();
  for (const part of parts) {
    const key = `${part.method} ${part.path}`;
    const title = `${part.method.toUpperCase()} ${part.path}`;
    if (!operations.has(key)) operations.set(key, { key, title, parts: [] });
    operations.get(key)!.parts.push(part);
  }
  return [...operations.values()];
}

/**
 * Shown when the DataMapper's Attach Schema asks for a file: the request and response bodies of the
 * flow's Openapi spec, one of which ECHO writes into the flow as a JSON Schema file, or Upload.
 */
export function SpecSchemaPickerModal({ loadSpec, onAttach, onUpload, onCancel }: Props) {
  const [spec, setSpec] = useState<Record<string, unknown> | null>();
  const [error, setError] = useState<string>();
  const [picked, setPicked] = useState<SpecSchemaPart>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    loadSpec()
      .then((s) => setSpec(s ?? null))
      .catch((e: unknown) => {
        setSpec(null);
        setError(`Could not read the Openapi spec: ${(e as Error).message}`);
      });
    // Read once, when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const operations = useMemo(() => byOperation(spec ? specSchemaParts(spec) : []), [spec]);

  const attach = async () => {
    if (!picked || !spec) return;
    setBusy(true);
    setError(undefined);
    try {
      await onAttach(picked, spec);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <Modal variant="small" isOpen onClose={onCancel} aria-labelledby="echo-spec-schema-title" className="echo-spec-schema">
      <ModalHeader
        title="Attach a schema"
        labelId="echo-spec-schema-title"
        description="Pick a body from this flow's Openapi spec, or upload a JSON Schema or XSD file."
      />
      <ModalBody>
        {error && <Alert variant="danger" isInline isPlain title={error} />}
        {spec === undefined ? (
          <Spinner size="lg" aria-label="Reading the Openapi spec" />
        ) : !operations.length ? (
          <p className="echo-spec-schema__empty">
            {spec ? "This flow's Openapi spec has no JSON request or response bodies." : 'This flow has no Openapi spec yet.'}
          </p>
        ) : (
          <div className="echo-spec-schema__list" role="radiogroup" aria-label="Openapi bodies">
            {operations.map((op) => (
              <div key={op.key} className="echo-spec-schema__operation">
                <div className="echo-spec-schema__operation-title">{op.title}</div>
                {op.parts.map((part) => (
                  <Radio
                    key={part.label}
                    id={`echo-spec-schema-${part.label}`}
                    name="echo-spec-schema"
                    label={part.part === 'request' ? 'Request body' : `Response ${part.status}`}
                    isChecked={picked === part}
                    onChange={() => setPicked(part)}
                  />
                ))}
              </div>
            ))}
          </div>
        )}
      </ModalBody>
      <ModalFooter>
        <Button variant="primary" onClick={attach} isDisabled={!picked || busy} isLoading={busy}>
          Attach
        </Button>
        <Button variant="secondary" onClick={onUpload} isDisabled={busy}>
          Upload File
        </Button>
        <Button variant="link" onClick={onCancel} isDisabled={busy}>
          Cancel
        </Button>
      </ModalFooter>
    </Modal>
  );
}
