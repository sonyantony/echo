import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App, createQueryClient } from '../App';
import { mockFetch } from '../test/fetchMock';

// The editor pulls in Kaoto, which does not load under jsdom; these tests only check navigation.
vi.mock('./FlowEditorPage', () => ({ FlowEditorPage: () => <p>Flow editor</p> }));

const flow = (id: number, name: string, status = 'DRAFT') => ({
  id,
  name,
  description: `${name} flow`,
  status,
  updatedBy: 'designer',
  updatedAt: '2026-10-14T10:00:00Z',
});

const published = (name: string, version: number) => ({
  name,
  description: `${name} flow`,
  version,
  publishedBy: 'designer',
  publishedAt: '2026-10-14T10:00:00Z',
  flowId: name === 'orders' ? 1 : 2,
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

  it('lists published flows from Git next to the drafts', async () => {
    mockFetch({
      ...loggedIn,
      'GET /api/flows': {
        status: 200,
        body: [flow(1, 'orders', 'PUBLISHED'), flow(2, 'refunds'), flow(3, 'new-one')],
      },
      'GET /api/published-flows': {
        status: 200,
        body: [
          { ...published('orders', 1), draftChanged: false },
          { ...published('refunds', 2), draftChanged: true },
          { name: 'legacy', draftChanged: false },
        ],
      },
    });
    render(<App queryClient={createQueryClient()} />);
    await screen.findByRole('link', { name: 'orders' });
    const names = screen
      .getAllByRole('row')
      .slice(1)
      .map((r) => [(r as HTMLTableRowElement).cells[0].textContent, (r as HTMLTableRowElement).cells[2].textContent]);
    expect(names).toEqual([
      ['legacy', 'Published'],
      ['new-one', 'Draft'],
      ['orders', 'Published v1'], // unchanged since publishing: one row
      ['refunds', 'Published v2'], // published plus newer edits: two rows
      ['refunds', 'Draft'],
    ]);
    expect(screen.getByRole('link', { name: 'orders' })).toHaveAttribute('href', '/flows/1');
    expect(screen.queryByRole('link', { name: 'legacy' })).not.toBeInTheDocument();
  });

  it('opens a flow that is only in Git as a new draft', async () => {
    const { calls } = mockFetch({
      ...loggedIn,
      'GET /api/flows': { status: 200, body: [] },
      'GET /api/published-flows': { status: 200, body: [{ name: 'legacy', draftChanged: false }] },
      'POST /api/published-flows/legacy/draft': { status: 201, body: { ...flow(7, 'legacy'), routeFile: 'legacy.camel.yaml', files: [] } },
    });
    render(<App queryClient={createQueryClient()} />);
    await screen.findByText('legacy');
    await userEvent.click(screen.getByRole('button', { name: 'Kebab toggle' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Edit as draft' }));

    expect(await screen.findByText('Flow editor')).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'POST' && c.url === '/api/published-flows/legacy/draft')).toBe(true);
  });

  it('deletes a published flow from Git', async () => {
    let list = [{ ...published('orders', 1), draftChanged: false }];
    const { calls } = mockFetch({
      ...loggedIn,
      'GET /api/flows': { status: 200, body: [] },
      'GET /api/published-flows': () => ({ status: 200, body: list }),
      'DELETE /api/published-flows/orders': () => {
        list = [];
        return { status: 204 };
      },
    });
    render(<App queryClient={createQueryClient()} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Delete orders' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/removed from every publish target/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));

    expect(await screen.findByText('No flows yet')).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'DELETE' && c.url === '/api/published-flows/orders')).toBe(true);
  });

  it('still shows the drafts when Git cannot be read', async () => {
    mockFetch({
      ...loggedIn,
      'GET /api/flows': { status: 200, body: [flow(2, 'refunds')] },
      'GET /api/published-flows': { status: 502, body: { detail: 'Git error: connection refused' } },
    });
    render(<App queryClient={createQueryClient()} />);
    expect(await screen.findByText('Could not read the published flows')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'refunds' })).toBeInTheDocument();
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
    await userEvent.click(screen.getByRole('button', { name: 'Delete orders' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/never published, so the publish targets are not changed/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));

    expect(await screen.findByText('No flows yet')).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'DELETE' && c.url === '/api/flows/1')).toBe(true);
  });

  it('keeps the flow and shows the error when Git refuses the delete', async () => {
    mockFetch({
      ...loggedIn,
      'GET /api/flows': { status: 200, body: [flow(1, 'orders', 'PUBLISHED')] },
      'DELETE /api/flows/1': { status: 502, body: { detail: 'Git error: push rejected' } },
    });
    render(<App queryClient={createQueryClient()} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Delete orders' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));

    expect(await within(dialog).findByText('Git error: push rejected')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'orders', hidden: true })).toBeInTheDocument();
  });

  it('uploads a saved flow zip and opens it', async () => {
    const { fn } = mockFetch({
      ...loggedIn,
      'GET /api/flows': { status: 200, body: [flow(1, 'orders')] },
      'POST /api/flows/upload': { status: 201, body: { ...flow(3, 'orders-copy'), routeFile: 'orders-copy.camel.yaml' } },
    });
    render(<App queryClient={createQueryClient()} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Upload flow' }));
    const dialog = await screen.findByRole('dialog');
    const upload = within(dialog).getByRole('button', { name: 'Upload' });
    expect(upload).toBeDisabled();

    const zip = new File(['PK'], 'orders.zip', { type: 'application/zip' });
    await userEvent.upload(within(dialog).getByLabelText(/Flow file/), zip);
    await userEvent.type(within(dialog).getByLabelText('Name'), 'orders-copy');
    await userEvent.click(upload);

    expect(await screen.findByText('Flow editor')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/flows/3');
    const [, init] = fn.mock.calls.find(([url]) => url === '/api/flows/upload')!;
    const form = init!.body as FormData;
    expect((form.get('file') as File).name).toBe('orders.zip');
    expect(form.get('name')).toBe('orders-copy');
    expect(new Headers(init!.headers).get('X-XSRF-TOKEN')).toBe('abc');
  });

  it('shows why an upload was refused', async () => {
    mockFetch({
      ...loggedIn,
      'GET /api/flows': { status: 200, body: [] },
      'POST /api/flows/upload': { status: 409, body: { detail: "A flow named 'orders' already exists." } },
    });
    render(<App queryClient={createQueryClient()} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Upload flow' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.upload(within(dialog).getByLabelText(/Flow file/), new File(['PK'], 'orders.zip'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Upload' }));
    expect(await within(dialog).findByText("A flow named 'orders' already exists.")).toBeInTheDocument();
  });

  it('offers a download of each flow', async () => {
    mockFetch({ ...loggedIn, 'GET /api/flows': { status: 200, body: [flow(1, 'orders')] } });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.getAttribute('href')).toBe('/api/flows/1/download');
    });
    render(<App queryClient={createQueryClient()} />);
    await screen.findByRole('link', { name: 'orders' });
    await userEvent.click(screen.getByRole('button', { name: 'Kebab toggle' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Download' }));
    expect(click).toHaveBeenCalledOnce();
    click.mockRestore();
  });
});
