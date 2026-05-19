import { useEffect } from 'react';

/**
 * useUiBus — tiny pub/sub the chat router uses to drive the HUD with voice.
 *
 * Voice commands like "set weather to tokyo" or "start a focus timer" are
 * routed by the backend to a `module: "ui"` action (see `web.js`-style
 * fast paths in `ai_router.js`). Those actions arrive at the frontend as
 * `done` events with `{ actions: [{ module: 'ui', action, value }] }`, then
 * Terminal forwards them here by dispatching a `window` event.
 *
 * Why a CustomEvent and not React context: widgets are spread across the
 * tree, the bus receives ≤1 message per second, and we want widgets to
 * subscribe lazily without forcing every parent to re-render. A native
 * event also makes dispatching from outside React (e.g. the keyless web
 * tool result loop) trivial.
 *
 * Event shape:
 *   window.dispatchEvent(new CustomEvent('jarvis-ui', {
 *     detail: { action: 'pomodoro.start' | 'weather.set_location' | ..., value: ... }
 *   }))
 */

const BUS_EVENT = 'jarvis-ui';

export function dispatchUiAction(action, value) {
  if (typeof window === 'undefined') return;
  try {
    window.dispatchEvent(new CustomEvent(BUS_EVENT, { detail: { action, value } }));
  } catch { /* ignore — non-DOM environments (jsdom in tests) sometimes hiccup */ }
}

export function useUiBus(actionPattern, handler) {
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onEvent = (e) => {
      const detail = e?.detail || {};
      if (!detail.action) return;
      const matches = typeof actionPattern === 'string'
        ? detail.action === actionPattern
        : Array.isArray(actionPattern)
          ? actionPattern.includes(detail.action)
          : actionPattern instanceof RegExp
            ? actionPattern.test(detail.action)
            : false;
      if (matches) {
        try { handler(detail); } catch (err) { /* widget swallows its own errors */ }
      }
    };
    window.addEventListener(BUS_EVENT, onEvent);
    return () => window.removeEventListener(BUS_EVENT, onEvent);
  }, [actionPattern, handler]);
}
