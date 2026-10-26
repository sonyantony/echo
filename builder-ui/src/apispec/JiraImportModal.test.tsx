import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { StoryExamples } from '../api/jira';
import { JiraImportModal } from './JiraImportModal';

const storyExamples = vi.fn<(link: string) => Promise<StoryExamples>>();
vi.mock('../api/jira', () => ({ storyExamples: (link: string) => storyExamples(link) }));

const spec = JSON.stringify({
  openapi: '3.0.3',
  info: { title: 'Payments', version: '1.0.0' },
  servers: [{ url: '/banking/v1' }],
  paths: { '/cards': { get: { operationId: 'getCards', responses: { '200': { description: 'OK' } } } } },
  components: {},
});

const story: StoryExamples = {
  key: 'PAY-142',
  summary: 'Pay a bill',
  link: 'https://acme.atlassian.net/browse/PAY-142',
  comments: 1,
  examples: [
    { id: 1, json: '{ "amount": 10 }', source: 'Description', role: 'request' },
    { id: 2, json: '{ "paymentId": "p-1" }', source: 'Description', role: 'response' },
    { id: 3, json: '{ "paymentId": "p-1", "state": "NEW" }', source: 'Comment by Priya Shah, 14 Oct 2026', role: 'response' },
  ],
  operations: [
    { method: 'POST', path: '/banking/v1/accounts/{id}/payments', request: 1, response: 3, examples: [1, 2, 3] },
    { method: 'GET', path: '/cards?status=ACTIVE', request: null, response: null, examples: [] },
  ],
};

describe('Import From Jira dialog', () => {
  it('shows what it found for checking, adds it, then lists the paths and data types made', async () => {
    const user = userEvent.setup();
    storyExamples.mockResolvedValue(story);
    const onApply = vi.fn();
    const onUndo = vi.fn();
    const onClose = vi.fn();
    render(<JiraImportModal currentJson={() => spec} onApply={onApply} onUndo={onUndo} onClose={onClose} />);

    await user.type(screen.getByLabelText(/Story link/), 'https://acme.atlassian.net/browse/PAY-142');
    await user.click(screen.getByRole('button', { name: 'Read Story' }));
    expect(storyExamples).toHaveBeenCalledWith('https://acme.atlassian.net/browse/PAY-142');

    expect(await screen.findByText('PAY-142: Pay a bill')).toBeInTheDocument();
    expect(screen.getByText(/Found 3 example payloads in the description and 1 comment/)).toBeInTheDocument();

    const first = screen.getByRole('region', { name: 'Operation 1' });
    // The spec's Base Path is taken off; the newest response is picked, and the others offered.
    expect(within(first).getByLabelText(/^Path/)).toHaveValue('/accounts/{id}/payments');
    expect(within(first).getByLabelText('Response body JSON')).toHaveValue('{ "paymentId": "p-1", "state": "NEW" }');
    expect(within(first).getByText(/several response examples here/)).toBeInTheDocument();
    await user.selectOptions(within(first).getByLabelText('Response body example'), '2');
    expect(within(first).getByLabelText('Response body JSON')).toHaveValue('{ "paymentId": "p-1" }');

    const second = screen.getByRole('region', { name: 'Operation 2' });
    expect(within(second).getByText(/Already in the spec/)).toBeInTheDocument();
    await user.click(within(second).getByLabelText('Import'));

    await user.click(screen.getByRole('button', { name: 'Add To Spec' }));
    expect(onApply).toHaveBeenCalledTimes(1);
    const result = onApply.mock.calls[0][0];
    expect(Object.keys(JSON.parse(result.json).paths)).toEqual(['/cards', '/accounts/{id}/payments']);

    expect(screen.getByText('Check what was added')).toBeInTheDocument();
    expect(within(screen.getByRole('list', { name: 'Paths' })).getByText('/accounts/{id}/payments')).toBeInTheDocument();
    expect(within(screen.getByRole('list', { name: 'Data types' })).getByText('PostAccountsIdPaymentsRequest')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(onUndo).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('says which AI engine paired the examples, why, and what went wrong', async () => {
    const user = userEvent.setup();
    storyExamples.mockResolvedValue({
      ...story,
      engine: 'gpt-4.1 at acme.openai.azure.com',
      notes: ["Parts of the AI engine's answer were left out: example 9, which the story does not have."],
      operations: [{ ...story.operations[0], reason: 'The comment of 14 Oct corrects the response.' }],
    });
    render(<JiraImportModal aiEngine="gpt-4.1 at acme.openai.azure.com" currentJson={() => spec} onApply={() => {}} onUndo={() => {}} onClose={() => {}} />);
    expect(screen.getByText(/The story's text is sent to the AI engine \(gpt-4.1 at acme.openai.azure.com\)/)).toBeInTheDocument();
    await user.type(screen.getByLabelText(/Story link/), 'PAY-142');
    await user.click(screen.getByRole('button', { name: 'Read Story' }));

    expect(await screen.findByText(/paired by the AI engine \(gpt-4.1 at acme.openai.azure.com\)/)).toBeInTheDocument();
    expect(screen.getByText(/example 9, which the story does not have/)).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Operation 1' })).getByText('AI: The comment of 14 Oct corrects the response.')).toBeInTheDocument();
  });

  it('says what Jira answered when the story cannot be read', async () => {
    const user = userEvent.setup();
    storyExamples.mockRejectedValue(new Error("PAY-9 was not found, or ECHO's Jira account cannot see it."));
    render(<JiraImportModal currentJson={() => spec} onApply={() => {}} onUndo={() => {}} onClose={() => {}} />);
    await user.type(screen.getByLabelText(/Story link/), 'PAY-9');
    await user.click(screen.getByRole('button', { name: 'Read Story' }));
    expect(await screen.findByText(/PAY-9 was not found/)).toBeInTheDocument();
  });

  it('will not add an operation without a valid path, or two of the same', async () => {
    const user = userEvent.setup();
    storyExamples.mockResolvedValue({ ...story, operations: [{ method: 'POST', path: '', request: 1, response: 2, examples: [1, 2] }] });
    render(<JiraImportModal currentJson={() => spec} onApply={() => {}} onUndo={() => {}} onClose={() => {}} />);
    await user.type(screen.getByLabelText(/Story link/), 'PAY-142');
    await user.click(screen.getByRole('button', { name: 'Read Story' }));

    const add = await screen.findByRole('button', { name: 'Add To Spec' });
    expect(add).toBeDisabled();
    const first = screen.getByRole('region', { name: 'Operation 1' });
    await user.type(within(first).getByLabelText(/^Path/), '/payments');
    expect(add).toBeEnabled();

    await user.click(screen.getByRole('button', { name: 'Add another operation' }));
    const second = screen.getByRole('region', { name: 'Operation 2' });
    await user.selectOptions(within(second).getByLabelText('Method'), 'POST');
    await user.type(within(second).getByLabelText(/^Path/), '/payments');
    expect(screen.getAllByText('Two operations are POST /payments')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Add 2 Operations' })).toBeDisabled();
  });
});
