import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { defaultSpecBase, SPEC_NAME_PATTERN, stripExtension, type SpecFormat } from './apiSpec';
import './SpecNameField.css';

interface Props {
  /** The spec's file name, with the extension of the format picked; null while it has none (new, or after Discard). */
  name: string | null;
  /** The Yaml/Json radios' format: the extension, which typing does not change. */
  format: SpecFormat;
  /** The flow's name: a new spec is offered <flow name>-api, which Enter on an empty field takes. */
  flowName: string;
  /** Saves the spec under fileName (replacing the one stored in the flow). Resolves to false when it was not saved. */
  onRename(fileName: string): Promise<boolean>;
}

/**
 * The spec's file name in the breadcrumb, renamed in place: click it to edit, Enter or leaving the
 * field saves, Escape cancels. Only the part before the extension is typed; the extension follows
 * the format. A new spec shows <new>, and naming it saves it: the field offers <flow name>-api, and
 * Enter with nothing typed takes it.
 */
export function SpecNameField({ name, format, flowName, onRename }: Props) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  /** Set once Enter, Escape or blur has handled this edit, so the blur that follows does nothing more. */
  const done = useRef(false);

  const suggested = defaultSpecBase(flowName);
  const base = value.trim();
  const fileName = `${stripExtension(base)}.${format}`;
  const valid = !!base && SPEC_NAME_PATTERN.test(fileName) && fileName.length <= 200;

  useEffect(() => {
    if (editing) input.current?.select();
  }, [editing]);

  const start = () => {
    if (busy) return;
    done.current = false;
    setValue(name ? stripExtension(name) : '');
    setEditing(true);
  };

  const commit = async (target = fileName) => {
    if (done.current) return;
    done.current = true;
    // Nothing typed, the same name, or a name a file cannot have: the name stays as it was.
    if (!SPEC_NAME_PATTERN.test(target) || target.length > 200 || target === name) {
      setEditing(false);
      return;
    }
    setBusy(true);
    try {
      await onRename(target);
    } finally {
      setBusy(false);
      setEditing(false);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      if (valid) void commit();
      // Enter on an empty field takes the name offered for a new spec.
      else if (!base && !name) void commit(`${suggested}.${format}`);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      done.current = true;
      setEditing(false);
    }
  };

  if (!editing) {
    return (
      <h1 className="echo-spec-name">
        <button
          type="button"
          className="echo-spec-name__button"
          data-testid="spec-name"
          onClick={start}
          disabled={busy}
          title={name ? 'Rename the OpenAPI file' : 'Name the OpenAPI file to save it'}
        >
          {name ?? <strong>&lt;new&gt;</strong>}
        </button>
      </h1>
    );
  }

  return (
    <h1 className="echo-spec-name echo-spec-name--editing">
      <input
        ref={input}
        className={`echo-spec-name__input${base && !valid ? ' echo-spec-name__input--invalid' : ''}`}
        aria-label="OpenAPI file name"
        aria-invalid={!!base && !valid}
        value={value}
        placeholder={name ? stripExtension(name) : suggested}
        size={Math.max(value.length, suggested.length, 12)}
        disabled={busy}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => void commit()}
        title="Letters, digits, '.', '-' and '_'. Enter saves, Escape cancels."
      />
      <span className="echo-spec-name__extension">.{format}</span>
    </h1>
  );
}
