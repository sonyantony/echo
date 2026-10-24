import {
  Alert,
  Button,
  Checkbox,
  DropdownItem,
  Label,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
} from '@patternfly/react-core';
import { useState } from 'react';
import { naturalOperationIds, operationLabel, specOperations, type SpecOperation } from '../apispec/operationIds';

export type RoutableOperation = SpecOperation & { operationId: string };

/** Flow > Add Route For Operation. */
export function addOperationRouteMenuItem(onOpen?: () => void) {
  return (
    <DropdownItem
      key="add-operation-route"
      onClick={onOpen}
      isDisabled={!onOpen}
      description={onOpen ? 'A route for an operation of the Openapi spec' : 'Save the flow first'}
    >
      Add Route For Operation
    </DropdownItem>
  );
}

/**
 * The spec's operations with the operationId a route starts from: the one in the spec, or for an
 * operation without one, the id ECHO gives it (the backend fills in the same when the flow leaves
 * the editor).
 */
export function routableOperations(editorJson: string): RoutableOperation[] {
  const named = specOperations(naturalOperationIds(editorJson).json);
  return specOperations(editorJson).map((op, i) => ({ ...op, operationId: op.operationId ?? named[i].operationId! }));
}

interface Props {
  operations: RoutableOperation[];
  /** The direct endpoints routes start from: true when the route starts, false when it is switched off. */
  routes: Map<string, boolean>;
  onAdd(operations: RoutableOperation[]): void;
  onClose(): void;
}

/**
 * Lists the operations of the flow's spec and adds a route for each one picked, so nobody types an
 * operationId (decision 0013). An operation that has a route already cannot be picked again.
 */
export function AddOperationRouteModal({ operations, routes, onAdd, onClose }: Props) {
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const toggle = (id: string, on: boolean) =>
    setPicked((was) => {
      const next = new Set(was);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  return (
    <Modal isOpen variant="small" onClose={onClose} aria-labelledby="add-operation-route-title">
      <ModalHeader
        title="Add Route For Operation"
        labelId="add-operation-route-title"
        description="Each route you add handles one operation of the flow's Openapi spec. It logs the call until you design it on the canvas."
      />
      <ModalBody>
        {operations.length === 0 ? (
          <Alert variant="info" isInline isPlain title="The flow's Openapi spec has no operations yet." />
        ) : (
          <div className="echo-operation-routes" role="group" aria-label="Operations">
            {operations.map((op) => {
              const route = routes.get(op.operationId);
              return (
                <Checkbox
                  key={op.operationId}
                  id={`operation-route-${op.operationId}`}
                  label={
                    <>
                      <span className="echo-operation-routes__label">{operationLabel(op)}</span>{' '}
                      {route === true && <Label isCompact>Has a route</Label>}
                      {route === false && (
                        <Label isCompact color="orange">
                          Route is disabled
                        </Label>
                      )}
                    </>
                  }
                  description={op.summary}
                  isChecked={picked.has(op.operationId)}
                  isDisabled={route !== undefined}
                  onChange={(_e, on) => toggle(op.operationId, on)}
                />
              );
            })}
          </div>
        )}
      </ModalBody>
      <ModalFooter>
        <Button
          variant="primary"
          isDisabled={picked.size === 0}
          onClick={() => onAdd(operations.filter((op) => picked.has(op.operationId)))}
        >
          Add
        </Button>
        <Button variant="link" onClick={onClose}>
          Cancel
        </Button>
      </ModalFooter>
    </Modal>
  );
}
