import React, { useState } from 'react';
import './App.css';
import NavBar from './component/NavBar';
import AIVoiceBlob from './component/blob';
import Terminal from './component/Terminal';
import SystemStatus from './component/SystemStatus';
import HUDWidgets from './component/HUDWidgets';
import CurrentMode from './component/CurrentMode';
import ConfirmationModal from './component/ConfirmationModal';
import { useConfirmationGate } from './hooks/useConfirmationGate';

function App() {
  const [blobConfig, setBlobConfig] = useState({
    color: '#7f8c22',
    size: 0.65, 
    sensitivity: 0.8,
    language: 'en-IN',
    position: { x: window.innerWidth / 2, y: window.innerHeight / 2 }, 
    isDraggingMode: false
  });

  // Confirmation gate: owns the pending-confirmation state for risky actions
  // and produces the onConfirm/onCancel callbacks ConfirmationModal needs.
  //
  // TODO(15.1): wire `wsClient.send` into the hook's `send` option once the
  // WsClient instance lives at this level, and forward `requiresConfirmation`
  // events / HTTP 409 responses into `setPendingConfirmation`. The shape
  // expected here is `{ turnId, originalMessage?, actions: [{ id, payload, summary }] }`.
  const {
    isOpen: isConfirmationOpen,
    modalActions,
    onConfirm: onConfirmActions,
    onCancel: onCancelActions,
  } = useConfirmationGate();

  return (
    <div className="App">
      <div className="hud-overlay"></div>
      <div className="scanlines"></div>
      
      <div className="hud-container">
        {/* Top Header */}
        <div className="hud-top">
          <NavBar blobConfig={blobConfig} setBlobConfig={setBlobConfig} />
        </div>

        {/* Left Side: Command History & Suggestions */}
        <div className="hud-left">
          <HUDWidgets blobConfig={blobConfig} />
        </div>

        {/* Center: Empty spacer for the floating blob */}
        <div className="hud-center"></div>

        {/* Bottom Center: Mode Widget */}
        <div className="hud-bottom-center">
          <CurrentMode blobConfig={blobConfig} />
        </div>

        {/* Right Side: AI Status & Resource Monitoring */}
        <div className="hud-right">
          <SystemStatus blobConfig={blobConfig} />
          <Terminal blobConfig={blobConfig} />
        </div>
      </div>

      {/* Floating AI Blob (Absolute to screen) */}
      <AIVoiceBlob blobConfig={blobConfig} setBlobConfig={setBlobConfig} />

      {/* Risky-action confirmation gate (Requirements 6.7 - 6.10).
          The modal is rendered at the App level so it overlays the entire
          HUD and is independent of Terminal's own legacy ConfirmDialog. */}
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
