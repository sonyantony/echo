import { Bullseye, Content } from '@patternfly/react-core';

/**
 * ECHO's About tab. vite.config.ts points Kaoto's lazy About route at this module,
 * so Kaoto itself stays unmodified.
 */
export function Component() {
  return (
    <Bullseye className="echo-about">
      <Content>
        <Content component="h1">
          <strong>EY ECHO (V2.0).</strong>
        </Content>
        <Content component="p">
          <strong>Developed By : Sony Antony</strong>
        </Content>
      </Content>
    </Bullseye>
  );
}
