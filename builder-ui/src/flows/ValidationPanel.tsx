import { Alert, AlertActionCloseButton, Button, List, ListItem, Popover } from '@patternfly/react-core';
import { ExclamationCircleIcon } from '@patternfly/react-icons';
import { useState } from 'react';
import type { ValidationProblem, ValidationResult } from '../api/flows';
import { problemCount, problemPlace } from '../editor/StepProblemBadges';

/** "The flow is valid." above the editor after a Validate that found nothing. */
export function ValidationPanel({ result, onClose }: { result: ValidationResult; onClose(): void }) {
  if (!result.valid) return null;
  return (
    <Alert
      variant="success"
      isInline
      isPlain
      title="The flow is valid."
      actionClose={<AlertActionCloseButton onClose={onClose} />}
      data-testid="validation-result"
    />
  );
}

/**
 * The problems a Validate (or Run, or Publish) found, on the canvas toolbar beside Validate. Problems
 * on a step are shown by a red circle on that step (StepProblemBadges); the others (another file,
 * no line, a step not on the canvas) are listed here, and the box opens by itself when there are any.
 */
export function ValidationProblems({
  problems,
  other,
  onClear,
}: {
  problems: ValidationProblem[];
  /** The problems no step on the canvas shows. */
  other: ValidationProblem[];
  onClear(): void;
}) {
  const [open, setOpen] = useState(other.length > 0);
  const onSteps = problems.length - other.length;
  return (
    <Popover
      isVisible={open}
      shouldOpen={() => setOpen(true)}
      shouldClose={() => setOpen(false)}
      position="bottom"
      minWidth="22rem"
      maxWidth="40rem"
      alertSeverityVariant="danger"
      headerContent={`${problemCount(problems.length)} to fix before publishing`}
      bodyContent={
        <div data-testid="validation-result">
          {onSteps > 0 && (
            <p>
              {onSteps === problems.length ? (onSteps === 1 ? 'It is' : 'They are') : `${onSteps} of them ${onSteps === 1 ? 'is' : 'are'}`} on steps of the
              flow: click the red circle on a step to see its {onSteps === 1 ? 'problem' : 'problems'}.
            </p>
          )}
          {other.length > 0 && (
            <List data-testid="other-problems">
              {other.map((p, i) => (
                <ListItem key={i}>
                  <strong>{problemPlace(p)}</strong> {p.message}
                </ListItem>
              ))}
            </List>
          )}
        </div>
      }
      footerContent={
        <Button variant="link" isInline onClick={onClear}>
          Clear the problems
        </Button>
      }
      aria-label="Problems to fix before publishing"
    >
      <Button variant="danger" icon={<ExclamationCircleIcon />} data-testid="validation-problems">
        {problemCount(problems.length)}
      </Button>
    </Popover>
  );
}
