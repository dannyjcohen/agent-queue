'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface WaitingItem {
  id: string;
  thread_id: string;
  session_id: string;
  kind: 'permission' | 'question' | 'done';
  context: {
    // permission
    tool_name?: string;
    tool_input?: string | Record<string, unknown>;
    agent_name?: string;
    project?: string;
    cwd?: string;
    // question / done
    message?: string;
    question?: string;
    summary?: string;
  };
  status: 'waiting' | 'answered' | 'answered_locally' | 'expired';
  answer: { decision?: string; text?: string } | null;
  created_at: string;
  answered_at: string | null;
}

interface ThreadGroup {
  thread_id: string;
  items: WaitingItem[];
  latestCreated: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function groupByThread(items: WaitingItem[]): ThreadGroup[] {
  const map = new Map<string, WaitingItem[]>();
  for (const item of items) {
    const list = map.get(item.thread_id) ?? [];
    list.push(item);
    map.set(item.thread_id, list);
  }
  // Each thread: sort items newest first
  const groups: ThreadGroup[] = [];
  for (const [thread_id, list] of map.entries()) {
    const sorted = [...list].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
    groups.push({
      thread_id,
      items: sorted,
      latestCreated: new Date(sorted[0].created_at).getTime(),
    });
  }
  // Sort thread groups newest first
  return groups.sort((a, b) => b.latestCreated - a.latestCreated);
}

function timeAgo(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function shortId(id: string): string {
  return id.slice(0, 8);
}

function formatInput(input: string | Record<string, unknown> | undefined): string {
  if (input === undefined || input === null) return '';
  if (typeof input === 'string') return input;
  try {
    return JSON.stringify(input, null, 2);
  } catch {
    return String(input);
  }
}

// ---------------------------------------------------------------------------
// Permission item
// ---------------------------------------------------------------------------

function PermissionItem({
  item,
  onAnswer,
  answering,
}: {
  item: WaitingItem;
  onAnswer: (id: string, decision: 'allow' | 'deny') => Promise<void>;
  answering: string | null;
}) {
  const { tool_name, tool_input, agent_name, project, cwd } = item.context;
  const isAnswering = answering === item.id;

  return (
    <div className="item-card item-permission">
      <div className="item-meta">
        <span className="kind-badge kind-permission">permission</span>
        {agent_name && <span className="meta-chip">{agent_name}</span>}
        {project && <span className="meta-chip">{project}</span>}
        <span className="item-time">{timeAgo(item.created_at)}</span>
      </div>

      {tool_name && (
        <div className="tool-row">
          <span className="tool-label">Tool</span>
          <code className="tool-name">{tool_name}</code>
        </div>
      )}

      {tool_input && (
        <pre className="input-block">{formatInput(tool_input)}</pre>
      )}

      {cwd && (
        <div className="cwd-row">
          <span className="cwd-label">cwd</span>
          <code className="cwd-value">{typeof cwd === 'string' ? cwd : String(cwd)}</code>
        </div>
      )}

      <div className="action-row">
        <button
          className="btn btn-allow"
          disabled={isAnswering}
          onClick={() => onAnswer(item.id, 'allow')}
        >
          {isAnswering ? '…' : 'Allow'}
        </button>
        <button
          className="btn btn-deny"
          disabled={isAnswering}
          onClick={() => onAnswer(item.id, 'deny')}
        >
          {isAnswering ? '…' : 'Deny'}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Question / done item
// ---------------------------------------------------------------------------

function QuestionItem({
  item,
  onAnswer,
  answering,
}: {
  item: WaitingItem;
  onAnswer: (id: string, text: string) => Promise<void>;
  answering: string | null;
}) {
  const [reply, setReply] = useState('');
  const isAnswering = answering === item.id;
  const text = item.context.message ?? item.context.question ?? item.context.summary ?? '';
  const { agent_name, project } = item.context;

  return (
    <div className="item-card item-question">
      <div className="item-meta">
        <span className={`kind-badge kind-${item.kind}`}>{item.kind}</span>
        {agent_name && <span className="meta-chip">{agent_name}</span>}
        {project && <span className="meta-chip">{project}</span>}
        <span className="item-time">{timeAgo(item.created_at)}</span>
      </div>

      {text && <p className="question-text">{text}</p>}

      <div className="reply-row">
        <textarea
          className="reply-input"
          placeholder={item.kind === 'done' ? 'Reply or just read…' : 'Type your reply…'}
          value={reply}
          onChange={e => setReply(e.target.value)}
          rows={3}
          disabled={isAnswering}
          onKeyDown={e => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && reply.trim()) {
              onAnswer(item.id, reply.trim());
            }
          }}
        />
        <button
          className="btn btn-send"
          disabled={isAnswering || !reply.trim()}
          onClick={() => onAnswer(item.id, reply.trim())}
        >
          {isAnswering ? '…' : 'Send'}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Answered / history item (collapsed, muted)
// ---------------------------------------------------------------------------

function HistoryItem({ item }: { item: WaitingItem }) {
  const [expanded, setExpanded] = useState(false);
  const statusLabel =
    item.status === 'answered_locally'
      ? 'answered locally'
      : item.status === 'expired'
      ? 'expired'
      : 'answered';

  const kindLabel = item.kind;
  const { tool_name, message, question, summary } = item.context;
  const preview = tool_name ?? message ?? question ?? summary ?? item.kind;

  return (
    <div className="history-item" onClick={() => setExpanded(v => !v)}>
      <div className="history-header">
        <span className="history-preview">{String(preview).slice(0, 60)}</span>
        <span className="history-status">{statusLabel}</span>
        <span className="history-time">{timeAgo(item.created_at)}</span>
        <span className="history-toggle">{expanded ? '▲' : '▼'}</span>
      </div>
      {expanded && (
        <div className="history-detail">
          <div className="history-meta">
            <span className="kind-badge-sm">{kindLabel}</span>
            {item.context.agent_name && (
              <span className="meta-chip-sm">{item.context.agent_name}</span>
            )}
          </div>
          {item.answer && (
            <div className="history-answer">
              <span className="history-answer-label">Answer:</span>{' '}
              {item.answer.decision
                ? item.answer.decision
                : item.answer.text
                ? String(item.answer.text).slice(0, 200)
                : JSON.stringify(item.answer)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Thread group
// ---------------------------------------------------------------------------

function Thread({
  group,
  onAnswer,
  answering,
  onQuestionAnswer,
}: {
  group: ThreadGroup;
  onAnswer: (id: string, decision: 'allow' | 'deny') => Promise<void>;
  onQuestionAnswer: (id: string, text: string) => Promise<void>;
  answering: string | null;
}) {
  const active = group.items.filter(i => i.status === 'waiting');
  const history = group.items.filter(i => i.status !== 'waiting');

  return (
    <div className="thread">
      <div className="thread-header">
        <span className="thread-id">thread {shortId(group.thread_id)}</span>
        {active.length > 0 && (
          <span className="thread-badge">{active.length} waiting</span>
        )}
      </div>

      {active.map(item =>
        item.kind === 'permission' ? (
          <PermissionItem
            key={item.id}
            item={item}
            onAnswer={onAnswer}
            answering={answering}
          />
        ) : (
          <QuestionItem
            key={item.id}
            item={item}
            onAnswer={onQuestionAnswer}
            answering={answering}
          />
        )
      )}

      {history.length > 0 && (
        <div className="history-section">
          {history.map(item => (
            <HistoryItem key={item.id} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function WaitingPage() {
  const [items, setItems] = useState<WaitingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [answering, setAnswering] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const toastRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((msg: string, ok: boolean) => {
    setToast({ msg, ok });
    if (toastRef.current) clearTimeout(toastRef.current);
    toastRef.current = setTimeout(() => setToast(null), 3500);
  }, []);

  const fetchItems = useCallback(async () => {
    try {
      const res = await fetch('/api/waiting', { credentials: 'include' });
      if (res.status === 401) {
        window.location.href = '/login';
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { items: WaitingItem[] };
      setItems(data.items);
      setError(null);
    } catch (e) {
      setError((e as Error).message ?? 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial fetch + polling
  useEffect(() => {
    fetchItems();

    const startPoll = () => {
      pollRef.current = setInterval(() => {
        if (!document.hidden) fetchItems();
      }, 5000);
    };

    const stopPoll = () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };

    const handleVisibility = () => {
      if (document.hidden) {
        stopPoll();
      } else {
        fetchItems();
        startPoll();
      }
    };

    startPoll();
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      stopPoll();
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [fetchItems]);

  const handlePermissionAnswer = useCallback(
    async (id: string, decision: 'allow' | 'deny') => {
      setAnswering(id);
      try {
        const res = await fetch(`/api/waiting/${id}/answer`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ answer: { decision } }),
        });
        if (res.status === 409) {
          showToast('Already answered at the desktop — refreshing.', true);
          await fetchItems();
          return;
        }
        if (!res.ok) {
          const d = await res.json().catch(() => ({})) as { error?: string };
          showToast(d.error ?? `Error ${res.status}`, false);
          return;
        }
        showToast(decision === 'allow' ? 'Allowed.' : 'Denied.', true);
        await fetchItems();
      } catch {
        showToast('Network error.', false);
      } finally {
        setAnswering(null);
      }
    },
    [fetchItems, showToast]
  );

  const handleQuestionAnswer = useCallback(
    async (id: string, text: string) => {
      setAnswering(id);
      try {
        const res = await fetch(`/api/waiting/${id}/answer`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ answer: { text } }),
        });
        if (res.status === 409) {
          showToast('Already answered at the desktop — refreshing.', true);
          await fetchItems();
          return;
        }
        if (!res.ok) {
          const d = await res.json().catch(() => ({})) as { error?: string };
          showToast(d.error ?? `Error ${res.status}`, false);
          return;
        }
        showToast('Reply sent.', true);
        await fetchItems();
      } catch {
        showToast('Network error.', false);
      } finally {
        setAnswering(null);
      }
    },
    [fetchItems, showToast]
  );

  const groups = groupByThread(items);
  const waitingCount = items.filter(i => i.status === 'waiting').length;

  return (
    <>
      <style>{`
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        html { -webkit-text-size-adjust: 100%; }
        body {
          background: #0f0f0f;
          color: #e5e5e5;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
          font-size: 15px;
          line-height: 1.5;
          min-height: 100dvh;
        }

        /* ---- Layout ---- */
        .page { max-width: 480px; margin: 0 auto; padding: 1rem 1rem 5rem; }

        /* ---- Header ---- */
        .header {
          display: flex; align-items: center; justify-content: space-between;
          padding: 0.75rem 0 1rem;
          border-bottom: 1px solid #1e1e1e;
          margin-bottom: 1rem;
        }
        .header-title {
          font-size: 1rem; font-weight: 600; letter-spacing: -0.01em; color: #e5e5e5;
        }
        .header-right {
          display: flex; align-items: center; gap: 0.5rem;
        }
        .waiting-count {
          font-size: 0.75rem; font-weight: 600;
          background: #3b82f6; color: #fff;
          border-radius: 999px; padding: 0.1rem 0.5rem;
          min-width: 1.4rem; text-align: center;
        }
        /* Placeholder for task 389: PWA/notifications button goes in .header-right */
        .header-actions { display: flex; align-items: center; gap: 0.4rem; }

        /* ---- Thread ---- */
        .thread {
          margin-bottom: 1.25rem;
          border: 1px solid #1e1e1e;
          border-radius: 10px;
          overflow: hidden;
        }
        .thread-header {
          display: flex; align-items: center; gap: 0.5rem;
          padding: 0.5rem 0.75rem;
          background: #141414;
          border-bottom: 1px solid #1e1e1e;
        }
        .thread-id {
          font-size: 0.7rem; font-family: 'SF Mono', 'Cascadia Code', monospace;
          color: #555; letter-spacing: 0.03em;
        }
        .thread-badge {
          font-size: 0.65rem; font-weight: 700;
          background: #1c2d44; color: #60a5fa;
          border-radius: 4px; padding: 0.1rem 0.4rem;
          text-transform: uppercase; letter-spacing: 0.04em;
        }

        /* ---- Item cards ---- */
        .item-card {
          padding: 0.85rem 0.85rem 1rem;
          background: #141414;
        }
        .item-card + .item-card { border-top: 1px solid #1e1e1e; }

        .item-meta {
          display: flex; align-items: center; flex-wrap: wrap; gap: 0.35rem;
          margin-bottom: 0.6rem;
        }

        /* Kind badges */
        .kind-badge {
          font-size: 0.65rem; font-weight: 700; text-transform: uppercase;
          letter-spacing: 0.05em; border-radius: 4px; padding: 0.15rem 0.45rem;
        }
        .kind-permission { background: #2d1b00; color: #fb923c; }
        .kind-question { background: #1a2640; color: #60a5fa; }
        .kind-done { background: #0f2d1a; color: #4ade80; }

        .meta-chip {
          font-size: 0.72rem; color: #666;
          background: #1c1c1c; border: 1px solid #2a2a2a;
          border-radius: 4px; padding: 0.1rem 0.4rem;
          white-space: nowrap;
        }
        .item-time { font-size: 0.7rem; color: #444; margin-left: auto; white-space: nowrap; }

        /* Tool display */
        .tool-row {
          display: flex; align-items: baseline; gap: 0.5rem; margin-bottom: 0.4rem;
        }
        .tool-label { font-size: 0.7rem; color: #555; text-transform: uppercase; letter-spacing: 0.04em; flex-shrink: 0; }
        .tool-name { font-family: 'SF Mono', 'Cascadia Code', monospace; font-size: 0.85rem; color: #fb923c; }

        .input-block {
          background: #0a0a0a; border: 1px solid #222;
          border-radius: 6px; padding: 0.6rem 0.75rem;
          font-family: 'SF Mono', 'Cascadia Code', monospace; font-size: 0.75rem;
          color: #c4b5fd; line-height: 1.4;
          white-space: pre-wrap; word-break: break-all;
          max-height: 160px; overflow-y: auto;
          margin-bottom: 0.4rem;
        }

        .cwd-row {
          display: flex; align-items: baseline; gap: 0.4rem; margin-bottom: 0.6rem;
        }
        .cwd-label { font-size: 0.65rem; color: #444; text-transform: uppercase; letter-spacing: 0.04em; flex-shrink: 0; }
        .cwd-value { font-family: 'SF Mono', 'Cascadia Code', monospace; font-size: 0.7rem; color: #555; word-break: break-all; }

        /* Question / done text */
        .question-text {
          font-size: 0.88rem; color: #ccc; line-height: 1.55;
          margin-bottom: 0.75rem;
          white-space: pre-wrap;
        }

        /* Actions */
        .action-row { display: flex; gap: 0.6rem; margin-top: 0.75rem; }
        .reply-row { display: flex; flex-direction: column; gap: 0.5rem; margin-top: 0.25rem; }

        .btn {
          border: none; border-radius: 7px; font-size: 0.9rem; font-weight: 600;
          cursor: pointer; padding: 0.6rem 1.1rem; transition: opacity 0.12s;
          flex-shrink: 0;
        }
        .btn:disabled { opacity: 0.4; cursor: not-allowed; }
        .btn-allow { background: #16a34a; color: #fff; flex: 1; }
        .btn-allow:not(:disabled):hover { background: #15803d; }
        .btn-deny { background: #dc2626; color: #fff; flex: 1; }
        .btn-deny:not(:disabled):hover { background: #b91c1c; }
        .btn-send {
          background: #e5e5e5; color: #0f0f0f;
          align-self: flex-end; padding: 0.55rem 1.25rem;
        }
        .btn-send:not(:disabled):hover { background: #fff; }

        .reply-input {
          width: 100%; background: #0a0a0a; border: 1px solid #2a2a2a;
          border-radius: 7px; color: #e5e5e5; font-size: 0.88rem;
          font-family: inherit; line-height: 1.5; padding: 0.6rem 0.75rem;
          resize: vertical; outline: none; transition: border-color 0.15s;
        }
        .reply-input:focus { border-color: #444; }
        .reply-input::placeholder { color: #444; }
        .reply-input:disabled { opacity: 0.5; }

        /* ---- History ---- */
        .history-section {
          border-top: 1px solid #1a1a1a;
        }
        .history-item {
          padding: 0.55rem 0.85rem;
          cursor: pointer;
          border-top: 1px solid #181818;
          transition: background 0.1s;
        }
        .history-item:first-child { border-top: none; }
        .history-item:hover { background: #181818; }
        .history-header {
          display: flex; align-items: center; gap: 0.5rem;
        }
        .history-preview {
          font-size: 0.75rem; color: #444; font-family: 'SF Mono', 'Cascadia Code', monospace;
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; min-width: 0;
        }
        .history-status {
          font-size: 0.65rem; color: #3a3a3a; white-space: nowrap;
          background: #181818; border-radius: 3px; padding: 0.1rem 0.35rem;
        }
        .history-time { font-size: 0.65rem; color: #333; white-space: nowrap; }
        .history-toggle { font-size: 0.6rem; color: #333; flex-shrink: 0; }
        .history-detail { padding: 0.5rem 0 0.25rem; }
        .history-meta { display: flex; align-items: center; gap: 0.35rem; margin-bottom: 0.35rem; }
        .kind-badge-sm {
          font-size: 0.6rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em;
          border-radius: 3px; padding: 0.1rem 0.35rem; color: #555; background: #1a1a1a;
        }
        .meta-chip-sm { font-size: 0.65rem; color: #444; }
        .history-answer { font-size: 0.75rem; color: #4a4a4a; }
        .history-answer-label { color: #3a3a3a; font-weight: 600; }

        /* ---- Empty state ---- */
        .empty {
          text-align: center; padding: 4rem 1rem;
          display: flex; flex-direction: column; align-items: center; gap: 0.75rem;
        }
        .empty-icon { font-size: 2rem; opacity: 0.3; }
        .empty-title { font-size: 1rem; font-weight: 600; color: #555; }
        .empty-sub { font-size: 0.8rem; color: #3a3a3a; }

        /* ---- Loading state ---- */
        .loading {
          text-align: center; padding: 4rem 1rem; color: #333;
          font-size: 0.85rem;
        }

        /* ---- Error banner ---- */
        .error-banner {
          margin-bottom: 1rem; padding: 0.65rem 0.9rem;
          background: #2a1515; border: 1px solid #4a2020;
          border-radius: 7px; color: #f87171; font-size: 0.82rem;
          display: flex; align-items: center; justify-content: space-between; gap: 0.5rem;
        }
        .error-retry {
          background: none; border: none; color: #f87171; cursor: pointer;
          font-size: 0.8rem; text-decoration: underline; flex-shrink: 0;
        }

        /* ---- Toast ---- */
        .toast {
          position: fixed; bottom: 1.5rem; left: 50%; transform: translateX(-50%);
          padding: 0.65rem 1.1rem; border-radius: 8px; font-size: 0.85rem;
          font-weight: 500; z-index: 100; white-space: nowrap;
          box-shadow: 0 4px 24px rgba(0,0,0,0.5);
          transition: opacity 0.2s;
        }
        .toast-ok { background: #16a34a; color: #fff; }
        .toast-err { background: #dc2626; color: #fff; }

        /* ---- Scrollbar ---- */
        .input-block::-webkit-scrollbar { width: 4px; }
        .input-block::-webkit-scrollbar-track { background: transparent; }
        .input-block::-webkit-scrollbar-thumb { background: #2a2a2a; border-radius: 2px; }
      `}</style>

      <div className="page">
        <header className="header">
          <span className="header-title">Agent Queue</span>
          <div className="header-right">
            <div className="header-actions">
              {/* Task 389: PWA/notifications button will be inserted here */}
            </div>
            {waitingCount > 0 && (
              <span className="waiting-count">{waitingCount}</span>
            )}
          </div>
        </header>

        {error && (
          <div className="error-banner">
            <span>{error}</span>
            <button className="error-retry" onClick={fetchItems}>Retry</button>
          </div>
        )}

        {loading && <div className="loading">Loading…</div>}

        {!loading && groups.length === 0 && !error && (
          <div className="empty">
            <div className="empty-icon">✓</div>
            <div className="empty-title">Nothing waiting</div>
            <div className="empty-sub">Agents are running unattended</div>
          </div>
        )}

        {!loading && groups.map(group => (
          <Thread
            key={group.thread_id}
            group={group}
            onAnswer={handlePermissionAnswer}
            onQuestionAnswer={handleQuestionAnswer}
            answering={answering}
          />
        ))}
      </div>

      {toast && (
        <div className={`toast ${toast.ok ? 'toast-ok' : 'toast-err'}`}>
          {toast.msg}
        </div>
      )}
    </>
  );
}
