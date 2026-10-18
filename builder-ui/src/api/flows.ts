import { api, ApiError } from './client';

export type FlowStatus = 'DRAFT' | 'PUBLISHED';

export interface FlowSummary {
  id: number;
  name: string;
  description?: string | null;
  status: FlowStatus;
  updatedBy: string;
  updatedAt: string;
}

export interface FlowDetail extends FlowSummary {
  routeFile: string;
  files: string[];
  createdBy: string;
  createdAt: string;
}

export const FLOW_NAME_PATTERN = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
export const FLOW_NAME_HINT = 'Lowercase letters, digits and dashes, starting with a letter.';

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
  name: string;
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
  name: string;
  description?: string | null;
  version?: number | null;
  publishedBy?: string | null;
  publishedAt?: string | null;
  flowId?: number | null;
  /** The Builder flow has changes that are not published yet. */
  draftChanged: boolean;
}

const publishedPath = (name: string) => `/api/published-flows/${encodeURIComponent(name)}`;

export const publishedFlowsApi = {
  list: () => api<PublishedFlowSummary[]>('/api/published-flows'),
  /** Copies the published flow into the Builder as a new draft. */
  createDraft: (name: string) => api<FlowDetail>(`${publishedPath(name)}/draft`, { method: 'POST' }),
  remove: (name: string) => api<void>(publishedPath(name), { method: 'DELETE' }),
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

export const publishFlow = (id: number, message: string) =>
  api<PublishedFlow>(`/api/flows/${id}/publish`, { method: 'POST', json: { message } });

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
