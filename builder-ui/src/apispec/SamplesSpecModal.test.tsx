import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SamplesSpecModal } from './SamplesSpecModal';

const set = (n: number) => within(screen.getByRole('region', { name: `Sample ${n}` }));

describe('Interface Specs from Samples dialog', () => {
  it('names the operation after its method and path, without asking for an operationId', async () => {
    const user = userEvent.setup();
    const onGenerate = vi.fn();
    render(<SamplesSpecModal onGenerate={onGenerate} onClose={() => {}} />);

    expect(screen.queryByLabelText(/operationId/)).not.toBeInTheDocument();
    await user.type(set(1).getByLabelText(/Path/), '/cards/{{cardId}/activate');

    // POST needs both samples, as JSON.
    const create = screen.getByRole('button', { name: 'Create' });
    expect(create).toBeDisabled();
    await user.click(set(1).getByLabelText(/Sample request/));
    await user.paste('{"code": 1');
    expect(screen.getByText(/Not valid JSON/)).toBeInTheDocument();
    await user.clear(set(1).getByLabelText(/Sample request/));
    await user.paste('{"code": 1}');
    await user.click(set(1).getByLabelText(/Sample response/));
    await user.paste('{"ok": true}');
    await user.click(create);
    // The blank sets are left out.
    expect(onGenerate).toHaveBeenCalledWith([
      {
        method: 'POST',
        path: '/cards/{cardId}/activate',
        operationId: 'postCardsCardIdActivate',
        request: { code: 1 },
        response: { ok: true },
      },
    ]);
  });

  it('starts with three sets, More Samples adds three more, and every filled-in set is made', async () => {
    const user = userEvent.setup();
    const onGenerate = vi.fn();
    render(<SamplesSpecModal onGenerate={onGenerate} onClose={() => {}} />);
    expect(screen.getAllByRole('region', { name: /^Sample \d$/ })).toHaveLength(3);
    await user.click(screen.getByRole('button', { name: 'More Samples' }));
    expect(screen.getAllByRole('region', { name: /^Sample \d$/ })).toHaveLength(6);

    await user.selectOptions(set(1).getByLabelText('Method'), 'GET');
    await user.type(set(1).getByLabelText(/Path/), '/cards');
    await user.click(set(1).getByLabelText(/Sample response/));
    await user.paste('[]');
    await user.selectOptions(set(5).getByLabelText('Method'), 'GET');
    await user.type(set(5).getByLabelText(/Path/), '/cards');
    await user.click(set(5).getByLabelText(/Sample response/));
    await user.paste('{"id": "c-1"}');
    // Two sets for one method and path cannot both be made.
    expect(set(1).getByText('Two sets are GET /cards')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled();
    await user.type(set(5).getByLabelText(/Path/), '/{{id}');

    // A half-filled set holds the rest back until it is finished or removed.
    await user.type(set(3).getByLabelText(/Path/), '/oops');
    expect(set(3).getAllByText('A sample is needed.')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled();
    await user.click(set(3).getByRole('button', { name: 'Remove' }));
    expect(screen.getAllByRole('region', { name: /^Sample \d$/ })).toHaveLength(5);

    await user.click(screen.getByRole('button', { name: 'Create' }));
    expect(onGenerate).toHaveBeenCalledWith([
      { method: 'GET', path: '/cards', operationId: 'getCards', request: undefined, response: [] },
      { method: 'GET', path: '/cards/{id}', operationId: 'getCardsId', request: undefined, response: { id: 'c-1' } },
    ]);
  });

  it('warns when it replaces the spec, and lets GET go without a request sample, with a sample query', async () => {
    const user = userEvent.setup();
    const onGenerate = vi.fn();
    render(<SamplesSpecModal replaces="cards.yaml is overwritten when you save" onGenerate={onGenerate} onClose={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Add to this spec' })).not.toBeInTheDocument();
    expect(screen.getByText(/A flow has one OpenAPI spec: cards.yaml is overwritten/)).toBeInTheDocument();
    await user.selectOptions(set(1).getByLabelText('Method'), 'GET');
    await user.type(set(1).getByLabelText(/Path/), '/cards?status=ACTIVE&limit=10');
    await user.click(set(1).getByLabelText(/Sample response/));
    await user.paste('[]');
    await user.click(screen.getByRole('button', { name: 'Replace' }));
    // The sample query is not part of the operationId.
    expect(onGenerate).toHaveBeenCalledWith([{ method: 'GET', path: '/cards', query: 'status=ACTIVE&limit=10', operationId: 'getCards', request: undefined, response: [] }]);
  });

  it('adds the methods to the spec, or replaces the ones the spec has on that path', async () => {
    const user = userEvent.setup();
    const onGenerate = vi.fn();
    const onAdd = vi.fn();
    const hasOperation = (method: string, path: string) => method === 'GET' && path === '/cards/{id}';
    render(
      <SamplesSpecModal replaces="cards.yaml is overwritten when you save" hasOperation={hasOperation} onGenerate={onGenerate} onAdd={onAdd} onClose={() => {}} />,
    );
    await user.selectOptions(set(1).getByLabelText('Method'), 'GET');
    await user.type(set(1).getByLabelText(/Path/), '/cards/{{id}');
    await user.click(set(1).getByLabelText(/Sample response/));
    await user.paste('{"id": "c-1"}');
    expect(screen.queryByRole('button', { name: 'Add to this spec' })).not.toBeInTheDocument();
    expect(set(1).getByText(/Already in the spec/)).toBeInTheDocument();
    expect(screen.getByText(/This spec has GET \/cards\/\{id\} already. Replace GET \/cards\/\{id\} puts the one made from these samples in its place/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Replace Whole Spec' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Replace GET /cards/{id}' }));
    expect(onAdd).toHaveBeenLastCalledWith([{ method: 'GET', path: '/cards/{id}', operationId: 'getCardsId', request: undefined, response: { id: 'c-1' } }]);

    // With a second set, the button says how many it replaces.
    await user.selectOptions(set(2).getByLabelText('Method'), 'DELETE');
    await user.type(set(2).getByLabelText(/Path/), '/cards/{{id}');
    await user.click(set(2).getByLabelText(/Sample response/));
    await user.paste('{}');
    await user.click(screen.getByRole('button', { name: 'Add to this spec, replacing 1' }));
    expect(onAdd).toHaveBeenLastCalledWith([
      { method: 'GET', path: '/cards/{id}', operationId: 'getCardsId', request: undefined, response: { id: 'c-1' } },
      { method: 'DELETE', path: '/cards/{id}', operationId: 'deleteCardsId', request: undefined, response: {} },
    ]);

    await user.selectOptions(set(1).getByLabelText('Method'), 'PUT');
    await user.click(set(1).getByLabelText(/Sample request/));
    await user.paste('{"status": "BLOCKED"}');
    expect(screen.getByRole('button', { name: 'Add to this spec' })).toBeEnabled();
    // One plain line, no warning, while the methods can be added.
    expect(screen.getByText(/: adds these methods to the spec\./)).toBeInTheDocument();
    expect(screen.queryByText(/A flow has one OpenAPI spec/)).not.toBeInTheDocument();
    // Enter in a Path field adds; it never replaces.
    await user.type(set(1).getByLabelText(/Path/), '{Enter}');
    expect(onAdd).toHaveBeenLastCalledWith([
      { method: 'PUT', path: '/cards/{id}', operationId: 'putCardsId', request: { status: 'BLOCKED' }, response: { id: 'c-1' } },
      { method: 'DELETE', path: '/cards/{id}', operationId: 'deleteCardsId', request: undefined, response: {} },
    ]);
    expect(onGenerate).not.toHaveBeenCalled();
  });
});
