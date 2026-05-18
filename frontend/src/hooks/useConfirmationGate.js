// frontend/src/hooks/useConfirmationGate.js
//
// Task 14.2: wire ConfirmationModal approval/cancel to the WsClient.
//
// The ConfirmationModal (Task 14.1) is intentionally self-contained and does
// NOT send anything over the wire itself. This hook owns the parent-side
// state and produces the callbacks the modal needs:
//
//   - `pendingConfirmation` state shape (matches the `requiresConfirmation`
//     event / HTTP 409 body produced by `validateActions` on the backend):
//
//       {
//         turnId: string,
//         originalMessage?: string,
//         actions: Array<{ id: string, payload: object, summary: string }>,
//       }
//
//   - On confirm: send `{ type: 'confirm', turnId, approvedActionIds }`
//     under the SAME `turnId` as the original prompt. Per design.md
//     "Confirmation flow" and Requirements 6.9 / 6.10, the backend matches
//     the confirmation gate by `turnId`; a mismatched id is treated as
//     `confirmed: false`.
//
//   - On cancel: send `{ type: 'cancel', turnId }` and clear the gate.
//
// The hook is transport-agnostic. It receives a `send` function (typically
// `wsClient.send` from `frontend/src/wsClient.js`) and the rest is pure
// React state. Task 15.1 is responsible for plumbing the actual WsClient
// instance into `App.js` and forwarding `requiresConfirmation` /
// `HTTP 409` events into `setPendingConfirmation`.

import { useCallback, useMemo, useState } from 'react';

/**
 * Track pending confirmation state for a single turn and expose the
 * callbacks ConfirmationModal needs.
 *
 * @param {Object}   [options]
 * @param {Function} [options.send]  Function that accepts a message object
 *                                   and dispatches it over the WsClient
 *                                   (or any transport). Optional so the
 *                                   hook can be mounted before Task 15.1
 *                                   wires the client; in that case
 *                                   `confirm`/`cancel` messages are silently
 *                                   dropped and the gate still clears.
 * @returns {{
 *   pendingConfirmation: null | { turnId: string, originalMessage?: string, actions: Array<{id: string, payload: object, summary: string}> },
 *   modalActions: Array<{ id: string, description: string }>,
 *   isOpen: boolean,
 *   setPendingConfirmation: (state: object | null) => void,
 *   clearPendingConfirmation: () => void,
 *   onConfirm: (approvedActionIds: string[]) => void,
 *   onCancel: () => void,
 * }}
 */
export function useConfirmationGate({ send } = {}) {
  const [pendingConfirmation, setPendingConfirmation] = useState(null);

  const clearPendingConfirmation = useCallback(() => {
    setPendingConfirmation(null);
  }, []);

  const onConfirm = useCallback(
    (approvedActionIds) => {
      // Use the functional setter so we always read the freshest pending
      // state (avoids a stale-closure race when multiple confirms land
      // back-to-back). Returning `null` clears the gate atomically.
      setPendingConfirmation((current) => {
        if (!current) return null;

        const ids = Array.isArray(approvedActionIds)
          ? approvedActionIds.filter((id) => id !== undefined && id !== null)
          : [];

        if (typeof send === 'function') {
          try {
            send({
              type: 'confirm',
              turnId: current.turnId,
              approvedActionIds: ids,
            });
          } catch (_) {
            // Transport failures are non-fatal; the user can retry. We
            // still clear the gate so the HUD does not lock up on a stale
            // modal.
          }
        }
        return null;
      });
    },
    [send]
  );

  const onCancel = useCallback(() => {
    setPendingConfirmation((current) => {
      if (!current) return null;

      if (typeof send === 'function') {
        try {
          send({ type: 'cancel', turnId: current.turnId });
        } catch (_) {
          // see onConfirm
        }
      }
      return null;
    });
  }, [send]);

  // ConfirmationModal expects `{ id, description }` per its prop contract,
  // but the backend payload is `{ id, payload, summary }`. Map here so the
  // modal stays self-contained.
  const modalActions = useMemo(() => {
    if (!pendingConfirmation || !Array.isArray(pendingConfirmation.actions)) {
      return [];
    }
    return pendingConfirmation.actions.map((a, idx) => {
      const id = a && a.id !== undefined && a.id !== null ? a.id : `pending-${idx}`;
      let description = '';
      if (a && typeof a.summary === 'string' && a.summary) {
        description = a.summary;
      } else if (a && typeof a.description === 'string' && a.description) {
        description = a.description;
      }
      return { id, description };
    });
  }, [pendingConfirmation]);

  return {
    pendingConfirmation,
    modalActions,
    isOpen: Boolean(pendingConfirmation),
    setPendingConfirmation,
    clearPendingConfirmation,
    onConfirm,
    onCancel,
  };
}

export default useConfirmationGate;
