import { render, screen } from '@testing-library/react';
import { ValidationPanel } from './ValidationPanel';

describe('ValidationPanel', () => {
  it('says when a flow is valid', () => {
    render(<ValidationPanel result={{ valid: true, problems: [] }} onClose={() => undefined} />);
    expect(screen.getByText('The flow is valid.')).toBeInTheDocument();
  });

  it('lists each problem with file and line', () => {
    render(
      <ValidationPanel
        result={{
          valid: false,
          problems: [
            { file: 'orders.camel.yaml', line: 6, message: "The 'kafka' component is not allowed in flows." },
            { file: 'application.properties', line: null, message: 'Cannot read properties.' },
          ],
        }}
        onClose={() => undefined}
      />,
    );
    expect(screen.getByText('2 problems to fix before publishing')).toBeInTheDocument();
    expect(screen.getByText('orders.camel.yaml:6')).toBeInTheDocument();
    expect(screen.getByText("The 'kafka' component is not allowed in flows.")).toBeInTheDocument();
    expect(screen.getByText('application.properties')).toBeInTheDocument();
  });
});
