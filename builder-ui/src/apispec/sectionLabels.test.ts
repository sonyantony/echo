import { describe, expect, it } from 'vitest';
import { titleCase, titleCaseSectionLabels } from './sectionLabels';

describe('section headings in Openapi Design', () => {
  it('are shown in title case', () => {
    expect(titleCase('TAG DEFINITIONS ')).toBe('Tag Definitions ');
    expect(titleCase('INFO')).toBe('Info');
  });

  it('are rewritten as Apicurio draws them, leaving mixed-case labels and counters alone', async () => {
    document.body.innerHTML =
      '<div class="section"><span class="section-label">TAG DEFINITIONS <counter><span>2</span></counter></span></div>' +
      '<div class="section"><span class="section-label">Paths</span></div>';
    const stop = titleCaseSectionLabels(document);
    const labels = document.querySelectorAll('.section-label');
    expect(labels[0].textContent).toBe('Tag Definitions 2');
    expect(labels[1].textContent).toBe('Paths');

    const later = document.createElement('div');
    later.className = 'section';
    later.innerHTML = '<span class="section-label">PATH PARAMETERS</span>';
    document.body.appendChild(later);
    await new Promise((resolve) => setTimeout(resolve));
    expect(later.textContent).toBe('Path Parameters');
    stop();
  });
});
