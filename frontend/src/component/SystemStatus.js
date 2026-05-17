import React, { useState, useEffect } from 'react';
import './SystemStatus.css';
import { getAiStatus, getSystemStats } from '../api';

const ActiveAIStatusWidget = ({ activeColor }) => {
  const [aiStatus, setAiStatus] = useState(null);

  useEffect(() => {
    const fetchAiStatus = async () => {
      try {
        const data = await getAiStatus();
        setAiStatus(data);
      } catch (err) {}
    };
    fetchAiStatus();
    const timer = setInterval(fetchAiStatus, 3000);
    return () => clearInterval(timer);
  }, []);

  if (!aiStatus) return null;

  const isEmergency = aiStatus.activeProvider === 'emergency' || aiStatus.activeProvider === 'system';
  const isPowerMode = aiStatus.activeProvider === 'ollama_local';

  let statusColor = '#00ff88';
  if (isEmergency) statusColor = '#ff3366';
  else if (isPowerMode) statusColor = '#00ffe1';
  else if (aiStatus.activeProvider === 'gemini_fallback') statusColor = '#ffcc00';

  return (
    <div className="hud-widget ai-status-widget" style={{ borderColor: `${statusColor}4a`, boxShadow: `inset 0 0 10px ${statusColor}33` }}>
      <div className="widget-header">
        <span className="dot" style={{ backgroundColor: statusColor, boxShadow: `0 0 8px ${statusColor}` }}></span>
        <span className="title" style={{ color: statusColor, textShadow: `0 0 5px ${statusColor}80` }}>ACTIVE.AI.STATE</span>
      </div>
      <div className="status-grid">
        <div className="status-row">
          <span className="label">MODEL:</span>
          <span className="value glow-text" style={{ color: statusColor }}>{aiStatus.activeProviderName.toUpperCase()}</span>
        </div>
        <div className="status-row">
          <span className="label">MODE:</span>
          <span className="value">{isEmergency ? 'OFFLINE EMERGENCY' : isPowerMode ? 'LOCAL POWER' : 'CLOUD CONNECTED'}</span>
        </div>
        <div className="status-row">
          <span className="label">STT ENGINE:</span>
          <span className="value">WEB SPEECH API</span>
        </div>
        <div className="status-row">
          <span className="label">TTS ENGINE:</span>
          <span className="value">GOOGLE TTS</span>
        </div>
        <div className="status-row">
          <span className="label">MEMORY:</span>
          <span className="value">{aiStatus.conversationLength} MSG</span>
        </div>
      </div>
      {aiStatus.lastSwitch && Date.now() - aiStatus.lastSwitch.timestamp < 10000 && (
        <div className="failover-alert pulse-bg">
          FAILOVER: {aiStatus.lastSwitch.from} -&gt; {aiStatus.lastSwitch.to}
        </div>
      )}
    </div>
  );
};

const ProgressBar = ({ label, value, max, unit, color }) => {
  const percent = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <div className="progress-container">
      <div className="progress-label">
        <span>{label}</span>
        <span>{value}{unit} {max ? `/ ${max}${unit}` : ''}</span>
      </div>
      <div className="progress-track">
        <div className="progress-fill" style={{ width: `${percent}%`, backgroundColor: color, boxShadow: `0 0 8px ${color}` }}></div>
      </div>
    </div>
  );
};

const ResourceMonitorWidget = ({ activeColor }) => {
  const [stats, setStats] = useState(null);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const data = await getSystemStats();
        if (data.success) setStats(data);
      } catch (err) {}
    };
    fetchStats();
    const timer = setInterval(fetchStats, 2000);
    return () => clearInterval(timer);
  }, []);

  if (!stats) return null;

  return (
    <div className="hud-widget resource-monitor-widget" style={{ borderColor: `${activeColor}4a`, boxShadow: `inset 0 0 10px ${activeColor}33` }}>
      <div className="widget-header">
        <span className="dot" style={{ backgroundColor: activeColor, boxShadow: `0 0 8px ${activeColor}` }}></span>
        <span className="title" style={{ color: activeColor, textShadow: `0 0 5px ${activeColor}80` }}>SYSTEM.RESOURCES</span>
      </div>

      <div className="resources-grid">
        <ProgressBar label="CPU LOAD" value={stats.cpu.load} max={100} unit="%" color={stats.cpu.load > 85 ? '#ff3366' : activeColor} />
        <ProgressBar label="RAM USAGE" value={stats.ram.used} max={stats.ram.total} unit="GB" color={stats.ram.percent > 85 ? '#ffcc00' : activeColor} />

        <div className="gpu-info">
          <span className="gpu-name">GPU: {stats.gpu.name}</span>
        </div>
        <ProgressBar label="VRAM" value={stats.gpu.vramUsed} max={stats.gpu.vramTotal} unit="MB" color={activeColor} />

        <div className="hardware-metrics">
          <div className="metric">
            <span className="metric-label">CPU TEMP</span>
            <span className="metric-value" style={{ color: stats.cpu.temp > 80 ? '#ff3366' : '#fff' }}>{stats.cpu.temp}C</span>
          </div>
          <div className="metric">
            <span className="metric-label">NET RX</span>
            <span className="metric-value">{stats.network.rx} KB/s</span>
          </div>
          <div className="metric">
            <span className="metric-label">NET TX</span>
            <span className="metric-value">{stats.network.tx} KB/s</span>
          </div>
        </div>
      </div>
    </div>
  );
};

const SystemStatus = ({ blobConfig }) => {
  const activeColor = blobConfig?.color || '#00ffe1';

  return (
    <div className="system-widgets-container">
      <ActiveAIStatusWidget activeColor={activeColor} />
      <ResourceMonitorWidget activeColor={activeColor} />
    </div>
  );
};

export default SystemStatus;
