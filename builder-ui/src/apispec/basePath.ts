/**
 * Apicurio's server dialog, shown as Base Path (theme/apicurio-mapping.css): a URL there only counts once
 * Apply is pressed (or Enter), which the dialog's Save waits for. ECHO hides Apply and presses it
 * as the user types, and gives the field an example as its placeholder. Under Info a set
 * Base Path is one line with a pencil (its menu and details hidden).
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
  // Apicurio's own Edit shows a server's URL read-only, so the pencil on a set path opens the Add
  // dialog (its button is hidden) with the path filled in; on Save the old path is deleted.
  let replacing: Element | null = null;
  const later = (find: () => HTMLElement | null | undefined, then: (el: HTMLElement) => void, tries = 40) => {
    const el = find();
    if (el) then(el);
    else if (tries > 0) doc.defaultView?.setTimeout(() => later(find, then, tries - 1), 50);
  };
  // The dialog clears its field as it opens, so the path is filled in again until it stays.
  const fill = (input: HTMLInputElement, path: string, tries: number) => {
    if (input.value === path) return;
    input.value = path;
    input.dispatchEvent(new (doc.defaultView?.Event ?? Event)('input', { bubbles: true }));
    input.focus();
    if (tries > 0) doc.defaultView?.setTimeout(() => input.value === '' && fill(input, path, tries - 1), 50);
  };
  const onClick = (event: Event) => {
    const target = event.target as Element | null;
    const save = target?.closest?.('.server-entity-editor button');
    if (save?.textContent?.trim() === 'Save' && replacing?.isConnected) {
      const old = replacing;
      replacing = null;
      const section = old.closest('.servers-section');
      later(
        () => (section && section.querySelectorAll('server-row').length > 1 ? old.querySelector<HTMLElement>('.dropdown-toggle') : null),
        (toggle) => {
          toggle.click();
          // The row's menu is drawn a moment after Angular has handled the toggle; Delete is its last item.
          later(() => old.querySelector<HTMLElement>('.dropdown-menu li:last-child a'), (remove) => remove.click());
        },
      );
      return;
    }
    const row = target?.closest?.('main-form .servers-section server-row');
    // The row's hidden menu gets the clicks made above.
    if (!row || !target?.closest('.header') || target.closest('.actions')) return;
    event.stopPropagation(); // not Apicurio's toggle, which opens the hidden details
    replacing = row;
    const path = row.querySelector('[server-url]')?.textContent?.trim() ?? '';
    row.closest('.servers-section')?.querySelector<HTMLElement>("icon-button[type='add'] button")?.click();
    later(
      () => doc.querySelector<HTMLInputElement>('.server-entity-editor #serverUrl'),
      (input) => fill(input as HTMLInputElement, path, 10),
    );
  };
  doc.addEventListener('input', onInput, true);
  doc.addEventListener('focusin', onFocus, true);
  doc.addEventListener('click', onClick, true);
  return () => {
    doc.removeEventListener('input', onInput, true);
    doc.removeEventListener('focusin', onFocus, true);
    doc.removeEventListener('click', onClick, true);
  };
}
