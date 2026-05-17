import React, { useState, useEffect } from 'react';
import './CurrentMode.css';
import { getAiStatus } from '../api';

const CurrentMode = ({ blobConfig }) => {
  const [modeInfo, setModeInfo] = useState({
    mode: 'IDLE',
    status: 'STANDBY',
    activeTools: []
  });

  const activeColor = blobConfig?.color || '#00ffe1';

  useEffect(() => {
    // Poll AI status to determine if we are in Power Mode or Normal Mode
    const pollMode = async () => {
      try {
        const data = await getAiStatus();
        
        let mode = 'VOICE ASSISTANT';
        let status = 'LISTENING';
        
        if (data.activeProvider === 'ollama_local') {
          mode = 'OFFLINE POWER MODE';
          status = 'GEMMA ACTIVE';
        } else if (data.activeProvider === 'emergency' || data.activeProvider === 'system') {
          mode = 'EMERGENCY MODE';
          status = 'LIMITED';
        }

        setModeInfo({
          mode,
          status,
          activeTools: ['Chrome', 'Terminal'] // Static for now, could be dynamic in future
        });
      } catch (err) {}
    };

    pollMode();
    const timer = setInterval(pollMode, 5000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="current-mode-container fade-in" style={{ borderColor: `${activeColor}4a` }}>
      <div className="mode-main">
        <span className="mode-label">SYSTEM MODE</span>
        <span className="mode-value glow-text" style={{ color: activeColor }}>{modeInfo.mode}</span>
      </div>
      <div className="mode-divider" style={{ backgroundColor: activeColor }}></div>
      <div className="mode-details">
        <div className="detail-item">
          <span className="detail-label">STATUS:</span>
          <span className="detail-value">{modeInfo.status}</span>
        </div>
        <div className="detail-item">
          <span className="detail-label">ACTIVE TOOLS:</span>
          <span className="detail-value">{modeInfo.activeTools.join(' | ')}</span>
        </div>
      </div>
    </div>
  );
};

export default CurrentMode;
