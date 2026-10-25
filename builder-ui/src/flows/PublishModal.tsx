import {
  Alert,
  Button,
  Form,
  FormGroup,
  List,
  ListItem,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  TextArea,
} from '@patternfly/react-core';
import { useEffect, useState } from 'react';
import { ApiError } from '../api/client';
import { publishFlow, publishTargets, type MissingRoute, type PublishedFlow, type PublishTarget, type ValidationResult } from '../api/flows';

interface Props {
  flowId: number;
  flowName: string;
  /** Saves pending editor changes; resolves false if saving failed. */
  beforePublish(): Promise<boolean>;
  onPublished(result: PublishedFlow): void;
  onInvalid(result: ValidationResult): void;
  onClose(): void;
}

export function PublishModal({ flowId, flowName, beforePublish, onPublished, onInvalid, onClose }: Props) {
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string>();
  /** Endpoints or operationIds published flows already use; Publish is blocked until they are gone. */
  const [clashes, setClashes] = useState<string[]>();
  /** Operations of the spec no route handles: Publish Anyway publishes all the same. */
  const [missingRoutes, setMissingRoutes] = useState<MissingRoute[]>();
  const [publishing, setPublishing] = useState(false);
  const [targets, setTargets] = useState<PublishTarget[]>();

  useEffect(() => {
    publishTargets().then(setTargets, () => setTargets(undefined)); // only used to warn when none is enabled
  }, []);

  const publish = async (allowMissingRoutes = false) => {
    setPublishing(true);
    setError(undefined);
    setClashes(undefined);
    setMissingRoutes(undefined);
    try {
      if (!(await beforePublish())) {
        setError('Could not save the flow before publishing.');
        return;
      }
      onPublished(await publishFlow(flowId, message, allowMissingRoutes));
    } catch (e) {
      if (e instanceof ApiError && e.status === 422) {
        onInvalid(e.details as ValidationResult);
      } else if (e instanceof ApiError && e.status === 409 && (e.details as { missingRoutes?: MissingRoute[] } | undefined)?.missingRoutes) {
        setMissingRoutes((e.details as { missingRoutes: MissingRoute[] }).missingRoutes);
      } else if (e instanceof ApiError && e.status === 409) {
        setClashes((e.details as { clashes?: string[] } | undefined)?.clashes ?? [e.message]);
      } else {
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      setPublishing(false);
    }
  };

  return (
    <Modal isOpen variant="small" onClose={onClose} aria-labelledby="publish-title">
      <ModalHeader title={`Publish ${flowName}`} labelId="publish-title" />
      <ModalBody>
        <Form onSubmit={(e) => e.preventDefault()}>
          <p>The flow is validated, then published to every enabled target. Your pipeline builds it from there.</p>
          {targets?.length === 0 && (
            <Alert variant="warning" isInline isPlain title="No publish target is enabled in application.yaml." />
          )}
          {error && <Alert variant="danger" isInline isPlain title={error} />}
          {clashes && (
            <Alert variant="danger" isInline title="Not published: other published flows already use these">
              <List aria-label="Clashes">
                {clashes.map((c) => (
                  <ListItem key={c}>{c}</ListItem>
                ))}
              </List>
              <p>Give this flow its own Base Path or paths in Interface, or rename the operationIds, then publish again.</p>
            </Alert>
          )}
          {missingRoutes && (
            <Alert variant="warning" isInline title="These operations have no route">
              <List aria-label="Operations without a route">
                {missingRoutes.map((op) => (
                  <ListItem key={`${op.method} ${op.path}`}>
                    {op.method} {op.path}
                    {op.disabled && ' (its route is disabled)'}
                  </ListItem>
                ))}
              </List>
              <p>Callers get 404 for them. Publish anyway, or add their routes first (Flow &gt; Add Route For Operation).</p>
            </Alert>
          )}
          <FormGroup label="Description" fieldId="publish-message">
            <TextArea
              id="publish-message"
              value={message}
              onChange={(_e, v) => setMessage(v)}
              placeholder={`Publish flow ${flowName}`}
              rows={3}
            />
          </FormGroup>
        </Form>
      </ModalBody>
      <ModalFooter>
        {missingRoutes ? (
          <Button variant="warning" onClick={() => publish(true)} isLoading={publishing} isDisabled={publishing}>
            Publish Anyway
          </Button>
        ) : (
          <Button variant="primary" onClick={() => publish()} isLoading={publishing} isDisabled={publishing}>
            Publish
          </Button>
        )}
        <Button variant="link" onClick={onClose}>
          Cancel
        </Button>
      </ModalFooter>
    </Modal>
  );
}
