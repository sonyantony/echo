import {
  Alert,
  Button,
  FileUpload,
  Form,
  FormGroup,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
} from '@patternfly/react-core';
import { CheckCircleIcon, ExclamationCircleIcon } from '@patternfly/react-icons';
import { useState } from 'react';
import type { RunFile, RunValues } from '../api/flows';
import './RunWithModal.css';

/** Names that look like secrets: their values are not shown. */
const SENSITIVE = /password|passwd|pwd|secret|token|key|credential/i;

/** The keys and values of a .properties file (key=value, key:value or key value; # and ! comments). */
export function parseProperties(text: string): Map<string, string> {
  const values = new Map<string, string>();
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].trimStart();
    if (!line || line.startsWith('#') || line.startsWith('!')) continue;
    // A line ending in an odd number of backslashes goes on in the next one.
    while (/(^|[^\\])(\\\\)*\\$/.test(line) && i + 1 < lines.length) line = line.slice(0, -1) + lines[++i].trimStart();
    const m = /^((?:\\.|[^\\=:\s])+)\s*[=:\s]?\s*(.*)$/.exec(line);
    if (m) values.set(m[1].replace(/\\(.)/g, '$1'), m[2]);
  }
  return values;
}

interface Props {
  flowName: string;
  values: RunValues;
  /** Runs with the chosen file (none when the flow uses no values); fails with the reason it could not. */
  onRun(file?: RunFile): Promise<void>;
  onClose(): void;
}

/**
 * Run <flow> With...: lists the values the flow uses and checks that the chosen properties file sets each
 * one (a placeholder with a default needs none). The file is only for test runs in the Builder.
 */
export function RunWithModal({ flowName, values, onRun, onClose }: Props) {
  const [file, setFile] = useState<RunFile>();
  const [error, setError] = useState<string>();
  const [running, setRunning] = useState(false);
  const { placeholders } = values;
  const read = file && parseProperties(file.content);
  const missing = read ? placeholders.filter((p) => p.fallback === null && !read.has(p.name)).map((p) => p.name) : [];
  const canRun = placeholders.length === 0 || (!!read && missing.length === 0);

  const run = async () => {
    setRunning(true);
    setError(undefined);
    try {
      await onRun(file);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  };

  return (
    <Modal isOpen variant="medium" onClose={onClose} aria-labelledby="run-with-title">
      <ModalHeader
        title={`Run ${flowName} with`}
        labelId="run-with-title"
        description="Choose a properties file that sets every value this flow uses. It is only used for test runs in the Builder: it is not saved with the flow or published."
      />
      <ModalBody>
        {!file && values.fileName && values.missing.length > 0 && (
          <Alert
            variant="warning"
            isInline
            className="echo-run-with__alert"
            title={`${values.fileName} does not set ${values.missing.join(', ')}`}
          >
            The flow uses {values.missing.length === 1 ? 'it' : 'them'} now. Choose a file that sets every value.
          </Alert>
        )}
        {error && <Alert variant="danger" isInline className="echo-run-with__alert" title={error} />}
        <Form onSubmit={(e) => e.preventDefault()}>
          <FormGroup label="Properties file" fieldId="run-with-file" isRequired={placeholders.length > 0}>
            <FileUpload
              id="run-with-file"
              filename={file?.fileName ?? ''}
              filenamePlaceholder="Choose a .properties file"
              browseButtonText="Browse..."
              hideDefaultPreview
              dropzoneProps={{ accept: { 'text/plain': ['.properties'] } }}
              onFileInputChange={async (_e, chosen) => {
                setError(undefined);
                setFile({ fileName: chosen.name, content: await chosen.text() });
              }}
              onClearClick={() => setFile(undefined)}
            />
          </FormGroup>
        </Form>
        {placeholders.length === 0 ? (
          <p className="echo-run-with__none">This flow uses no {'{{values}}'}, so it runs without a file.</p>
        ) : (
          <table className="echo-run-with__table" aria-label="Values the flow uses">
            <thead>
              <tr>
                <th>Value the flow uses</th>
                <th>{file ? `In ${file.fileName}` : 'Value'}</th>
              </tr>
            </thead>
            <tbody>
              {placeholders.map((p) => {
                const value = read?.get(p.name);
                return (
                  <tr key={p.name}>
                    <td>
                      <code>{p.name}</code>
                    </td>
                    <td>
                      {!read ? (
                        <span className="echo-run-with__muted">{p.fallback !== null ? `default ${p.fallback}` : 'needed'}</span>
                      ) : value !== undefined ? (
                        <>
                          <CheckCircleIcon className="echo-run-with__ok" /> {SENSITIVE.test(p.name) ? '••••••••' : value}
                        </>
                      ) : p.fallback !== null ? (
                        <>
                          <CheckCircleIcon className="echo-run-with__ok" /> default {p.fallback}
                        </>
                      ) : (
                        <>
                          <ExclamationCircleIcon className="echo-run-with__bad" /> not set in this file
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {file && missing.length > 0 && (
          <Alert
            variant="danger"
            isInline
            className="echo-run-with__alert"
            title={`${missing.length} ${missing.length === 1 ? 'value is' : 'values are'} missing from ${file.fileName}`}
          >
            Add {missing.join(', ')} to the file and choose it again.
          </Alert>
        )}
      </ModalBody>
      <ModalFooter>
        <Button variant="primary" onClick={run} isDisabled={!canRun || running} isLoading={running}>
          Run
        </Button>
        <Button variant="link" onClick={onClose}>
          Cancel
        </Button>
      </ModalFooter>
    </Modal>
  );
}
