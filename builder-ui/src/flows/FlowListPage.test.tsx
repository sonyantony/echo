import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App, createQueryClient } from '../App';
import { mockFetch } from '../test/fetchMock';

// The editor pulls in Kaoto, which does not load under jsdom; these tests only check navigation.
vi.mock('./FlowEditorPage', () => ({ FlowEditorPage: () => <p>Flow editor</p> }));

const flow = (id: number, name: string, status = 'DRAFT', displayName = name) => ({
  id,
  name,
  displayName,
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
  window.history.pushState({}, '', '/flows');
});
afterEach(() => {
  vi.unstubAllGlobals();
  window.history.pushState({}, '', '/');
  localStorage.clear();
});

describe('Flow list', () => {
  it('shows an empty state with a create button', async () => {
    mockFetch({ ...loggedIn, 'GET /api/flows': { status: 200, body: [] } });
    render(<App queryClient={createQueryClient()} />);
    expect(await screen.findByText('No flows yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
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
      .map((r) => {
        const cells = (r as HTMLTableRowElement).cells;
        return [cells[0].textContent, cells[2].textContent, cells[3].textContent];
      });
    // Every flow in Git has its own row, next to the Builder's own row for it.
    expect(names).toEqual([
      ['legacy', 'Published', 'Git'],
      ['new-one', 'Draft', 'Builder'],
      ['orders', 'Published v1', 'Git'],
      ['orders', 'Published', 'Builder'],
      ['refunds', 'Published v2', 'Git'],
      ['refunds', 'Draft', 'Builder'],
    ]);
    expect(screen.getByRole('link', { name: 'orders' })).toHaveAttribute('href', '/flows/1');
    for (const name of ['legacy', 'orders', 'refunds']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument(); // the Git rows open too
    }
  });

  it('opens a Git row in the editor: the draft when it is the same, else after asking', async () => {
    const { calls } = mockFetch({
      ...loggedIn,
      'GET /api/flows': { status: 200, body: [flow(1, 'orders', 'PUBLISHED'), flow(2, 'refunds')] },
      'GET /api/published-flows': {
        status: 200,
        body: [
          { ...published('orders', 1), draftChanged: false, target: 'Git' },
          { ...published('refunds', 2), draftChanged: true, target: 'Git' },
        ],
      },
      'POST /api/published-flows/refunds/draft?replace=true': {
        status: 201,
        body: { ...flow(2, 'refunds', 'PUBLISHED'), routeFile: 'refunds.camel.yaml', files: [] },
      },
    });
    render(<App queryClient={createQueryClient()} />);

    await userEvent.click(await screen.findByRole('button', { name: 'orders' }));
    expect(await screen.findByText('Flow editor')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/flows/1');
    expect(calls.some((c) => c.method === 'POST')).toBe(false);

    // A draft with other changes: the user chooses, nothing is replaced until they do.
    const back = async () => {
      window.history.pushState({}, '', '/flows');
      window.dispatchEvent(new PopStateEvent('popstate', { state: window.history.state }));
      await userEvent.click(await screen.findByRole('button', { name: 'refunds' }));
      return screen.findByRole('dialog');
    };
    let dialog = await back();
    expect(within(dialog).getByText(/changes that are not in Git/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Open my draft' }));
    expect(await screen.findByText('Flow editor')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/flows/2');
    expect(calls.some((c) => c.method === 'POST')).toBe(false);

    dialog = await back();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Replace draft with Git version' }));
    expect(await screen.findByText('Flow editor')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/flows/2');
    expect(calls.some((c) => c.method === 'POST' && c.url === '/api/published-flows/refunds/draft?replace=true')).toBe(
      true,
    );
  });

  it('filters the list by search text and by Published / Unpublished', async () => {
    mockFetch({
      ...loggedIn,
      'GET /api/flows': { status: 200, body: [flow(2, 'refunds'), { ...flow(3, 'billing'), description: 'Monthly invoices' }] },
      'GET /api/published-flows': {
        status: 200,
        body: [
          { ...published('orders', 1), draftChanged: false },
          { ...published('refunds', 2), draftChanged: true },
        ],
      },
    });
    render(<App queryClient={createQueryClient()} />);
    await screen.findByRole('button', { name: 'orders' });
    const shown = () =>
      screen
        .queryAllByRole('row')
        .slice(1)
        .map((r) => `${(r as HTMLTableRowElement).cells[0].textContent} ${(r as HTMLTableRowElement).cells[2].textContent}`);

    const search = screen.getByRole('textbox', { name: 'Search flows' });
    await userEvent.type(search, 'REF');
    expect(shown()).toEqual(['refunds Published v2', 'refunds Draft']);
    await userEvent.clear(search);
    await userEvent.type(search, 'invoices'); // matches the description
    expect(shown()).toEqual(['billing Draft']);
    await userEvent.clear(search);

    await userEvent.click(screen.getByRole('checkbox', { name: 'Published' }));
    expect(shown()).toEqual(['billing Draft', 'refunds Draft']);
    await userEvent.click(screen.getByRole('checkbox', { name: 'Unpublished' }));
    expect(shown()).toEqual([]);
    expect(screen.getByText('No flows match')).toBeInTheDocument();
    expect(screen.getByText('Tick Published or Unpublished to see flows.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Published' }));
    expect(shown()).toEqual(['orders Published v1', 'refunds Published v2']);

    await userEvent.type(search, 'nothing like this');
    expect(screen.getByText('No flows match')).toBeInTheDocument();
  });

  it('is titled Open Flow, with no create buttons once there are flows, and Cancel goes back (or to the last flow, or the start page)', async () => {
    mockFetch({ ...loggedIn, 'GET /api/flows': { status: 200, body: [flow(1, 'orders'), flow(2, 'refunds')] } });
    render(<App queryClient={createQueryClient()} />);
    expect(await screen.findByRole('heading', { name: 'Open Flow' })).toBeInTheDocument();
    await screen.findByRole('link', { name: 'orders' });
    for (const name of ['New flow', 'Open Flow Template', 'Upload flow']) {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
    }

    // With no previous screen and no flow worked on, Cancel goes to the start page.
    localStorage.clear();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(await screen.findByText('Start with a flow')).toBeInTheDocument();

    // A flow worked on earlier (remembered by the editor) that has since been deleted: the start page too.
    localStorage.setItem('echo.lastFlowId', '99');
    window.history.pushState({}, '', '/flows');
    window.dispatchEvent(new PopStateEvent('popstate', { state: window.history.state }));
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(await screen.findByText('Start with a flow')).toBeInTheDocument();

    // ...and one that still exists: back to it.
    localStorage.setItem('echo.lastFlowId', '1');
    window.history.pushState({}, '', '/flows');
    window.dispatchEvent(new PopStateEvent('popstate', { state: window.history.state }));
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(await screen.findByText('Flow editor')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/flows/1');

    // The editor's File > Open Flow passes where you came from; Cancel goes back there.
    window.history.pushState({ usr: { from: '/flows/2' }, key: 'x', idx: 2 }, '', '/flows');
    window.dispatchEvent(new PopStateEvent('popstate', { state: window.history.state }));
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(await screen.findByText('Flow editor')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/flows/2');
  });

  it('opens a flow that is only in Git as a new draft', async () => {
    const { calls } = mockFetch({
      ...loggedIn,
      'GET /api/flows': { status: 200, body: [] },
      'GET /api/published-flows': { status: 200, body: [{ name: 'legacy', draftChanged: false }] },
      'POST /api/published-flows/legacy/draft': { status: 201, body: { ...flow(7, 'legacy'), routeFile: 'legacy.camel.yaml', files: [] } },
    });
    render(<App queryClient={createQueryClient()} />);
    await userEvent.click(await screen.findByRole('button', { name: 'legacy' }));

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

  it('disables a published flow after confirmation and enables it again', async () => {
    let disabled = false;
    const { calls } = mockFetch({
      ...loggedIn,
      'GET /api/flows': { status: 200, body: [] },
      'GET /api/published-flows': () => ({
        status: 200,
        body: [{ ...published('orders', 1), flowId: null, draftChanged: false, disabled }],
      }),
      'POST /api/published-flows/orders/disable': () => {
        disabled = true;
        return { status: 204 };
      },
      'POST /api/published-flows/orders/enable': () => {
        disabled = false;
        return { status: 204 };
      },
    });
    render(<App queryClient={createQueryClient()} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Kebab toggle' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Disable' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/leaves it out of the images/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Disable' }));

    expect(await screen.findByText('Disabled')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Kebab toggle' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Enable' }));
    await vi.waitFor(() => expect(screen.queryByText('Disabled')).not.toBeInTheDocument());
    expect(calls.filter((c) => c.method === 'POST').map((c) => c.url)).toEqual([
      '/api/published-flows/orders/disable',
      '/api/published-flows/orders/enable',
    ]);
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

    await userEvent.type(name, ' ');
    expect(within(dialog).getByRole('button', { name: 'Create' })).toBeDisabled();
    await userEvent.type(name, 'x'.repeat(101));
    expect(within(dialog).getByRole('button', { name: 'Create' })).toBeDisabled();
    expect(within(dialog).getByText('Use at most 100 characters.')).toBeInTheDocument();

    await userEvent.clear(name);
    await userEvent.type(name, 'orders');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create' }));
    expect(await within(dialog).findByText("A flow named 'orders' already exists.")).toBeInTheDocument();
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ name: 'orders', description: '' });
  });

  it('takes any name and shows the ID made from it', async () => {
    const { calls } = mockFetch({
      ...loggedIn,
      'GET /api/flows': { status: 200, body: [] },
      'GET /api/published-flows': { status: 200, body: [] },
      'POST /api/flows': { status: 201, body: { ...flow(2, 'first-flow', 'DRAFT', 'First Flow'), files: [] } },
    });
    render(<App queryClient={createQueryClient()} />);
    await userEvent.click(await screen.findByRole('button', { name: 'New flow' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText(/Name/), 'First Flow');
    expect(within(dialog).getByText('ID: first-flow (its folder in Git is flows/first-flow/).')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create' }));
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ name: 'First Flow', description: '' });
  });

  it('shows the flow name, with its ID under it when they differ', async () => {
    mockFetch({
      ...loggedIn,
      'GET /api/flows': { status: 200, body: [flow(1, 'first-flow', 'DRAFT', 'First Flow'), flow(2, 'orders')] },
      'GET /api/published-flows': {
        status: 200,
        body: [{ ...published('first-flow', 1), flowId: 1, displayName: 'First Flow', draftChanged: false }],
      },
    });
    render(<App queryClient={createQueryClient()} />);
    expect(await screen.findByRole('link', { name: 'First Flow' })).toHaveAttribute('href', '/flows/1');
    expect(screen.getByRole('button', { name: 'First Flow' })).toBeInTheDocument();
    expect(screen.getAllByText('ID: first-flow')).toHaveLength(2);
    expect(screen.queryByText('ID: orders')).not.toBeInTheDocument();

    await userEvent.type(screen.getByRole('textbox', { name: 'Search flows' }), 'first-fl');
    expect(screen.queryByRole('link', { name: 'orders' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'First Flow' })).toBeInTheDocument();
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
      'GET /api/flows': { status: 200, body: [] }, // with flows listed, Upload is in the editor's File menu
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
