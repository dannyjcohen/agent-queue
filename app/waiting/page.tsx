'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

// ---------------------------------------------------------------------------
// VAPID URL base64 → Uint8Array conversion for push subscription
// ---------------------------------------------------------------------------
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

// ---------------------------------------------------------------------------
// NotificationsButton — manages push subscription state
// ---------------------------------------------------------------------------
function NotificationsButton({ onToast }: { onToast: (msg: string, ok: boolean) => void }) {
  const [permission, setPermission] = useState<NotificationPermission>('default');
  const [subscribed, setSubscribed] = useState(false);
  const [working, setWorking] = useState(false);

  useEffect(() => {
    if (!('Notification' in window) || !('serviceWorker' in navigator)) return;
    setPermission(Notification.permission);
    if (Notification.permission === 'granted') {
      navigator.serviceWorker.ready.then((reg) => {
        reg.pushManager.getSubscription().then((sub) => {
          setSubscribed(!!sub);
        });
      });
    }
  }, []);

  const handleClick = useCallback(async () => {
    if (!('Notification' in window)) {
      onToast('Notifications not supported in this browser.', false);
      return;
    }
    if (!('serviceWorker' in navigator)) {
      onToast('Service workers not supported.', false);
      return;
    }

    setWorking(true);
    try {
      const perm = await Notification.requestPermission();
      setPermission(perm);
      if (perm !== 'granted') {
        onToast('Notification permission denied.', false);
        return;
      }

      const keyRes = await fetch('/api/push/vapid-public-key');
      if (!keyRes.ok) {
        onToast('Push not configured on server.', false);
        return;
      }
      const { publicKey } = await keyRes.json() as { publicKey: string };

      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });

      const res = await fetch('/api/push/subscribe', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sub.toJSON()),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as { error?: string };
        onToast(d.error ?? `Subscribe failed: ${res.status}`, false);
        return;
      }

      setSubscribed(true);
      onToast('Notifications enabled.', true);
    } catch (err) {
      onToast(`Error: ${(err as Error).message}`, false);
    } finally {
      setWorking(false);
    }
  }, [onToast]);

  if (typeof window !== 'undefined' && !('serviceWorker' in navigator)) return null;

  if (permission === 'denied') {
    return (
      <span style={{ fontSize: '0.7rem', color: '#4a4a4a' }} title="Notifications blocked in browser settings">
        notif blocked
      </span>
    );
  }

  if (subscribed && permission === 'granted') {
    return (
      <span style={{ fontSize: '0.72rem', color: '#16a34a' }} title="Push notifications active">
        notif on
      </span>
    );
  }

  return (
    <button
      onClick={handleClick}
      disabled={working}
      style={{
        background: 'none',
        border: '1px solid #2a2a2a',
        borderRadius: '6px',
        color: '#888',
        fontSize: '0.72rem',
        padding: '0.2rem 0.55rem',
        cursor: working ? 'not-allowed' : 'pointer',
        opacity: working ? 0.5 : 1,
        whiteSpace: 'nowrap',
      }}
      title="Enable push notifications"
    >
      {working ? '…' : 'Enable notif'}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface WaitingItem {
  id: string;
  thread_id: string;
  session_id: string;
  kind: 'permission' | 'question' | 'done';
  context: {
    // permission (hook-gate)
    tool_name?: string;
    tool_input?: string | Record<string, unknown>;
    cwd?: string;
    // source classification (task 428)
    source?: 'hook-gate' | 'notifier' | string;
    answerable?: boolean;
    // question / done — new contract from task 425
    last_message?: string;
    // older items / fallbacks
    message?: string;
    question?: string;
    summary?: string;
    // identity — task 425 populates these
    agent_name?: string;
    project?: string;
  };
  status: 'waiting' | 'answered' | 'answered_locally' | 'expired';
  answer: { decision?: string; text?: string; expired_reason?: string } | null;
  created_at: string;
  answered_at: string | null;
}

// Away state (task 430)
interface AwayState {
  away: boolean;
  updated_at: string;
  last_heartbeat_at: string;
  pending_request: { away: boolean; requested_at: string } | null;
}

interface SessionGroup {
  thread_id: string;
  /** All items newest-first */
  items: WaitingItem[];
  /** The single open (waiting) item, or null */
  openItem: WaitingItem | null;
  /** Resolved items for history */
  historyItems: WaitingItem[];
  latestCreated: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function groupBySession(items: WaitingItem[]): SessionGroup[] {
  const map = new Map<string, WaitingItem[]>();
  for (const item of items) {
    const list = map.get(item.thread_id) ?? [];
    list.push(item);
    map.set(item.thread_id, list);
  }

  const groups: SessionGroup[] = [];
  for (const [thread_id, list] of map.entries()) {
    const sorted = [...list].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
    // Latest waiting item only (there should only ever be one after task 425 fix,
    // but defensively take the newest)
    const openItem = sorted.find(i => i.status === 'waiting') ?? null;
    const historyItems = sorted.filter(i => i.status !== 'waiting');
    groups.push({
      thread_id,
      items: sorted,
      openItem,
      historyItems,
      latestCreated: new Date(sorted[0].created_at).getTime(),
    });
  }
  // Sort: sessions with open items first (newest first), then resolved sessions
  return groups.sort((a, b) => {
    const aOpen = a.openItem !== null ? 1 : 0;
    const bOpen = b.openItem !== null ? 1 : 0;
    if (aOpen !== bOpen) return bOpen - aOpen;
    return b.latestCreated - a.latestCreated;
  });
}

function timeAgo(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function shortId(id: string): string {
  // Strip "session:" prefix if present
  const raw = id.startsWith('session:') ? id.slice('session:'.length) : id;
  return raw.slice(0, 8);
}

function sessionTitle(thread_id: string, items: WaitingItem[]): string {
  // Pull agent_name + project from the most recent item that has them
  for (const item of items) {
    const { agent_name, project } = item.context;
    if (agent_name || project) {
      const parts: string[] = [];
      if (agent_name) parts.push(String(agent_name));
      if (project) parts.push(String(project));
      return parts.join(' / ');
    }
  }
  // Fallback: 8-char session id
  return shortId(thread_id);
}

function kindLabel(kind: WaitingItem['kind']): string {
  if (kind === 'permission') return 'Needs permission';
  if (kind === 'question') return 'Question';
  if (kind === 'done') return 'Finished — waiting for next instruction';
  return kind;
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
// Answer-window hint for permission items.
// ---------------------------------------------------------------------------

function AnswerWindowHint({ createdAt }: { createdAt: string }) {
  const [hint, setHint] = useState<string>('');

  useEffect(() => {
    function compute() {
      const ageMs = Date.now() - new Date(createdAt).getTime();
      const ageS = Math.floor(ageMs / 1000);
      const windowS = 5 * 60;
      const remaining = windowS - ageS;
      if (remaining <= 0) {
        setHint('expiring…');
      } else if (remaining < 90) {
        setHint(`expiring in ${remaining}s`);
      } else {
        const remMin = Math.ceil(remaining / 60);
        setHint(`~${remMin}m left to answer`);
      }
    }
    compute();
    const t = setInterval(compute, 10000);
    return () => clearInterval(t);
  }, [createdAt]);

  const ageS = Math.floor((Date.now() - new Date(createdAt).getTime()) / 1000);
  const urgent = (5 * 60 - ageS) < 90;

  return (
    <span className={urgent ? 'answer-hint answer-hint-urgent' : 'answer-hint'}>
      {hint}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Away badge (task 430) — shown in the page header
// ---------------------------------------------------------------------------

// PC is considered unreachable if the heartbeat is older than 3 minutes.
const PC_UNREACHABLE_MS = 3 * 60 * 1000;

function AwayBadge({
  awayState,
  toggling,
  onToggle,
}: {
  awayState: AwayState | null;
  toggling: boolean;
  onToggle: () => void;
}) {
  if (!awayState) return null;

  const heartbeatAge = awayState.last_heartbeat_at
    ? Date.now() - new Date(awayState.last_heartbeat_at).getTime()
    : Infinity;
  const pcUnreachable = heartbeatAge > PC_UNREACHABLE_MS;
  const hasPending = awayState.pending_request !== null;

  let label: string;
  let badgeClass: string;

  if (toggling || hasPending) {
    label = 'Switching…';
    badgeClass = 'away-badge away-badge-pending';
  } else if (pcUnreachable) {
    label = 'PC unreachable';
    badgeClass = 'away-badge away-badge-unreachable';
  } else if (awayState.away) {
    label = 'Away — permissions come to your phone';
    badgeClass = 'away-badge away-badge-away';
  } else {
    label = 'Here — permissions stay at your desk';
    badgeClass = 'away-badge away-badge-here';
  }

  const canToggle = !toggling && !hasPending && !pcUnreachable;

  return (
    <button
      className={badgeClass}
      onClick={canToggle ? onToggle : undefined}
      disabled={!canToggle}
      title={canToggle ? (awayState.away ? 'Tap to switch to Here' : 'Tap to switch to Away') : undefined}
    >
      {label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Permission card
// ---------------------------------------------------------------------------

/**
 * Determine whether a permission item is answerable from the phone.
 * Hook-gate items are actively polled — Allow/Deny work.
 * Notifier mirror items are informational — the terminal is the only control.
 *
 * Priority:
 *   1. context.answerable is explicitly set → use it.
 *   2. Fallback: structured tool_input present → hook-gate (answerable);
 *      message-only → notifier mirror (not answerable).
 */
function isAnswerableItem(item: WaitingItem): boolean {
  if (typeof item.context.answerable === 'boolean') return item.context.answerable;
  // Legacy / items posted before task 428: infer from payload shape
  return !!(item.context.tool_name || item.context.tool_input);
}

function PermissionCard({
  item,
  onAnswer,
  answering,
  precedingTimedOut,
}: {
  item: WaitingItem;
  onAnswer: (id: string, decision: 'allow' | 'deny') => Promise<void>;
  answering: string | null;
  /** True when the most recent history item in this thread is an expired-by-timeout gate card (task 433) */
  precedingTimedOut?: boolean;
}) {
  const { tool_name, tool_input, cwd, message } = item.context;
  const isAnswering = answering === item.id;
  const hasStructured = !!(tool_name || tool_input);
  const answerable = isAnswerableItem(item);

  return (
    <div className="card-body">
      {hasStructured && tool_name && (
        <div className="tool-row">
          <span className="tool-label">Tool</span>
          <code className="tool-name">{tool_name}</code>
        </div>
      )}
      {hasStructured && tool_input && (
        <pre className="input-block">{formatInput(tool_input)}</pre>
      )}
      {hasStructured && cwd && (
        <div className="cwd-row">
          <span className="cwd-label">cwd</span>
          <code className="cwd-value">{typeof cwd === 'string' ? cwd : String(cwd)}</code>
        </div>
      )}

      {/* Fallback: no tool_name/tool_input — show context.message */}
      {!hasStructured && message && (
        <p className="message-text">{String(message)}</p>
      )}
      {!hasStructured && cwd && (
        <div className="cwd-row">
          <span className="cwd-label">cwd</span>
          <code className="cwd-value">{typeof cwd === 'string' ? cwd : String(cwd)}</code>
        </div>
      )}

      {answerable ? (
        <>
          <div className="answer-window-row">
            <AnswerWindowHint createdAt={item.created_at} />
          </div>
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
        </>
      ) : (
        <div className="mirror-notice">
          <span className="mirror-icon">⌨️</span>
          <span className="mirror-text">
            {precedingTimedOut
              ? 'Timed out on your phone — respond at your PC'
              : 'answer at your desktop'}
          </span>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Question / done card
// ---------------------------------------------------------------------------

function QuestionCard({
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
  // Prefer context.last_message (new contract from task 425),
  // fall back to older fields
  const text =
    item.context.last_message ??
    item.context.message ??
    item.context.question ??
    item.context.summary ??
    '';

  return (
    <div className="card-body">
      {text && <p className="message-text">{text}</p>}

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
// History expander — collapsed by default, per session card
// ---------------------------------------------------------------------------

function HistoryExpander({ items }: { items: WaitingItem[] }) {
  const [open, setOpen] = useState(false);

  if (items.length === 0) return null;

  return (
    <div className="history-expander">
      <button
        className="history-toggle-btn"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
      >
        <span>history ({items.length})</span>
        <span className="history-chevron">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="history-list">
          {items.map(item => (
            <HistoryRow key={item.id} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}

function HistoryRow({ item }: { item: WaitingItem }) {
  const [expanded, setExpanded] = useState(false);

  // Task 433: distinguish timeout-expired gate items from normal expiry.
  const isTimedOut = item.status === 'expired' && item.answer?.expired_reason === 'timeout';

  const statusLabel =
    item.status === 'answered_locally'
      ? 'answered locally'
      : isTimedOut
      ? 'Timed out'
      : item.status === 'expired'
      ? 'expired'
      : 'answered';

  const { tool_name, last_message, message, question, summary } = item.context;
  const preview = tool_name ?? last_message ?? message ?? question ?? summary ?? item.kind;

  return (
    <div className="history-row" onClick={() => setExpanded(v => !v)}>
      <div className="history-row-header">
        <span className="history-preview">{String(preview).slice(0, 60)}</span>
        <span className="history-status-chip">{statusLabel}</span>
        <span className="history-time">{timeAgo(item.created_at)}</span>
        <span className="history-row-chevron">{expanded ? '▲' : '▼'}</span>
      </div>
      {expanded && (
        <div className="history-row-detail">
          <span className="kind-badge-sm kind-sm-{item.kind}">{kindLabel(item.kind)}</span>
          {item.answer && (
            <div className="history-answer">
              <span className="history-answer-label">Answer: </span>
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
// Session card — one per thread, shows only the latest open item
// ---------------------------------------------------------------------------

function SessionCard({
  group,
  onPermissionAnswer,
  onQuestionAnswer,
  answering,
}: {
  group: SessionGroup;
  onPermissionAnswer: (id: string, decision: 'allow' | 'deny') => Promise<void>;
  onQuestionAnswer: (id: string, text: string) => Promise<void>;
  answering: string | null;
}) {
  const { thread_id, items, openItem, historyItems } = group;
  const title = sessionTitle(thread_id, items);
  const hasRealTitle =
    items.some(i => i.context.agent_name || i.context.project);

  // Task 433: detect if the current open mirror item directly follows a timed-out gate item.
  // Condition: openItem is a non-answerable permission (mirror), AND the most recent
  // history item is an expired-by-timeout gate item (answerable source).
  const precedingTimedOut =
    openItem !== null &&
    openItem.kind === 'permission' &&
    !isAnswerableItem(openItem) &&
    historyItems.length > 0 &&
    historyItems[0].status === 'expired' &&
    historyItems[0].answer?.expired_reason === 'timeout';

  return (
    <div className="session-card">
      {/* Card header: title + kind badge + time */}
      <div className="card-header">
        <div className="card-header-left">
          {!hasRealTitle && (
            <span className="session-id-chip">{shortId(thread_id)}</span>
          )}
          <span className="session-title">{title}</span>
        </div>
        <div className="card-header-right">
          {openItem && (
            <>
              <span className={`kind-badge kind-${openItem.kind}`}>
                {kindLabel(openItem.kind)}
              </span>
              <span className="item-time">{timeAgo(openItem.created_at)}</span>
            </>
          )}
        </div>
      </div>

      {/* Open item action area */}
      {openItem && (
        openItem.kind === 'permission' ? (
          <PermissionCard
            item={openItem}
            onAnswer={onPermissionAnswer}
            answering={answering}
            precedingTimedOut={precedingTimedOut}
          />
        ) : (
          <QuestionCard
            item={openItem}
            onAnswer={onQuestionAnswer}
            answering={answering}
          />
        )
      )}

      {/* History expander */}
      {historyItems.length > 0 && (
        <HistoryExpander items={historyItems} />
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

  // Away state (task 430)
  const [awayState, setAwayState] = useState<AwayState | null>(null);
  const [toggling, setToggling] = useState(false);

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

  // Task 430: fetch away state in parallel with items
  const fetchAwayState = useCallback(async () => {
    try {
      const res = await fetch('/api/away-state', { credentials: 'include' });
      if (res.status === 401) return; // already handled by fetchItems redirect
      if (!res.ok) return;
      const data = await res.json() as AwayState;
      setAwayState(data);
    } catch {
      // Non-fatal — away badge just won't show
    }
  }, []);

  // Task 430: tap handler — request the opposite away state from the PC
  const handleToggleAway = useCallback(async () => {
    if (!awayState || toggling) return;
    const desiredAway = !awayState.away;
    setToggling(true);
    try {
      const res = await fetch('/api/away-state/request', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ away: desiredAway }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as { error?: string };
        showToast(d.error ?? `Error ${res.status}`, false);
        return;
      }
      // Optimistically update local state with a pending_request so badge shows "Switching…"
      setAwayState(prev => prev ? { ...prev, pending_request: { away: desiredAway, requested_at: new Date().toISOString() } } : prev);
    } catch {
      showToast('Network error.', false);
    } finally {
      setToggling(false);
    }
  }, [awayState, toggling, showToast]);

  // Initial fetch + 5s polling with hidden-tab pause
  useEffect(() => {
    fetchItems();
    fetchAwayState();

    const startPoll = () => {
      pollRef.current = setInterval(() => {
        if (!document.hidden) {
          fetchItems();
          fetchAwayState();
        }
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
        fetchAwayState();
        startPoll();
      }
    };

    startPoll();
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      stopPoll();
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [fetchItems, fetchAwayState]);

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

  const groups = groupBySession(items);
  // Sessions with an open item
  const openGroups = groups.filter(g => g.openItem !== null);
  // Sessions that are fully resolved
  const resolvedGroups = groups.filter(g => g.openItem === null);
  // Badge = count of open items (one per open session)
  const openCount = openGroups.length;

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
        .open-count {
          font-size: 0.75rem; font-weight: 600;
          background: #3b82f6; color: #fff;
          border-radius: 999px; padding: 0.1rem 0.5rem;
          min-width: 1.4rem; text-align: center;
        }
        .header-actions { display: flex; align-items: center; gap: 0.4rem; }

        /* ---- Session card ---- */
        .session-card {
          margin-bottom: 1rem;
          border: 1px solid #222;
          border-radius: 12px;
          overflow: hidden;
          background: #141414;
        }

        /* Card header */
        .card-header {
          display: flex; align-items: flex-start; justify-content: space-between;
          gap: 0.5rem;
          padding: 0.75rem 0.9rem 0.6rem;
          border-bottom: 1px solid #1e1e1e;
          background: #111;
        }
        .card-header-left {
          display: flex; align-items: center; gap: 0.45rem;
          min-width: 0; flex: 1;
        }
        .card-header-right {
          display: flex; align-items: center; gap: 0.4rem;
          flex-shrink: 0;
        }
        .session-id-chip {
          font-size: 0.65rem; font-family: 'SF Mono', 'Cascadia Code', monospace;
          color: #444; letter-spacing: 0.04em; flex-shrink: 0;
        }
        .session-title {
          font-size: 0.88rem; font-weight: 600; color: #ccc;
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .item-time {
          font-size: 0.68rem; color: #444; white-space: nowrap;
        }

        /* Kind badges */
        .kind-badge {
          font-size: 0.62rem; font-weight: 700; text-transform: uppercase;
          letter-spacing: 0.04em; border-radius: 4px; padding: 0.15rem 0.45rem;
          white-space: nowrap;
        }
        .kind-permission { background: #2d1b00; color: #fb923c; }
        .kind-question   { background: #1a2640; color: #60a5fa; }
        .kind-done       { background: #0f2d1a; color: #4ade80; }

        /* ---- Card body ---- */
        .card-body {
          padding: 0.85rem 0.9rem 0.95rem;
        }

        /* Tool display */
        .tool-row {
          display: flex; align-items: baseline; gap: 0.5rem; margin-bottom: 0.4rem;
        }
        .tool-label {
          font-size: 0.68rem; color: #555; text-transform: uppercase;
          letter-spacing: 0.04em; flex-shrink: 0;
        }
        .tool-name {
          font-family: 'SF Mono', 'Cascadia Code', monospace; font-size: 0.85rem; color: #fb923c;
        }

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
        .cwd-label {
          font-size: 0.65rem; color: #444; text-transform: uppercase;
          letter-spacing: 0.04em; flex-shrink: 0;
        }
        .cwd-value {
          font-family: 'SF Mono', 'Cascadia Code', monospace; font-size: 0.7rem;
          color: #555; word-break: break-all;
        }

        /* Message text (question/done/permission fallback) */
        .message-text {
          font-size: 0.9rem; color: #d4d4d4; line-height: 1.6;
          margin-bottom: 0.75rem; white-space: pre-wrap;
        }

        /* Answer-window hint */
        .answer-window-row { margin-bottom: 0.5rem; }
        .answer-hint { font-size: 0.7rem; color: #555; }
        .answer-hint-urgent { color: #f59e0b; font-weight: 600; }

        /* Mirror notice (notifier-sourced permission items — desktop only) */
        .mirror-notice {
          display: flex; align-items: center; gap: 0.4rem;
          margin-top: 0.75rem; padding: 0.45rem 0.6rem;
          background: #141414; border: 1px solid #1e1e1e;
          border-radius: 6px;
        }
        .mirror-icon { font-size: 0.85rem; opacity: 0.45; }
        .mirror-text { font-size: 0.75rem; color: #444; font-style: italic; }

        /* Actions */
        .action-row { display: flex; gap: 0.6rem; margin-top: 0.75rem; }
        .reply-row  { display: flex; flex-direction: column; gap: 0.5rem; }

        .btn {
          border: none; border-radius: 8px; font-size: 0.92rem; font-weight: 600;
          cursor: pointer; padding: 0.65rem 1.1rem; transition: opacity 0.12s;
          flex-shrink: 0;
        }
        .btn:disabled { opacity: 0.4; cursor: not-allowed; }
        .btn-allow { background: #16a34a; color: #fff; flex: 1; }
        .btn-allow:not(:disabled):hover { background: #15803d; }
        .btn-deny  { background: #dc2626; color: #fff; flex: 1; }
        .btn-deny:not(:disabled):hover  { background: #b91c1c; }
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

        /* ---- History expander ---- */
        .history-expander {
          border-top: 1px solid #1a1a1a;
        }
        .history-toggle-btn {
          width: 100%;
          display: flex; align-items: center; justify-content: space-between;
          padding: 0.5rem 0.9rem;
          background: none; border: none; cursor: pointer;
          font-size: 0.72rem; color: #444;
          transition: color 0.1s;
        }
        .history-toggle-btn:hover { color: #666; }
        .history-chevron { font-size: 0.58rem; color: #333; }

        .history-list { border-top: 1px solid #181818; }

        .history-row {
          padding: 0.5rem 0.9rem;
          border-top: 1px solid #181818;
          cursor: pointer; transition: background 0.1s;
        }
        .history-row:first-child { border-top: none; }
        .history-row:hover { background: #181818; }

        .history-row-header {
          display: flex; align-items: center; gap: 0.5rem;
        }
        .history-preview {
          font-size: 0.73rem; color: #444;
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; min-width: 0;
        }
        .history-status-chip {
          font-size: 0.62rem; color: #3a3a3a;
          background: #181818; border-radius: 3px; padding: 0.1rem 0.35rem;
          white-space: nowrap;
        }
        .history-time { font-size: 0.62rem; color: #333; white-space: nowrap; }
        .history-row-chevron { font-size: 0.55rem; color: #333; flex-shrink: 0; }

        .history-row-detail { padding: 0.4rem 0 0.2rem; }
        .kind-badge-sm {
          display: inline-block;
          font-size: 0.62rem; font-weight: 700; text-transform: uppercase;
          letter-spacing: 0.04em; border-radius: 3px; padding: 0.1rem 0.35rem;
          color: #555; background: #1a1a1a; margin-bottom: 0.3rem;
        }
        .history-answer { font-size: 0.75rem; color: #4a4a4a; }
        .history-answer-label { color: #3a3a3a; font-weight: 600; }

        /* ---- Resolved footer ---- */
        .resolved-footer {
          text-align: center;
          padding: 0.75rem 0 0.25rem;
          font-size: 0.72rem; color: #2e2e2e;
        }

        /* ---- Empty state ---- */
        .empty {
          text-align: center; padding: 4rem 1rem;
          display: flex; flex-direction: column; align-items: center; gap: 0.75rem;
        }
        .empty-icon  { font-size: 2rem; opacity: 0.3; }
        .empty-title { font-size: 1rem; font-weight: 600; color: #555; }
        .empty-sub   { font-size: 0.8rem; color: #3a3a3a; }

        /* ---- Loading ---- */
        .loading { text-align: center; padding: 4rem 1rem; color: #333; font-size: 0.85rem; }

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
        }
        .toast-ok  { background: #16a34a; color: #fff; }
        .toast-err { background: #dc2626; color: #fff; }

        /* ---- Scrollbar ---- */
        .input-block::-webkit-scrollbar { width: 4px; }
        .input-block::-webkit-scrollbar-track { background: transparent; }
        .input-block::-webkit-scrollbar-thumb { background: #2a2a2a; border-radius: 2px; }

        /* ---- Away badge (task 430) ---- */
        .away-badge {
          display: block; width: 100%;
          font-size: 0.75rem; font-weight: 500;
          border-radius: 6px; padding: 0.35rem 0.7rem;
          margin-bottom: 0.6rem;
          border: 1px solid transparent;
          cursor: default;
          text-align: center;
          transition: background 0.15s, border-color 0.15s;
        }
        .away-badge:not(:disabled) { cursor: pointer; }
        .away-badge-away {
          background: #1a1a00; border-color: #4a3800; color: #fbbf24;
        }
        .away-badge-away:not(:disabled):active { background: #252500; }
        .away-badge-here {
          background: #0a1a0a; border-color: #1a3a1a; color: #4ade80;
        }
        .away-badge-here:not(:disabled):active { background: #0f200f; }
        .away-badge-pending {
          background: #141414; border-color: #2a2a2a; color: #888;
        }
        .away-badge-unreachable {
          background: #1a0a0a; border-color: #3a1a1a; color: #f87171;
        }
      `}</style>

      <div className="page">
        <header className="header">
          <span className="header-title">Agent Queue</span>
          <div className="header-right">
            <div className="header-actions">
              <NotificationsButton onToast={showToast} />
            </div>
            {openCount > 0 && (
              <span className="open-count">{openCount}</span>
            )}
          </div>
        </header>

        {/* Away badge — full-width tap target below header (task 430) */}
        <AwayBadge
          awayState={awayState}
          toggling={toggling}
          onToggle={handleToggleAway}
        />

        {error && (
          <div className="error-banner">
            <span>{error}</span>
            <button className="error-retry" onClick={fetchItems}>Retry</button>
          </div>
        )}

        {loading && <div className="loading">Loading…</div>}

        {!loading && openGroups.length === 0 && !error && (
          <div className="empty">
            <div className="empty-icon">✓</div>
            <div className="empty-title">Nothing waiting</div>
            <div className="empty-sub">Agents are running unattended</div>
          </div>
        )}

        {!loading && openGroups.map(group => (
          <SessionCard
            key={group.thread_id}
            group={group}
            onPermissionAnswer={handlePermissionAnswer}
            onQuestionAnswer={handleQuestionAnswer}
            answering={answering}
          />
        ))}

        {!loading && resolvedGroups.length > 0 && (
          <div className="resolved-footer">
            {resolvedGroups.length} resolved {resolvedGroups.length === 1 ? 'thread' : 'threads'} hidden
          </div>
        )}
      </div>

      {toast && (
        <div className={`toast ${toast.ok ? 'toast-ok' : 'toast-err'}`}>
          {toast.msg}
        </div>
      )}
    </>
  );
}
