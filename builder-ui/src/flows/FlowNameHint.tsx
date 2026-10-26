import { useQuery } from '@tanstack/react-query';
import {
  flowIdFor,
  flowsApi,
  isValidDisplayName,
  MAX_DISPLAY_NAME_LENGTH,
  publishedFlowsApi,
  type NameTaken,
} from '../api/flows';

/** Same keys as the Open Flow page, so its lists are reused. */
const FLOWS_KEY = ['flows'];
const PUBLISHED_KEY = [...FLOWS_KEY, 'published'];

/**
 * The identifier a flow called name is saved under, as the server makes it from the name. A name
 * another flow already has gives that flow's identifier (Save As replaces it); a flow being renamed
 * keeps its own (keepId).
 */
export function useFlowIdPreview(name: string, keepId?: string): string {
  const flows = useQuery({ queryKey: FLOWS_KEY, queryFn: flowsApi.list });
  if (keepId) return keepId;
  const typed = name.trim().toLowerCase();
  const same = flows.data?.find((f) => f.displayName.toLowerCase() === typed);
  if (same) return same.name;
  return flowIdFor(name);
}

/**
 * The flow that already has this name, or the ID it makes, among the Builder's flows and the
 * published ones (ignoring case), as the server checks it: every flow needs a name of its own.
 * self is the flow being renamed, which may keep its own name.
 */
export function useNameTaken(name: string, self?: { id: number; name: string }): NameTaken | undefined {
  const flows = useQuery({ queryKey: FLOWS_KEY, queryFn: flowsApi.list });
  const published = useQuery({ queryKey: PUBLISHED_KEY, queryFn: publishedFlowsApi.list, retry: false });
  const display = name.trim();
  if (!isValidDisplayName(display)) return undefined;
  const typed = display.toLowerCase();
  const id = flowIdFor(display);
  const taken = (existingName: string, sameName: boolean, existing: Omit<NameTaken, 'message' | 'existingName'>) => ({
    message: sameName
      ? `A flow named '${existingName}' already exists.`
      : `The name '${display}' makes the ID ${id}, which flow '${existingName}' already has.`,
    existingName,
    ...existing,
  });
  for (const f of flows.data ?? []) {
    if (f.id === self?.id) continue;
    const sameName = f.displayName.toLowerCase() === typed || f.name.toLowerCase() === typed;
    if (sameName || f.name.toLowerCase() === id) return taken(f.displayName, sameName, { existingFlowId: f.id });
  }
  for (const p of published.data ?? []) {
    if (p.name === self?.name) continue;
    const shown = p.displayName || p.name;
    const sameName = shown.toLowerCase() === typed || p.name.toLowerCase() === typed;
    if (sameName || p.name.toLowerCase() === id) {
      return taken(shown, sameName, { existingFlowId: p.flowId ?? undefined, existingFolder: p.name });
    }
  }
  return undefined;
}

/** The help line under a name field: what may be typed, then the ID (Git folder) it is saved under. */
export function flowNameHint(name: string, id: string, kind: 'flow' | 'template' = 'flow', renaming = false): string {
  if (!name.trim()) return `Any name, e.g. First Flow. ECHO makes the ${kind}'s ID from it.`;
  if (!isValidDisplayName(name)) return `Use at most ${MAX_DISPLAY_NAME_LENGTH} characters.`;
  const folder = kind === 'flow' ? 'flows' : 'templates';
  return `ID: ${id} (its folder in Git is ${folder}/${id}/${renaming ? '; renaming keeps it' : ''}).`;
}
