import { describe, expect, it } from 'vitest';
import { readRestSettings, writeRestSetting } from './restSettings';

const route = `- route:
    id: get-customer
    from:
      uri: direct:getCustomer
      steps:
        - log:
            message: hi
`;

describe('REST settings in the route file', () => {
  it('adds a restConfiguration when one is turned on, and removes it when the last is turned off', () => {
    const on = writeRestSetting(route, 'clientRequestValidation', true);
    expect(on).toBe(`- restConfiguration:
    clientRequestValidation: true
${route}`);
    expect(readRestSettings(on)).toEqual({ clientRequestValidation: true, enableCORS: false });

    const both = writeRestSetting(on, 'enableCORS', true);
    expect(readRestSettings(both)).toEqual({ clientRequestValidation: true, enableCORS: true });
    const one = writeRestSetting(both, 'clientRequestValidation', false);
    expect(readRestSettings(one)).toEqual({ clientRequestValidation: false, enableCORS: true });
    expect(writeRestSetting(one, 'enableCORS', false)).toBe(route);
  });

  it('keeps the other settings of a restConfiguration the flow already has', () => {
    const yaml = `- restConfiguration:
    contextPath: /api
    enableCORS: "true"
${route}`;
    expect(readRestSettings(yaml).enableCORS).toBe(true);
    expect(writeRestSetting(yaml, 'enableCORS', false)).toBe(`- restConfiguration:
    contextPath: /api
${route}`);
  });

  it('works on an empty flow', () => {
    expect(writeRestSetting('', 'enableCORS', true)).toBe('- restConfiguration:\n    enableCORS: true\n');
    expect(readRestSettings('')).toEqual({ clientRequestValidation: false, enableCORS: false });
  });
});
