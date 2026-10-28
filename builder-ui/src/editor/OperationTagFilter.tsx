import { FormGroup, FormSelect, FormSelectOption } from '@patternfly/react-core';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ApiTags } from '../api/flows';
import { OPERATION_FIELD, SPEC_FIELD, operationFilterCss, tagOf, tagsFor } from './operationTags';

interface Form {
  /** Kaoto's Operation Id field; the Tag drop-down goes just above it. */
  operationField: Element;
  specificationUri: string;
  operationId: string;
}

/** The REST OpenApi step form open in Kaoto's side panel, if any (both fields are shown with All). */
function readForm(container: HTMLElement): Form | undefined {
  const operationField = container.querySelector(OPERATION_FIELD);
  const specField = container.querySelector(SPEC_FIELD);
  if (!operationField || !specField) return undefined;
  return {
    operationField,
    specificationUri: specField.querySelector('input')?.value ?? '',
    operationId: operationField.querySelector('input')?.value ?? '',
  };
}

/**
 * A Tag drop-down above the REST OpenApi step's Operation Id (Kaoto's form, which ECHO cannot
 * change): it lists the approved spec's tags, and picking one hides the other operations in the
 * Operation Id drop-down. Only a filter: nothing of it is saved in the flow. A step whose operation
 * is set starts on that operation's tag.
 */
export function OperationTagFilter({ container, apis }: { container: HTMLElement; apis: ApiTags[] }) {
  const [form, setForm] = useState<Form>();
  const [slot, setSlot] = useState<HTMLElement>();
  /** The tag picked in this form (the Operation Id field it belongs to): another step's form starts afresh. */
  const [picked, setPicked] = useState<{ field: Element; tag: string }>();

  useEffect(() => {
    const div = document.createElement('div');
    div.className = 'echo-operation-tag';
    const update = () => {
      const next = readForm(container);
      if (next && next.operationField.previousElementSibling !== div) next.operationField.before(div);
      if (!next) div.remove();
      setSlot(next ? div : undefined);
      setForm((prev) =>
        prev?.operationField === next?.operationField &&
        prev?.specificationUri === next?.specificationUri &&
        prev?.operationId === next?.operationId
          ? prev
          : next,
      );
    };
    // Kaoto's drop-downs set the inputs' value (and its attribute) when an option is picked.
    const observer = new MutationObserver(update);
    observer.observe(container, { childList: true, subtree: true, attributes: true, attributeFilter: ['value'] });
    container.addEventListener('input', update, true);
    update();
    return () => {
      observer.disconnect();
      container.removeEventListener('input', update, true);
      div.remove();
    };
  }, [container]);

  if (!form || !slot) return null;
  const tags = tagsFor(apis, form.specificationUri);
  if (tags.length === 0) return null;
  const chosen = picked?.field === form.operationField ? picked.tag : tagOf(tags, form.operationId);
  const tag = tags.some((t) => t.name === chosen) ? chosen : '';
  const css = operationFilterCss(tags, tag);
  return createPortal(
    <>
      {css && <style data-testid="operation-tag-filter">{css}</style>}
      <FormGroup label="Tag" fieldId="echo-operation-tag">
        <FormSelect
          id="echo-operation-tag"
          aria-label="Tag"
          value={tag}
          onChange={(_e, value) => setPicked({ field: form.operationField, tag: value })}
        >
          <FormSelectOption value="" label="All tags" />
          {tags.map((t) => (
            <FormSelectOption key={t.name} value={t.name} label={`${t.name} (${t.operations.length})`} />
          ))}
        </FormSelect>
      </FormGroup>
    </>,
    slot,
  );
}
