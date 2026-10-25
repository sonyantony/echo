/**
 * The spec's own details as items in Apicurio's list on the left: Info (with Base Path) and Tag
 * Definitions above Paths, Source below Responses. Each shows its part of Apicurio's main form on the
 * right; until one, a path, a data type or a response is clicked, the right pane is empty.
 *
 * The part shown is the frame root's data-echo-pane (none, info, tags or source), which
 * theme/apicurio-mapping.css reads to hide the rest of the main form and its Design/Source tabs.
 * Apicurio draws its list again now and then, so the items are added back whenever they are missing.
 */
export type OverviewPane = 'none' | 'info' | 'tags' | 'source';

const ITEM_CLASS = 'echo-nav-item';
const TOP_CLASS = 'echo-nav echo-nav--top';
const BOTTOM_CLASS = 'echo-nav echo-nav--bottom';

const TOP_ITEMS: { pane: OverviewPane; label: string; icon: string }[] = [
  { pane: 'info', label: 'Info', icon: 'fa-info-circle' },
  { pane: 'tags', label: 'Tag Definitions', icon: 'fa-tags' },
];
const BOTTOM_ITEMS: typeof TOP_ITEMS = [{ pane: 'source', label: 'Source', icon: 'fa-code' }];

/** Shows `pane` of the main form (or nothing, with 'none'). */
export function showPane(doc: Document, pane: OverviewPane) {
  doc.documentElement.dataset.echoPane = pane;
  if (pane === 'none') return;
  // Apicurio opens its main form when its (hidden) title is clicked.
  doc.querySelector<HTMLElement>('.editor-title-bar > h1')?.click();
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

export function addOverviewNav(doc: Document) {
  const item = ({ pane, label, icon }: (typeof TOP_ITEMS)[number]) => {
    const el = doc.createElement('div');
    el.className = ITEM_CLASS;
    el.dataset.pane = pane;
    el.tabIndex = 0;
    el.setAttribute('role', 'button');
    el.innerHTML = `<span class="fa fa-fw ${icon}"></span><span class="echo-nav-item__label"></span>`;
    el.querySelector('.echo-nav-item__label')!.textContent = label;
    return el;
  };
  const group = (className: string, items: typeof TOP_ITEMS) => {
    const el = doc.createElement('div');
    el.className = className;
    el.append(...items.map(item));
    return el;
  };
  const apply = () => {
    const outline = doc.querySelector('.editor-outline');
    if (!outline) return;
    if (outline.firstElementChild?.className !== TOP_CLASS) {
      outline.querySelector(`:scope > .echo-nav--top`)?.remove();
      outline.prepend(group(TOP_CLASS, TOP_ITEMS));
    }
    if (outline.lastElementChild?.className !== BOTTOM_CLASS) {
      outline.querySelector(`:scope > .echo-nav--bottom`)?.remove();
      outline.append(group(BOTTOM_CLASS, BOTTOM_ITEMS));
    }
  };

  // Our items show their part; anything else picked in the list (a path, a data type, a
  // response, an Add button) leaves the main form, so nothing of it is shown if Apicurio goes back to it.
  const onClick = (event: Event) => {
    const target = event.target as Element | null;
    if (!target?.closest?.('.editor-outline')) return;
    const picked = target.closest<HTMLElement>(`.${ITEM_CLASS}`);
    showPane(doc, (picked?.dataset.pane as OverviewPane | undefined) ?? 'none');
  };
  const onKey = (event: KeyboardEvent) => {
    const picked = (event.target as Element | null)?.closest?.<HTMLElement>(`.${ITEM_CLASS}`);
    if (!picked || (event.key !== 'Enter' && event.key !== ' ')) return;
    event.preventDefault();
    showPane(doc, picked.dataset.pane as OverviewPane);
  };

  const root = doc.documentElement as HTMLElement | null; // none in jsdom's blank frames
  if (root && !root.dataset.echoPane) root.dataset.echoPane = 'none';
  apply();
  // The frame's own MutationObserver: its nodes belong to the frame's window.
  const observer = new (doc.defaultView?.MutationObserver ?? MutationObserver)(apply);
  try {
    observer.observe(doc.documentElement, { childList: true, subtree: true });
  } catch {
    // A frame document the observer cannot watch (only happens in the jsdom test environment).
  }
  doc.addEventListener('click', onClick, true);
  doc.addEventListener('keydown', onKey, true);
  return () => {
    observer.disconnect();
    doc.removeEventListener('click', onClick, true);
    doc.removeEventListener('keydown', onKey, true);
  };
}
