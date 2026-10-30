import { Alert, Button, List, ListItem, Modal, ModalBody, ModalFooter, ModalHeader } from '@patternfly/react-core';
import { useCallback, useRef, useState, type RefObject } from 'react';
import {
  appendRoute,
  callsDirect,
  directRoutes,
  operationLabel,
  refreshRoutes,
  relabelRoutes,
  removeDirectRoutes,
  routeForOperation,
  untouchedRoutes,
  withJoinBean,
  withoutUnusedJoinBean,
  type ApiCall,
  type RoutableOperation,
} from '../apispec/operationIds';
import { attachScaffoldSchemas, forgetScaffoldSchemas, mappedXslFiles } from '../datamapper/scaffoldSchemas';
import type { FlowFiles } from '../editor/flowFiles';
import type { KaotoEditorHandle } from '../editor/KaotoEditorHost';

/** Operations an edit in Interface added and removed (ApiSpecPanel's onOperationsChanged). */
export interface OperationChanges {
  added: RoutableOperation[];
  removed: RoutableOperation[];
  /** Still there with other parameters: their routes, if still as ECHO made them, follow. */
  changed?: RoutableOperation[];
}

interface Asking {
  operations: RoutableOperation[];
  /** Those other routes call: removing their route breaks the call. */
  called: RoutableOperation[];
}

/**
 * Keeps the flow's routes in step with the operations edited in Interface (docs/decisions/0013):
 * a method added there gets a route on the canvas at once (routeForOperation's scaffold, as Add
 * Route For Operation makes it, calling `call`). A parameter added or removed later changes the
 * route's Set Variable steps while the route is still as ECHO made it. When a method is deleted, a
 * route still as ECHO made it goes
 * quietly (so undoing an add leaves nothing behind); one somebody worked on is kept unless the user
 * says Remove Route. A removed route comes back as it was if the method does (undo).
 *
 * The routes change on the canvas like any edit: unsaved canvas work stays, and the flow is saved
 * with the next save or autosave. The schemas the scaffolds' DataMappers start from (and their Kaoto
 * metadata) are written to `files` straight away, and taken away with a route that goes quietly.
 *
 * @returns onOperationsChanged for ApiSpecPanel, and the Keep/Remove dialog to render
 */
export function useOperationRoutes(
  editor: RefObject<KaotoEditorHandle | null>,
  onMessage: (variant: 'success' | 'danger', text: string) => void,
  call?: ApiCall,
  files?: FlowFiles,
) {
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;
  const callRef = useRef(call);
  callRef.current = call;
  /** Routes removed this session, by operationId, for when their operation comes back. */
  const removedRoutes = useRef(new Map<string, string>());
  /** The operations Interface has now, as far as edits told us. */
  const present = useRef(new Set<string>());
  const queue = useRef<Promise<void>>(Promise.resolve());
  const [asking, setAsking] = useState<Asking>();

  const filesRef = useRef(files);
  filesRef.current = files;

  /**
   * Changes the canvas's YAML, one change after another (edits can come quicker than the canvas).
   * change gets the DataMapper XSLT files that have mappings; then runs after the canvas has the change.
   */
  const edit = useCallback(
    (change: (yaml: string, mapped: ReadonlySet<string>) => string, then?: (files: FlowFiles) => Promise<void>) => {
      queue.current = queue.current.then(async () => {
        try {
          if (!editor.current) return;
          const yaml = await editor.current.getContent();
          const files = filesRef.current;
          const next = change(yaml, files ? await mappedXslFiles(files) : new Set());
          if (next !== yaml) await editor.current.setContent(next);
          if (files && then) await then(files);
        } catch (e) {
          onMessageRef.current('danger', `Could not update the routes: ${(e as Error).message}`);
        }
      });
    },
    [editor],
  );

  const onOperationsChanged = useCallback(({ added, removed, changed = [] }: OperationChanges) => {
    for (const op of removed) present.current.delete(op.operationId);
    for (const op of added) present.current.add(op.operationId);
    // The scaffolds made or made again, whose DataMappers' schemas follow; those that went quietly.
    let scaffolds: RoutableOperation[] = [];
    let gone: string[] = [];
    edit((yaml, mapped) => {
      const routes = directRoutes(yaml);
      const untouched = untouchedRoutes(yaml, mapped);
      const existing = removed.filter((op) => routes.has(op.operationId));
      const quiet = existing.filter((op) => untouched.has(op.operationId));
      const ask = existing.filter((op) => !untouched.has(op.operationId));
      gone = quiet.map((op) => op.operationId);
      scaffolds = changed.filter((op) => untouched.has(op.operationId));
      // A route kept for an operation that moved under the same id (an upload) shows where it is now.
      let next = relabelRoutes(withoutUnusedJoinBean(removeDirectRoutes(yaml, quiet.map((op) => op.operationId)).yaml), added);
      next = refreshRoutes(next, changed, mapped);
      const made: RoutableOperation[] = [];
      for (const op of added) {
        if (directRoutes(next).has(op.operationId)) continue;
        const restored = removedRoutes.current.get(op.operationId);
        next = appendRoute(withJoinBean(next), restored ?? routeForOperation(op, callRef.current));
        removedRoutes.current.delete(op.operationId);
        made.push(op);
        if (!restored || untouchedRoutes(restored).has(op.operationId)) scaffolds.push(op);
      }
      if (made.length) onMessageRef.current('success', `Added a route for ${made.map(operationLabel).join(', ')}.`);
      if (ask.length) {
        const called = ask.filter((op) => callsDirect(removeDirectRoutes(next, [op.operationId]).yaml, op.operationId));
        setAsking((was) => ({
          operations: [...(was?.operations ?? []), ...ask],
          called: [...(was?.called ?? []), ...called],
        }));
      }
      return next;
    }, async (files) => {
      await forgetScaffoldSchemas(files, gone);
      await attachScaffoldSchemas(files, scaffolds);
    });
  }, [edit]);

  const answer = (remove: boolean) => {
    const operations = asking?.operations ?? [];
    setAsking(undefined);
    if (!remove) return;
    // One that came back while the dialog was open (undo) keeps its route.
    const ids = operations.map((op) => op.operationId).filter((id) => !present.current.has(id));
    edit(
      (yaml) => {
        const result = removeDirectRoutes(yaml, ids);
        result.removed.forEach((route, id) => removedRoutes.current.set(id, route));
        return withoutUnusedJoinBean(result.yaml);
      },
      (files) => forgetScaffoldSchemas(files, ids),
    );
  };

  const many = (asking?.operations.length ?? 0) > 1;
  const dialog = asking && (
    <Modal isOpen variant="small" onClose={() => answer(false)} aria-labelledby="remove-operation-route-title">
      <ModalHeader
        title={many ? 'Remove their routes too?' : 'Remove its route too?'}
        labelId="remove-operation-route-title"
        description={
          many
            ? 'These operations were deleted from the Interface. Their routes are still on the canvas.'
            : 'This operation was deleted from the Interface. Its route is still on the canvas.'
        }
      />
      <ModalBody>
        <List isPlain>
          {asking.operations.map((op) => (
            <ListItem key={op.operationId}>{operationLabel(op)}</ListItem>
          ))}
        </List>
        {asking.called.length > 0 && (
          <Alert
            variant="warning"
            isInline
            isPlain
            title={`Other routes call ${asking.called.map(operationLabel).join(', ')}: those calls fail if the route is removed.`}
          />
        )}
      </ModalBody>
      <ModalFooter>
        <Button variant="danger" onClick={() => answer(true)}>
          {many ? 'Remove Routes' : 'Remove Route'}
        </Button>
        <Button variant="secondary" onClick={() => answer(false)}>
          {many ? 'Keep Routes' : 'Keep Route'}
        </Button>
      </ModalFooter>
    </Modal>
  );

  /** Resolves once the canvas has every route change asked for so far. */
  const idle = useCallback(() => queue.current, []);

  return { onOperationsChanged, idle, dialog };
}
