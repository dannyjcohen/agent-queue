export default function Home() {
  return (
    <main style={{ fontFamily: 'monospace', padding: '2rem' }}>
      <h1>Agent Queue</h1>
      <p>Inbound event bus for the agent system.</p>
      <ul>
        <li>POST /api/queue — enqueue an item</li>
        <li>GET /api/queue/pending — fetch pending items</li>
        <li>PATCH /api/queue/:id — update item status</li>
        <li>GET /api/health — health check</li>
      </ul>
    </main>
  );
}
