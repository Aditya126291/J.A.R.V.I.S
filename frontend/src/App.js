import React, { useState, memo } from 'react';
import './App.css';
import NavBar from './component/NavBar';
import AIVoiceBlob from './component/blob';
import Terminal from './component/Terminal';
import SystemPulse from './component/SystemPulse';
import TimePomodoro from './component/TimePomodoro';
import Weather from './component/Weather';
import NewsFeed from './component/NewsFeed';
import DevRail from './component/DevRail';
import NowPlaying from './component/NowPlaying';
import GamePresence from './component/GamePresence';
import RichPresence from './component/RichPresence';
import ConfirmationModal from './component/ConfirmationModal';
import { useConfirmationGate } from './hooks/useConfirmationGate';
import { useUIMode } from './hooks/useUIMode';

/**
 * HUD root.
 *
 * Layout:
 *   - Top   : NavBar (brand · DEV/GAMER toggle · links · settings)
 *   - Left  : TimePomodoro + Weather (always-on)
 *             DevRail OR Gamer widgets (mode-scoped)
 *             NewsFeed (always-on, topic flips with mode)
 *   - Center: floating AIVoiceBlob
 *   - Right : SystemPulse + Terminal
 *
 * Theme: rival accents (blue=dev, red=gamer) via theme.css. Body's
 * `data-ui-mode` attribute drives the swap; `useUIMode` keeps it in sync
 * and persists the choice + listens for the voice bus.
 */

const GamerSlot = memo(function GamerSlot({ blobConfig }) {
  return (
    <>
      <NowPlaying blobConfig={blobConfig} />
      <GamePresence blobConfig={blobConfig} />
      <RichPresence blobConfig={blobConfig} />
    </>
  );
});

function App() {
  const [blobConfig, setBlobConfig] = useState({
    color: '#4ea1ff',
    size: 0.65,
    sensitivity: 0.8,
    language: 'en-IN',
    position: { x: window.innerWidth / 2, y: window.innerHeight / 2 },
    isDraggingMode: false,
  });

  const { mode, setMode } = useUIMode();

  // Dynamically align blob color accent with active mode: dev = cobalt blue (#4ea1ff), gamer = adversary red (#e62222)
  const activeColor = mode === 'gamer' ? '#e62222' : '#4ea1ff';
  const effectiveBlobConfig = { ...blobConfig, color: activeColor };

  const {
    isOpen: isConfirmationOpen,
    modalActions,
    onConfirm: onConfirmActions,
    onCancel: onCancelActions,
  } = useConfirmationGate();

  return (
    <div className="App" data-ui-mode={mode}>
      <div className="hud-overlay"></div>
      <div className="hud-grid"></div>
      <div className="scanlines"></div>

      <div className="hud-container">
        <div className="hud-top">
          <NavBar
            blobConfig={effectiveBlobConfig}
            setBlobConfig={setBlobConfig}
            mode={mode}
            setMode={setMode}
          />
        </div>

        <div className="hud-left">
          <div className="rail-always-on">
            <TimePomodoro blobConfig={effectiveBlobConfig} />
            <Weather blobConfig={effectiveBlobConfig} />
          </div>

          <div className="rail-mode-slot" data-mode={mode}>
            {mode === 'dev' && <DevRail blobConfig={effectiveBlobConfig} />}
            {mode === 'gamer' && <GamerSlot blobConfig={effectiveBlobConfig} />}
          </div>

          <div className="rail-news">
            <NewsFeed blobConfig={effectiveBlobConfig} mode={mode} />
          </div>
        </div>

        <div className="hud-center"></div>

        <div className="hud-right">
          <SystemPulse />
          <Terminal blobConfig={effectiveBlobConfig} />
        </div>
      </div>

      <AIVoiceBlob blobConfig={effectiveBlobConfig} setBlobConfig={setBlobConfig} />

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
