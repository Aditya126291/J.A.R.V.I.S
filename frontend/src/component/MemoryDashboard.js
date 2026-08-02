import React, { useState, useEffect } from 'react';
import './MemoryDashboard.css';

const MemoryDashboard = () => {
  const [memories, setMemories] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [newMemoryContent, setNewMemoryContent] = useState('');
  const [newMemoryKind, setNewMemoryKind] = useState('explicit_memory');
  const [isLoading, setIsLoading] = useState(false);
  const [activeSubTab, setActiveSubTab] = useState('memories'); // 'memories' | 'sessions'

  const fetchMemories = async (query = '') => {
    try {
      setIsLoading(true);
      const res = await fetch(`http://localhost:5000/api/memory?q=${encodeURIComponent(query)}`);
      const data = await res.json();
      if (data.success) {
        setMemories(data.memories || []);
      }
    } catch (e) {
      console.error('Failed to fetch memories:', e);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchSessions = async () => {
    try {
      const res = await fetch('http://localhost:5000/api/sessions');
      const data = await res.json();
      if (data.success) {
        setSessions(data.sessions || []);
      }
    } catch (e) {
      console.error('Failed to fetch sessions:', e);
    }
  };

  useEffect(() => {
    fetchMemories();
    fetchSessions();
  }, []);

  const handleSearch = (e) => {
    e.preventDefault();
    fetchMemories(searchQuery);
  };

  const handleAddMemory = async (e) => {
    e.preventDefault();
    if (!newMemoryContent.trim()) return;

    try {
      const res = await fetch('http://localhost:5000/api/memory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: newMemoryKind,
          content: newMemoryContent.trim(),
          tags: ['manual_add'],
        }),
      });
      const data = await res.json();
      if (data.success) {
        setNewMemoryContent('');
        fetchMemories(searchQuery);
      }
    } catch (err) {
      console.error('Add memory failed:', err);
    }
  };

  const handleDeleteMemory = async (id) => {
    try {
      const res = await fetch(`http://localhost:5000/api/memory/${id}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (data.success) {
        fetchMemories(searchQuery);
      }
    } catch (err) {
      console.error('Delete memory failed:', err);
    }
  };

  return (
    <div className="memory-dashboard-container">
      <div className="memory-header">
        <div className="subtab-buttons">
          <button
            className={`subtab-btn ${activeSubTab === 'memories' ? 'active' : ''}`}
            onClick={() => setActiveSubTab('memories')}
          >
            🧠 Long-Term Memory ({memories.length})
          </button>
          <button
            className={`subtab-btn ${activeSubTab === 'sessions' ? 'active' : ''}`}
            onClick={() => setActiveSubTab('sessions')}
          >
            📜 Conversation History ({sessions.length})
          </button>
        </div>

        {activeSubTab === 'memories' && (
          <form className="memory-search-bar" onSubmit={handleSearch}>
            <input
              type="text"
              placeholder="Search memories by keyword or tag..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            <button type="submit">Search</button>
          </form>
        )}
      </div>

      {activeSubTab === 'memories' && (
        <div className="memory-content-wrapper">
          <form className="add-memory-card" onSubmit={handleAddMemory}>
            <h3>Add New Memory</h3>
            <div className="add-memory-row">
              <select
                value={newMemoryKind}
                onChange={(e) => setNewMemoryKind(e.target.value)}
              >
                <option value="explicit_memory">Explicit Memory</option>
                <option value="preference">User Preference</option>
                <option value="decision">Key Decision</option>
              </select>
              <input
                type="text"
                placeholder="e.g. Aditya prefers dark mode interfaces..."
                value={newMemoryContent}
                onChange={(e) => setNewMemoryContent(e.target.value)}
              />
              <button type="submit">+ Save Memory</button>
            </div>
          </form>

          <div className="memory-grid">
            {isLoading ? (
              <div className="loading-indicator">Loading memories...</div>
            ) : memories.length === 0 ? (
              <div className="empty-indicator">No long-term memories found.</div>
            ) : (
              memories.map((mem) => (
                <div className="memory-card" key={mem.id}>
                  <div className="memory-card-header">
                    <span className={`kind-badge ${mem.kind}`}>{mem.kind.replace('_', ' ')}</span>
                    <button className="delete-btn" onClick={() => handleDeleteMemory(mem.id)}>
                      ✕ Forget
                    </button>
                  </div>
                  <p className="memory-text">{mem.content}</p>
                  <div className="memory-card-footer">
                    <div className="tags">
                      {mem.tags.map((tag, i) => (
                        <span className="tag" key={i}>#{tag}</span>
                      ))}
                    </div>
                    <span className="date">{new Date(mem.createdAt).toLocaleDateString()}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {activeSubTab === 'sessions' && (
        <div className="sessions-list-wrapper">
          {sessions.length === 0 ? (
            <div className="empty-indicator">No session history found.</div>
          ) : (
            sessions.map((sess) => (
              <div className="session-card" key={sess.sessionId}>
                <div className="session-title">
                  <span>{sess.title}</span>
                  <span className="session-date">{new Date(sess.startedAt).toLocaleString()}</span>
                </div>
                <p className="session-summary">{sess.summary}</p>
                <div className="session-meta">
                  <span>Turns: {sess.turnCount || 0}</span>
                  <span>ID: {sess.sessionId}</span>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
};

export default MemoryDashboard;
