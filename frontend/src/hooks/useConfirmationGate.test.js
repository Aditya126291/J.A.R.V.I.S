import React from 'react';
import { act, render, screen, fireEvent, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import { useConfirmationGate } from './useConfirmationGate';
import ConfirmationModal from '../component/ConfirmationModal';

afterEach(() => {
  cleanup();
});

// Lightweight host that exposes the hook's API to the test via refs.
function Host({ send, registerApi }) {
  const api = useConfirmationGate({ send });
  React.useEffect(() => {
    registerApi(api);
  }, [api, registerApi]);
  return (
    <ConfirmationModal
      isOpen={api.isOpen}
      pendingActions={api.modalActions}
      onConfirm={api.onConfirm}
      onCancel={api.onCancel}
    />
  );
}

const samplePending = {
  turnId: 'turn-42',
  originalMessage: 'shut it down',
  actions: [
    { id: 'a1', payload: { module: 'power', action: 'shutdown' }, summary: 'Shut down the system' },
    { id: 'a2', payload: { module: 'files', action: 'delete', target: 'notes.txt' }, summary: 'Delete file: notes.txt' },
  ],
};

function renderHost(send) {
  let api = null;
  render(<Host send={send} registerApi={(a) => { api = a; }} />);
  return () => api;
}

describe('useConfirmationGate', () => {
  test('starts with no pending confirmation and modal hidden', () => {
    const send = jest.fn();
    const getApi = renderHost(send);
    expect(getApi().isOpen).toBe(false);
    expect(getApi().pendingConfirmation).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  test('setPendingConfirmation opens the modal with mapped descriptions', () => {
    const send = jest.fn();
    const getApi = renderHost(send);

    act(() => { getApi().setPendingConfirmation(samplePending); });

    expect(getApi().isOpen).toBe(true);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Shut down the system')).toBeInTheDocument();
    expect(screen.getByText('Delete file: notes.txt')).toBeInTheDocument();
  });

  test('onConfirm sends a confirm message under the same turnId and clears state', () => {
    const send = jest.fn();
    const getApi = renderHost(send);

    act(() => { getApi().setPendingConfirmation(samplePending); });
    fireEvent.click(screen.getByTestId('confirmation-modal-confirm-btn'));

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({
      type: 'confirm',
      turnId: 'turn-42',
      approvedActionIds: ['a1', 'a2'],
    });
    expect(getApi().isOpen).toBe(false);
    expect(getApi().pendingConfirmation).toBeNull();
  });

  test('onCancel sends a cancel message and clears state', () => {
    const send = jest.fn();
    const getApi = renderHost(send);

    act(() => { getApi().setPendingConfirmation(samplePending); });
    fireEvent.click(screen.getByTestId('confirmation-modal-cancel-btn'));

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({ type: 'cancel', turnId: 'turn-42' });
    expect(getApi().isOpen).toBe(false);
    expect(getApi().pendingConfirmation).toBeNull();
  });

  test('confirm/cancel are no-ops when no confirmation is pending', () => {
    const send = jest.fn();
    const getApi = renderHost(send);

    act(() => { getApi().onConfirm(['anything']); });
    act(() => { getApi().onCancel(); });

    expect(send).not.toHaveBeenCalled();
  });

  test('clearPendingConfirmation closes the modal without sending anything', () => {
    const send = jest.fn();
    const getApi = renderHost(send);

    act(() => { getApi().setPendingConfirmation(samplePending); });
    act(() => { getApi().clearPendingConfirmation(); });

    expect(send).not.toHaveBeenCalled();
    expect(getApi().isOpen).toBe(false);
  });

  test('hook tolerates a missing `send` option (drops messages, still clears state)', () => {
    const getApi = renderHost(undefined);

    act(() => { getApi().setPendingConfirmation(samplePending); });
    fireEvent.click(screen.getByTestId('confirmation-modal-confirm-btn'));
    expect(getApi().isOpen).toBe(false);

    act(() => { getApi().setPendingConfirmation(samplePending); });
    fireEvent.click(screen.getByTestId('confirmation-modal-cancel-btn'));
    expect(getApi().isOpen).toBe(false);
  });

  test('transport errors do not leave the modal stuck open', () => {
    const send = jest.fn(() => { throw new Error('socket closed'); });
    const getApi = renderHost(send);

    act(() => { getApi().setPendingConfirmation(samplePending); });
    fireEvent.click(screen.getByTestId('confirmation-modal-confirm-btn'));

    expect(send).toHaveBeenCalledTimes(1);
    expect(getApi().isOpen).toBe(false);
  });

  test('falls back to `description` when `summary` is absent on a pending action', () => {
    const send = jest.fn();
    const getApi = renderHost(send);
    const pending = {
      turnId: 'turn-1',
      actions: [{ id: 'x', payload: {}, description: 'Legacy description' }],
    };

    act(() => { getApi().setPendingConfirmation(pending); });
    expect(screen.getByText('Legacy description')).toBeInTheDocument();
  });
});
