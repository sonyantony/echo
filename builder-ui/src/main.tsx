import '@patternfly/react-core/dist/styles/base.css';
import '@fontsource-variable/inter';
import './theme/themes.css';
import './theme/kaoto-mapping.css';
import './theme/echo.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { Playground } from './playground/Playground';

// The editor playground (M1 spike) needs no login and no backend.
const isPlayground = window.location.pathname.startsWith('/playground');

createRoot(document.getElementById('root')!).render(
  <StrictMode>{isPlayground ? <Playground /> : <App />}</StrictMode>,
);
