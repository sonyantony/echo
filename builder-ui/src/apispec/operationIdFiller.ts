import { fillMissingOperationIds, specOperations } from './operationIds';

/** The Operation ID field of the operation on screen (hidden by theme/apicurio-mapping.css). */
const OPERATION_ID_FIELD = 'pf-inline-text-editor[nodepath="operationId"]';
const SAVE = '.form-control-pf-save';
const OPERATION_TAB = '.operation-tab.selected';

/**
 * Gives a new operation its operationId as soon as it is added in Apicurio, before any Save, so
 * Source shows it at once (docs/decisions/0013). Apicurio cannot be handed changes without opening
 * it again, so ECHO fills in the operation's own (hidden) Operation ID field, the way a user would:
 * click it, type the name, press its Save. That is an ordinary edit (undo takes it back).
 *
 * Only an operation without an id gets one, and only when it is the one operation without an id
 * and the one on screen: a path renamed afterwards keeps its id until the spec is saved, when the
 * operation and its routes are renamed together (operationIds.ts).
 *
 * @param editorJson the spec as the editor just reported it
 * @returns the id filled in, or undefined
 */
export function fillNewOperationId(doc: Document, editorJson: string): string | undefined {
  let operations;
  try {
    operations = specOperations(editorJson);
  } catch {
    return undefined;
  }
  const missing = operations.flatMap((op, i) => (op.operationId ? [] : [i]));
  if (missing.length !== 1) return undefined;
  // A new operation's field opens ready to type; otherwise it shows "No Operation ID" until clicked.
  // A field with an id belongs to another operation (Apicurio may keep more than one form around).
  const empty = (field: Element) => {
    const input = field.querySelector<HTMLInputElement>('input');
    if (input) return !input.value.trim();
    return field.querySelector('[title="Click to edit."]')?.textContent?.trim() === 'No Operation ID';
  };
  const fields = [...doc.querySelectorAll<HTMLElement>(OPERATION_ID_FIELD)].filter(empty);
  if (fields.length !== 1) return undefined;
  const field = fields[0];
  if (!field.querySelector('input')) field.querySelector<HTMLElement>('[title="Click to edit."]')?.click();
  const input = field.querySelector<HTMLInputElement>('input');
  const save = field.querySelector<HTMLElement>(SAVE);
  if (!input || !save) return undefined;
  const id = specOperations(fillMissingOperationIds(editorJson))[missing[0]].operationId;
  if (!id) return undefined;
  input.value = id;
  input.dispatchEvent(new (doc.defaultView?.Event ?? Event)('input', { bubbles: true }));
  save.click();
  // Editing a field leaves Apicurio's selection on the field, which Add Path cannot work with
  // ("i.parent is not a function"); a user would have clicked elsewhere since. Select the
  // operation again, as clicking its tab does.
  let around: HTMLElement | null = field;
  while (around && !around.querySelector(OPERATION_TAB)) around = around.parentElement;
  around?.querySelector<HTMLElement>(OPERATION_TAB)?.click();
  return id;
}
