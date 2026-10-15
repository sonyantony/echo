import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App, createQueryClient } from '../App';
import { mockFetch } from '../test/fetchMock';

const flow = (id: number, name: string, status = 'DRAFT') => ({
  id,
  name,
  description: `${name} flow`,
  status,
  updatedBy: 'designer',
  updatedAt: '2026-10-14T10:00:00Z',
});

const loggedIn = { 'GET /api/auth/me': { status: 200, body: { username: 'designer', roles: ['DESIGNER'] } } };

beforeEach(() => {
  document.cookie = 'XSRF-TOKEN=abc';
});
afterEach(() => {
  vi.unstubAllGlobals();
  window.history.pushState({}, '', '/');
});

describe('Flow list', () => {
  it('shows an empty state with a create button', async () => {
    mockFetch({ ...loggedIn, 'GET /api/flows': { status: 200, body: [] } });
    render(<App queryClient={createQueryClient()} />);
    expect(await screen.findByText('No flows yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New flow' })).toBeInTheDocument();
  });

  it('lists flows with their status', async () => {
    mockFetch({
      ...loggedIn,
      'GET /api/flows': { status: 200, body: [flow(1, 'orders', 'PUBLISHED'), flow(2, 'refunds')] },
    });
    render(<App queryClient={createQueryClient()} />);
    const table = await screen.findByRole('grid', { name: 'Flows' }).catch(() => screen.findByRole('table'));
    expect(within(table).getByRole('link', { name: 'orders' })).toHaveAttribute('href', '/flows/1');
    expect(within(table).getByText('Published')).toBeInTheDocument();
    expect(within(table).getByText('Draft')).toBeInTheDocument();
  });

  it('validates the name before creating a flow', async () => {
    const { calls } = mockFetch({
      ...loggedIn,
      'GET /api/flows': { status: 200, body: [] },
      'POST /api/flows': { status: 409, body: { detail: "A flow named 'orders' already exists." } },
    });
    render(<App queryClient={createQueryClient()} />);
    await userEvent.click(await screen.findByRole('button', { name: 'New flow' }));
    const dialog = await screen.findByRole('dialog');
    const name = within(dialog).getByLabelText(/Name/);

    await userEvent.type(name, 'My Orders');
    expect(within(dialog).getByRole('button', { name: 'Create' })).toBeDisabled();

    await userEvent.clear(name);
    await userEvent.type(name, 'orders');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create' }));
    expect(await within(dialog).findByText("A flow named 'orders' already exists.")).toBeInTheDocument();
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ name: 'orders', description: '' });
  });

  it('deletes a flow after confirmation', async () => {
    let list = [flow(1, 'orders')];
    const { calls } = mockFetch({
      ...loggedIn,
      'GET /api/flows': () => ({ status: 200, body: list }),
      'DELETE /api/flows/1': () => {
        list = [];
        return { status: 204 };
      },
    });
    render(<App queryClient={createQueryClient()} />);
    await screen.findByRole('link', { name: 'orders' });
    await userEvent.click(screen.getByRole('button', { name: 'Kebab toggle' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Delete' }));
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete' }));

    expect(await screen.findByText('No flows yet')).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'DELETE' && c.url === '/api/flows/1')).toBe(true);
  });
});
