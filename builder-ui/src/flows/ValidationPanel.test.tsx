import { render, screen } from '@testing-library/react';
import { ValidationPanel, ValidationProblems } from './ValidationPanel';

describe('ValidationPanel', () => {
  it('says when a flow is valid', () => {
    render(<ValidationPanel result={{ valid: true, problems: [] }} onClose={() => undefined} />);
    expect(screen.getByText('The flow is valid.')).toBeInTheDocument();
  });

  it('shows nothing above the editor for problems', () => {
    const { container } = render(
      <ValidationPanel result={{ valid: false, problems: [{ file: 'a', message: 'b' }] }} onClose={() => undefined} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe('ValidationProblems', () => {
  const onStep = { file: 'orders.camel.yaml', line: 6, message: "The 'kafka' component is not allowed in flows." };
  const elsewhere = { file: 'application.properties', line: null, message: 'Cannot read properties.' };

  it('lists the problems no step shows, opening by itself', async () => {
    render(<ValidationProblems problems={[onStep, elsewhere]} other={[elsewhere]} onClear={() => undefined} />);
    expect(screen.getByRole('button', { name: '2 problems' })).toBeInTheDocument();
    expect(await screen.findByText('2 problems to fix before publishing')).toBeInTheDocument();
    expect(screen.getByText(/1 of them is on steps of the flow/)).toBeInTheDocument();
    expect(screen.getByText('application.properties')).toBeInTheDocument();
    expect(screen.getByText('Cannot read properties.')).toBeInTheDocument();
    expect(screen.queryByText(onStep.message)).not.toBeInTheDocument();
  });

  it('stays closed when every problem is on a step', () => {
    render(<ValidationProblems problems={[onStep]} other={[]} onClear={() => undefined} />);
    expect(screen.getByRole('button', { name: '1 problem' })).toBeInTheDocument();
    expect(screen.queryByText('1 problem to fix before publishing')).not.toBeInTheDocument();
  });
});
