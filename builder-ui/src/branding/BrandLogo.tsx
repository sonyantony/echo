import { useBranding } from './BrandingContext';
import './BrandLogo.css';

/** The install's logo and product name, as shown in the masthead and on the login page. */
export function BrandLogo() {
  const { productName, logo, logoAlt } = useBranding();
  return (
    <span className="echo-brand">
      {logo && <img className="echo-brand__logo" src={logo} alt={logoAlt ?? ''} />}
      <span className="echo-brand__name">{productName}</span>
    </span>
  );
}
