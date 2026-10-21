type Handler = (init: RequestInit & { url: string }) => { status: number; body?: unknown } | undefined;

/** Minimal fetch stub: routes "METHOD /path" to handlers. Unmatched requests return 404. */
export function mockFetch(routes: Record<string, Handler | { status: number; body?: unknown }>) {
  const calls: { method: string; url: string; body?: unknown; headers: Headers }[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = (init.method ?? 'GET').toUpperCase();
    const body = typeof init.body === 'string' ? parseBody(init.body) : undefined;
    calls.push({ method, url, body, headers: new Headers(init.headers) });
    const route = routes[`${method} ${url}`];
    const result = typeof route === 'function' ? route({ ...init, url }) : route;
    const { status, body: responseBody } = result ?? { status: 404 };
    return new Response(responseBody === undefined ? null : JSON.stringify(responseBody), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', fn);
  return { fn, calls };
}

/** JSON bodies are parsed; others (e.g. a YAML file) are kept as text. */
function parseBody(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
