import { createHmac } from 'node:crypto';
import type { Config, Context } from '@netlify/functions';

declare const Netlify: { env: { get(name: string): string | undefined } };

export default async (request: Request, context?: Context) => {
  const reply = (body: unknown, status = 200) => Response.json(body, {
    status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
  });
  if (!['GET', 'POST'].includes(request.method)) return reply({ error: 'Method not allowed.' }, 405);
  const url = new URL(request.url);
  if (request.method === 'POST' && request.headers.get('origin') !== url.origin) return reply({ error: 'Invalid request origin.' }, 403);
  let payload;
  if (request.method === 'POST') {
    if (!request.headers.get('content-type')?.startsWith('application/json')) return reply({ error: 'JSON required.' }, 415);
    try {
      const reader = request.body?.getReader();
      if (!reader) return reply({ error: 'Message required.' }, 400);
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 20000) { await reader.cancel(); return reply({ error: 'Message too large.' }, 413); }
        chunks.push(value);
      }
      payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch { return reply({ error: 'Invalid JSON.' }, 400); }
    if (!payload || typeof payload.message !== 'string' || !payload.message.trim() || payload.message.length > 4000 ||
        !/^[a-f0-9-]{36}$/.test(payload.requestId ?? '')) return reply({ error: 'Invalid message or request ID.' }, 400);
  }
  const session = request.method === 'POST' ? payload.sessionId : url.searchParams.get('sessionId');
  const job = url.searchParams.get('jobId');
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(session ?? '') ||
      (request.method === 'GET' && !/^[a-f0-9-]{36}$/.test(job ?? ''))) return reply({ error: 'Invalid session or job ID.' }, 400);
  const base = Netlify.env.get('NANO_API_URL');
  const key = Netlify.env.get('NANO_API_KEY');
  const secret = Netlify.env.get('NANO_SESSION_SECRET');
  if (!base || !key || key.length < 32 || !secret || secret.length < 32) {
    return reply({ error: 'Python/Llama backend connection is not configured. Set the server connection in Netlify.' }, 503);
  }
  try {
    const target = new URL(base);
    if (target.protocol !== 'https:' || target.username || target.password || target.search || target.hash) throw new Error();
    const hash = (value: string) => createHmac('sha256', secret).update(value).digest('hex');
    const sessionId = hash('session:' + session);
    target.pathname = target.pathname.replace(/\/$/, '') + (request.method === 'POST' ? '/api/chat' : '/api/chat/status');
    if (request.method === 'GET') target.search = new URLSearchParams({ sessionId, jobId: job! }).toString();
    const upstream = await fetch(target, {
      method: request.method, redirect: 'error', signal: AbortSignal.timeout(15000),
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json',
        'X-Nano-Client': hash('client:' + (context?.ip || 'unknown')) },
      ...(request.method === 'POST' ? { body: JSON.stringify({ message: payload.message.trim(), sessionId, requestId: payload.requestId }) } : {}),
    });
    if (!upstream.ok) return reply({ error: upstream.status === 429 ? 'Nano is busy. Please try again shortly.' : 'Python/Llama backend is unavailable. Check its connection and readiness.' }, upstream.status === 429 ? 429 : 502);
    const data = await upstream.json();
    if (!/^[a-f0-9-]{36}$/.test(data.jobId ?? '') || !['queued', 'running', 'completed', 'failed'].includes(data.status)) throw new Error();
    if (data.status === 'completed' && (typeof data.response !== 'string' || !data.response.trim() || data.response.length > 100000)) throw new Error();
    return reply({ jobId: data.jobId, status: data.status,
      ...(data.status === 'completed' ? { response: data.response } : {}),
      ...(data.status === 'failed' ? { error: 'Python/Llama generation failed. Please try again.' } : {}),
    }, request.method === 'POST' ? 202 : 200);
  } catch {
    return reply({ error: 'Python/Llama backend is unreachable or returned an invalid response.' }, 502);
  }
};

export const config: Config = {
  path: '/api/nano',
  rateLimit: { windowLimit: 180, windowSize: 60, aggregateBy: ['ip', 'domain'] },
};
