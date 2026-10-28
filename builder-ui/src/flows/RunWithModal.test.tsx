import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { RunValues } from '../api/flows';
import { parseProperties, RunWithModal } from './RunWithModal';

const values: RunValues = {
  fileName: null,
  placeholders: [
    { name: 'fulfilment.api.token', fallback: null },
    { name: 'inventory.host', fallback: null },
    { name: 'inventory.timeout', fallback: '5000' },
  ],
  missing: [],
};

const propertiesFile = (name: string, text: string) => new File([text], name, { type: 'text/plain' });

describe('parseProperties', () => {
  it('reads key=value, key: value and key value lines, skipping comments', () => {
    const read = parseProperties('# test\n! also\na=1\nb : two\nc three\n  d=4\\\n    5\ne\\=f=6\n');
    expect([...read]).toEqual([
      ['a', '1'],
      ['b', 'two'],
      ['c', 'three'],
      ['d', '45'],
      ['e=f', '6'],
    ]);
  });
});

describe('RunWithModal', () => {
  it('lists the values the flow uses and runs only once the chosen file sets each needed one', async () => {
    const onRun = vi.fn().mockResolvedValue(undefined);
    render(<RunWithModal flowName="Order Status" values={values} onRun={onRun} onClose={() => {}} />);
    expect(screen.getByRole('dialog', { name: 'Run Order Status with' })).toBeVisible();
    expect(screen.getAllByText('needed')).toHaveLength(2);
    expect(screen.getByText('default 5000')).toBeVisible();
    const run = screen.getByRole('button', { name: 'Run' });
    expect(run).toBeDisabled();

    const input = document.querySelector<HTMLInputElement>('input[type=file]')!;
    await userEvent.upload(input, propertiesFile('dev.properties', 'inventory.host=localhost\n'));
    expect(await screen.findByText('1 value is missing from dev.properties')).toBeVisible();
    expect(run).toBeDisabled();

    await userEvent.upload(input, propertiesFile('test.properties', 'inventory.host=localhost\nfulfilment.api.token=abc\n'));
    expect(await screen.findByText(/localhost/)).toBeVisible();
    expect(screen.queryByText('abc')).toBeNull();
    expect(run).toBeEnabled();
    await userEvent.click(run);
    expect(onRun).toHaveBeenCalledWith({
      fileName: 'test.properties',
      content: 'inventory.host=localhost\nfulfilment.api.token=abc\n',
    });
  });

  it('says when the file chosen before no longer sets a value the flow uses', () => {
    render(
      <RunWithModal
        flowName="Order Status"
        values={{ ...values, fileName: 'test.properties', missing: ['inventory.host'] }}
        onRun={vi.fn()}
        onClose={() => {}}
      />,
    );
    expect(screen.getByText('test.properties does not set inventory.host')).toBeVisible();
  });

  it('shows why a run failed', async () => {
    const onRun = vi.fn().mockRejectedValue(new Error('The flow could not start: boom'));
    render(
      <RunWithModal flowName="Ping" values={{ fileName: null, placeholders: [], missing: [] }} onRun={onRun} onClose={() => {}} />,
    );
    expect(screen.getByText(/runs without a file/)).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Run' }));
    expect(await screen.findByText('The flow could not start: boom')).toBeVisible();
  });
});
