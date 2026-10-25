import { useQuery } from '@tanstack/react-query';
import { flowsApi, isValidDisplayName, MAX_DISPLAY_NAME_LENGTH, uniqueFlowIdFor } from '../api/flows';

/** Same key as the Open Flow page, so its list is reused. */
const FLOWS_KEY = ['flows'];

/**
 * The identifier a flow called name is saved under, as the server makes it: from the name, with
 * -2, -3... when another flow has it. A name another flow already has gives that flow's identifier
 * (Save As replaces it); a flow being renamed keeps its own (keepId).
 */
export function useFlowIdPreview(name: string, keepId?: string): string {
  const flows = useQuery({ queryKey: FLOWS_KEY, queryFn: flowsApi.list });
  if (keepId) return keepId;
  const typed = name.trim().toLowerCase();
  const same = flows.data?.find((f) => f.displayName.toLowerCase() === typed);
  if (same) return same.name;
  return uniqueFlowIdFor(name, (flows.data ?? []).map((f) => f.name));
}

/** The help line under a name field: what may be typed, then the ID (Git folder) it is saved under. */
export function flowNameHint(name: string, id: string, kind: 'flow' | 'template' = 'flow', renaming = false): string {
  if (!name.trim()) return `Any name, e.g. First Flow. ECHO makes the ${kind}'s ID from it.`;
  if (!isValidDisplayName(name)) return `Use at most ${MAX_DISPLAY_NAME_LENGTH} characters.`;
  const folder = kind === 'flow' ? 'flows' : 'templates';
  return `ID: ${id} (its folder in Git is ${folder}/${id}/${renaming ? '; renaming keeps it' : ''}).`;
}
