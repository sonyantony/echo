import type { PublishTargetResult } from '../api/flows';
import { publishSummary } from './publishSummary';

const git: PublishTargetResult = { target: 'git', name: 'Git', location: 'main', revision: 'abc12345def', changed: true };
const s3: PublishTargetResult = { target: 's3', name: 'S3', location: 's3://b/flows/orders/', changed: true };
const result = (targets: PublishTargetResult[], changed = true) => ({
  publishedBy: 'designer',
  publishedAt: '',
  message: 'm',
  changed,
  targets,
});

describe('publishSummary', () => {
  it('says Published Successfully when every target succeeded', () => {
    expect(publishSummary(result([git, s3]))).toEqual({ variant: 'success', text: 'Published Successfully' });
  });

  it('warns about targets that failed', () => {
    expect(publishSummary(result([git, { ...s3, changed: false, error: 'S3 error: 503' }]))).toEqual({
      variant: 'warning',
      text: 'Published to Git (main, abc12345). S3 failed: S3 error: 503 Publish again to retry.',
    });
  });

  it('says when nothing changed', () => {
    expect(publishSummary(result([{ ...git, changed: false }], false)).text).toBe(
      'Nothing changed since the last publish.',
    );
  });
});
