/** The toolbar over the whole spec's Source tab (Apicurio's main form; paths and data types have their own). */
const MAIN_SOURCE_BAR = 'main-form > .detail-actionbar';
const UPLOAD_CLASS = 'echo-source-upload';

/**
 * Puts an Upload button on the Source tab's toolbar of the whole spec, which does what Openapi >
 * Upload does. Apicurio draws that toolbar each time Source opens, so the button is added again
 * whenever it is missing. The buttons' order (Upload, Save, As YAML/JSON, Format, Revert) is set
 * in theme/apicurio-mapping.css. Returns a cleanup function.
 */
export function addSourceUpload(doc: Document, onUpload: () => void) {
  const apply = () => {
    for (const bar of doc.querySelectorAll(MAIN_SOURCE_BAR)) {
      if (bar.querySelector(`.${UPLOAD_CLASS}`)) continue;
      const button = doc.createElement('button');
      button.type = 'button';
      button.className = `btn btn-default btn-xs ${UPLOAD_CLASS}`;
      button.title = 'Upload an Openapi file (.yaml or .json) as this flow\'s spec';
      button.innerHTML = '<span class="fa fa-fw fa-upload"></span><span>Upload</span>';
      button.addEventListener('click', () => onUpload());
      bar.prepend(button);
    }
  };
  apply();
  // The frame's own MutationObserver: its nodes belong to the frame's window.
  const observer = new (doc.defaultView?.MutationObserver ?? MutationObserver)(apply);
  try {
    observer.observe(doc.documentElement, { childList: true, subtree: true });
  } catch {
    // A frame document the observer cannot watch (only happens in the jsdom test environment).
  }
  return () => observer.disconnect();
}
