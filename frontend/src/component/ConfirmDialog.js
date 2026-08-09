import React, { useState } from 'react';
import './ConfirmDialog.css';

function summarizePayload(payload) {
  if (!payload) return 'Unknown action';
  if (payload.module === 'apps') return `${payload.action.toUpperCase()} ${payload.value}`;
  if (payload.module === 'message' && payload.value) {
    return `SEND ${payload.value.app?.toUpperCase()} MESSAGE TO ${payload.value.contact}`;
  }
  if (payload.module === 'power') return `POWER ${payload.action.toUpperCase()}`;
  if (payload.module === 'network') return payload.action.replace(/_/g, ' ').toUpperCase();
  if (payload.module === 'files') {
    return `${payload.action.replace(/_/g, ' ').toUpperCase()}${payload.value ? `: ${payload.value}` : ''}`;
  }
  return `${payload.module.toUpperCase()} ${payload.action.replace(/_/g, ' ').toUpperCase()}`;
}

const ConfirmDialog = ({ payloads = [], previews = [], speech, onConfirm, onCancel, activeColor }) => {
  const color = activeColor || '#00ffe1';
  const primaryPayload = payloads[0];
  const preview = previews[0] || null;
  const [securityPin, setSecurityPin] = useState('');
  const target = payloads.map(summarizePayload).join(' + ') || 'Unknown action';
  const isDestructive = preview?.authorityLevel === 'A6' || preview?.authorityLevel === 'A7' || primaryPayload?.module === 'power' || primaryPayload?.action === 'delete';

  return (
    <div className="confirm-overlay">
      <div
        className="confirm-dialog"
        style={{
          borderColor: `${color}66`,
          boxShadow: `0 0 60px ${color}22, 0 0 120px ${color}11, inset 0 0 30px ${color}0a`,
        }}
      >
        <div className="confirm-icon" style={{ color, textShadow: `0 0 20px ${color}` }}>
          !
        </div>
        <div className="confirm-title" style={{ color }}>
          AUTHORIZATION REQUIRED
        </div>
        <div className="confirm-body">
          <span className="confirm-label">ACTION:</span>
          <span className="confirm-target" style={{ color, textShadow: `0 0 8px ${color}80` }}>
            {preview?.actionDescription || target}
          </span>
        </div>
        {preview?.targetValue && <div className="confirm-body"><span className="confirm-label">TARGET:</span><span className="confirm-target">{preview.targetValue}</span></div>}
        {preview?.authorityLevel && <div className="confirm-body"><span className="confirm-label">AUTHORITY:</span><span className="confirm-target">{preview.authorityLevel} — {preview.authorityName}</span></div>}
        {speech && <div className="confirm-prompt">{speech}</div>}
        {(preview?.warning || isDestructive) && <div className="confirm-warning">{preview?.warning || 'This may change system state immediately.'}</div>}
        {preview?.requiresPin && (
          <input
            className="confirm-pin-input"
            type="password"
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="Enter JARVIS security PIN"
            value={securityPin}
            onChange={(event) => setSecurityPin(event.target.value)}
          />
        )}
        <div className="confirm-actions">
          <button
            className="confirm-btn confirm-yes"
            onClick={() => onConfirm(securityPin)}
            style={{
              borderColor: '#00ff88',
              color: '#00ff88',
              boxShadow: '0 0 15px #00ff8822',
            }}
          >
            AUTHORIZE
          </button>
          <button
            className="confirm-btn confirm-no"
            onClick={onCancel}
            style={{
              borderColor: '#ff3366',
              color: '#ff3366',
              boxShadow: '0 0 15px #ff336622',
            }}
          >
            DENY
          </button>
        </div>
        <div className="confirm-voice-hint">
          Say <strong>"Yes"</strong> or <strong>"No"</strong>
        </div>
      </div>
    </div>
  );
};

export default ConfirmDialog;
