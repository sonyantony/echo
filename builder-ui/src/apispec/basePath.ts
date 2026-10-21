/**
 * Apicurio's server dialog, shown as Base Path (apicurioTheme.css): a URL there only counts once
 * Apply is pressed (or Enter), which the dialog's Save waits for. ECHO hides Apply and presses it
 * as the user types, and gives the field an example as its placeholder.
 */
export function simplifyBasePathDialog(doc: Document) {
  const field = (target: EventTarget | null) =>
    target instanceof (doc.defaultView?.HTMLInputElement ?? HTMLInputElement) &&
    target.id === 'serverUrl' &&
    target.closest('.server-entity-editor')
      ? target
      : null;
  const onInput = (event: Event) => {
    const input = field(event.target);
    if (!input) return;
    // After Angular has seen the new text, so Apply is enabled.
    doc.defaultView?.setTimeout(() => {
      const apply = input.closest('tr')?.querySelector<HTMLButtonElement>('.url-action.btn-primary');
      if (apply && !apply.disabled) apply.click();
    });
  };
  const onFocus = (event: Event) => {
    const input = field(event.target);
    if (input) input.placeholder = '/customers/v1';
  };
  doc.addEventListener('input', onInput, true);
  doc.addEventListener('focusin', onFocus, true);
  return () => {
    doc.removeEventListener('input', onInput, true);
    doc.removeEventListener('focusin', onFocus, true);
  };
}
