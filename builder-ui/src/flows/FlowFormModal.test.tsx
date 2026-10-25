import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render as renderDom, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { FlowFormModal } from './FlowFormModal';

/** The dialog previews the flow's ID against the other flows (none here). */
function render(ui: ReactElement) {
  const client = new QueryClient();
  client.setQueryData(['flows'], []);
  return renderDom(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe('Save flow dialog', () => {
  it('asks only for the flow name when there is no OpenAPI spec', () => {
    render(<FlowFormModal title="Save flow" submitLabel="Save" onClose={vi.fn()} onSubmit={vi.fn()} />);
    expect(screen.getByLabelText(/^Name/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/OpenAPI file name/)).not.toBeInTheDocument();
  });

  it('asks for the flow and spec names together, prefilled, the spec name following the flow name', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <FlowFormModal
        title="Save flow"
        submitLabel="Save"
        initialName="card-api"
        spec={{ initialName: 'card-api.yaml', format: 'yaml' }}
        onClose={vi.fn()}
        onSubmit={onSubmit}
      />,
    );
    expect(screen.getByLabelText(/^Name/)).toHaveValue('card-api');
    expect(screen.getByLabelText(/OpenAPI file name/)).toHaveValue('card-api.yaml');

    await userEvent.type(screen.getByLabelText(/^Name/), 's');
    expect(screen.getByLabelText(/OpenAPI file name/)).toHaveValue('card-apis.yaml');

    // Once typed in, the spec name is its own; a name without extension gets the format's.
    await userEvent.clear(screen.getByLabelText(/OpenAPI file name/));
    await userEvent.type(screen.getByLabelText(/OpenAPI file name/), 'cards');
    expect(screen.getByText(/Saved as cards.yaml/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSubmit).toHaveBeenCalledWith('card-apis', '', 'cards.yaml');
  });

  it('keeps an uploaded spec name, and waits for a valid one', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <FlowFormModal
        title="Save flow"
        submitLabel="Save"
        spec={{ initialName: '', format: 'json' }}
        onClose={vi.fn()}
        onSubmit={onSubmit}
      />,
    );
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/^Name/), 'orders');
    expect(screen.getByLabelText(/OpenAPI file name/)).toHaveValue('orders.json');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSubmit).toHaveBeenCalledWith('orders', '', 'orders.json');
  });

  it('takes a name with capitals and spaces; the spec name follows the ID made from it', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <FlowFormModal
        title="Save flow"
        submitLabel="Save"
        initialName="Card API"
        spec={{ initialName: 'card-api.yaml', format: 'yaml' }}
        onClose={vi.fn()}
        onSubmit={onSubmit}
      />,
    );
    expect(screen.getByText('ID: card-api (its folder in Git is flows/card-api/).')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/^Name/), ' Two');
    expect(screen.getByLabelText(/OpenAPI file name/)).toHaveValue('card-api-two.yaml');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSubmit).toHaveBeenCalledWith('Card API Two', '', 'card-api-two.yaml');
  });
});
