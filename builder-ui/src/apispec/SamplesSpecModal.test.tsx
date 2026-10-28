import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SamplesSpecModal } from './SamplesSpecModal';

describe('Interface Specs from Samples dialog', () => {
  it('names the operation after its method and path, without asking for an operationId', async () => {
    const user = userEvent.setup();
    const onGenerate = vi.fn();
    render(<SamplesSpecModal onGenerate={onGenerate} onClose={() => {}} />);

    expect(screen.queryByLabelText(/operationId/)).not.toBeInTheDocument();
    await user.type(screen.getByLabelText(/Path/), '/cards/{{cardId}/activate');

    // POST needs both samples, as JSON.
    const create = screen.getByRole('button', { name: 'Create' });
    expect(create).toBeDisabled();
    await user.click(screen.getByLabelText(/Sample request/));
    await user.paste('{"code": 1');
    expect(screen.getByText(/Not valid JSON/)).toBeInTheDocument();
    await user.clear(screen.getByLabelText(/Sample request/));
    await user.paste('{"code": 1}');
    await user.click(screen.getByLabelText(/Sample response/));
    await user.paste('{"ok": true}');
    await user.click(create);
    expect(onGenerate).toHaveBeenCalledWith({
      method: 'POST',
      path: '/cards/{cardId}/activate',
      operationId: 'postCardsCardIdActivate',
      request: { code: 1 },
      response: { ok: true },
    });
  });

  it('warns when it replaces the spec, and lets GET go without a request sample, with a sample query', async () => {
    const user = userEvent.setup();
    const onGenerate = vi.fn();
    render(<SamplesSpecModal replaces="cards.yaml is overwritten when you save" onGenerate={onGenerate} onClose={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Add to this spec' })).not.toBeInTheDocument();
    expect(screen.getByText(/A flow has one OpenAPI spec: cards.yaml is overwritten/)).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Method'), 'GET');
    await user.type(screen.getByLabelText(/Path/), '/cards?status=ACTIVE&limit=10');
    await user.click(screen.getByLabelText(/Sample response/));
    await user.paste('[]');
    await user.click(screen.getByRole('button', { name: 'Replace' }));
    // The sample query is not part of the operationId.
    expect(onGenerate).toHaveBeenCalledWith({ method: 'GET', path: '/cards', query: 'status=ACTIVE&limit=10', operationId: 'getCards', request: undefined, response: [] });
  });

  it('adds the method to the spec, or replaces that one method when the spec has it on that path', async () => {
    const user = userEvent.setup();
    const onGenerate = vi.fn();
    const onAdd = vi.fn();
    const hasOperation = (method: string, path: string) => method === 'GET' && path === '/cards/{id}';
    render(
      <SamplesSpecModal replaces="cards.yaml is overwritten when you save" hasOperation={hasOperation} onGenerate={onGenerate} onAdd={onAdd} onClose={() => {}} />,
    );
    await user.selectOptions(screen.getByLabelText('Method'), 'GET');
    await user.type(screen.getByLabelText(/Path/), '/cards/{{id}');
    await user.click(screen.getByLabelText(/Sample response/));
    await user.paste('{"id": "c-1"}');
    expect(screen.queryByRole('button', { name: 'Add to this spec' })).not.toBeInTheDocument();
    expect(screen.getByText(/This spec has GET \/cards\/\{id\} already. Replace GET \/cards\/\{id\} puts the one made from these samples in its place/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Replace Whole Spec' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Replace GET /cards/{id}' }));
    expect(onAdd).toHaveBeenLastCalledWith({ method: 'GET', path: '/cards/{id}', operationId: 'getCardsId', request: undefined, response: { id: 'c-1' } });

    await user.selectOptions(screen.getByLabelText('Method'), 'DELETE');
    expect(screen.getByRole('button', { name: 'Add to this spec' })).toBeEnabled();
    // One plain line, no warning, while the method can be added.
    expect(screen.getByText(/: adds this method to the spec\./)).toBeInTheDocument();
    expect(screen.queryByText(/A flow has one OpenAPI spec/)).not.toBeInTheDocument();
    // Enter in the Path field adds; it never replaces.
    await user.type(screen.getByLabelText(/Path/), '{Enter}');
    expect(onAdd).toHaveBeenCalledWith({ method: 'DELETE', path: '/cards/{id}', operationId: 'deleteCardsId', request: undefined, response: { id: 'c-1' } });
    expect(onGenerate).not.toHaveBeenCalled();
  });
});
