import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App, createQueryClient } from '../App';
import { mockFetch } from '../test/fetchMock';
import { newApiSpec } from './apiSpec';

const loggedIn = { 'GET /api/auth/me': { status: 200, body: { username: 'designer', roles: ['DESIGNER'] } } };
const flow = {
  id: 1,
  name: 'orders',
  description: 'Order intake',
  status: 'DRAFT',
  updatedBy: 'designer',
  updatedAt: '2026-10-16T10:00:00Z',
  routeFile: 'orders.camel.yaml',
  files: ['orders.camel.yaml'],
};

beforeEach(() => {
  document.cookie = 'XSRF-TOKEN=abc';
});
afterEach(() => {
  vi.unstubAllGlobals();
  window.history.pushState({}, '', '/');
});

describe('API spec page', () => {
  it('opens a new spec in Apicurio and saves its edits as openapi.json', async () => {
    const { calls } = mockFetch({
      ...loggedIn,
      'GET /api/flows/1': { status: 200, body: flow },
      'GET /api/editor/settings': { status: 200, body: { autosaveSeconds: 0 } },
      'PUT /api/flows/1/files/openapi.json': { status: 204 },
    });
    window.history.pushState({}, '', '/flows/1/api');
    render(<App queryClient={createQueryClient()} />);

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
    expect(await screen.findByTestId('unsaved')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Saved.')).toBeInTheDocument();
    const put = calls.find((c) => c.method === 'PUT');
    expect(put?.url).toBe('/api/flows/1/files/openapi.json');
    expect(put?.body).toEqual(edited);
    await waitFor(() => expect(screen.queryByTestId('unsaved')).not.toBeInTheDocument());
  });

  it('ignores messages that do not come from the editor frame', async () => {
    mockFetch({
      ...loggedIn,
      'GET /api/flows/1': { status: 200, body: flow },
      'GET /api/editor/settings': { status: 200, body: { autosaveSeconds: 0 } },
    });
    window.history.pushState({}, '', '/flows/1/api');
    render(<App queryClient={createQueryClient()} />);
    await screen.findByTitle('OpenAPI editor');

    act(() => {
      window.dispatchEvent(new MessageEvent('message', { source: window, data: { type: 'apicurio_onChange', data: { content: {} } } }));
    });
    expect(screen.queryByTestId('unsaved')).not.toBeInTheDocument();
  });
});
