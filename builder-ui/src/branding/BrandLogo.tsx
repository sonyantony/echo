import { useState } from 'react';
import { useBranding } from './BrandingContext';
import './BrandLogo.css';

/** The install's logo and product name, as shown in the masthead and on the login page. */
export function BrandLogo() {
  const { productName, logo, logoAlt } = useBranding();
  // A logo file that is missing (e.g. not yet copied into config/branding) shows no broken image.
  const [failed, setFailed] = useState<string>();
  return (
    <span className="echo-brand">
      {logo && failed !== logo && (
        <img className="echo-brand__logo" src={logo} alt={logoAlt ?? ''} onError={() => setFailed(logo)} />
      )}
      <span className="echo-brand__name">{productName}</span>
    </span>
  );
}
