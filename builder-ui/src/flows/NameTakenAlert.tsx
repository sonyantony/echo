import { Alert, AlertActionLink } from '@patternfly/react-core';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { publishedFlowsApi, type NameTaken } from '../api/flows';

interface Props {
  taken: NameTaken;
  /** Called once the existing flow is open (to close the dialog); left out where opening it makes no sense (renaming). */
  onOpened?(): void;
  /** Back to the name field. */
  onChooseAnother(): void;
}

/**
 * Says which flow already has the name typed, and offers to open that flow instead or to choose
 * another name. A flow that is only published is opened as a new draft, as Open Flow does.
 */
export function NameTakenAlert({ taken, onOpened, onChooseAnother }: Props) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string>();
  const [opening, setOpening] = useState(false);

  const open = async () => {
    setOpening(true);
    setError(undefined);
    try {
      const id = taken.existingFlowId ?? (await publishedFlowsApi.createDraft(taken.existingFolder!)).id;
      void queryClient.invalidateQueries({ queryKey: ['flows'] });
      onOpened?.();
      navigate(`/flows/${id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setOpening(false);
    }
  };

  return (
    <Alert
      variant="warning"
      isInline
      title={taken.message}
      data-testid="name-taken"
      actionLinks={
        <>
          {onOpened && (
            <AlertActionLink onClick={open} isDisabled={opening}>
              Open {taken.existingName}
            </AlertActionLink>
          )}
          <AlertActionLink onClick={onChooseAnother}>Choose another name</AlertActionLink>
        </>
      }
    >
      {error ?? 'Every flow needs a name of its own.'}
    </Alert>
  );
}
