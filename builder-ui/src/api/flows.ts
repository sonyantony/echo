import { api, ApiError } from './client';

export type FlowStatus = 'DRAFT' | 'PUBLISHED';

export interface FlowSummary {
  id: number;
  /** The flow's identifier: its Git folder (flows/<name>/), route file and image name. */
  name: string;
  /** What users call the flow ("First Flow"); the identifier for flows made before display names. */
  displayName: string;
  description?: string | null;
  status: FlowStatus;
  updatedBy: string;
  updatedAt: string;
}

export interface FlowDetail extends FlowSummary {
  routeFile: string;
  files: string[];
  /** The flow's OpenAPI spec file, under the name it was uploaded or saved with; absent if it has none. */
  apiSpec?: string | null;
  createdBy: string;
  createdAt: string;
}

/** A flow's OpenAPI spec file. */
export interface ApiSpecRef {
  flowId: number;
  flowName: string;
  fileName: string;
}

export const FLOW_NAME_PATTERN = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
export const MAX_FLOW_ID_LENGTH = 63;
export const MAX_DISPLAY_NAME_LENGTH = 100;

/** Any name people would call a flow (or template): not blank, at most 100 characters, no control characters. */
export function isValidDisplayName(name: string): boolean {
  const trimmed = name.trim();
  // eslint-disable-next-line no-control-regex
  return trimmed.length > 0 && trimmed.length <= MAX_DISPLAY_NAME_LENGTH && !/[\u0000-\u001f\u007f-\u009f]/.test(name);
}

/**
 * The identifier ECHO makes from a display name, as the server does (FlowNames.idFor): lowercase
 * letters and digits, everything else one dash. "First Flow" is first-flow, "2nd try" is flow-2nd-try.
 */
export function flowIdFor(displayName: string): string {
  let id = displayName
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!id) return 'flow';
  if (!/^[a-z]/.test(id)) id = `flow-${id}`;
  return trimId(id, MAX_FLOW_ID_LENGTH);
}

/** flowIdFor, with -2, -3... added while another flow has that identifier (as the server does for a new flow). */
export function uniqueFlowIdFor(displayName: string, taken: Iterable<string>): string {
  const used = new Set(Array.from(taken, (t) => t.toLowerCase()));
  const base = flowIdFor(displayName);
  let id = base;
  for (let n = 2; used.has(id); n++) id = `${trimId(base, MAX_FLOW_ID_LENGTH - String(n).length - 1)}-${n}`;
  return id;
}

function trimId(id: string, max: number): string {
  return id.length <= max ? id : id.slice(0, max).replace(/-+$/, '');
}

const filePath = (id: number, path: string) =>
  `/api/flows/${id}/files/${path.split('/').map(encodeURIComponent).join('/')}`;

export const flowsApi = {
  list: () => api<FlowSummary[]>('/api/flows'),
  get: (id: number) => api<FlowDetail>(`/api/flows/${id}`),
  create: (name: string, description?: string) =>
    api<FlowDetail>('/api/flows', { method: 'POST', json: { name, description } }),
  update: (id: number, name: string, description?: string | null) =>
    api<FlowDetail>(`/api/flows/${id}`, { method: 'PUT', json: { name, description } }),
  remove: (id: number) => api<void>(`/api/flows/${id}`, { method: 'DELETE' }),

  readFile: async (id: number, path: string): Promise<string | undefined> => {
    const response = await fetch(filePath(id, path), { credentials: 'same-origin', headers: { Accept: 'text/plain' } });
    if (response.status === 404) return undefined;
    if (!response.ok) throw new Error(`Could not read ${path} (${response.status})`);
    return response.text();
  },
  writeFile: (id: number, path: string, content: string) =>
    api<void>(filePath(id, path), { method: 'PUT', body: content, headers: { 'Content-Type': 'text/plain' } }),
  deleteFile: (id: number, path: string) => api<void>(filePath(id, path), { method: 'DELETE' }),
  /** Saves the flow's OpenAPI spec as name (JSON or YAML, by its extension), replacing a spec saved under another name. */
  saveApiSpec: (id: number, name: string, content: string) =>
    api<FlowDetail>(`/api/flows/${id}/api-spec/${encodeURIComponent(name)}`, {
      method: 'PUT',
      body: content,
      headers: { 'Content-Type': 'text/plain' },
    }),

  /** Every flow's OpenAPI spec (the Rest tab's Openapi Specification offers them). */
  apiSpecs: () => api<ApiSpecRef[]>('/api/flows/api-specs'),
  /** Copies flow sourceId's spec into flow id, under its own file name, replacing the spec flow id had. */
  copyApiSpec: (id: number, sourceId: number) =>
    api<FlowDetail>(`/api/flows/${id}/api-spec/copy-from/${sourceId}`, { method: 'POST' }),

  /** Creates a flow from a zip made by download. Name and description are optional overrides. */
  upload: (file: File, name?: string, description?: string) => {
    const form = new FormData();
    form.append('file', file);
    if (name) form.append('name', name);
    if (description) form.append('description', description);
    return api<FlowDetail>('/api/flows/upload', { method: 'POST', body: form });
  },
  downloadUrl: (id: number) => `/api/flows/${id}/download`,
  /**
   * Save As: the flow (with routeContent as the route) under another name. Fails with 409 and
   * confirmOverwrite when that name is taken; send overwrite once the user agreed.
   */
  saveAs: (id: number, name: string, routeContent: string, overwrite = false) =>
    api<FlowDetail>(`/api/flows/${id}/save-as`, { method: 'POST', json: { name, routeContent, overwrite } }),
};

/** A flow template, kept in the templates folder of Git (next to the flows folder). */
export interface TemplateSummary {
  /** The template's folder in Git (templates/<name>/). */
  name: string;
  /** What users call it; the folder name for templates saved before display names. */
  displayName?: string | null;
  description?: string | null;
  savedBy?: string | null;
  savedAt?: string | null;
}

export const templatesApi = {
  list: () => api<TemplateSummary[]>('/api/templates'),
  /** Save As Template; 409 with confirmOverwrite when the template exists. */
  saveFromFlow: (flowId: number, name: string, routeContent: string, overwrite = false) =>
    api<TemplateSummary>(`/api/templates/from-flow/${flowId}`, {
      method: 'POST',
      json: { name, routeContent, overwrite },
    }),
  /** Open Template: a new draft made from the template. */
  open: (template: string, name: string, description?: string) =>
    api<FlowDetail>(`/api/templates/${encodeURIComponent(template)}/flows`, {
      method: 'POST',
      json: { name, description },
    }),
};

/** True when a save failed only because it would replace something, and may be confirmed. */
export function needsOverwriteConfirmation(e: unknown): boolean {
  return (
    e instanceof ApiError && e.status === 409 && (e.details as { confirmOverwrite?: boolean })?.confirmOverwrite === true
  );
}

/** A flow as it is in the publish target (Git, else S3). flowId is the Builder flow it belongs to, if any. */
export interface PublishedFlowSummary {
  /** The flow's folder (its identifier). */
  name: string;
  /** What users call it; the folder name for flows published before display names. */
  displayName?: string | null;
  description?: string | null;
  version?: number | null;
  publishedBy?: string | null;
  publishedAt?: string | null;
  flowId?: number | null;
  /** The Builder flow has changes that are not published yet. */
  draftChanged: boolean;
  /** Where the flow is, as shown to users, e.g. Git. */
  target?: string | null;
  /** The pipeline leaves the flow out of images until it is enabled again. */
  disabled?: boolean;
}

const publishedPath = (name: string) => `/api/published-flows/${encodeURIComponent(name)}`;

export const publishedFlowsApi = {
  list: () => api<PublishedFlowSummary[]>('/api/published-flows'),
  /** Copies the published flow into the Builder as a new draft, or with replace over the draft it belongs to. */
  createDraft: (name: string, replace = false) =>
    api<FlowDetail>(`${publishedPath(name)}/draft${replace ? '?replace=true' : ''}`, { method: 'POST' }),
  remove: (name: string) => api<void>(publishedPath(name), { method: 'DELETE' }),
  /** Keeps the flow in the publish targets but marks it disabled, so the pipeline does not build it. */
  setDisabled: (name: string, disabled: boolean) =>
    api<void>(`${publishedPath(name)}/${disabled ? 'disable' : 'enable'}`, { method: 'POST' }),
  downloadUrl: (name: string) => `${publishedPath(name)}/download`,
};

function download(url: string) {
  const link = document.createElement('a');
  link.href = url;
  link.download = '';
  document.body.appendChild(link);
  link.click();
  link.remove();
}

/** Saves the flow's draft to the user's computer as <name>.zip (the browser's download). */
export function downloadFlow(id: number) {
  download(flowsApi.downloadUrl(id));
}

/** Saves the published version of a flow, as it is in Git, as <name>.zip. */
export function downloadPublishedFlow(name: string) {
  download(publishedFlowsApi.downloadUrl(name));
}

export interface ValidationProblem {
  file: string;
  line?: number | null;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  problems: ValidationProblem[];
}

export const validateFlow = (id: number) => api<ValidationResult>(`/api/flows/${id}/validate`, { method: 'POST' });

/** What one publish did in one target (Git, S3, ...). */
export interface PublishTargetResult {
  target: string;
  /** The target's name for users, e.g. Git. */
  name: string;
  /** Where the flow went: the branch for Git, the folder URL for S3. */
  location: string;
  /** The commit for Git; null for targets without revisions. */
  revision?: string | null;
  changed: boolean;
  /** Why this target failed; the others still got the flow. */
  error?: string | null;
}

export interface PublishedFlow {
  publishedBy: string;
  publishedAt: string;
  message: string;
  changed: boolean;
  targets: PublishTargetResult[];
}

/** An enabled publish target. */
export interface PublishTarget {
  id: string;
  name: string;
  location: string;
}

export const publishTargets = () => api<PublishTarget[]>('/api/publish-targets');

/** An operation of the flow's spec that no route handles (it answers 404). */
export interface MissingRoute {
  method: string;
  /** As the spec has it, without the Base Path. */
  path: string;
  operationId: string | null;
  /** Its route is there but switched off (autoStartup: false). */
  disabled: boolean;
}

/**
 * Publishes the flow. Unless allowMissingRoutes, operations of its spec without a route stop it with
 * a 409 whose details list them (missingRoutes), so the user can confirm first.
 */
export const publishFlow = (id: number, message: string, allowMissingRoutes = false) =>
  api<PublishedFlow>(`/api/flows/${id}/publish`, { method: 'POST', json: { message, allowMissingRoutes } });

export const flowHistory = (id: number) => api<PublishedFlow[]>(`/api/flows/${id}/history`);

export interface EditorSettings {
  /** Seconds between autosaves of unsaved changes; 0 means off. */
  autosaveSeconds: number;
  /** Whether this install lets users run drafts inside the Builder (the Run button). */
  runEnabled?: boolean;
}

export const editorSettings = () => api<EditorSettings>('/api/editor/settings');

/** A platform-http endpoint of a running flow; methods is empty when any method is accepted. */
export interface RunEndpoint {
  path: string;
  methods: string[];
  /** The full URL to call it from your own tools. */
  url: string;
}

/** A draft running inside the Builder (the Run button). */
export interface RunInfo {
  flowId: number;
  flowName: string;
  port: number;
  url: string;
  endpoints: RunEndpoint[];
  /** Swagger UI for the flow's OpenAPI spec (Base Path + /docs); null when the flow has no spec. */
  docsUrl: string | null;
  startedBy: string;
  startedAt: string;
  /** The run stops after this many minutes without requests. */
  idleMinutes: number;
}

export interface RunLogLine {
  seq: number;
  at: string;
  level: string;
  message: string;
}

export interface TestRequest {
  method: string;
  path: string;
  contentType?: string;
  body?: string;
}

export interface TestResponse {
  status: number;
  contentType?: string | null;
  body: string;
  durationMs: number;
}

const runPath = (id: number) => `/api/flows/${id}/run`;

export const runApi = {
  /** The flow's current run, or null when it is not running. */
  status: async (id: number) => (await api<RunInfo | undefined>(runPath(id))) ?? null,
  /** Validates the saved draft and starts it. A 422 ApiError carries the ValidationResult as details. */
  start: (id: number) => api<RunInfo>(runPath(id), { method: 'POST' }),
  stop: (id: number) => api<void>(runPath(id), { method: 'DELETE' }),
  log: (id: number, after: number) => api<RunLogLine[]>(`${runPath(id)}/log?after=${after}`),
  /** Sends a request to the running flow through the Builder. */
  send: (id: number, request: TestRequest) =>
    api<TestResponse>(`${runPath(id)}/request`, { method: 'POST', json: request }),
};
