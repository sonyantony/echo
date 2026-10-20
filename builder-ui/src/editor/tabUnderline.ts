const ACCENT_PROPERTIES = [
  '--pf-v6-c-tabs--link-accent--start',
  '--pf-v6-c-tabs--link-accent--TranslateX',
  '--pf-v6-c-tabs--link-accent--length',
];

/** Marks the menu on the tab line that has the underline (styled like the open tab). */
export const UNDERLINED_CLASS = 'echo-tab-menu--underlined';

/**
 * Keeps Kaoto's tab underline (PatternFly's animated accent, drawn by the tab list) on the right
 * item of the editor's tab line, Builder menus included:
 * - a menu (File, Flow Design, Run, Advanced) takes it when clicked, and keeps it after its dropdown
 *   closes;
 * - a Kaoto tab takes it back when clicked, or when another view opens;
 * - while Kaoto's Design or Beans view is open and no menu was clicked since, it sits under the menu
 *   standing in for that tab (the toggle's `data-echo-tab`, see KaotoTabMenu.tsx).
 * PatternFly sets the accent's position on the tabs element; values on the list itself take
 * precedence, and are removed again when a Kaoto tab has the underline. Returns a cleanup function.
 */
export function trackTabUnderline(container: HTMLElement) {
  let clicked: HTMLElement | null = null;
  let selected: string | null = null;
  let underlined: HTMLElement | null = null;
  const list = () => container.querySelector<HTMLElement>(":scope > .shell > div[role='region'] > .pf-v6-c-tabs__list");
  const selectedTab = () =>
    list()?.querySelector("[role='tab'][aria-selected='true']")?.closest<HTMLElement>('[data-testid]')?.dataset.testid ?? null;

  const targetIn = (tabs: HTMLElement) =>
    (clicked?.isConnected && tabs.contains(clicked) ? clicked : null) ??
    (selected ? tabs.querySelector<HTMLElement>(`.pf-v6-c-menu-toggle[data-echo-tab='${selected}']`) : null);

  const place = () => {
    const tabs = list();
    if (!tabs) return;
    const target = targetIn(tabs);
    if (underlined !== target) {
      underlined?.classList.remove(UNDERLINED_CLASS);
      target?.classList.add(UNDERLINED_CLASS);
      underlined = target;
    }
    if (!target) {
      for (const name of ACCENT_PROPERTIES) tabs.style.removeProperty(name);
      return;
    }
    const box = target.getBoundingClientRect();
    const start = box.left - tabs.getBoundingClientRect().left + tabs.scrollLeft;
    tabs.style.setProperty('--pf-v6-c-tabs--link-accent--start', `${start}px`);
    // PatternFly derives TranslateX from start on the tabs element, so it is set here too.
    tabs.style.setProperty('--pf-v6-c-tabs--link-accent--TranslateX', `${start}px`);
    tabs.style.setProperty('--pf-v6-c-tabs--link-accent--length', `${box.width}px`);
  };

  const onClick = (event: MouseEvent) => {
    const target = event.target as Element | null;
    const tabs = list();
    if (!target || !tabs?.contains(target)) return;
    const menu = target.closest<HTMLElement>('.pf-v6-c-menu-toggle');
    if (menu) clicked = menu;
    else if (target.closest("[data-testid$='-tab']")) clicked = null;
    else return;
    place();
  };
  const sizes = new ResizeObserver(place);
  let observed: HTMLElement | null = null;
  // Kaoto changes the page often (the canvas is drawn in it); measure only when the result can differ.
  const onChange = () => {
    const tabs = list();
    if (!tabs) return;
    if (tabs !== observed) {
      if (observed) sizes.unobserve(observed);
      sizes.observe(tabs);
      observed = tabs;
    }
    const now = selectedTab();
    // Another view opened (from a tab, or from a menu item such as Java Beans): it has the underline.
    if (now !== selected) {
      selected = now;
      clicked = null;
      place();
    } else if (targetIn(tabs) !== underlined) {
      place();
    }
  };

  // Capture, so a menu's own click handler (which may open another view) runs after this.
  container.addEventListener('click', onClick, true);
  const mutations = new MutationObserver(onChange);
  mutations.observe(container, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-selected'] });
  onChange();

  return () => {
    container.removeEventListener('click', onClick, true);
    mutations.disconnect();
    sizes.disconnect();
  };
}
