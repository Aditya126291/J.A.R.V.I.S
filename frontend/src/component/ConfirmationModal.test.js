import React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import ConfirmationModal from './ConfirmationModal';

afterEach(() => {
  cleanup();
});

const sampleActions = [
  { id: 'a1', description: 'Shut down the system' },
  { id: 'a2', description: 'Delete file: notes.txt from Desktop' },
];

describe('ConfirmationModal', () => {
  test('renders nothing when isOpen is false', () => {
    const { container } = render(
      <ConfirmationModal
        isOpen={false}
        pendingActions={sampleActions}
        onConfirm={() => {}}
        onCancel={() => {}}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  test('renders dialog with role="dialog" and aria-modal when open', () => {
    render(
      <ConfirmationModal
        isOpen
        pendingActions={sampleActions}
        onConfirm={() => {}}
        onCancel={() => {}}
      />
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveAttribute('aria-modal', 'true');
  });

  test('lists each pending action description verbatim', () => {
    render(
      <ConfirmationModal
        isOpen
        pendingActions={sampleActions}
        onConfirm={() => {}}
        onCancel={() => {}}
      />
    );
    expect(screen.getByText('Shut down the system')).toBeInTheDocument();
    expect(screen.getByText('Delete file: notes.txt from Desktop')).toBeInTheDocument();

    const list = screen.getByTestId('confirmation-modal-list');
    expect(list.querySelectorAll('li')).toHaveLength(2);
  });

  test('Confirm button invokes onConfirm with the ordered list of action ids', () => {
    const onConfirm = jest.fn();
    render(
      <ConfirmationModal
        isOpen
        pendingActions={sampleActions}
        onConfirm={onConfirm}
        onCancel={() => {}}
      />
    );
    fireEvent.click(screen.getByTestId('confirmation-modal-confirm-btn'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith(['a1', 'a2']);
  });

  test('Cancel button invokes onCancel and not onConfirm', () => {
    const onConfirm = jest.fn();
    const onCancel = jest.fn();
    render(
      <ConfirmationModal
        isOpen
        pendingActions={sampleActions}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    );
    fireEvent.click(screen.getByTestId('confirmation-modal-cancel-btn'));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  test('Escape key triggers onCancel', () => {
    const onCancel = jest.fn();
    render(
      <ConfirmationModal
        isOpen
        pendingActions={sampleActions}
        onConfirm={() => {}}
        onCancel={onCancel}
      />
    );
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  test('Enter key triggers onConfirm with action ids', () => {
    const onConfirm = jest.fn();
    render(
      <ConfirmationModal
        isOpen
        pendingActions={sampleActions}
        onConfirm={onConfirm}
        onCancel={() => {}}
      />
    );
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith(['a1', 'a2']);
  });

  test('clicking the overlay does NOT trigger onCancel (non-dismissable)', () => {
    const onCancel = jest.fn();
    const onConfirm = jest.fn();
    render(
      <ConfirmationModal
        isOpen
        pendingActions={sampleActions}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    );
    fireEvent.click(screen.getByTestId('confirmation-modal-overlay'));
    expect(onCancel).not.toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  test('keyboard listeners are removed when the modal closes', () => {
    const onCancel = jest.fn();
    const { rerender } = render(
      <ConfirmationModal
        isOpen
        pendingActions={sampleActions}
        onConfirm={() => {}}
        onCancel={onCancel}
      />
    );

    rerender(
      <ConfirmationModal
        isOpen={false}
        pendingActions={sampleActions}
        onConfirm={() => {}}
        onCancel={onCancel}
      />
    );

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onCancel).not.toHaveBeenCalled();
  });

  test('handles empty pendingActions gracefully', () => {
    const onConfirm = jest.fn();
    render(
      <ConfirmationModal
        isOpen
        pendingActions={[]}
        onConfirm={onConfirm}
        onCancel={() => {}}
      />
    );
    const list = screen.getByTestId('confirmation-modal-list');
    expect(list.querySelectorAll('li')).toHaveLength(0);
    fireEvent.click(screen.getByTestId('confirmation-modal-confirm-btn'));
    expect(onConfirm).toHaveBeenCalledWith([]);
  });
});
