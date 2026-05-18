import React, { useCallback, useEffect, useRef } from 'react';
import './ConfirmationModal.css';

/**
 * ConfirmationModal
 *
 * Glassmorphic, non-dismissable modal that gates risky actions emitted by the
 * voice pipeline. Triggered by HTTP 409 responses or `requiresConfirmation`
 * events from the backend (see Requirements 6.7, 6.8).
 *
 * This component is intentionally self-contained: it does not import any other
 * JARVIS module and does not send the `confirm` message itself. Wiring into
 * the WebSocket / HTTP transport is handled by task 14.2.
 *
 * Props:
 *   - isOpen:         boolean. Controls whether the modal is rendered.
 *   - pendingActions: Array<{ id: string, description: string }>. Each entry's
 *                     `description` is the verbatim string returned by the
 *                     backend's `summarizeAction(payload)`.
 *   - onConfirm:      (actionIds: string[]) => void. Invoked when the user
 *                     explicitly authorizes the pending actions. Receives the
 *                     ids of every listed action in original order.
 *   - onCancel:       () => void. Invoked when the user explicitly cancels.
 *
 * Interaction model:
 *   - The modal is non-dismissable. Clicking the overlay does NOT trigger
 *     onCancel; the user must use the Cancel button or the Escape key.
 *   - Keyboard: Escape -> onCancel(); Enter -> onConfirm(actionIds).
 *   - aria-modal + role="dialog" so screen readers announce the gate.
 */
function ConfirmationModal({ isOpen, pendingActions = [], onConfirm, onCancel }) {
  const panelRef = useRef(null);

  const handleConfirm = useCallback(() => {
    if (typeof onConfirm !== 'function') return;
    const ids = (pendingActions || []).map((a) => (a && a.id !== undefined ? a.id : null));
    onConfirm(ids);
  }, [onConfirm, pendingActions]);

  const handleCancel = useCallback(() => {
    if (typeof onCancel === 'function') onCancel();
  }, [onCancel]);

  // Keyboard accessibility: Escape cancels, Enter confirms. Listener is only
  // attached while the modal is open so it never interferes with the rest of
  // the HUD.
  useEffect(() => {
    if (!isOpen) return undefined;

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        handleCancel();
      } else if (e.key === 'Enter') {
        // Avoid stealing Enter from input fields nested inside the modal.
        const target = e.target;
        const tag = target && target.tagName ? target.tagName.toUpperCase() : '';
        if (tag === 'TEXTAREA' || (tag === 'INPUT' && target.type !== 'button' && target.type !== 'submit')) {
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        handleConfirm();
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    // Move focus into the dialog so subsequent key events are routed here and
    // assistive tech announces the prompt.
    if (panelRef.current && typeof panelRef.current.focus === 'function') {
      panelRef.current.focus();
    }

    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, handleCancel, handleConfirm]);

  if (!isOpen) return null;

  const actions = Array.isArray(pendingActions) ? pendingActions : [];

  return (
    <div
      className="confirmation-modal-overlay"
      role="presentation"
      data-testid="confirmation-modal-overlay"
    >
      <div
        className="confirmation-modal-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirmation-modal-title"
        aria-describedby="confirmation-modal-subtitle"
        tabIndex={-1}
        ref={panelRef}
        data-testid="confirmation-modal-panel"
      >
        <div className="confirmation-modal-header">
          <span className="confirmation-modal-icon" aria-hidden="true">
            !
          </span>
          <h2 id="confirmation-modal-title" className="confirmation-modal-title">
            CONFIRMATION REQUIRED
          </h2>
        </div>

        <p id="confirmation-modal-subtitle" className="confirmation-modal-subtitle">
          {actions.length === 1
            ? 'The following action requires your explicit authorization.'
            : 'The following actions require your explicit authorization.'}
        </p>

        <ul className="confirmation-modal-list" data-testid="confirmation-modal-list">
          {actions.map((action, idx) => {
            const id = action && action.id !== undefined ? action.id : `pending-${idx}`;
            const description =
              action && typeof action.description === 'string' ? action.description : '';
            return (
              <li
                key={id}
                className="confirmation-modal-item"
                data-action-id={id}
              >
                <span className="confirmation-modal-bullet" aria-hidden="true">
                  ›
                </span>
                <span className="confirmation-modal-description">{description}</span>
              </li>
            );
          })}
        </ul>

        <div className="confirmation-modal-actions">
          <button
            type="button"
            className="confirmation-modal-btn confirmation-modal-confirm"
            onClick={handleConfirm}
            data-testid="confirmation-modal-confirm-btn"
          >
            CONFIRM
          </button>
          <button
            type="button"
            className="confirmation-modal-btn confirmation-modal-cancel"
            onClick={handleCancel}
            data-testid="confirmation-modal-cancel-btn"
          >
            CANCEL
          </button>
        </div>

        <div className="confirmation-modal-hint">
          Press <kbd>Enter</kbd> to confirm · <kbd>Esc</kbd> to cancel
        </div>
      </div>
    </div>
  );
}

export default ConfirmationModal;
