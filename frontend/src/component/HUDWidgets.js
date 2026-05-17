import React, { useState, useEffect, useRef } from 'react';
import './HUDWidgets.css';
import { getSystemStats } from '../api';

const CommandLogWidget = ({ activeColor }) => {
  const [logs, setLogs] = useState([]);
  const logsEndRef = useRef(null);

  useEffect(() => {
    const handleLog = (e) => {
      setLogs((prev) => {
        const newLogs = [...prev, e.detail];
        if (newLogs.length > 20) return newLogs.slice(newLogs.length - 20);
        return newLogs;
      });
    };

    window.addEventListener('jarvis-command-log', handleLog);
    return () => window.removeEventListener('jarvis-command-log', handleLog);
  }, []);

  useEffect(() => {
    if (logsEndRef.current) logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  return (
    <div className="hud-widget command-log-widget" style={{ borderColor: `${activeColor}4a`, boxShadow: `inset 0 0 10px ${activeColor}33` }}>
      <div className="widget-header">
        <span className="dot" style={{ backgroundColor: activeColor, boxShadow: `0 0 8px ${activeColor}` }}></span>
        <span className="title" style={{ color: activeColor, textShadow: `0 0 5px ${activeColor}80` }}>EXECUTION.LOG</span>
      </div>
      <div className="log-container">
        {logs.length === 0 ? (
          <div className="empty-log">AWAITING COMMANDS...</div>
        ) : (
          logs.map((log, idx) => {
            let color = '#ffffff';
            if (log.status === 'warning') color = '#ffcc00';
            if (log.status === 'error') color = '#ff3366';
            if (log.status === 'success') color = '#00ff88';

            return (
              <div key={`${log.time}-${idx}`} className="log-entry fade-in">
                <span className="log-time">[{log.time}]</span>
                <span className="log-text" style={{ color }}>{log.text}</span>
              </div>
            );
          })
        )}
        <div ref={logsEndRef} />
      </div>
    </div>
  );
};

const SmartSuggestionsWidget = () => {
  const [suggestions, setSuggestions] = useState([]);

  useEffect(() => {
    const pollStats = async () => {
      try {
        const data = await getSystemStats();
        const newSuggestions = [];

        if (data.ram && data.ram.percent > 85) {
          newSuggestions.push({
            id: 'ram',
            type: 'warning',
            text: `High memory usage (${data.ram.percent}%). Consider closing inactive apps.`,
          });
        }

        if (data.cpu && data.cpu.load > 85) {
          newSuggestions.push({
            id: 'cpu',
            type: 'warning',
            text: `CPU load is high (${data.cpu.load}%). Resource optimization may help.`,
          });
        }

        setSuggestions(newSuggestions);
      } catch (err) {}
    };

    pollStats();
    const timer = setInterval(pollStats, 10000);
    return () => clearInterval(timer);
  }, []);

  if (suggestions.length === 0) return null;

  return (
    <div className="hud-widget suggestions-widget" style={{ borderColor: '#ffcc004a', boxShadow: 'inset 0 0 10px #ffcc0033' }}>
      <div className="widget-header">
        <span className="dot yellow"></span>
        <span className="title" style={{ color: '#ffcc00', textShadow: '0 0 5px #ffcc0080' }}>SMART.SUGGESTIONS</span>
      </div>
      <div className="suggestions-container">
        {suggestions.map((sug) => (
          <div key={sug.id} className="suggestion-entry fade-in pulse-warning">
            <span className="suggestion-icon">WARN</span>
            <span className="suggestion-text">{sug.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

const HUDWidgets = ({ blobConfig }) => {
  const activeColor = blobConfig?.color || '#00ffe1';

  return (
    <div className="hud-widgets-container">
      <CommandLogWidget activeColor={activeColor} />
      <SmartSuggestionsWidget />
    </div>
  );
};

export default HUDWidgets;
