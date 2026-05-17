import React, { useState } from 'react';
import './App.css';
import NavBar from './component/NavBar';
import AIVoiceBlob from './component/blob';
import Terminal from './component/Terminal';
import SystemStatus from './component/SystemStatus';
import HUDWidgets from './component/HUDWidgets';
import CurrentMode from './component/CurrentMode';

function App() {
  const [blobConfig, setBlobConfig] = useState({
    color: '#7f8c22',
    size: 0.65, 
    sensitivity: 0.8,
    language: 'en-IN',
    position: { x: window.innerWidth / 2, y: window.innerHeight / 2 }, 
    isDraggingMode: false
  });

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
    </div>
  );
}

export default App;
