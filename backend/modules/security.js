'use strict';

/**
 * J.A.R.V.I.S. Seven-Layer Security Model (A0 – A7)
 *
 * Implements fine-grained authority levels, action risk evaluation,
 * dry-run preview generation, and security audit event logging.
 *
 * Authority Levels:
 *   - A0: Passive Read (System stats, time, health) -> Auto-approved
 *   - A1: Harmless Local (Read notes, list local files) -> Auto-approved
 *   - A2: Low-Impact Query (Web search, weather, wikipedia) -> Auto-approved
 *   - A3: Local Modification (Write note, adjust volume/brightness) -> Auto-approved + Audit Logged
 *   - A4: External Communication (Send message, post update, launch process) -> UI Confirmation Required
 *   - A5: State & Auth Change (Modify system config, update API keys) -> UI Confirmation Required
 *   - A6: Destructive Action (Delete file, close app, purge history) -> Strong UI Confirmation Required
 *   - A7: Unbounded Execution (Raw shell execution, shutdown) -> Explicit Confirmation
 */

const AUTHORITY_LEVELS = {
  A0: { level: 0, name: 'Passive Read', requiresConfirmation: false },
  A1: { level: 1, name: 'Harmless Local', requiresConfirmation: false },
  A2: { level: 2, name: 'Low-Impact Query', requiresConfirmation: false },
  A3: { level: 3, name: 'Local Modification', requiresConfirmation: false },
  A4: { level: 4, name: 'External Communication', requiresConfirmation: true },
  A5: { level: 5, name: 'State & Auth Change', requiresConfirmation: true },
  A6: { level: 6, name: 'Destructive Action', requiresConfirmation: true },
  A7: { level: 7, name: 'Unbounded Execution', requiresConfirmation: true },
};

/**
 * Classify authority level for an action payload
 */
function classifyAuthority(payload) {
  if (!payload || typeof payload !== 'object') {
    return { level: 'A0', meta: AUTHORITY_LEVELS.A0 };
  }

  const { module, action } = payload;
  const mod = String(module || '').toLowerCase();
  const act = String(action || '').toLowerCase();

  // A7: Unbounded / System Shutdown
  if (act.includes('shutdown') || act.includes('format') || act.includes('eval')) {
    return { level: 'A7', meta: AUTHORITY_LEVELS.A7 };
  }

  // A6: Destructive Action
  if (act.includes('delete') || act.includes('remove') || act.includes('purge') || act === 'close') {
    return { level: 'A6', meta: AUTHORITY_LEVELS.A6 };
  }

  // A5: State & Configuration Changes
  if (act.includes('config') || act.includes('setting') || act.includes('key')) {
    return { level: 'A5', meta: AUTHORITY_LEVELS.A5 };
  }

  // A4: External communication. Opening a local application is A1.
  if (mod === 'message' || mod === 'email' || mod === 'social' || act.includes('send') || act.includes('post')) {
    return { level: 'A4', meta: AUTHORITY_LEVELS.A4 };
  }

  // A3: Local Modifications
  if (mod === 'notes' && (act === 'write' || act === 'append') || act.includes('adjust') || act.includes('set')) {
    return { level: 'A3', meta: AUTHORITY_LEVELS.A3 };
  }

  // A2: Web Queries / Knowledge
  if (mod === 'web' || act.includes('search') || act === 'weather' || act === 'wiki') {
    return { level: 'A2', meta: AUTHORITY_LEVELS.A2 };
  }

  // A1: Harmless local actions and reads.
  if ((mod === 'apps' && act === 'open') || act.includes('read') || act.includes('list') || act.includes('get')) {
    return { level: 'A1', meta: AUTHORITY_LEVELS.A1 };
  }

  // A0: Passive Default
  return { level: 'A0', meta: AUTHORITY_LEVELS.A0 };
}

/**
 * Generate dry-run preview template for sensitive operations
 */
function generateDryRunPreview(payload) {
  const classification = classifyAuthority(payload);
  const { module, action, value } = payload || {};

  return {
    authorityLevel: classification.level,
    authorityName: classification.meta.name,
    requiresConfirmation: classification.meta.requiresConfirmation,
    title: `Authorization Request [${classification.level}]`,
    actionDescription: `Module: ${module || 'system'} | Action: ${action || 'execute'}`,
    targetValue: typeof value === 'object' ? JSON.stringify(value) : String(value || 'None'),
    requiresPin: classification.level === 'A7',
    warning: classification.level >= 'A6' ? 'CRITICAL: Destructive operation.' : classification.level >= 'A4' ? 'External communication or state change.' : null,
  };
}

module.exports = {
  AUTHORITY_LEVELS,
  classifyAuthority,
  generateDryRunPreview,
};
