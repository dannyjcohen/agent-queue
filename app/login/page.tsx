'use client';

import { useState, FormEvent } from 'react';

export default function LoginPage() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        // Redirect to home after successful login
        window.location.href = '/';
      } else {
        const data = await res.json().catch(() => ({}));
        if (res.status === 429) {
          setError('Too many attempts. Wait a minute and try again.');
        } else {
          setError((data as { error?: string }).error ?? 'Login failed');
        }
      }
    } catch {
      setError('Network error. Try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <style>{`
        *, *::before, *::after { box-sizing: border-box; }
        body { margin: 0; background: #0f0f0f; color: #e5e5e5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif; }
        .container { display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 1.5rem; }
        .card { background: #1a1a1a; border: 1px solid #2a2a2a; border-radius: 12px; padding: 2rem; width: 100%; max-width: 360px; }
        h1 { margin: 0 0 0.25rem; font-size: 1.25rem; font-weight: 600; letter-spacing: -0.01em; }
        p.sub { margin: 0 0 1.75rem; font-size: 0.85rem; color: #888; }
        label { display: block; font-size: 0.8rem; font-weight: 500; color: #aaa; margin-bottom: 0.4rem; letter-spacing: 0.02em; text-transform: uppercase; }
        input[type="password"] {
          display: block; width: 100%; padding: 0.65rem 0.85rem;
          background: #111; border: 1px solid #333; border-radius: 7px;
          color: #e5e5e5; font-size: 1rem; outline: none; transition: border-color 0.15s;
        }
        input[type="password"]:focus { border-color: #555; }
        .error { margin-top: 0.75rem; padding: 0.6rem 0.8rem; background: #2a1515; border: 1px solid #4a2020; border-radius: 6px; color: #f87171; font-size: 0.85rem; }
        button {
          display: block; width: 100%; margin-top: 1.25rem;
          padding: 0.75rem; background: #e5e5e5; color: #0f0f0f;
          border: none; border-radius: 7px; font-size: 0.95rem; font-weight: 600;
          cursor: pointer; transition: background 0.15s;
        }
        button:hover { background: #fff; }
        button:disabled { background: #555; color: #888; cursor: not-allowed; }
      `}</style>
      <div className="container">
        <div className="card">
          <h1>Agent Queue</h1>
          <p className="sub">Sign in to continue</p>
          <form onSubmit={handleSubmit} autoComplete="off">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              autoFocus
              autoComplete="current-password"
              required
            />
            {error && <div className="error">{error}</div>}
            <button type="submit" disabled={loading || !password}>
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        </div>
      </div>
    </>
  );
}
