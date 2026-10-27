import OpenAI from 'openai';
import type { Config } from '@netlify/functions';

export default async (request: Request) => {
  const reply = (body: unknown, status = 200) => Response.json(body, {
    status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
  });
  if (request.method !== 'POST') return reply({ error: 'Method not allowed.' }, 405);
  if (request.headers.get('origin') !== new URL(request.url).origin) return reply({ error: 'Invalid request origin.' }, 403);
  if (!request.headers.get('content-type')?.startsWith('application/json')) return reply({ error: 'JSON required.' }, 415);
  let payload;
  try {
    const reader = request.body?.getReader();
    if (!reader) return reply({ error: 'Message required.' }, 400);
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 60000) { await reader.cancel(); return reply({ error: 'Message too large.' }, 413); }
      chunks.push(value);
    }
    payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch { return reply({ error: 'Invalid JSON.' }, 400); }
  if (!payload || typeof payload.message !== 'string' || !payload.message.trim() || payload.message.length > 4000) {
    return reply({ error: 'Provide a message of 1–4000 characters.' }, 400);
  }
  const history = payload.history ?? [];
  if (!Array.isArray(history) || history.length > 12 || history.some(item =>
    !item || !['user', 'assistant'].includes(item.role) || typeof item.content !== 'string' || item.content.length > 4000)) {
    return reply({ error: 'Invalid conversation history.' }, 400);
  }
  try {
    const ai = new OpenAI({ timeout: 45000, maxRetries: 0 });
    const result = await ai.chat.completions.create({
      model: 'gpt-4.1-mini',
      max_tokens: 1200,
      messages: [
        { role: 'system', content: 'You are Nano, a warm and thoughtful assistant for NanoBotz. Provide empathetic support and practical, structured guidance. Help users reflect on goals and recent conversation when asked. You run through Netlify AI Gateway. You do not have access to an original Python controller, autonomous growth engine, or private memories. Never claim to have saved information or performed background actions. Only use the conversation provided.' },
        ...history.map((item: { role: 'user' | 'assistant'; content: string }) => ({ role: item.role, content: item.content })),
        { role: 'user', content: payload.message.trim() },
      ],
    });
    const response = result.choices[0]?.message.content?.trim();
    if (!response) return reply({ error: 'Nano returned an empty response. Please try again.' }, 502);
    return reply({ response });
  } catch (error) {
    if (error instanceof OpenAI.APIError && error.status === 429) {
      return reply({ error: 'Nano is busy. Please wait a minute before trying again.' }, 429);
    }
    return reply({ error: 'Nano could not respond right now. Please try again shortly.' }, 502);
  }
};

export const config: Config = {
  path: '/api/nano',
  rateLimit: { windowLimit: 10, windowSize: 60, aggregateBy: ['ip', 'domain'] },
};
