import { Alert, AlertActionCloseButton, List, ListItem } from '@patternfly/react-core';
import type { ValidationResult } from '../api/flows';

export function ValidationPanel({ result, onClose }: { result: ValidationResult; onClose(): void }) {
  if (result.valid) {
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
  const count = result.problems.length;
  return (
    <Alert
      variant="danger"
      isInline
      title={`${count} problem${count === 1 ? '' : 's'} to fix before publishing`}
      actionClose={<AlertActionCloseButton onClose={onClose} />}
      data-testid="validation-result"
    >
      <List>
        {result.problems.map((p, i) => (
          <ListItem key={i}>
            <strong>
              {p.file}
              {p.line ? `:${p.line}` : ''}
            </strong>{' '}
            {p.message}
          </ListItem>
        ))}
      </List>
    </Alert>
  );
}
