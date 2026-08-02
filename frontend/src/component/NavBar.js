import React, { useState } from 'react';
import './NavBar.css';

const NavBar = ({ blobConfig = {}, setBlobConfig }) => {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  const handleDragToggle = () => {
    setBlobConfig({ ...blobConfig, isDraggingMode: !blobConfig.isDraggingMode });
    setIsSettingsOpen(false);
  };

  return (
    <nav className="navbar-container">
      <div className="navbar-settings-wrapper" style={{ position: 'relative' }}>
        <button
          className="btn-settings-toggle"
          onClick={() => setIsSettingsOpen(!isSettingsOpen)}
        >
          ⚙️ Settings
        </button>
        {isSettingsOpen && (
          <div className="settings-dropdown">
            <div className="settings-section">
              <span>Blob Size</span>
              <input
                type="range" min="0.5" max="3.0" step="0.1"
                value={blobConfig.size || 1.0}
                onChange={(e) => setBlobConfig({ ...blobConfig, size: parseFloat(e.target.value) })}
              />
            </div>
            <div className="settings-section">
              <span>Sensitivity</span>
              <input
                type="range" min="0.1" max="2.0" step="0.1"
                value={blobConfig.sensitivity || 0.8}
                onChange={(e) => setBlobConfig({ ...blobConfig, sensitivity: parseFloat(e.target.value) })}
              />
            </div>
            <div className="settings-section">
              <span>Language</span>
              <select
                value={blobConfig.language || 'en-IN'}
                onChange={(e) => setBlobConfig({ ...blobConfig, language: e.target.value })}
                style={{
                  width: '100%',
                  background: 'rgba(255,255,255,0.06)',
                  color: 'var(--text-main)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '6px',
                  padding: '6px',
                  outline: 'none',
                  cursor: 'pointer',
                  fontSize: '0.8rem',
                }}
              >
                <option value="en-US" style={{color: '#000'}}>English (US)</option>
                <option value="en-IN" style={{color: '#000'}}>English (India)</option>
                <option value="hi-IN" style={{color: '#000'}}>Hindi (India)</option>
              </select>
            </div>
            <div className="settings-section">
              <button className="btn-futuristic" onClick={handleDragToggle}>
                {blobConfig.isDraggingMode ? "Lock Position" : "Reposition Blob"}
              </button>
            </div>
          </div>
        )}
      </div>
    </nav>
  );
};

export default NavBar;
