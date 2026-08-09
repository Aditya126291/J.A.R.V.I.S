import React, { useState, useEffect } from 'react';
import './MemoryDashboard.css';
import { createMemory, deleteMemory, getArtifacts, getMemories, getSessions, getTurns } from '../api';

const MemoryDashboard = () => {
  const [memories, setMemories] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [artifacts, setArtifacts] = useState([]);
  const [turns, setTurns] = useState([]);
  const [selectedSession, setSelectedSession] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [newMemoryContent, setNewMemoryContent] = useState('');
  const [newMemoryKind, setNewMemoryKind] = useState('explicit_memory');
  const [isLoading, setIsLoading] = useState(false);
  const [activeSubTab, setActiveSubTab] = useState('memories'); // 'memories' | 'sessions' | 'artifacts'

  const fetchMemories = async (query = '') => {
    try {
      setIsLoading(true);
      const data = await getMemories(query);
      if (data.success) {
        setMemories(data.memories || []);
      }
    } catch (e) {
      console.error('Failed to fetch memories:', e);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchSessions = async (query = '') => {
    try {
      const data = await getSessions(query);
      if (data.success) {
        setSessions(data.sessions || []);
      }
    } catch (e) {
      console.error('Failed to fetch sessions:', e);
    }
  };

  const fetchArtifacts = async (query = '') => {
    try {
      const data = await getArtifacts(query);
      if (data.success) setArtifacts(data.artifacts || []);
    } catch (e) {
      console.error('Failed to fetch artifacts:', e);
    }
  };

  const selectSession = async (session) => {
    try {
      const data = await getTurns({ sessionId: session.sessionId });
      setSelectedSession(session);
      setTurns(data.turns || []);
    } catch (e) {
      console.error('Failed to fetch session turns:', e);
    }
  };

  useEffect(() => {
    fetchMemories();
    fetchSessions();
    fetchArtifacts();
  }, []);

  const handleSearch = (e) => {
    e.preventDefault();
    if (activeSubTab === 'artifacts') fetchArtifacts(searchQuery);
    else fetchMemories(searchQuery);
  };

  const handleAddMemory = async (e) => {
    e.preventDefault();
    if (!newMemoryContent.trim()) return;

    try {
      const data = await createMemory({ kind: newMemoryKind, content: newMemoryContent.trim(), tags: ['manual_add'] });
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
      const data = await deleteMemory(id);
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
          <button
            className={`subtab-btn ${activeSubTab === 'artifacts' ? 'active' : ''}`}
            onClick={() => setActiveSubTab('artifacts')}
          >
            🗂️ Artifacts ({artifacts.length})
          </button>
        </div>

        {(activeSubTab === 'memories' || activeSubTab === 'artifacts') && (
          <form className="memory-search-bar" onSubmit={handleSearch}>
            <input
              type="text"
              placeholder={activeSubTab === 'artifacts' ? 'Search artifact text, summary, or tags...' : 'Search memories by keyword or tag...'}
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
          <form className="memory-search-bar" onSubmit={(event) => { event.preventDefault(); fetchSessions(searchQuery); }}>
            <input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Search past sessions..." />
            <button type="submit">Search</button>
          </form>
          {sessions.length === 0 ? (
            <div className="empty-indicator">No session history found.</div>
          ) : (
            sessions.map((sess) => (
              <button type="button" className="session-card" key={sess.sessionId} onClick={() => selectSession(sess)}>
                <div className="session-title">
                  <span>{sess.title}</span>
                  <span className="session-date">{new Date(sess.startedAt).toLocaleString()}</span>
                </div>
                <p className="session-summary">{sess.summary}</p>
                <div className="session-meta">
                  <span>Turns: {sess.turnCount || 0}</span>
                  <span>ID: {sess.sessionId}</span>
                </div>
              </button>
            ))
          )}
          {selectedSession && (
            <div className="session-turns">
              <h3>{selectedSession.title} — turns</h3>
              {turns.length === 0 ? <div className="empty-indicator">This session was compacted or has no retained turns.</div> : turns.map((turn) => (
                <div className="memory-card" key={turn.turnId}>
                  <p className="memory-text"><strong>You:</strong> {turn.userPrompt}</p>
                  <p className="memory-text"><strong>J.A.R.V.I.S:</strong> {turn.jarvisSpeech}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeSubTab === 'artifacts' && (
        <div className="memory-grid">
          {artifacts.length === 0 ? <div className="empty-indicator">No indexed artifacts yet.</div> : artifacts.map((artifact) => (
            <div className="memory-card" key={artifact.id}>
              <div className="memory-card-header"><strong>{artifact.name}</strong><span className="kind-badge">artifact</span></div>
              <p className="memory-text">{artifact.summary || artifact.text || 'No extractable text recorded.'}</p>
              <div className="tags">{(artifact.tags || []).map((tag) => <span className="tag" key={tag}>#{tag}</span>)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default MemoryDashboard;
