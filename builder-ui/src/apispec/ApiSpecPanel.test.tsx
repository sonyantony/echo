import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import { createQueryClient } from '../App';
import { mockFetch } from '../test/fetchMock';
import { createRef } from 'react';
import { ApiSpecPanel, type ApiSpecPanelHandle } from './ApiSpecPanel';
import { newApiSpec } from './apiSpec';

// The panel is shown by the flow editor (in place of Kaoto's views); here it is rendered on its own.
function renderPanel(props: { onDirtyChange?: (dirty: boolean) => void; onNameChange?: (name: string | null) => void } = {}) {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <ApiSpecPanel flowId={1} flowName="orders" flowDescription="Order intake" {...props} />
    </QueryClientProvider>,
  );
}

const flow = (apiSpec: string | null) => ({ id: 1, name: 'orders', routeFile: 'orders.camel.yaml', files: [], apiSpec });

/** An edit in the editor (e.g. a data type made from a sample JSON) arrives as a message from its frame. */
function edit(frame: HTMLIFrameElement, content: unknown) {
  act(() => {
    window.dispatchEvent(
      new MessageEvent('message', { source: frame.contentWindow, data: { type: 'apicurio_onChange', data: { content } } }),
    );
  });
}

const edited = { openapi: '3.0.3', info: { title: 'orders', version: '1.0.0' }, components: { schemas: { Order: {} } } };

beforeEach(() => {
  document.cookie = 'XSRF-TOKEN=abc';
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Openapi panel', () => {
  it('opens a new spec in Apicurio and saves it as YAML under the name asked for', async () => {
    const { calls } = mockFetch({
      'GET /api/editor/settings': { status: 200, body: { autosaveSeconds: 0 } },
      'GET /api/flows/1': { status: 200, body: flow(null) },
      'PUT /api/flows/1/api-spec/orders-api.yaml': { status: 200, body: flow('orders-api.yaml') },
    });
    const onDirtyChange = vi.fn();
    const onNameChange = vi.fn();
    renderPanel({ onDirtyChange, onNameChange });

    const frame = (await screen.findByTitle('OpenAPI editor')) as HTMLIFrameElement;
    expect(frame).toHaveAttribute('src', '/apicurio-editor/index.html');
    expect(onNameChange).toHaveBeenLastCalledWith(null);
    expect(screen.getByRole('radio', { name: 'Yaml' })).toBeChecked();

    // Once the frame has loaded, the spec (a starter one named after the flow) is sent to it.
    const posted = vi.spyOn(frame.contentWindow!, 'postMessage');
    // Only setInterval (the resend loop) is faked: React's own scheduling must keep running, or the
    // editor opened when the spec arrives may never start listening for its changes.
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    fireEvent.load(frame);
    act(() => vi.advanceTimersByTime(250));
    vi.useRealTimers();
    expect(posted).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'apicurio-editingInfo',
        data: expect.objectContaining({ content: { type: 'OPENAPI', value: newApiSpec('orders', 'Order intake') } }),
      }),
      window.location.origin,
    );

    // Unsaved edits are reported to the flow editor, which shows "Unsaved changes". The editor can
    // open again while the settings load, with a new frame: the edit is sent from the frame on
    // screen until the panel takes it.
    await waitFor(() => {
      edit(screen.getByTitle('OpenAPI editor') as HTMLIFrameElement, edited);
      expect(onDirtyChange).toHaveBeenLastCalledWith(true);
    });

    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    const dialog = await screen.findByRole('dialog');
    // The name offered is <flow name>-api.
    expect(within(dialog).getByLabelText(/File name/)).toHaveValue('orders-api.yaml');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Saved orders-api.yaml.')).toBeInTheDocument();
    const put = calls.find((c) => c.method === 'PUT');
    expect(put?.url).toBe('/api/flows/1/api-spec/orders-api.yaml');
    expect(put?.body).toContain('Order: {}');
    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(false));
    expect(onNameChange).toHaveBeenLastCalledWith('orders-api.yaml');
  });

  it('opens the saved spec under its name; picking JSON saves it as .json', async () => {
    const { calls } = mockFetch({
      'GET /api/editor/settings': { status: 200, body: { autosaveSeconds: 0 } },
      'GET /api/flows/1': { status: 200, body: flow('orders.yml') },
      'PUT /api/flows/1/api-spec/orders.json': { status: 200, body: flow('orders.json') },
    });
    // The file is plain text (YAML), which the JSON fetch stub cannot serve: answer it directly.
    const yaml = 'openapi: 3.0.3\ninfo:\n  title: Orders\n  version: 1.0.0\npaths: {}\n';
    const stub = fetch as unknown as ReturnType<typeof vi.fn>;
    const json = stub.getMockImplementation()!;
    stub.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) =>
      String(input) === '/api/flows/1/files/orders.yml' ? new Response(yaml, { status: 200 }) : json(input, init),
    );
    const onNameChange = vi.fn();
    renderPanel({ onNameChange });

    await screen.findByTitle('OpenAPI editor');
    await waitFor(() => expect(onNameChange).toHaveBeenLastCalledWith('orders.yml'));
    expect(screen.getByRole('radio', { name: 'Yaml' })).toBeChecked();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();

    await userEvent.click(screen.getByRole('radio', { name: 'Json' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onNameChange).toHaveBeenLastCalledWith('orders.json'));
    const put = calls.find((c) => c.method === 'PUT');
    expect(put?.url).toBe('/api/flows/1/api-spec/orders.json');
    expect(put?.body).toEqual({ openapi: '3.0.3', info: { title: 'Orders', version: '1.0.0' }, paths: {} });
  });

  it("keeps the file's comments and an operation's own id on Save; a moved path renames it once", async () => {
    const { calls } = mockFetch({
      'GET /api/editor/settings': { status: 200, body: { autosaveSeconds: 0 } },
      'GET /api/flows/1': { status: 200, body: flow('cards.yaml') },
      'PUT /api/flows/1/api-spec/cards.yaml': { status: 200, body: flow('cards.yaml') },
    });
    const yaml = [
      '# Cards, from the partner',
      'openapi: 3.0.3',
      'info: { title: Cards, version: 1.0.0 }',
      'paths:',
      '  /cards:',
      '    get: { operationId: listCards }',
      '  /cards/{id}:',
      '    # one card',
      '    get: { operationId: fetchCard }',
      '',
    ].join('\n');
    const stub = fetch as unknown as ReturnType<typeof vi.fn>;
    const json = stub.getMockImplementation()!;
    stub.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) =>
      String(input) === '/api/flows/1/files/cards.yaml' ? new Response(yaml, { status: 200 }) : json(input, init),
    );
    const onOperationIdsRenamed = vi.fn();
    render(
      <QueryClientProvider client={createQueryClient()}>
        <ApiSpecPanel flowId={1} flowName="cards" onOperationIdsRenamed={onOperationIdsRenamed} />
      </QueryClientProvider>,
    );
    await screen.findByTitle('OpenAPI editor');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled());
    const moved = {
      openapi: '3.0.3',
      info: { title: 'Cards', version: '1.0.0' },
      paths: { '/payment-cards': { get: { operationId: 'listCards' } }, '/cards/{id}': { get: { operationId: 'fetchCard' } } },
    };
    await waitFor(() => {
      edit(screen.getByTitle('OpenAPI editor') as HTMLIFrameElement, moved);
      expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
    });
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Saved cards.yaml.')).toBeInTheDocument();
    let put = calls.filter((c) => c.method === 'PUT').at(-1)!.body as string;
    expect(put).toContain('# Cards, from the partner\n');
    expect(put).toContain('  /cards/{id}:\n    # one card\n    get: { operationId: fetchCard }');
    expect(put).toContain('/payment-cards');
    expect(put).toContain('operationId: getPaymentCards');
    expect(onOperationIdsRenamed).toHaveBeenCalledWith([{ from: 'listCards', to: 'getPaymentCards', label: 'GET /payment-cards' }]);

    // The editor still shows the old id; another edit saved keeps the new one, without renaming again.
    edit(screen.getByTitle('OpenAPI editor') as HTMLIFrameElement, { ...moved, info: { title: 'Cards', version: '1.1.0' } });
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(2));
    put = calls.filter((c) => c.method === 'PUT').at(-1)!.body as string;
    expect(put).toContain('version: 1.1.0');
    expect(put).toContain('operationId: getPaymentCards');
    expect(put).toContain('# one card');
    expect(onOperationIdsRenamed).toHaveBeenCalledTimes(1);
  });

  it('gives each operation of an uploaded spec a route under its own id, and lets go of the old ones', async () => {
    mockFetch({
      'GET /api/editor/settings': { status: 200, body: { autosaveSeconds: 0 } },
      'GET /api/flows/1': { status: 200, body: flow('cards.yaml') },
      'PUT /api/flows/1/api-spec/cards-v2.yaml': { status: 200, body: flow('cards-v2.yaml') },
      'POST /api/flows/1/path-clashes': { status: 200, body: [] },
    });
    const yaml = 'openapi: 3.0.3\ninfo: { title: Cards, version: 1.0.0 }\npaths:\n  /old:\n    get: { operationId: getOld }\n  /cards:\n    get: { operationId: listCards }\n';
    const stub = fetch as unknown as ReturnType<typeof vi.fn>;
    const json = stub.getMockImplementation()!;
    stub.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) =>
      String(input) === '/api/flows/1/files/cards.yaml' ? new Response(yaml, { status: 200 }) : json(input, init),
    );
    const onOperationsChanged = vi.fn();
    render(
      <QueryClientProvider client={createQueryClient()}>
        <ApiSpecPanel flowId={1} flowName="cards" onOperationsChanged={onOperationsChanged} />
      </QueryClientProvider>,
    );
    await screen.findByTitle('OpenAPI editor');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled());

    const uploaded = '# v2\nopenapi: 3.0.3\ninfo: { title: Cards, version: 2.0.0 }\npaths:\n  /cards:\n    get: { operationId: listCards }\n    post: {}\n';
    await userEvent.upload(screen.getByTestId('spec-upload-input'), new File([uploaded], 'cards-v2.yaml', { type: 'application/yaml' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Replace' }));
    await waitFor(() => expect(onOperationsChanged).toHaveBeenCalled());
    const { added, removed } = onOperationsChanged.mock.calls.at(-1)![0];
    expect(added.map((op: { operationId: string }) => op.operationId)).toEqual(['listCards', 'postCards']);
    expect(removed.map((op: { operationId: string }) => op.operationId)).toEqual(['getOld']);
  });

  it('Import From Jira adds operations with routes, unsaved, and Undo takes them out again', async () => {
    mockFetch({
      'GET /api/editor/settings': { status: 200, body: { autosaveSeconds: 0, jiraImport: true } },
      'GET /api/flows/1': { status: 200, body: flow(null) },
      'POST /api/flows/1/path-clashes': { status: 200, body: [] },
      'POST /api/jira/story-examples': {
        status: 200,
        body: {
          key: 'PAY-142',
          summary: 'Pay a bill',
          link: 'https://acme.atlassian.net/browse/PAY-142',
          comments: 0,
          examples: [{ id: 1, json: '{"paymentId": "p-1"}', source: 'Description', role: 'response' }],
          operations: [{ method: 'GET', path: '/payments?status=OPEN', request: null, response: 1, examples: [1] }],
        },
      },
    });
    const onOperationsChanged = vi.fn();
    const onDirtyChange = vi.fn();
    render(
      <QueryClientProvider client={createQueryClient()}>
        <ApiSpecPanel flowId={1} flowName="payments" onOperationsChanged={onOperationsChanged} onDirtyChange={onDirtyChange} />
      </QueryClientProvider>,
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Import From Jira' }));
    await userEvent.type(screen.getByLabelText(/Story link/), 'PAY-142');
    await userEvent.click(screen.getByRole('button', { name: 'Read Story' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Add To Spec' }));

    expect(await screen.findByText('Check what was added')).toBeInTheDocument();
    expect(onOperationsChanged).toHaveBeenLastCalledWith({ added: [expect.objectContaining({ method: 'GET', path: '/payments', operationId: 'getPayments' })], removed: [] });
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);

    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(onOperationsChanged).toHaveBeenLastCalledWith({ added: [], removed: [expect.objectContaining({ operationId: 'getPayments' })] });
    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(false));
  });

  it('Interface Specs from Samples adds a method to the spec, under the path it has, with a route', async () => {
    mockFetch({
      'GET /api/editor/settings': { status: 200, body: { autosaveSeconds: 0 } },
      'GET /api/flows/1': { status: 200, body: flow('cards.yaml') },
      'POST /api/flows/1/path-clashes': { status: 200, body: [] },
    });
    const yaml = 'openapi: 3.0.3\ninfo: { title: Cards, version: 1.0.0 }\npaths:\n  /cards/{id}:\n    get: { operationId: getCardsId }\n';
    const stub = fetch as unknown as ReturnType<typeof vi.fn>;
    const json = stub.getMockImplementation()!;
    stub.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) =>
      String(input) === '/api/flows/1/files/cards.yaml' ? new Response(yaml, { status: 200 }) : json(input, init),
    );
    const onOperationsChanged = vi.fn();
    render(
      <QueryClientProvider client={createQueryClient()}>
        <ApiSpecPanel flowId={1} flowName="cards" onOperationsChanged={onOperationsChanged} />
      </QueryClientProvider>,
    );
    await screen.findByTitle('OpenAPI editor');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled());

    await userEvent.click(screen.getByRole('button', { name: 'Interface Specs from Samples' }));
    await userEvent.selectOptions(screen.getByLabelText('Method'), 'GET');
    await userEvent.type(screen.getByLabelText(/Path/), '/cards/{{cardId}');
    await userEvent.click(screen.getByLabelText(/Sample response/));
    await userEvent.paste('{"id": "c-1"}');
    // GET /cards/{id} is there already, under another {name}: it could be replaced.
    expect(screen.getByRole('button', { name: 'Replace GET /cards/{cardId}' })).toBeEnabled();
    await userEvent.selectOptions(screen.getByLabelText('Method'), 'DELETE');
    await userEvent.click(screen.getByRole('button', { name: 'Add to this spec' }));

    expect(await screen.findByText('Added DELETE /cards/{id} from the samples: save to keep it.')).toBeInTheDocument();
    expect(onOperationsChanged).toHaveBeenLastCalledWith({ added: [expect.objectContaining({ method: 'DELETE', path: '/cards/{id}', operationId: 'deleteCardsId' })], removed: [], changed: [] });
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
  });

  it('offers Import From Jira only when Jira is set up', async () => {
    mockFetch({
      'GET /api/editor/settings': { status: 200, body: { autosaveSeconds: 0 } },
      'GET /api/flows/1': { status: 200, body: flow(null) },
    });
    renderPanel();
    await screen.findByTitle('OpenAPI editor');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Discard' })).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Import From Jira' })).not.toBeInTheDocument();
  });

  it('refuses an uploaded spec with paths other flows have', async () => {
    const { calls } = mockFetch({
      'GET /api/editor/settings': { status: 200, body: { autosaveSeconds: 0 } },
      'GET /api/flows/1': { status: 200, body: flow(null) },
      'POST /api/flows/1/path-clashes': {
        status: 200,
        body: [{ path: '/shop/shoes/{id}', specPath: '/shoes/{id}', otherPath: '/shop/shoes', flowName: 'Shoe Shop', flowId: 2 }],
      },
    });
    renderPanel();
    await screen.findByTitle('OpenAPI editor');

    const uploaded = 'openapi: 3.0.3\ninfo: { title: Shoes, version: 1.0.0 }\npaths:\n  /shoes/{id}:\n    get: {}\n';
    await userEvent.upload(screen.getByTestId('spec-upload-input'), new File([uploaded], 'shoes.yaml', { type: 'application/yaml' }));
    const dialog = await screen.findByRole('dialog', { name: /shoes.yaml cannot be uploaded/ });
    expect(dialog).toHaveTextContent('/shop/shoes/{id} is in flow Shoe Shop (as /shop/shoes)');
    expect(dialog).toHaveTextContent('Nothing was uploaded.');
    expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(0);
  });

  it('offers to switch to the flow that has a path just added, saving this one without it', async () => {
    const yaml = 'openapi: 3.0.3\ninfo: { title: Cards, version: 1.0.0 }\npaths:\n  /cards:\n    get: { operationId: getCards }\n';
    const { calls } = mockFetch({
      'GET /api/editor/settings': { status: 200, body: { autosaveSeconds: 0 } },
      'GET /api/flows/1': { status: 200, body: flow('cards.yaml') },
      'PUT /api/flows/1/api-spec/cards.yaml': { status: 200, body: flow('cards.yaml') },
      'POST /api/flows/1/path-clashes': {
        status: 200,
        body: [{ path: '/shoes', specPath: '/shoes', otherPath: '/shoes/{id}', flowName: 'Shoe Shop', flowId: 2 }],
      },
    });
    const stub = fetch as unknown as ReturnType<typeof vi.fn>;
    const json = stub.getMockImplementation()!;
    stub.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) =>
      String(input) === '/api/flows/1/files/cards.yaml' ? new Response(yaml, { status: 200 }) : json(input, init),
    );
    const onSwitchToFlow = vi.fn(async () => {});
    render(
      <QueryClientProvider client={createQueryClient()}>
        <ApiSpecPanel flowId={1} flowName="cards" onSwitchToFlow={onSwitchToFlow} />
      </QueryClientProvider>,
    );
    await screen.findByTitle('OpenAPI editor');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled());

    const added = {
      openapi: '3.0.3',
      info: { title: 'Cards', version: '1.0.0' },
      paths: { '/cards': { get: { operationId: 'getCards' } }, '/shoes': {} },
    };
    await waitFor(() => {
      edit(screen.getByTitle('OpenAPI editor') as HTMLIFrameElement, added);
      expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
    });
    const dialog = await screen.findByRole('dialog', { name: /This path is in another flow/ });
    expect(dialog).toHaveTextContent('/shoes is already in flow Shoe Shop');
    expect(calls.find((c) => c.url === '/api/flows/1/path-clashes')!.body).toEqual({ spec: expect.any(String), paths: ['/shoes'] });

    await userEvent.click(within(dialog).getByRole('button', { name: 'Switch to Shoe Shop' }));
    await waitFor(() => expect(onSwitchToFlow).toHaveBeenCalledWith(2));
    const put = calls.filter((c) => c.method === 'PUT').at(-1)!.body as string;
    expect(put).toContain('/cards');
    expect(put).not.toContain('/shoes');
  });

  it('asks before Discard throws away unsaved edits, then starts from a blank spec', async () => {
    mockFetch({
      'GET /api/editor/settings': { status: 200, body: { autosaveSeconds: 0 } },
      'GET /api/flows/1': { status: 200, body: flow(null) },
    });
    const onDirtyChange = vi.fn();
    renderPanel({ onDirtyChange });
    await screen.findByTitle('OpenAPI editor');
    // Sent from the frame on screen until the panel takes it (the editor can open again with a new frame).
    await waitFor(() => {
      edit(screen.getByTitle('OpenAPI editor') as HTMLIFrameElement, edited);
      expect(onDirtyChange).toHaveBeenLastCalledWith(true);
    });
    const frame = screen.getByTitle('OpenAPI editor');

    await userEvent.click(screen.getByRole('button', { name: 'Discard' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Discard' }));
    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(false));
    expect(screen.getByTitle('OpenAPI editor')).not.toBe(frame);
  });

  it('ignores messages that do not come from the editor frame', async () => {
    mockFetch({
      'GET /api/editor/settings': { status: 200, body: { autosaveSeconds: 0 } },
      'GET /api/flows/1': { status: 200, body: flow(null) },
    });
    const onDirtyChange = vi.fn();
    renderPanel({ onDirtyChange });
    await screen.findByTitle('OpenAPI editor');

    act(() => {
      window.dispatchEvent(new MessageEvent('message', { source: window, data: { type: 'apicurio_onChange', data: { content: {} } } }));
    });
    expect(onDirtyChange).not.toHaveBeenCalledWith(true);
  });

  it('on the untitled flow keeps the spec on screen and leaves Save to the flow', async () => {
    const { calls } = mockFetch({ 'GET /api/editor/settings': { status: 200, body: { autosaveSeconds: 1 } } });
    const onSaveFlow = vi.fn();
    const onDirtyChange = vi.fn();
    const panel = createRef<ApiSpecPanelHandle>();
    render(
      <QueryClientProvider client={createQueryClient()}>
        <ApiSpecPanel ref={panel} flowName="untitled" onSaveFlow={onSaveFlow} onDirtyChange={onDirtyChange} />
      </QueryClientProvider>,
    );
    await screen.findByTitle('OpenAPI editor');
    expect(panel.current!.unsavedSpec()).toBeUndefined();

    // The editor can open again while the settings load, with a new frame: the edit is sent from
    // the frame on screen until the panel takes it.
    await waitFor(() => {
      edit(screen.getByTitle('OpenAPI editor') as HTMLIFrameElement, { ...edited, info: { title: 'Card API', version: '1.0.0' } });
      expect(onDirtyChange).toHaveBeenLastCalledWith(true);
    });
    await userEvent.click(screen.getByRole('radio', { name: 'Json' }));
    expect(panel.current!.unsavedSpec()).toEqual({ json: expect.stringContaining('Card API'), format: 'json', name: null });

    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSaveFlow).toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    // A copy from another flow goes on screen under its own name, still unsaved.
    act(() => panel.current!.show('cards.yaml', 'openapi: 3.0.3\ninfo:\n  title: Cards\n  version: 1.0.0\npaths: {}\n'));
    expect(await screen.findByText('Opened cards.yaml: save the flow to keep it.')).toBeInTheDocument();
    expect(panel.current!.unsavedSpec()).toEqual({
      json: expect.stringContaining('Cards'),
      format: 'yaml',
      name: 'cards.yaml',
      // The file itself, whose comments the flow's first Save keeps.
      text: 'openapi: 3.0.3\ninfo:\n  title: Cards\n  version: 1.0.0\npaths: {}\n',
    });

    // Nothing is written: there is no flow to write to yet (and autosave stays off).
    await new Promise((resolve) => setTimeout(resolve, 1200));
    expect(calls.filter((c) => c.url !== '/api/editor/settings')).toEqual([]);
  });
});
