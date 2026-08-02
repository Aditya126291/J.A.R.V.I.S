import React, { useState } from 'react';
import './App.css';
import NavBar from './component/NavBar';
import AIVoiceBlob from './component/blob';
import Terminal from './component/Terminal';
import ConfirmationModal from './component/ConfirmationModal';
import { useConfirmationGate } from './hooks/useConfirmationGate';
import MemoryDashboard from './component/MemoryDashboard';
import ToolsSecurityConsole from './component/ToolsSecurityConsole';

const NAV_ITEMS = [
  { id: 'chat', icon: '💬', label: 'Assistant' },
  { id: 'tasks', icon: '⚡', label: 'Tasks' },
  { id: 'memory', icon: '🧠', label: 'Memory' },
  { id: 'tools', icon: '🛠️', label: 'Tools' },
  { id: 'settings', icon: '⚙️', label: 'Settings' },
];

function App() {
  const [blobConfig, setBlobConfig] = useState({
    color: '#38bdf8',
    size: 0.65,
    sensitivity: 0.8,
    language: 'en-IN',
    position: { x: window.innerWidth * 0.75, y: window.innerHeight * 0.18 },
    isDraggingMode: false,
  });
  const [activeTab, setActiveTab] = useState('chat');

  const {
    isOpen: isConfirmationOpen,
    modalActions,
    onConfirm: onConfirmActions,
    onCancel: onCancelActions,
  } = useConfirmationGate();

  return (
    <div className="app-shell">
      {/* Clean Sidebar */}
      <aside className="sidebar" aria-label="JARVIS navigation">
        <div className="sidebar-brand">
          <div className="brand-logo">J</div>
          <div className="brand-text">
            <strong>J.A.R.V.I.S</strong>
            <span>CONTROL CENTER</span>
          </div>
        </div>

        <nav className="sidebar-nav">
          {NAV_ITEMS.map((item) => (
            <button
              type="button"
              key={item.id}
              className={`nav-item ${activeTab === item.id ? 'active' : ''}`}
              onClick={() => setActiveTab(item.id)}
            >
              <span className="nav-icon">{item.icon}</span>
              <span>{item.label}</span>
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">
          <span className="status-dot" />
          <div className="status-info">
            <strong>ONLINE</strong>
            <span>SYSTEM READY</span>
          </div>
        </div>
      </aside>

      {/* Main Workspace */}
      <section className="workspace">
        <header className="topbar">
          <div className="topbar-title-block">
            <span className="topbar-eyebrow">SYSTEM / {activeTab.toUpperCase()}</span>
            <h1 className="topbar-title">
              {activeTab === 'chat' && 'Assistant Console'}
              {activeTab === 'tasks' && 'Active Tasks & Queue'}
              {activeTab === 'memory' && 'Memory & Context'}
              {activeTab === 'tools' && 'Registered Capabilities'}
              {activeTab === 'settings' && 'System Settings'}
            </h1>
          </div>
          <div className="topbar-controls">
            <span className="hotkey-hint">Right Alt to Speak</span>
            <NavBar
              blobConfig={blobConfig}
              setBlobConfig={setBlobConfig}
            />
          </div>
        </header>

        <main className="workspace-body">
          {activeTab === 'chat' && (
            <div className="chat-container">
              <div className="chat-header-banner">
                <div className="banner-left">
                  <span className="live-badge">● LIVE STREAM</span>
                  <h2>Voice & Command Interface</h2>
                </div>
                <div className="banner-right">
                  <span className="ready-indicator">Ready for Input</span>
                </div>
              </div>
              <div className="terminal-wrapper">
                <Terminal blobConfig={blobConfig} />
              </div>
            </div>
          )}

          {activeTab === 'tasks' && (
            <div className="panel-card">
              <h3>Active Tasks</h3>
              <p className="panel-muted">No background tasks currently running.</p>
            </div>
          )}

          {activeTab === 'memory' && (
            <MemoryDashboard />
          )}

          {activeTab === 'tools' && (
            <ToolsSecurityConsole />
          )}

          {activeTab === 'settings' && (
            <div className="panel-card">
              <h3>System Settings</h3>
              <p className="panel-muted">Backend connected on port 5000. Active model: Gemini 2.5 Flash.</p>
            </div>
          )}
        </main>
      </section>

      <AIVoiceBlob blobConfig={blobConfig} setBlobConfig={setBlobConfig} />

      <ConfirmationModal
        isOpen={isConfirmationOpen}
        pendingActions={modalActions}
        onConfirm={onConfirmActions}
        onCancel={onCancelActions}
      />
    </div>
  );
}

export default App;
