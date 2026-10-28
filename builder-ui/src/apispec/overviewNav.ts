/**
 * Apicurio's list on the left as plain items, each showing its content in the right pane: Info (with
 * Base Path), Tag Definitions, Paths, Data Types, Responses and Source. Until one of them is clicked,
 * the right pane is empty.
 *
 * What is shown is the frame root's data-echo-pane, which theme/apicurio-mapping.css reads:
 *  - info, tags, source: that part of Apicurio's main form (its Design/Source tabs hidden);
 *  - paths, definitions, responses: Apicurio's own section for them (list, count, Add, right-click menu),
 *    which is hidden on the left and laid over the right pane instead. Picking an entry in it opens the
 *    entry as before, and the pane goes back to none. Paths, Data Types and Responses entries get a Delete
 *    button on the right, which deletes through Apicurio's own right-click Delete (so a
 *    deleted path's routes are handled as for any deleted operation).
 * An opened data type or response gets a left arrow before its name, which goes back to its list.
 * Apicurio draws its list again now and then, so the items are added back whenever they are missing.
 */
export type OverviewPane = 'none' | 'info' | 'tags' | 'paths' | 'definitions' | 'responses' | 'source';

const ITEM_CLASS = 'echo-nav-item';
const NAV_CLASS = 'echo-nav';

/** The items, top to bottom; `section` is the Apicurio section a list item stands for. */
const ITEMS: { pane: OverviewPane; label: string; icon: string; section?: string }[] = [
  { pane: 'info', label: 'Info', icon: 'fa-info-circle' },
  { pane: 'tags', label: 'Tag Definitions', icon: 'fa-tags' },
  { pane: 'paths', label: 'Paths', icon: 'fa-sitemap', section: 'path-section' },
  { pane: 'definitions', label: 'Data Types', icon: 'fa-cube', section: 'definition-section' },
  { pane: 'responses', label: 'Responses', icon: 'fa-reply-all', section: 'response-section' },
  { pane: 'source', label: 'Source', icon: 'fa-code' },
];
const LIST_ENTRY = '.api-path, .api-definition, .api-response';
/** Entries with a Delete button, and the id of the right-click menu Apicurio opens for them. */
const DELETABLE: { entry: string; menu: string }[] = [
  { entry: '.path-section .api-path', menu: 'path-context-menu' },
  { entry: '.definition-section .api-definition', menu: 'definition-context-menu' },
  { entry: '.response-section .api-response', menu: 'response-context-menu' },
];
const DELETE_CLASS = 'echo-entry-delete';
/** The forms of an opened data type and response, and the list their back arrow goes to. */
const BACK: { form: string; pane: OverviewPane; label: string }[] = [
  { form: 'definition-form', pane: 'definitions', label: 'Back to Data Types' },
  { form: 'response-form', pane: 'responses', label: 'Back to Responses' },
];
const BACK_CLASS = 'echo-back';

/**
 * Deletes `entry` as its right-click menu's Delete does: the menu is opened where the button is and
 * its Delete picked, so Apicurio's own checks and undo apply.
 */
function deleteEntry(doc: Document, entry: HTMLElement, button: HTMLElement, menu: string) {
  const view = doc.defaultView;
  const box = button.getBoundingClientRect();
  // A path listens for its right-click on the item inside its row.
  (entry.querySelector(':scope > [path-item]') ?? entry).dispatchEvent(
    new (view?.MouseEvent ?? MouseEvent)('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: box.left, clientY: box.bottom }),
  );
  // The menu is drawn by Apicurio, usually at once, else a moment later.
  let tries = 20;
  const pick = () => {
    const item = [...doc.querySelectorAll<HTMLElement>(`#${menu} li > a`)].find((a) => a.textContent?.trim() === 'Delete');
    if (item) item.click();
    else if (tries-- > 0) view?.setTimeout(pick, 25);
  };
  pick();
}

/** Shows `pane` in the right pane (or nothing, with 'none'). */
export function showPane(doc: Document, pane: OverviewPane) {
  doc.documentElement.dataset.echoPane = pane;
  if (pane === 'none') return;
  // Apicurio opens its main form when its (hidden) title is clicked; with a list shown none of it shows.
  doc.querySelector<HTMLElement>('.editor-title-bar > h1')?.click();
  const section = ITEMS.find((item) => item.pane === pane)?.section;
  if (section) {
    placeLists(doc);
    // A list collapsed earlier is opened again (its heading no longer takes clicks, see the CSS).
    const toggle = doc.querySelector<HTMLElement>(`.editor-outline .${section} > .section-header > a.collapsed`);
    toggle?.click();
    return;
  }
  // The main form may be drawn a moment later; Info and Tag Definitions are on its Design tab.
  const tab = pane === 'source' ? 2 : 1;
  let tries = 20;
  const pick = () => {
    const link = doc.querySelector<HTMLElement>(`main-form .detail-tabs li:nth-child(${tab}) > a`);
    if (link) {
      if (!link.parentElement?.classList.contains('active')) link.click();
    } else if (tries-- > 0) doc.defaultView?.setTimeout(pick, 50);
  };
  pick();
}

/** The lists are laid over the right pane, wherever it is now (see theme/apicurio-mapping.css). */
function placeLists(doc: Document) {
  const detail = doc.querySelector('.editor-detail')?.getBoundingClientRect();
  if (!detail) return;
  doc.documentElement.style.setProperty('--detail-pane-top', `${detail.top}px`);
  doc.documentElement.style.setProperty('--detail-pane-left', `${detail.left}px`);
}

export function addOverviewNav(doc: Document) {
  const item = ({ pane, label, icon }: (typeof ITEMS)[number]) => {
    const el = doc.createElement('div');
    el.className = ITEM_CLASS;
    el.dataset.pane = pane;
    el.tabIndex = 0;
    el.setAttribute('role', 'button');
    el.innerHTML = `<span class="fa fa-fw ${icon}"></span><span class="echo-nav-item__label"></span><span class="echo-nav-item__count"></span>`;
    el.querySelector('.echo-nav-item__label')!.textContent = label;
    return el;
  };
  const root = doc.documentElement as HTMLElement | null; // none in jsdom's blank frames
  const apply = () => {
    const outline = doc.querySelector('.editor-outline');
    if (!outline) return;
    if (outline.firstElementChild?.className !== NAV_CLASS) {
      outline.querySelector(`:scope > .${NAV_CLASS}`)?.remove();
      const nav = doc.createElement('div');
      nav.className = NAV_CLASS;
      nav.append(...ITEMS.map(item));
      outline.prepend(nav);
    }
    // The lists' counts, from Apicurio's headings.
    for (const { pane, section } of ITEMS) {
      if (!section) continue;
      const count = outline.querySelector(`.${section} .item-counter`)?.textContent?.trim();
      const shown = outline.querySelector(`.${NAV_CLASS} [data-pane='${pane}'] .echo-nav-item__count`);
      const text = count ? `(${count})` : '';
      if (shown && shown.textContent !== text) shown.textContent = text;
    }
    for (const { entry } of DELETABLE) {
      for (const row of outline.querySelectorAll<HTMLElement>(entry)) {
        if (row.querySelector(`:scope > .${DELETE_CLASS}`)) continue;
        const name = (row.querySelector('.name') ?? row).textContent?.trim() ?? '';
        const button = doc.createElement('button');
        button.type = 'button';
        button.className = DELETE_CLASS;
        button.title = name ? `Delete ${name}` : 'Delete';
        button.setAttribute('aria-label', button.title);
        button.innerHTML = '<span class="pficon pficon-delete"></span>';
        row.append(button);
      }
    }
    for (const { form, pane, label } of BACK) {
      const name = doc.querySelector<HTMLElement>(`${form} .detail-title .detail-label`);
      if (!name || name.querySelector(`:scope > .${BACK_CLASS}`)) continue;
      const button = doc.createElement('button');
      button.type = 'button';
      button.className = BACK_CLASS;
      button.dataset.pane = pane;
      button.title = label;
      button.setAttribute('aria-label', label);
      button.innerHTML = '<span class="fa fa-arrow-left"></span>';
      name.prepend(button);
    }
    // Something else picked (a new path, say, after Add): the right pane is Apicurio's again.
    const pane = root?.dataset.echoPane;
    if (pane && pane !== 'none' && doc.querySelector('.editor-detail') && !doc.querySelector('.editor-detail main-form')) {
      root!.dataset.echoPane = 'none';
    }
  };

  const onClick = (event: Event) => {
    const target = event.target as Element | null;
    const back = target?.closest?.<HTMLElement>(`.${BACK_CLASS}`);
    if (back) {
      showPane(doc, back.dataset.pane as OverviewPane);
      return;
    }
    if (!target?.closest?.('.editor-outline')) return;
    const remove = target.closest<HTMLElement>(`.${DELETE_CLASS}`);
    if (remove) {
      // Only the Delete: the entry is not opened.
      event.preventDefault();
      event.stopPropagation();
      const found = DELETABLE.find(({ entry }) => remove.parentElement?.matches(entry));
      if (found) deleteEntry(doc, remove.parentElement!, remove, found.menu);
      return;
    }
    const picked = target.closest<HTMLElement>(`.${ITEM_CLASS}`);
    if (picked) {
      showPane(doc, picked.dataset.pane as OverviewPane);
    } else if (target.closest(LIST_ENTRY)) {
      // An entry opens in the right pane, in place of its list.
      showPane(doc, 'none');
    }
  };
  const onKey = (event: KeyboardEvent) => {
    const picked = (event.target as Element | null)?.closest?.<HTMLElement>(`.${ITEM_CLASS}`);
    if (!picked || (event.key !== 'Enter' && event.key !== ' ')) return;
    event.preventDefault();
    showPane(doc, picked.dataset.pane as OverviewPane);
  };
  const onResize = () => placeLists(doc);

  if (root && !root.dataset.echoPane) root.dataset.echoPane = 'none';
  apply();
  // The frame's own MutationObserver: its nodes belong to the frame's window.
  const observer = new (doc.defaultView?.MutationObserver ?? MutationObserver)(apply);
  try {
    observer.observe(doc.documentElement, { childList: true, subtree: true, characterData: true });
  } catch {
    // A frame document the observer cannot watch (only happens in the jsdom test environment).
  }
  doc.addEventListener('click', onClick, true);
  doc.addEventListener('keydown', onKey, true);
  doc.defaultView?.addEventListener('resize', onResize);
  return () => {
    observer.disconnect();
    doc.removeEventListener('click', onClick, true);
    doc.removeEventListener('keydown', onKey, true);
    doc.defaultView?.removeEventListener('resize', onResize);
  };
}
