import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { RunInfo } from '../api/flows';
import { mockFetch } from '../test/fetchMock';
import { formatBody, RunPanel } from './RunPanel';

beforeEach(() => {
  document.cookie = 'XSRF-TOKEN=abc';
});
afterEach(() => vi.unstubAllGlobals());

const run: RunInfo = {
  flowId: 2,
  flowName: 'firsttestflow',
  port: 8081,
  url: 'http://localhost:8081',
  endpoints: [{ path: '/firsttestflow', methods: ['POST'], url: 'http://localhost:8081/firsttestflow' }],
  startedBy: 'designer',
  startedAt: '2026-10-16T19:00:00Z',
  idleMinutes: 30,
};

describe('RunPanel', () => {
  it('shows where to call the flow and its log lines', async () => {
    mockFetch({
      'GET /api/flows/2/run/log?after=0': {
        status: 200,
        body: [{ seq: 1, at: '2026-10-16T19:00:01Z', level: 'INFO', message: 'got {"hello":"world"}' }],
      },
    });
    render(<RunPanel flowId={2} run={run} onStop={() => undefined} stopping={false} />);

    expect(screen.getByText('firsttestflow on port 8081', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('http://localhost:8081/firsttestflow')).toBeInTheDocument();
    expect(await screen.findByText('got {"hello":"world"}')).toBeInTheDocument();
  });

  it('sends a test request and shows the reply', async () => {
    const { calls } = mockFetch({
      'GET /api/flows/2/run/log?after=0': { status: 200, body: [] },
      'POST /api/flows/2/run/request': {
        status: 200,
        body: { status: 200, contentType: 'application/json', body: '{"ok":true}', durationMs: 12 },
      },
    });
    render(<RunPanel flowId={2} run={run} onStop={() => undefined} stopping={false} />);

    const body = screen.getByLabelText('Request body (JSON)');
    await userEvent.clear(body);
    await userEvent.type(body, '{{"hello":"world"}');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));

    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
      method: 'POST',
      path: '/firsttestflow',
      body: '{"hello":"world"}',
    });
    expect(await screen.findByTestId('run-response')).toHaveTextContent('200');
    expect(screen.getByTestId('run-response')).toHaveTextContent('"ok": true');
  });

  it('calls onStop', async () => {
    mockFetch({ 'GET /api/flows/2/run/log?after=0': { status: 200, body: [] } });
    const onStop = vi.fn();
    render(<RunPanel flowId={2} run={run} onStop={onStop} stopping={false} />);
    await userEvent.click(screen.getByRole('button', { name: 'Stop' }));
    expect(onStop).toHaveBeenCalled();
  });
});

describe('formatBody', () => {
  it('pretty-prints JSON and leaves other text alone', () => {
    expect(formatBody('{"a":1}')).toBe('{\n  "a": 1\n}');
    expect(formatBody('pong')).toBe('pong');
  });
});
