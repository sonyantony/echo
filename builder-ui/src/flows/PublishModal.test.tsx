import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mockFetch } from '../test/fetchMock';
import { PublishModal } from './PublishModal';

beforeEach(() => {
  document.cookie = 'XSRF-TOKEN=abc';
});
afterEach(() => vi.unstubAllGlobals());

function renderModal() {
  const props = {
    flowId: 7,
    flowName: 'orders',
    beforePublish: vi.fn(async () => true),
    onPublished: vi.fn(),
    onInvalid: vi.fn(),
    onClose: vi.fn(),
  };
  render(<PublishModal {...props} />);
  return props;
}

describe('PublishModal', () => {
  it('saves first, then publishes with the message', async () => {
    const published = { commitSha: 'abc12345def', branch: 'main', publishedBy: 'designer', publishedAt: '', message: 'm', changed: true };
    const { calls } = mockFetch({ 'POST /api/flows/7/publish': { status: 200, body: published } });
    const props = renderModal();

    await userEvent.type(screen.getByLabelText('What changed?'), 'Add mapping');
    await userEvent.click(screen.getByRole('button', { name: 'Publish' }));

    expect(props.beforePublish).toHaveBeenCalled();
    expect(calls[0].body).toEqual({ message: 'Add mapping' });
    expect(props.onPublished).toHaveBeenCalledWith(published);
  });

  it('hands validation problems back instead of publishing', async () => {
    const invalid = { valid: false, problems: [{ file: 'orders.camel.yaml', line: 3, message: 'bad' }] };
    mockFetch({ 'POST /api/flows/7/publish': { status: 422, body: invalid } });
    const props = renderModal();

    await userEvent.click(screen.getByRole('button', { name: 'Publish' }));
    expect(props.onInvalid).toHaveBeenCalledWith(invalid);
    expect(props.onPublished).not.toHaveBeenCalled();
  });

  it('shows Git errors in the dialog', async () => {
    mockFetch({ 'POST /api/flows/7/publish': { status: 502, body: { detail: 'Git error: connection refused' } } });
    renderModal();
    await userEvent.click(screen.getByRole('button', { name: 'Publish' }));
    expect(await screen.findByText('Git error: connection refused')).toBeInTheDocument();
  });
});
