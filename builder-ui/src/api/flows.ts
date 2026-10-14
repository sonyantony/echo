import { api } from './client';

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
};
