import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SamplesSpecModal } from './SamplesSpecModal';

describe('New From Samples dialog', () => {
  it('fills in the operationId from the method and path until it is edited', async () => {
    const user = userEvent.setup();
    const onGenerate = vi.fn();
    render(<SamplesSpecModal onGenerate={onGenerate} onClose={() => {}} />);

    const operationId = screen.getByLabelText(/operationId/);
    await user.type(screen.getByLabelText(/Path/), '/cards/{{cardId}/activate');
    expect(operationId).toHaveValue('postCardsCardIdActivate');
    await user.selectOptions(screen.getByLabelText('Method'), 'PUT');
    expect(operationId).toHaveValue('putCardsCardIdActivate');

    await user.clear(operationId);
    await user.type(operationId, 'activateCard');
    await user.selectOptions(screen.getByLabelText('Method'), 'POST');
    expect(operationId).toHaveValue('activateCard');

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
      operationId: 'activateCard',
      request: { code: 1 },
      response: { ok: true },
    });
  });

  it('warns when it replaces the spec, and lets GET go without a request sample, with a sample query', async () => {
    const user = userEvent.setup();
    const onGenerate = vi.fn();
    render(<SamplesSpecModal replaces="cards.yaml is overwritten when you save" onGenerate={onGenerate} onClose={() => {}} />);
    expect(screen.getByText(/A flow has one OpenAPI spec: cards.yaml is overwritten/)).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Method'), 'GET');
    await user.type(screen.getByLabelText(/Path/), '/cards?status=ACTIVE&limit=10');
    // The sample query is not part of the operationId.
    expect(screen.getByLabelText(/operationId/)).toHaveValue('getCards');
    await user.click(screen.getByLabelText(/Sample response/));
    await user.paste('[]');
    await user.click(screen.getByRole('button', { name: 'Replace' }));
    expect(onGenerate).toHaveBeenCalledWith({ method: 'GET', path: '/cards', query: 'status=ACTIVE&limit=10', operationId: 'getCards', request: undefined, response: [] });
  });
});
