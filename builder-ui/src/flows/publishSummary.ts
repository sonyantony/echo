import type { PublishedFlow, PublishTargetResult } from '../api/flows';

/** "Git (main, abc12345)" or "S3 (s3://bucket/flows/orders/)". */
export function targetLabel(t: PublishTargetResult) {
  return `${t.name} (${t.location}${t.revision ? `, ${t.revision.slice(0, 8)}` : ''})`;
}

/** The editor's message after Publish: a plain success, or where the flow went and which targets failed. */
export function publishSummary(result: PublishedFlow): { variant: 'success' | 'warning'; text: string } {
  const ok = result.targets.filter((t) => !t.error);
  const failed = result.targets.filter((t) => t.error);
  const done = !result.changed
    ? 'Nothing changed since the last publish.'
    : `Published to ${ok.map(targetLabel).join(' and ')}.`;
  if (failed.length === 0) return { variant: 'success', text: result.changed ? 'Published Successfully' : done };
  const errors = failed.map((t) => `${t.name} failed: ${t.error}`).join(' ');
  return { variant: 'warning', text: `${done} ${errors} Publish again to retry.` };
}
