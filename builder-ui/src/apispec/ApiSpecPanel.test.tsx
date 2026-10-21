import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import { createQueryClient } from '../App';
import { mockFetch } from '../test/fetchMock';
import { ApiSpecPanel } from './ApiSpecPanel';
import { newApiSpec } from './apiSpec';

// The panel is shown by the flow editor (in place of Kaoto's views); here it is rendered on its own.
function renderPanel(onDirtyChange?: (dirty: boolean) => void) {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <ApiSpecPanel flowId={1} flowName="orders" flowDescription="Order intake" onDirtyChange={onDirtyChange} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  document.cookie = 'XSRF-TOKEN=abc';
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('API spec panel', () => {
  it('opens a new spec in Apicurio and saves its edits as openapi.json', async () => {
    const { calls } = mockFetch({
      'GET /api/editor/settings': { status: 200, body: { autosaveSeconds: 0 } },
      'PUT /api/flows/1/files/openapi.json': { status: 204 },
    });
    const onDirtyChange = vi.fn();
    renderPanel(onDirtyChange);

    const frame = (await screen.findByTitle('OpenAPI editor')) as HTMLIFrameElement;
    expect(frame).toHaveAttribute('src', '/apicurio-editor/index.html');
    expect(screen.getByTestId('new-spec')).toBeInTheDocument();

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

    // An edit in the editor (e.g. a data type made from a sample JSON) arrives as a message.
    const edited = { openapi: '3.0.3', info: { title: 'orders', version: '1.0.0' }, components: { schemas: { Order: {} } } };
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', { source: frame.contentWindow, data: { type: 'apicurio_onChange', data: { content: edited } } }),
      );
    });
    // Unsaved edits are reported to the flow editor, which shows "Unsaved changes" next to the flow's name.
    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(true));

    await userEvent.click(screen.getByRole('button', { name: 'Save API spec' }));
    expect(await screen.findByText('Saved.')).toBeInTheDocument();
    const put = calls.find((c) => c.method === 'PUT');
    expect(put?.url).toBe('/api/flows/1/files/openapi.json');
    expect(put?.body).toEqual(edited);
    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(false));
  });

  it('ignores messages that do not come from the editor frame', async () => {
    mockFetch({ 'GET /api/editor/settings': { status: 200, body: { autosaveSeconds: 0 } } });
    const onDirtyChange = vi.fn();
    renderPanel(onDirtyChange);
    await screen.findByTitle('OpenAPI editor');

    act(() => {
      window.dispatchEvent(new MessageEvent('message', { source: window, data: { type: 'apicurio_onChange', data: { content: {} } } }));
    });
    expect(onDirtyChange).not.toHaveBeenCalledWith(true);
  });
});
