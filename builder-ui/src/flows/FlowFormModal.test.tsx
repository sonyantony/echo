import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render as renderDom, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { mockFetch } from '../test/fetchMock';
import { FlowFormModal } from './FlowFormModal';

const draft = (id: number, name: string, displayName = name) => ({
  id,
  name,
  displayName,
  status: 'DRAFT',
  updatedBy: 'designer',
  updatedAt: '2026-10-26T10:00:00Z',
});

/** The dialog checks names against the Builder's flows and the published ones, as seeded here. */
const flows = [draft(7, 'orders', 'Orders')];
const published = [
  { name: 'orders', displayName: 'Orders', flowId: 7, draftChanged: false },
  { name: 'customer-refunds', displayName: 'Customer Refunds', flowId: null, draftChanged: false },
];
const lists = {
  'GET /api/flows': { status: 200, body: flows },
  'GET /api/published-flows': { status: 200, body: published },
};

function render(ui: ReactElement) {
  const client = new QueryClient();
  client.setQueryData(['flows'], flows);
  client.setQueryData(['flows', 'published'], published);
  const router = createMemoryRouter([
    { path: '/', element: ui },
    { path: '/flows/:id', element: <p>Flow editor</p> },
  ]);
  renderDom(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

beforeEach(() => {
  document.cookie = 'XSRF-TOKEN=abc';
  mockFetch(lists);
});
afterEach(() => vi.unstubAllGlobals());

describe('New flow dialog', () => {
  it('takes a name with capitals and spaces and shows the ID made from it', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<FlowFormModal title="New flow" submitLabel="Create" onClose={vi.fn()} onSubmit={onSubmit} />);
    await userEvent.type(screen.getByLabelText(/^Name/), 'Card API');
    expect(screen.getByText('ID: card-api (its folder in Git is flows/card-api/).')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(onSubmit).toHaveBeenCalledWith('Card API', '');
  });

  it('refuses a name a Builder flow has and offers to open that flow', async () => {
    const onClose = vi.fn();
    const router = render(<FlowFormModal title="New flow" submitLabel="Create" onClose={onClose} onSubmit={vi.fn()} />);
    await userEvent.type(screen.getByLabelText(/^Name/), 'orders');
    const alert = screen.getByTestId('name-taken');
    expect(within(alert).getByText("A flow named 'Orders' already exists.")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled();

    await userEvent.click(within(alert).getByRole('button', { name: 'Open Orders' }));
    expect(await screen.findByText('Flow editor')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/flows/7');
    expect(onClose).toHaveBeenCalled();
  });

  it('refuses a name that makes the ID of another flow', async () => {
    render(<FlowFormModal title="New flow" submitLabel="Create" onClose={vi.fn()} onSubmit={vi.fn()} />);
    await userEvent.type(screen.getByLabelText(/^Name/), 'Orders!');
    expect(screen.getByText("The name 'Orders!' makes the ID orders, which flow 'Orders' already has.")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled();

    await userEvent.click(screen.getByRole('button', { name: 'Choose another name' }));
    expect(screen.getByLabelText(/^Name/)).toHaveFocus();
    await userEvent.type(screen.getByLabelText(/^Name/), ' 2');
    expect(screen.queryByTestId('name-taken')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create' })).toBeEnabled();
  });

  it('opens a flow that is only published as a new draft', async () => {
    const { calls } = mockFetch({
      ...lists,
      'POST /api/published-flows/customer-refunds/draft': { status: 201, body: { ...draft(9, 'customer-refunds'), files: [] } },
    });
    const router = render(<FlowFormModal title="New flow" submitLabel="Create" onClose={vi.fn()} onSubmit={vi.fn()} />);
    await userEvent.type(screen.getByLabelText(/^Name/), 'Customer Refunds');
    await userEvent.click(screen.getByRole('button', { name: 'Open Customer Refunds' }));
    expect(await screen.findByText('Flow editor')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/flows/9');
    expect(calls.some((c) => c.method === 'POST' && c.url === '/api/published-flows/customer-refunds/draft')).toBe(true);
  });

  it("shows the server's refusal the same way", async () => {
    const { ApiError } = await import('../api/client');
    const onSubmit = vi.fn().mockRejectedValue(
      new ApiError(409, "A flow named 'Payments' already exists.", {
        nameTaken: true,
        existingName: 'Payments',
        existingFolder: 'payments',
      }),
    );
    render(<FlowFormModal title="New flow" submitLabel="Create" onClose={vi.fn()} onSubmit={onSubmit} />);
    await userEvent.type(screen.getByLabelText(/^Name/), 'Payments');
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(await screen.findByText("A flow named 'Payments' already exists.")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open Payments' })).toBeInTheDocument();
  });

  it('lets a flow being renamed keep its own name, without offering to open others', async () => {
    render(
      <FlowFormModal
        title="Rename flow"
        submitLabel="Save"
        initialName="Orders"
        renaming={{ id: 7, name: 'orders' }}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.queryByTestId('name-taken')).not.toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText(/^Name/));
    await userEvent.type(screen.getByLabelText(/^Name/), 'Customer Refunds');
    expect(screen.getByTestId('name-taken')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Open/ })).not.toBeInTheDocument();
  });
});
