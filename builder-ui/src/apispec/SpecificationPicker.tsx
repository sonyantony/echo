import {
  Button,
  Divider,
  HelperText,
  HelperTextItem,
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
import type { KaotoFormField } from '../editor/KaotoEditorHost';
import { formatOf, newApiSpec, serialize } from './apiSpec';
import { SpecNameModal } from './SpecNameModal';

/** The name Kaoto's Rest service form gives its Open Api specification field. */
export const OPENAPI_SPECIFICATION_FIELD = '#.openApi.specification';

const NEW = '<new>';

interface Props {
  field: KaotoFormField;
  flowId: number;
  flowName: string;
  flowDescription?: string | null;
  /** The flow's own spec file, if it has one. */
  ownSpec?: string | null;
  /** Openapi Design has unsaved edits, which replacing the spec throws away. */
  specDirty: boolean;
  /** Called once the flow's spec was replaced (a copy, or a new spec), so Openapi Design shows it. */
  onSpecReplaced(): Promise<unknown>;
}

type Pending = { kind: 'copy'; spec: ApiSpecRef } | { kind: 'new' };

/**
 * Openapi Specification of a Rest service (contract-first), in place of Kaoto's text field: a
 * drop-down of the flow's own spec and every other flow's spec. A flow has one spec, kept in its
 * own folder, so picking another flow's spec copies it into this flow (replacing its spec, after
 * asking); "<new>" starts an empty spec under a name the user gives.
 */
export function SpecificationPicker({ field, flowId, flowName, flowDescription, ownSpec, specDirty, onSpecReplaced }: Props) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<Pending>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const specs = useQuery({ queryKey: ['api-specs'], queryFn: flowsApi.apiSpecs });
  const others = (specs.data ?? []).filter((s) => s.flowId !== flowId);

  const replace = async (store: () => Promise<string>) => {
    setBusy(true);
    setError(undefined);
    try {
      const name = await store();
      field.setValue(name);
      setPending(undefined);
      await onSpecReplaced();
      await specs.refetch();
    } catch (e) {
      setError((e as Error).message);
      setPending(undefined);
    } finally {
      setBusy(false);
    }
  };
  const copy = (spec: ApiSpecRef) =>
    replace(async () => (await flowsApi.copyApiSpec(flowId, spec.flowId)).apiSpec ?? spec.fileName);
  const createNew = (fileName: string) =>
    replace(async () => {
      const text = serialize(newApiSpec(flowName, flowDescription), formatOf(fileName) ?? 'yaml');
      return (await flowsApi.saveApiSpec(flowId, fileName, text)).apiSpec ?? fileName;
    });

  const onSelect = (value: string | number | undefined) => {
    setOpen(false);
    setError(undefined);
    if (value === NEW) {
      setPending({ kind: 'new' });
    } else if (ownSpec && value === ownSpec) {
      field.setValue(ownSpec);
    } else {
      const spec = others.find((s) => key(s) === value);
      if (!spec) return;
      if (ownSpec || specDirty) setPending({ kind: 'copy', spec });
      else void copy(spec);
    }
  };

  const selected = field.value === ownSpec ? ownSpec : undefined;
  const lost = specDirty ? ' Unsaved edits in Openapi Design are lost.' : '';

  return (
    <>
      <Select
        isOpen={open}
        selected={selected}
        onSelect={(_e, value) => onSelect(value as string)}
        onOpenChange={setOpen}
        onOpenChangeKeys={['Escape']}
        toggle={(ref) => (
          <MenuToggle
            ref={ref}
            isFullWidth
            isExpanded={open}
            isDisabled={busy}
            onClick={() => {
              if (!open) void specs.refetch();
              setOpen(!open);
            }}
            aria-label="Openapi Specification"
            data-testid="openapi-specification-toggle"
          >
            {field.value || <span className="echo-spec-picker__placeholder">Select an OpenAPI spec</span>}
          </MenuToggle>
        )}
        shouldFocusToggleOnSelect
        popperProps={{ appendTo: () => document.body }}
      >
        <SelectList aria-label="OpenAPI specs">
          <SelectOption value={NEW} description="An empty spec for this flow, edited in Openapi Design">
            {NEW}
          </SelectOption>
          {ownSpec && <Divider component="li" />}
          {ownSpec && (
            <SelectOption value={ownSpec} description="This flow's spec">
              {ownSpec}
            </SelectOption>
          )}
          {others.length > 0 && <Divider component="li" />}
          {others.map((s) => (
            <SelectOption key={key(s)} value={key(s)} description={`From flow ${s.flowName}: picking it copies it into this flow`}>
              {s.fileName}
            </SelectOption>
          ))}
        </SelectList>
      </Select>
      {field.value && field.value !== ownSpec && !busy && (
        <HelperText>
          <HelperTextItem variant="warning">This flow has no spec called {field.value}. Pick one from the list.</HelperTextItem>
        </HelperText>
      )}
      {error && (
        <HelperText>
          <HelperTextItem variant="error">Could not use that spec: {error}</HelperTextItem>
        </HelperText>
      )}

      {pending?.kind === 'copy' && (
        <Modal isOpen variant="small" onClose={() => setPending(undefined)} aria-labelledby="spec-copy-title">
          <ModalHeader title="Replace this flow's OpenAPI spec?" labelId="spec-copy-title" titleIconVariant="warning" />
          <ModalBody>
            A flow has one OpenAPI spec.{' '}
            {ownSpec ? <>{ownSpec} is replaced by a copy</> : <>This flow gets a copy</>} of {pending.spec.fileName} from flow{' '}
            {pending.spec.flowName}, which this flow then keeps as its own.{lost}
          </ModalBody>
          <ModalFooter>
            <Button variant="danger" isLoading={busy} isDisabled={busy} onClick={() => void copy(pending.spec)}>
              Replace
            </Button>
            <Button variant="link" onClick={() => setPending(undefined)}>
              Cancel
            </Button>
          </ModalFooter>
        </Modal>
      )}
      {pending?.kind === 'new' && (
        <SpecNameModal
          title="New OpenAPI spec"
          description={`Starts an empty OpenAPI spec for this flow, under this file name; design it in Openapi Design.${lost}`}
          initialName={`${flowName}-api.yaml`}
          format="yaml"
          replaces={ownSpec}
          onSave={createNew}
          onClose={() => setPending(undefined)}
        />
      )}
    </>
  );
}

const key = (s: ApiSpecRef) => `${s.flowId}/${s.fileName}`;
