import React, { useState } from 'react';
import { useTabFlow, WorkspaceWithCount } from './useTabFlow';

interface PopupProps {
  user?: { id: string; email: string } | null;
  onSignOut?: () => void;
}

export const Popup: React.FC<PopupProps> = ({ user, onSignOut }) => {
  const { workspaces, loading, error, createWorkspace, deleteWorkspace, addCurrentTab, switchWorkspace } = useTabFlow();
  const [showNewForm, setShowNewForm] = useState(false);
  const [newName, setNewName] = useState('');

  const handleCreate = async () => {
    if (!newName.trim()) return;
    await createWorkspace(newName.trim(), '');
    setNewName('');
    setShowNewForm(false);
  };

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <div style={styles.logo}>
          <svg width="18" height="18" viewBox="0 0 128 128" fill="none">
            <rect x="10" y="30" width="70" height="50" rx="8" fill="#fff" fillOpacity=".5" />
            <rect x="30" y="20" width="70" height="50" rx="8" fill="#fff" fillOpacity=".75" />
            <rect x="48" y="10" width="70" height="50" rx="8" fill="#fff" />
          </svg>
        </div>
        <h1 style={styles.title}>TabFlow</h1>
        <div style={{ flex: 1 }} />
        <span style={styles.count}>{workspaces.length} workspaces</span>
        {onSignOut && (
          <button
            style={{ background: 'none', border: 'none', color: '#8b8fa3', cursor: 'pointer', fontSize: '12px', padding: '4px 8px' }}
            onClick={onSignOut}
            title={user?.email || 'Sign out'}
          >
            Sign out
          </button>
        )}
      </div>

      {/* Content */}
      <div style={styles.content}>
        {loading && <div style={styles.emptyState}>Loading...</div>}
        {error && <div style={{ ...styles.emptyState, color: '#f87171' }}>{error}</div>}

        {!loading && workspaces.length === 0 && (
          <div style={styles.emptyState}>
            <div style={{ fontSize: '32px', marginBottom: '12px' }}>📑</div>
            <div style={{ fontWeight: 600, marginBottom: '4px' }}>No workspaces yet</div>
            <div style={{ color: '#8b8fa3' }}>Create one to start organizing your tabs</div>
          </div>
        )}

        <div style={styles.workspaceList}>
          {workspaces.map((ws) => (
            <WorkspaceCard
              key={ws.id}
              workspace={ws}
              onAddTab={() => addCurrentTab(ws.id)}
              onSwitch={() => switchWorkspace(ws.id)}
              onDelete={() => deleteWorkspace(ws.id)}
            />
          ))}
        </div>

        {/* Inline new-workspace form */}
        {showNewForm && (
          <div style={styles.newForm}>
            <input
              style={styles.input}
              type="text"
              placeholder="Workspace name..."
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
              autoFocus
            />
            <div style={{ display: 'flex', gap: '6px' }}>
              <button style={styles.formBtn} onClick={handleCreate}>Create</button>
              <button style={{ ...styles.formBtn, backgroundColor: '#2d3139' }} onClick={() => setShowNewForm(false)}>Cancel</button>
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div style={styles.footer}>
        <button
          style={styles.primaryBtn}
          onClick={() => setShowNewForm(true)}
          onMouseEnter={(e) => Object.assign(e.currentTarget.style, { backgroundColor: '#556ee8' })}
          onMouseLeave={(e) => Object.assign(e.currentTarget.style, { backgroundColor: '#6c8cff' })}
        >
          + New Workspace
        </button>
      </div>
    </div>
  );
};

/* ─── Workspace Card ─── */

interface WorkspaceCardProps {
  workspace: WorkspaceWithCount;
  onAddTab: () => void;
  onSwitch: () => void;
  onDelete: () => void;
}

const WorkspaceCard: React.FC<WorkspaceCardProps> = ({ workspace, onAddTab, onSwitch, onDelete }) => {
  const [hover, setHover] = useState(false);
  const [hoverAdd, setHoverAdd] = useState(false);

  return (
    <div
      style={{
        ...styles.card,
        ...(hover ? styles.cardHover : {}),
        ...(workspace.isActive ? { borderColor: workspace.color + '80' } : {}),
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={onSwitch}
    >
      <div style={styles.cardRow}>
        <div style={{ ...styles.dot, backgroundColor: workspace.color }} />
        <h3 style={styles.cardName}>{workspace.name}</h3>
        {workspace.isActive && <span style={styles.activeBadge}>Active</span>}
        <span style={styles.tabBadge}>{workspace.tabCount}</span>
        {hover && (
          <button
            style={styles.deleteBtn}
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            title="Delete workspace"
          >✕</button>
        )}
      </div>
      <button
        style={{
          ...styles.addBtn,
          ...(hoverAdd ? styles.addBtnHover : {}),
        }}
        onMouseEnter={() => setHoverAdd(true)}
        onMouseLeave={() => setHoverAdd(false)}
        onClick={(e) => { e.stopPropagation(); onAddTab(); }}
      >
        + Add current tab
      </button>
    </div>
  );
};

/* ─── Styles ─── */

const styles: Record<string, React.CSSProperties> = {
  container: {
    width: '400px',
    minHeight: '500px',
    backgroundColor: '#1a1d27',
    color: '#e8eaed',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    display: 'flex',
    flexDirection: 'column',
  },
  header: {
    padding: '14px 20px',
    borderBottom: '1px solid #2d3139',
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
  },
  logo: {
    width: '28px',
    height: '28px',
    borderRadius: '6px',
    background: 'linear-gradient(135deg, #6c8cff, #a78bfa)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { fontSize: '18px', fontWeight: 700, margin: 0, color: '#fff' },
  count: { fontSize: '12px', color: '#8b8fa3' },
  content: { flex: 1, overflow: 'auto', padding: '12px' },
  emptyState: { textAlign: 'center', padding: '40px 20px', color: '#8b8fa3', fontSize: '14px' },
  workspaceList: { display: 'flex', flexDirection: 'column', gap: '8px' },

  card: {
    padding: '12px 16px',
    backgroundColor: '#24272f',
    borderRadius: '8px',
    cursor: 'pointer',
    border: '1px solid transparent',
    transition: 'all 0.15s',
  },
  cardHover: { backgroundColor: '#2d3139', borderColor: '#3d4150' },
  cardRow: { display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' },
  dot: { width: '10px', height: '10px', borderRadius: '50%', flexShrink: 0 },
  cardName: { fontSize: '14px', fontWeight: 600, margin: 0, flex: 1 },
  activeBadge: {
    fontSize: '10px',
    fontWeight: 600,
    color: '#4ade80',
    backgroundColor: 'rgba(74,222,128,0.12)',
    padding: '2px 8px',
    borderRadius: '4px',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  tabBadge: {
    fontSize: '12px',
    color: '#9aa0a6',
    backgroundColor: '#3d4150',
    padding: '2px 8px',
    borderRadius: '4px',
    minWidth: '24px',
    textAlign: 'center',
  },
  deleteBtn: {
    background: 'none',
    border: 'none',
    color: '#8b8fa3',
    cursor: 'pointer',
    fontSize: '12px',
    padding: '2px 6px',
    borderRadius: '4px',
  },
  addBtn: {
    width: '100%',
    padding: '7px 0',
    fontSize: '12px',
    backgroundColor: '#2d3139',
    border: '1px solid #3d4150',
    color: '#9aa0a6',
    borderRadius: '6px',
    cursor: 'pointer',
    transition: 'all 0.15s',
  },
  addBtnHover: { backgroundColor: '#3d4150', color: '#e8eaed', borderColor: '#6c8cff' },

  newForm: {
    marginTop: '8px',
    padding: '12px',
    backgroundColor: '#24272f',
    borderRadius: '8px',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  input: {
    width: '100%',
    padding: '8px 12px',
    fontSize: '14px',
    backgroundColor: '#1a1d27',
    border: '1px solid #3d4150',
    borderRadius: '6px',
    color: '#e8eaed',
    outline: 'none',
  },
  formBtn: {
    flex: 1,
    padding: '8px',
    fontSize: '13px',
    fontWeight: 500,
    backgroundColor: '#6c8cff',
    color: '#fff',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
  },

  footer: { padding: '12px 20px', borderTop: '1px solid #2d3139' },
  primaryBtn: {
    width: '100%',
    padding: '10px',
    fontSize: '14px',
    fontWeight: 500,
    backgroundColor: '#6c8cff',
    color: '#fff',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    transition: 'all 0.15s',
  },
};
