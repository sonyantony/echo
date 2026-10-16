import { useState } from 'react';
import { PRODUCT_NAME } from './applyBranding';
import { useBranding } from './BrandingContext';
import './BrandLogo.css';

/** The buyer's logo and the product name ("EY" in EY yellow), as shown in the masthead and on the login page. */
export function BrandLogo() {
  const { logo, logoAlt } = useBranding();
  // A logo file that is missing (e.g. not yet copied into config/branding) shows no broken image.
  const [failed, setFailed] = useState<string>();
  return (
    <span className="echo-brand">
      {logo && failed !== logo && (
        <img className="echo-brand__logo" src={logo} alt={logoAlt ?? ''} onError={() => setFailed(logo)} />
      )}
      <span className="echo-brand__name">
        <span className="echo-brand__ey">EY</span>
        {PRODUCT_NAME.slice('EY'.length)}
      </span>
    </span>
  );
}
