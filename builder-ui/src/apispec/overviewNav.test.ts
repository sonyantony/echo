import { describe, expect, it, vi } from 'vitest';
import { addOverviewNav } from './overviewNav';

const outline =
  '<div class="editor-outline">' +
  '<section><div class="path-section section"><div class="section-header"><a class="collapsed"><span class="section-label">Paths <counter><span class="item-counter">2</span></counter></span></a></div>' +
  '<div class="section-body"><div class="api-path">/orders</div></div></div></section>' +
  '<section><div class="definition-section section"><div class="section-header"><a><span class="section-label">Data Types <counter></counter></span></a></div></div></section>' +
  '<section><div class="response-section section"></div></section></div>';
const detail =
  '<div class="editor-detail"><main-form><div class="detail-tabs"><ul><li class="active"><a>Design</a></li><li><a>Source</a></li></ul></div></main-form></div>';
const pane = () => document.documentElement.dataset.echoPane;
const item = (name: string) => document.querySelector<HTMLElement>(`.echo-nav-item[data-pane='${name}']`)!;

describe("Apicurio's list on the left as plain items", () => {
  it('lists Info, Tag Definitions, Paths, Data Types, Responses and Source, with counts, and nothing shown at first', () => {
    document.documentElement.removeAttribute('data-echo-pane');
    document.body.innerHTML = `<div class="editor-title-bar"><h1></h1></div>${outline}${detail}`;
    const stop = addOverviewNav(document);

    const items = [...document.querySelectorAll<HTMLElement>('.echo-nav-item')];
    expect(items.map((el) => el.textContent)).toEqual(['Info', 'Tag Definitions', 'Paths(2)', 'Data Types', 'Responses', 'Source']);
    expect(document.querySelector('.editor-outline')!.firstElementChild!.contains(items[0])).toBe(true);
    expect(pane()).toBe('none');
    stop();
  });

  it('show their content on the right; picking an entry of a list leaves it to Apicurio', () => {
    document.documentElement.removeAttribute('data-echo-pane');
    document.body.innerHTML = `<div class="editor-title-bar"><h1></h1></div>${outline}${detail}`;
    const title = vi.fn();
    document.querySelector('h1')!.addEventListener('click', title);
    const source = vi.fn();
    document.querySelectorAll('.detail-tabs a')[1].addEventListener('click', source);
    const unfold = vi.fn((event: Event) => (event.currentTarget as Element).classList.remove('collapsed'));
    document.querySelector('.path-section .section-header > a')!.addEventListener('click', unfold);
    const stop = addOverviewNav(document);

    item('tags').click();
    expect(pane()).toBe('tags');
    expect(title).toHaveBeenCalledOnce();
    expect(source).not.toHaveBeenCalled(); // already on Design

    item('source').click();
    expect(pane()).toBe('source');
    expect(source).toHaveBeenCalledOnce();

    // A list folded away earlier is opened again.
    item('paths').click();
    expect(pane()).toBe('paths');
    expect(unfold).toHaveBeenCalledOnce();
    item('paths').click();
    expect(unfold).toHaveBeenCalledOnce();

    document.querySelector<HTMLElement>('.api-path')!.click();
    expect(pane()).toBe('none');
    stop();
  });

  it('come back when Apicurio draws its list again, and give the pane back when it opens something else', async () => {
    document.body.innerHTML = `${outline}${detail}`;
    const stop = addOverviewNav(document);
    item('definitions').click();
    const list = document.querySelector('.editor-outline')!;
    list.innerHTML = '<section></section>';
    await new Promise((resolve) => setTimeout(resolve));
    expect(list.querySelectorAll('.echo-nav-item')).toHaveLength(6);
    expect(pane()).toBe('definitions');

    // A path opened by Apicurio itself (after Add, say) replaces the main form.
    document.querySelector('.editor-detail')!.innerHTML = '<path-form></path-form>';
    await new Promise((resolve) => setTimeout(resolve));
    expect(pane()).toBe('none');
    stop();
  });

  it("give data types and responses a Delete button that uses the entry's right-click Delete", () => {
    document.documentElement.removeAttribute('data-echo-pane');
    document.body.innerHTML =
      '<div class="editor-outline"><div class="path-section"><div class="api-path"><span class="name">/orders</span></div></div>' +
      '<div class="definition-section"><div class="api-definition"><span class="name">Customer</span></div></div>' +
      '<div class="response-section"><div class="api-response"><span class="name">Missing</span></div></div></div>';
    const opened = vi.fn();
    const entry = document.querySelector<HTMLElement>('.api-definition')!;
    entry.addEventListener('click', opened);
    // Apicurio's right-click draws its menu; its Delete is what deletes.
    const deleted = vi.fn();
    entry.addEventListener('contextmenu', () => {
      document.body.insertAdjacentHTML('beforeend', '<ul id="definition-context-menu"><li><a>Rename</a></li><li><a>Delete</a></li></ul>');
      document.querySelectorAll<HTMLElement>('#definition-context-menu a')[1].addEventListener('click', deleted);
    });
    const stop = addOverviewNav(document);

    expect(document.querySelector('.api-path .echo-entry-delete')).toBeNull();
    expect(document.querySelector('.api-response .echo-entry-delete')!.getAttribute('aria-label')).toBe('Delete Missing');
    document.querySelector<HTMLElement>('.api-definition .echo-entry-delete')!.click();
    expect(deleted).toHaveBeenCalledOnce();
    expect(opened).not.toHaveBeenCalled();
    expect(pane()).toBe('none');
    stop();
  });

  it("make an opened data type's or response's icon go back to its list", () => {
    document.documentElement.removeAttribute('data-echo-pane');
    document.body.innerHTML =
      `<div class="editor-title-bar"><h1></h1></div>${outline}` +
      '<div class="editor-detail"><response-form><div class="detail-title"><div class="detail-label">' +
      '<span class="fa fa-fw fa-reply-all"></span><span>Missing</span></div></div></response-form></div>';
    const title = vi.fn();
    document.querySelector('h1')!.addEventListener('click', title);
    const stop = addOverviewNav(document);

    const icon = document.querySelector<HTMLElement>('response-form .fa-reply-all')!;
    expect(icon.getAttribute('role')).toBe('button');
    expect(icon.getAttribute('aria-label')).toBe('Back to Responses');
    icon.click();
    expect(pane()).toBe('responses');
    expect(title).toHaveBeenCalledOnce();

    document.documentElement.dataset.echoPane = 'none';
    document.querySelector('.editor-detail')!.innerHTML =
      '<definition-form><div class="detail-label"><span class="fa fa-fw fa-code"></span>Customer</div></definition-form>';
    stop();
    const again = addOverviewNav(document);
    document.querySelector<HTMLElement>('definition-form .fa-code')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(pane()).toBe('definitions');
    again();
  });
});
