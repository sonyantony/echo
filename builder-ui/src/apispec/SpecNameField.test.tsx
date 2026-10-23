import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SpecNameField } from './SpecNameField';

describe('Spec name in the breadcrumb', () => {
  it('renames on Enter, keeping the extension of the format', async () => {
    const onRename = vi.fn().mockResolvedValue(true);
    render(<SpecNameField name="orders.yaml" format="yaml" onRename={onRename} />);

    await userEvent.click(screen.getByTestId('spec-name'));
    const input = screen.getByRole('textbox', { name: 'OpenAPI file name' });
    expect(input).toHaveValue('orders');
    expect(screen.getByText('.yaml')).toBeInTheDocument();
    // A typed extension does not change the format: the radios do.
    await userEvent.clear(input);
    await userEvent.type(input, 'customer-api.json{Enter}');
    expect(onRename).toHaveBeenCalledWith('customer-api.yaml');
    expect(onRename).toHaveBeenCalledTimes(1);
  });

  it('saves when the field is left, and Escape cancels', async () => {
    const onRename = vi.fn().mockResolvedValue(true);
    render(<SpecNameField name="orders.json" format="json" onRename={onRename} />);

    await userEvent.click(screen.getByTestId('spec-name'));
    await userEvent.type(screen.getByRole('textbox'), '-v2{Escape}');
    expect(onRename).not.toHaveBeenCalled();
    expect(screen.getByTestId('spec-name')).toHaveTextContent('orders.json');

    await userEvent.click(screen.getByTestId('spec-name'));
    await userEvent.type(screen.getByRole('textbox'), '-v2');
    await userEvent.tab();
    expect(onRename).toHaveBeenCalledWith('orders-v2.json');
  });

  it('names a new spec, and leaves a name a file cannot have or the same name alone', async () => {
    const onRename = vi.fn().mockResolvedValue(true);
    const { rerender } = render(<SpecNameField name={null} format="yaml" onRename={onRename} />);
    expect(screen.getByTestId('spec-name')).toHaveTextContent('<new>');

    await userEvent.click(screen.getByTestId('spec-name'));
    const input = screen.getByRole('textbox');
    expect(input).toHaveValue('');
    await userEvent.type(input, 'bad name{Enter}');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    await userEvent.tab();
    expect(onRename).not.toHaveBeenCalled();

    await userEvent.click(screen.getByTestId('spec-name'));
    await userEvent.type(screen.getByRole('textbox'), 'orders{Enter}');
    expect(onRename).toHaveBeenCalledWith('orders.yaml');

    rerender(<SpecNameField name="orders.yaml" format="yaml" onRename={onRename} />);
    await userEvent.click(screen.getByTestId('spec-name'));
    await userEvent.keyboard('{Enter}');
    expect(onRename).toHaveBeenCalledTimes(1);
  });
});
