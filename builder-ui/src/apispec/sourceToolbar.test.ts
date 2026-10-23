import { describe, expect, it, vi } from 'vitest';
import { addSourceUpload } from './sourceToolbar';

const bar =
  '<div class="detail-actionbar"><button><span class="fa-indent"></span>Format</button>' +
  '<button><span class="pficon-save"></span>Save</button></div>';

describe('Upload on the Source tab', () => {
  it('is added to the whole spec\'s toolbar only, once, and calls onUpload', async () => {
    document.body.innerHTML = `<main-form>${bar}</main-form><path-form>${bar}</path-form>`;
    const onUpload = vi.fn();
    const stop = addSourceUpload(document, onUpload);

    const uploads = document.querySelectorAll('.echo-source-upload');
    expect(uploads).toHaveLength(1);
    expect(uploads[0].closest('main-form')).not.toBeNull();
    expect(uploads[0].textContent).toBe('Upload');
    (uploads[0] as HTMLButtonElement).click();
    expect(onUpload).toHaveBeenCalledOnce();

    // Source closed and opened again: Apicurio draws a fresh toolbar.
    const form = document.querySelector('main-form')!;
    form.innerHTML = bar;
    await new Promise((resolve) => setTimeout(resolve));
    expect(form.querySelectorAll('.echo-source-upload')).toHaveLength(1);
    stop();
  });
});
