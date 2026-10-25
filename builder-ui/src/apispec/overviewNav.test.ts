import { describe, expect, it, vi } from 'vitest';
import { addOverviewNav } from './overviewNav';

const outline =
  '<div class="editor-outline"><section class="paths"><div class="api-path">/orders</div></section>' +
  '<section class="responses"></section></div>';
const mainForm =
  '<main-form><div class="detail-tabs"><ul><li class="active"><a>Design</a></li><li><a>Source</a></li></ul></div></main-form>';

describe('Info, Tag Definitions and Source in the list on the left', () => {
  it('are added above Paths and below Responses, with nothing shown on the right at first', () => {
    document.documentElement.removeAttribute('data-echo-pane');
    document.body.innerHTML = `<div class="editor-title-bar"><h1></h1></div>${outline}`;
    const stop = addOverviewNav(document);

    const items = [...document.querySelectorAll<HTMLElement>('.echo-nav-item')];
    expect(items.map((item) => item.textContent)).toEqual(['Info', 'Tag Definitions', 'Source']);
    const list = document.querySelector('.editor-outline')!;
    expect(list.firstElementChild!.contains(items[0])).toBe(true);
    expect(list.lastElementChild!.contains(items[2])).toBe(true);
    expect(document.documentElement.dataset.echoPane).toBe('none');
    stop();
  });

  it("open the main form on the matching tab, and anything else in the list clears them", () => {
    document.documentElement.removeAttribute('data-echo-pane');
    document.body.innerHTML = `<div class="editor-title-bar"><h1></h1></div>${outline}${mainForm}`;
    const title = vi.fn();
    document.querySelector('h1')!.addEventListener('click', title);
    const source = vi.fn();
    document.querySelectorAll('.detail-tabs a')[1].addEventListener('click', source);
    const stop = addOverviewNav(document);
    const item = (pane: string) => document.querySelector<HTMLElement>(`.echo-nav-item[data-pane='${pane}']`)!;

    item('tags').click();
    expect(document.documentElement.dataset.echoPane).toBe('tags');
    expect(title).toHaveBeenCalledOnce();
    expect(source).not.toHaveBeenCalled(); // already on Design

    item('source').click();
    expect(document.documentElement.dataset.echoPane).toBe('source');
    expect(source).toHaveBeenCalledOnce();

    document.querySelector<HTMLElement>('.api-path')!.click();
    expect(document.documentElement.dataset.echoPane).toBe('none');
    stop();
  });

  it('come back when Apicurio draws its list again', async () => {
    document.body.innerHTML = outline;
    const stop = addOverviewNav(document);
    const list = document.querySelector('.editor-outline')!;
    list.innerHTML = '<section class="paths"></section>';
    await new Promise((resolve) => setTimeout(resolve));
    expect(list.querySelectorAll('.echo-nav-item')).toHaveLength(3);
    expect(list.firstElementChild!.classList).toContain('echo-nav--top');
    stop();
  });
});
