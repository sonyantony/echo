import { describe, expect, it } from 'vitest';
import { ApiError } from './client';
import { flowIdFor, FLOW_NAME_PATTERN, isValidDisplayName, nameTakenOf } from './flows';

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

  it('reads which flow has a name from the server 409', () => {
    const taken = new ApiError(409, "A flow named 'Orders' already exists.", {
      nameTaken: true,
      existingName: 'Orders',
      existingFolder: 'orders',
    });
    expect(nameTakenOf(taken)).toEqual({
      message: "A flow named 'Orders' already exists.",
      existingName: 'Orders',
      existingFlowId: undefined,
      existingFolder: 'orders',
    });
    expect(nameTakenOf(new ApiError(409, 'Replace it?', { confirmOverwrite: true }))).toBeUndefined();
    expect(nameTakenOf(new Error('x'))).toBeUndefined();
  });

  it('takes any name up to 100 characters', () => {
    expect(isValidDisplayName('First Flow')).toBe(true);
    expect(isValidDisplayName(' ')).toBe(false);
    expect(isValidDisplayName('x'.repeat(101))).toBe(false);
    expect(isValidDisplayName('a\nb')).toBe(false);
  });
});
