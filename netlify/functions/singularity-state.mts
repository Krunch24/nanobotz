import { createHash, randomBytes } from 'node:crypto';
import { getDatabase } from '@netlify/database';
import type { Config } from '@netlify/functions';

export default async (request: Request) => {
  const headers = new Headers({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  const reply = (body: unknown, status = 200) => Response.json(body, { status, headers });
  if (!['GET', 'PUT'].includes(request.method)) return reply({ error: 'Method not allowed.' }, 405);
  if (request.method === 'PUT' && request.headers.get('origin') !== new URL(request.url).origin) return reply({ error: 'Invalid request origin.' }, 403);
  let session = request.headers.get('cookie')?.split(';').map(c => c.trim()).find(c => c.startsWith('__Host-nano-learning='))?.split('=')[1];
  if (!session || !/^[a-f0-9]{64}$/.test(session)) {
    if (request.method === 'PUT') return reply({ error: 'Reload to connect learning storage.' }, 401);
    session = randomBytes(32).toString('hex');
    headers.set('Set-Cookie', `__Host-nano-learning=${session}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=31536000`);
  }
  const hash = createHash('sha256').update(session).digest('hex');
  try {
    const db = getDatabase();
    if (request.method === 'GET') {
      const rows = await db.sql`SELECT state FROM nano_singularity_state WHERE session_hash = ${hash}`;
      return reply({ state: rows[0]?.state ?? null });
    }
    if (!request.headers.get('content-type')?.startsWith('application/json')) return reply({ error: 'JSON required.' }, 415);
    const reader = request.body?.getReader();
    if (!reader) return reply({ error: 'State required.' }, 400);
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 160000) { await reader.cancel(); return reply({ error: 'State too large.' }, 413); }
      chunks.push(value);
    }
    let state;
    try { state = JSON.parse(Buffer.concat(chunks).toString('utf8')).state; } catch { return reply({ error: 'Invalid JSON.' }, 400); }
    if (!state || typeof state !== 'object' || !Array.isArray(state.knowledge) || state.knowledge.length > 200 || !Array.isArray(state.log) || state.log.length > 30 ||
      state.knowledge.some((k: any) => !k || !Number.isSafeInteger(k.id) || typeof k.text !== 'string' || k.text.length > 300 || typeof k.category !== 'string' || k.category.length > 40 || typeof k.timestamp !== 'string' || !['chat', 'study'].includes(k.source)) ||
      state.log.some((l: any) => !l || typeof l.text !== 'string' || l.text.length > 1000 || typeof l.time !== 'string') ||
      typeof state.topics !== 'string' || state.topics.length > 1000 || ![5, 15, 30, 60].includes(state.intervalMinutes) ||
      ['enabled', 'learnFromChat', 'useKnowledge', 'selfStudy'].some(k => typeof state[k] !== 'boolean') || !Number.isSafeInteger(state.exchanges) || state.exchanges < 0) return reply({ error: 'Invalid learning state.' }, 400);
    await db.sql`INSERT INTO nano_singularity_state (session_hash, state) VALUES (${hash}, ${JSON.stringify(state)}::jsonb)
      ON CONFLICT (session_hash) DO UPDATE SET state = EXCLUDED.state, updated_at = now()`;
    return reply({ saved: true });
  } catch {
    return reply({ error: 'Learning storage is unavailable. Please try again.' }, 503);
  }
};

export const config: Config = {
  path: '/api/singularity-state',
  rateLimit: { windowLimit: 60, windowSize: 60, aggregateBy: ['ip', 'domain'] },
};
