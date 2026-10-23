import { Alert, AlertActionCloseButton } from '@patternfly/react-core';
import { useState } from 'react';
import type { MappingWarning } from './specMappings';

interface Props {
  warnings: MappingWarning[];
  error?: string;
  className?: string;
}

/**
 * The DataMapper steps to review after the Openapi spec changed: each one maps fields its schema
 * (made from the spec) no longer has. Closing it hides it until the list changes.
 */
export function SpecMappingWarnings({ warnings, error, className }: Props) {
  const key = JSON.stringify(warnings) + (error ?? '');
  const [closed, setClosed] = useState<string>();
  if ((!warnings.length && !error) || closed === key) return null;
  const close = <AlertActionCloseButton onClose={() => setClosed(key)} />;
  if (!warnings.length) return <Alert className={className} variant="warning" isInline title={error} actionClose={close} />;
  return (
    <Alert
      className={className}
      variant="warning"
      isInline
      title={warnings.length === 1 ? 'Review this DataMapper step: it no longer matches the Openapi spec' : `Review these ${warnings.length} DataMapper steps: they no longer match the Openapi spec`}
      actionClose={close}
      data-testid="spec-mapping-warnings"
    >
      <ul className="echo-spec-mapping-warnings">
        {warnings.map((w) => (
          <li key={`${w.stepId}:${w.side}`}>
            <strong>
              {w.routeId ? `Route ${w.routeId}, step ${w.stepId}` : `Step ${w.stepId}`}
            </strong>
            , {w.side} ({w.schemaFile}): {w.problems.join('; ')}.
          </li>
        ))}
      </ul>
    </Alert>
  );
}
