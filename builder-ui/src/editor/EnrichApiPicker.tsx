import {
  FormGroup,
  FormSelect,
  FormSelectOption,
  HelperText,
  HelperTextItem,
  Radio,
} from "@patternfly/react-core";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { ApiTags } from "../api/flows";
import { tagOf } from "./operationTags";
import {
  ENRICH_HEADER,
  EXPRESSION_FIELD,
  EXPRESSION_LIST,
  apiCallUri,
  calledApi,
  operationsFor,
  parseApiCall,
  startsOnApi,
} from "./enrichApi";

interface Form {
  /** The step's header icon class, which ends with its path: one per step. */
  step: string;
  /** Kaoto's Expression field (language buttons and text); the drop-downs go just above it. */
  field: Element;
  expression: string;
}

/** Kaoto's Expression field of the Enrich step form open in the side panel, if any. */
function expressionField(container: HTMLElement): Element | null {
  return (
    container.querySelector(EXPRESSION_LIST)?.closest(EXPRESSION_FIELD) ?? null
  );
}

function readForm(container: HTMLElement): Form | undefined {
  const header = container.querySelector(ENRICH_HEADER);
  const field = expressionField(container);
  if (!header || !field) return undefined;
  return {
    step: header.className,
    field,
    expression: field.querySelector("textarea")?.value ?? "",
  };
}

const nextFrame = () =>
  new Promise((resolve) => requestAnimationFrame(resolve));

/**
 * Sets Kaoto's Expression text as typing would (Kaoto saves it from the input event). A new Enrich
 * has no language yet, so Simple is picked first and its text box waited for.
 */
async function writeExpression(container: HTMLElement, text: string) {
  let area = expressionField(container)?.querySelector("textarea");
  if (!area) {
    const buttons =
      expressionField(container)?.querySelectorAll<HTMLButtonElement>(
        `${EXPRESSION_LIST} button`,
      ) ?? [];
    [...buttons].find((b) => b.textContent?.trim() === "Simple")?.click();
    for (let i = 0; i < 60 && !area; i++) {
      await nextFrame();
      area = expressionField(container)?.querySelector("textarea");
    }
  }
  if (!area) return;
  Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    "value",
  )!.set!.call(area, text);
  area.dispatchEvent(new Event("input", { bubbles: true }));
}

/** What the user chose in one step's form; the URI itself lives in Kaoto's Expression. */
interface Choice {
  typed?: boolean;
  spec?: string;
  tag?: string;
}

/**
 * The Enrich step's form (Kaoto's, which ECHO cannot change) gets the REST OpenApi step's approved
 * API drop-downs above its Expression: API (preselected), Tag and Operation. Picking an operation
 * writes rest-openapi:<spec>#<operationId> (with ?host= when the spec names no server) as the
 * Expression, which is hidden meanwhile. "URI typed by hand" shows Kaoto's Expression again, for
 * a plain http or https call. An Enrich whose Expression is something else opens on that.
 */
export function EnrichApiPicker({
  container,
  apis,
}: {
  container: HTMLElement;
  apis: ApiTags[];
}) {
  const [form, setForm] = useState<Form>();
  const [slot, setSlot] = useState<HTMLElement>();
  const [choices, setChoices] = useState<Record<string, Choice>>({});

  useEffect(() => {
    const div = document.createElement("div");
    div.className = "echo-enrich-api";
    const update = () => {
      const next = readForm(container);
      if (next && next.field.previousElementSibling !== div)
        next.field.before(div);
      if (!next) div.remove();
      setSlot(next ? div : undefined);
      setForm((prev) =>
        prev?.step === next?.step &&
        prev?.field === next?.field &&
        prev?.expression === next?.expression
          ? prev
          : next,
      );
    };
    const observer = new MutationObserver(update);
    observer.observe(container, { childList: true, subtree: true });
    container.addEventListener("input", update, true);
    update();
    return () => {
      observer.disconnect();
      container.removeEventListener("input", update, true);
      div.remove();
    };
  }, [container]);

  if (!form || !slot) return null;
  const choice = choices[form.step] ?? {};
  const choose = (change: Choice) =>
    setChoices((all) => ({ ...all, [form.step]: { ...choice, ...change } }));
  const typed = choice.typed ?? !startsOnApi(apis, form.expression);
  const call = parseApiCall(form.expression);
  const api =
    apis.find((a) => a.specificationUri === choice.spec) ??
    calledApi(apis, form.expression) ??
    apis[0];
  const operation =
    call && calledApi(apis, form.expression) === api ? call.operationId : "";
  const tag = choice.tag ?? tagOf(api.tags, operation);
  const operations = operationsFor(api, tag);
  const options =
    call && calledApi(apis, form.expression) === api ? call.options : "";

  return createPortal(
    <div className="echo-enrich-api__fields">
      {!typed && (
        <style data-testid="enrich-expression-hidden">{`.echo-enrich-api + ${EXPRESSION_FIELD} { display: none; }`}</style>
      )}
      <FormGroup
        role="radiogroup"
        label="Call"
        fieldId="echo-enrich-call"
        isInline
      >
        <Radio
          id="echo-enrich-call-api"
          name="echo-enrich-call"
          label="Approved API"
          isChecked={!typed}
          onChange={() => choose({ typed: false })}
        />
        <Radio
          id="echo-enrich-call-typed"
          name="echo-enrich-call"
          label="URI typed by hand"
          isChecked={typed}
          onChange={() => choose({ typed: true })}
        />
      </FormGroup>
      {!typed && (
        <>
          <FormGroup label="API" fieldId="echo-enrich-api">
            <FormSelect
              id="echo-enrich-api"
              aria-label="API"
              value={api.specificationUri}
              onChange={(_e, value) => {
                const next = apis.find((a) => a.specificationUri === value)!;
                choose({ spec: value, tag: "" });
                if (call) void writeExpression(container, apiCallUri(next, ""));
              }}
            >
              {apis.map((a) => (
                <FormSelectOption
                  key={a.specificationUri}
                  value={a.specificationUri}
                  label={a.name || a.specificationUri}
                />
              ))}
            </FormSelect>
          </FormGroup>
          <FormGroup label="Tag" fieldId="echo-enrich-tag">
            <FormSelect
              id="echo-enrich-tag"
              aria-label="Tag"
              value={tag}
              onChange={(_e, value) => choose({ tag: value })}
            >
              <FormSelectOption value="" label="All tags" />
              {api.tags.map((t) => (
                <FormSelectOption
                  key={t.name}
                  value={t.name}
                  label={`${t.name} (${t.operations.length})`}
                />
              ))}
            </FormSelect>
          </FormGroup>
          <FormGroup label="Operation Id" fieldId="echo-enrich-operation">
            <FormSelect
              id="echo-enrich-operation"
              aria-label="Operation Id"
              value={operations.includes(operation) ? operation : ""}
              onChange={(_e, value) => {
                choose({ spec: api.specificationUri });
                void writeExpression(
                  container,
                  apiCallUri(api, value, options),
                );
              }}
            >
              <FormSelectOption
                value=""
                label="Choose an operation"
                isDisabled
              />
              {operations.map((id) => (
                <FormSelectOption key={id} value={id} label={id} />
              ))}
            </FormSelect>
            <HelperText>
              <HelperTextItem
                data-testid="enrich-api-uri"
                className={
                  call && operation ? "echo-enrich-api__uri" : undefined
                }
              >
                {call && operation
                  ? `Calls ${form.expression.trim()}`
                  : "Pick the operation this step calls."}
              </HelperTextItem>
            </HelperText>
          </FormGroup>
        </>
      )}
    </div>,
    slot,
  );
}
