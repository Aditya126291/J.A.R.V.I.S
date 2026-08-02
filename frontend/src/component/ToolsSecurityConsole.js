import React, { useState, useEffect } from 'react';
import './ToolsSecurityConsole.css';

const ToolsSecurityConsole = () => {
  const [matrix, setMatrix] = useState({});
  const [auditLogs, setAuditLogs] = useState([]);
  const [activeTab, setActiveTab] = useState('security'); // 'security' | 'audit'

  useEffect(() => {
    fetch('http://localhost:5000/api/security-matrix')
      .then((res) => res.json())
      .then((data) => {
        if (data.success) setMatrix(data.levels || {});
      })
      .catch((err) => console.error('Failed to fetch security matrix:', err));

    fetch('http://localhost:5000/api/audit-log')
      .then((res) => res.json())
      .then((data) => {
        if (data.success) setAuditLogs(data.auditLogs || []);
      })
      .catch((err) => console.error('Failed to fetch audit log:', err));
  }, []);

  return (
    <div className="tools-security-container">
      <div className="tools-security-header">
        <div className="subtab-buttons">
          <button
            className={`subtab-btn ${activeTab === 'security' ? 'active' : ''}`}
            onClick={() => setActiveTab('security')}
          >
            🛡️ Seven-Layer Security Matrix (A0–A7)
          </button>
          <button
            className={`subtab-btn ${activeTab === 'audit' ? 'active' : ''}`}
            onClick={() => setActiveTab('audit')}
          >
            📜 Security Audit Trail ({auditLogs.length})
          </button>
        </div>
      </div>

      {activeTab === 'security' && (
        <div className="security-matrix-grid">
          {Object.entries(matrix).map(([code, meta]) => (
            <div className={`security-card level-${code}`} key={code}>
              <div className="security-card-header">
                <span className="code-badge">{code}</span>
                <span className="level-name">{meta.name}</span>
              </div>
              <p className="policy-desc">
                {meta.requiresConfirmation
                  ? '🔒 Explicit UI Confirmation & Dry-Run Preview Required'
                  : '⚡ Auto-Approved & Audit Logged'}
              </p>
            </div>
          ))}
        </div>
      )}

      {activeTab === 'audit' && (
        <div className="audit-logs-table">
          <div className="table-header">
            <span>Timestamp</span>
            <span>Event Type</span>
            <span>Authority</span>
            <span>Summary</span>
            <span>Status</span>
          </div>
          {auditLogs.length === 0 ? (
            <div className="empty-indicator">No audit events recorded yet.</div>
          ) : (
            auditLogs.map((log) => (
              <div className="table-row" key={log.eventId}>
                <span className="time">{new Date(log.timestamp).toLocaleTimeString()}</span>
                <span className="type">{log.eventType}</span>
                <span className="auth-badge">{log.authorityLevel}</span>
                <span className="summary">{log.summary}</span>
                <span className={`status ${log.result}`}>{log.result}</span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
};

export default ToolsSecurityConsole;
