import { describe, expect, it } from 'vitest';
import { flowIdFor, FLOW_NAME_PATTERN, isValidDisplayName, uniqueFlowIdFor } from './flows';

describe('Flow IDs made from names', () => {
  it('turns any name into lowercase letters, digits and dashes, as the server does', () => {
    expect(flowIdFor('First Flow')).toBe('first-flow');
    expect(flowIdFor('orders')).toBe('orders');
    expect(flowIdFor('  Card API  ')).toBe('card-api');
    expect(flowIdFor('Café Orders!')).toBe('cafe-orders');
    expect(flowIdFor('2nd try')).toBe('flow-2nd-try');
    expect(flowIdFor('***')).toBe('flow');
    expect(flowIdFor('word '.repeat(30))).toMatch(FLOW_NAME_PATTERN);
    expect(flowIdFor('word '.repeat(30)).length).toBeLessThanOrEqual(63);
  });

  it('adds a number when another flow has the ID', () => {
    expect(uniqueFlowIdFor('First Flow', [])).toBe('first-flow');
    expect(uniqueFlowIdFor('First Flow', ['First-Flow', 'first-flow-2'])).toBe('first-flow-3');
  });

  it('takes any name up to 100 characters', () => {
    expect(isValidDisplayName('First Flow')).toBe(true);
    expect(isValidDisplayName(' ')).toBe(false);
    expect(isValidDisplayName('x'.repeat(101))).toBe(false);
    expect(isValidDisplayName('a\nb')).toBe(false);
  });
});
