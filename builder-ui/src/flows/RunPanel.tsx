import {
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  ClipboardCopy,
  Flex,
  FlexItem,
  FormSelect,
  FormSelectOption,
  Label,
  TextArea,
  TextInput,
} from '@patternfly/react-core';
import { useEffect, useRef, useState } from 'react';
import { runApi, type RunInfo, type RunLogLine, type TestResponse } from '../api/flows';
import './RunPanel.css';

const METHODS = ['POST', 'GET', 'PUT', 'PATCH', 'DELETE'];
const MAX_LINES = 200;
const LOG_POLL_MS = 1000;

/** Pretty-prints JSON bodies; anything else is shown as it came. */
export function formatBody(body: string): string {
  try {
    return JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    return body;
  }
}

/**
 * The running flow: where to call it, a box to send it a request from the Builder, the reply and
 * the flow's log lines.
 */
export function RunPanel({
  flowId,
  run,
  onStop,
  stopping,
}: {
  flowId: number;
  run: RunInfo;
  onStop(): void;
  stopping: boolean;
}) {
  const first = run.endpoints[0];
  const [method, setMethod] = useState(first?.methods[0] ?? 'POST');
  const [path, setPath] = useState(first?.path ?? '/');
  const [body, setBody] = useState('{\n  \n}');
  const [sending, setSending] = useState(false);
  const [response, setResponse] = useState<TestResponse>();
  const [error, setError] = useState<string>();
  const [lines, setLines] = useState<RunLogLine[]>([]);
  const lastSeq = useRef(0);
  const logEnd = useRef<HTMLDivElement>(null);

  // A new run (Run pressed again) starts its log from the beginning.
  useEffect(() => {
    lastSeq.current = 0;
    setLines([]);
  }, [run.startedAt]);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const next = await runApi.log(flowId, lastSeq.current);
        if (cancelled || next.length === 0) return;
        lastSeq.current = next[next.length - 1].seq;
        setLines((current) => [...current, ...next].slice(-MAX_LINES));
      } catch {
        // the next poll tries again
      }
    };
    void poll();
    const timer = window.setInterval(poll, LOG_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [flowId, run.startedAt]);

  useEffect(() => {
    logEnd.current?.scrollIntoView?.({ block: 'nearest' });
  }, [lines]);

  const send = async () => {
    setSending(true);
    setError(undefined);
    setResponse(undefined);
    try {
      const hasBody = method !== 'GET' && method !== 'DELETE';
      setResponse(await runApi.send(flowId, { method, path, body: hasBody ? body : undefined }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  };

  return (
    <Card isCompact className="echo-run-panel" data-testid="run-panel">
      <CardHeader
        actions={{
          actions: (
            <Button variant="secondary" isDanger onClick={onStop} isLoading={stopping} isDisabled={stopping}>
              Stop
            </Button>
          ),
          hasNoOffset: true,
        }}
      >
        <CardTitle>
          <Label color="green" className="echo-run-panel__state">
            Running
          </Label>{' '}
          {run.flowName} on port {run.port}
        </CardTitle>
      </CardHeader>
      <CardBody>
        <Flex direction={{ default: 'column', lg: 'row' }} gap={{ default: 'gapLg' }} flexWrap={{ default: 'nowrap' }}>
          <FlexItem flex={{ default: 'flex_1' }} className="echo-run-panel__column">
            <div className="echo-run-panel__heading">Call it from your own tools</div>
            {run.endpoints.length === 0 && <p>This flow has no platform-http endpoint to call.</p>}
            {run.endpoints.map((e) => (
              <div key={e.path} className="echo-run-panel__endpoint">
                {e.methods.length > 0 && <Label isCompact>{e.methods.join(', ')}</Label>}
                <ClipboardCopy isReadOnly hoverTip="Copy" clickTip="Copied" variant="inline-compact">
                  {e.url}
                </ClipboardCopy>
              </div>
            ))}
            <p className="echo-run-panel__hint">
              The flow runs inside the Builder. To call a service on your own computer from an http step, use
              host.docker.internal instead of localhost. The run stops after {run.idleMinutes} minutes without
              requests.
            </p>

            <div className="echo-run-panel__heading">Send a test request</div>
            <Flex gap={{ default: 'gapSm' }} flexWrap={{ default: 'nowrap' }}>
              <FlexItem>
                <FormSelect
                  aria-label="Method"
                  value={method}
                  onChange={(_e, v) => setMethod(v)}
                  className="echo-run-panel__method"
                >
                  {METHODS.map((m) => (
                    <FormSelectOption key={m} value={m} label={m} />
                  ))}
                </FormSelect>
              </FlexItem>
              <FlexItem flex={{ default: 'flex_1' }}>
                <TextInput aria-label="Path" value={path} onChange={(_e, v) => setPath(v)} />
              </FlexItem>
              <FlexItem>
                <Button variant="primary" onClick={send} isLoading={sending} isDisabled={sending}>
                  Send
                </Button>
              </FlexItem>
            </Flex>
            {method !== 'GET' && method !== 'DELETE' && (
              <TextArea
                aria-label="Request body (JSON)"
                className="echo-run-panel__body"
                value={body}
                onChange={(_e, v) => setBody(v)}
                resizeOrientation="vertical"
                rows={5}
              />
            )}
            {error && (
              <p className="echo-run-panel__error" role="alert">
                {error}
              </p>
            )}
            {response && (
              <div data-testid="run-response">
                <div className="echo-run-panel__heading">
                  Reply{' '}
                  <Label isCompact color={response.status < 400 ? 'green' : 'red'}>
                    {response.status}
                  </Label>{' '}
                  <span className="echo-run-panel__subtle">{response.durationMs} ms</span>
                </div>
                <pre className="echo-run-panel__pre">{formatBody(response.body) || '(empty)'}</pre>
              </div>
            )}
          </FlexItem>
          <FlexItem flex={{ default: 'flex_1' }} className="echo-run-panel__column">
            <div className="echo-run-panel__heading">Log</div>
            <div className="echo-run-panel__log" data-testid="run-log">
              {lines.map((l) => (
                <div key={l.seq} className={l.level === 'ERROR' ? 'echo-run-panel__log-error' : undefined}>
                  <span className="echo-run-panel__subtle">
                    {new Date(l.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  </span>{' '}
                  {l.message}
                </div>
              ))}
              <div ref={logEnd} />
            </div>
          </FlexItem>
        </Flex>
      </CardBody>
    </Card>
  );
}
