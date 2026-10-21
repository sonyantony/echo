import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import { createQueryClient } from '../App';
import { mockFetch } from '../test/fetchMock';
import { ApiSpecPanel } from './ApiSpecPanel';
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

describe('Openapi Design panel', () => {
  it('opens a new spec in Apicurio and saves it as YAML under the name asked for', async () => {
    const { calls } = mockFetch({
      'GET /api/editor/settings': { status: 200, body: { autosaveSeconds: 0 } },
      'GET /api/flows/1': { status: 200, body: flow(null) },
      'PUT /api/flows/1/api-spec/order-api.yaml': { status: 200, body: flow('order-api.yaml') },
    });
    const onDirtyChange = vi.fn();
    const onNameChange = vi.fn();
    renderPanel({ onDirtyChange, onNameChange });

    const frame = (await screen.findByTitle('OpenAPI editor')) as HTMLIFrameElement;
    expect(frame).toHaveAttribute('src', '/apicurio-editor/index.html');
    expect(onNameChange).toHaveBeenLastCalledWith(null);
    expect(screen.getByRole('radio', { name: 'YAML' })).toBeChecked();

    // Once the frame has loaded, the spec (a starter one named after the flow) is sent to it.
    const posted = vi.spyOn(frame.contentWindow!, 'postMessage');
    vi.useFakeTimers();
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

    edit(frame, edited);
    // Unsaved edits are reported to the flow editor, which shows "Unsaved changes".
    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(true));

    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText(/File name/), 'order-api');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Saved order-api.yaml.')).toBeInTheDocument();
    const put = calls.find((c) => c.method === 'PUT');
    expect(put?.url).toBe('/api/flows/1/api-spec/order-api.yaml');
    expect(put?.body).toContain('Order: {}');
    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(false));
    expect(onNameChange).toHaveBeenLastCalledWith('order-api.yaml');
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
    expect(screen.getByRole('radio', { name: 'YAML' })).toBeChecked();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();

    await userEvent.click(screen.getByRole('radio', { name: 'JSON' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onNameChange).toHaveBeenLastCalledWith('orders.json'));
    const put = calls.find((c) => c.method === 'PUT');
    expect(put?.url).toBe('/api/flows/1/api-spec/orders.json');
    expect(put?.body).toEqual({ openapi: '3.0.3', info: { title: 'Orders', version: '1.0.0' }, paths: {} });
  });

  it('asks before Discard throws away unsaved edits, then starts from a blank spec', async () => {
    mockFetch({
      'GET /api/editor/settings': { status: 200, body: { autosaveSeconds: 0 } },
      'GET /api/flows/1': { status: 200, body: flow(null) },
    });
    const onDirtyChange = vi.fn();
    renderPanel({ onDirtyChange });
    const frame = (await screen.findByTitle('OpenAPI editor')) as HTMLIFrameElement;
    edit(frame, edited);
    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(true));

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
});
