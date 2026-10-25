import {
  Alert,
  Button,
  MenuToggle,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  Select,
  SelectList,
  SelectOption,
} from '@patternfly/react-core';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { flowsApi, type ApiSpecRef } from '../api/flows';

interface Props {
  /** Left out for the untitled flow, which has no folder to copy into yet: onCopy shows the copy instead. */
  flowId?: number;
  /** The flow's own spec file, if it has one: the copy replaces it. */
  ownSpec?: string | null;
  /** Openapi has unsaved edits, which the copy throws away. */
  specDirty: boolean;
  onClose(): void;
  /** Called once the copy is stored, so Openapi shows it. */
  onCopied?(): Promise<unknown>;
  /** Makes the copy in place of the Builder (the untitled flow). */
  onCopy?(spec: ApiSpecRef): Promise<unknown>;
}

/**
 * Openapi > Copy From Another Flow: starts this flow's spec from another flow's. A flow has
 * one spec, kept in its own folder, so the file is copied into this flow under the same name and
 * is this flow's own from then on.
 */
export function CopySpecModal({ flowId, ownSpec, specDirty, onClose, onCopied, onCopy }: Props) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<ApiSpecRef>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const specs = useQuery({ queryKey: ['api-specs'], queryFn: flowsApi.apiSpecs });
  const others = (specs.data ?? []).filter((s) => s.flowId !== flowId);

  const copy = async () => {
    if (!picked) return;
    setBusy(true);
    setError(undefined);
    try {
      if (onCopy) {
        await onCopy(picked);
      } else {
        await flowsApi.copyApiSpec(flowId!, picked.flowId);
        await onCopied?.();
      }
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const replaces = [ownSpec && `${ownSpec} is replaced`, specDirty && 'unsaved edits in Interface are lost']
    .filter(Boolean)
    .join(', and ');

  return (
    <Modal isOpen variant="small" onClose={onClose} aria-labelledby="spec-copy-title">
      <ModalHeader title="Copy an OpenAPI spec from another flow" labelId="spec-copy-title" />
      <ModalBody>
        {specs.isSuccess && others.length === 0 ? (
          <p>No other flow has an OpenAPI spec yet.</p>
        ) : (
          <>
            <p>This flow gets a copy, which it then keeps as its own: editing it leaves the other flow alone.</p>
            <Select
              isOpen={open}
              selected={picked && key(picked)}
              onSelect={(_e, value) => {
                setPicked(others.find((s) => key(s) === value));
                setOpen(false);
              }}
              onOpenChange={setOpen}
              toggle={(ref) => (
                <MenuToggle
                  ref={ref}
                  isFullWidth
                  isExpanded={open}
                  onClick={() => setOpen(!open)}
                  aria-label="OpenAPI spec to copy"
                  className="echo-copy-spec__toggle"
                >
                  {picked ? `${picked.fileName} (flow ${picked.flowName})` : 'Pick a spec'}
                </MenuToggle>
              )}
              shouldFocusToggleOnSelect
            >
              <SelectList aria-label="OpenAPI specs">
                {others.map((s) => (
                  <SelectOption key={key(s)} value={key(s)} description={`From flow ${s.flowName}`}>
                    {s.fileName}
                  </SelectOption>
                ))}
              </SelectList>
            </Select>
            {picked && replaces && (
              <Alert className="echo-copy-spec__warning" variant="warning" isInline isPlain title={`A flow has one OpenAPI spec: ${replaces}.`} />
            )}
          </>
        )}
        {error && <Alert variant="danger" isInline isPlain title={`Could not copy the spec: ${error}`} />}
      </ModalBody>
      <ModalFooter>
        <Button variant={replaces ? 'danger' : 'primary'} isLoading={busy} isDisabled={!picked || busy} onClick={() => void copy()}>
          {replaces ? 'Replace' : 'Copy'}
        </Button>
        <Button variant="link" onClick={onClose}>
          Cancel
        </Button>
      </ModalFooter>
    </Modal>
  );
}

const key = (s: ApiSpecRef) => `${s.flowId}/${s.fileName}`;
