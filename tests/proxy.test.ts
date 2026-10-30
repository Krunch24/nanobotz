import test from 'node:test';
import assert from 'node:assert/strict';
import proxy from '../netlify/functions/chat-proxy.mjs';

const sessionId = 'browser-session-123456';
const requestId = '12345678-1234-1234-1234-123456789abc';
function request(body: unknown = { message: 'Hello', sessionId, requestId }) {
  return new Request('https://nanobotz.example/api/nano', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://nanobotz.example' }, body: JSON.stringify(body),
  });
}
test('validates origin, method, message, session and size before forwarding', async () => {
  assert.equal((await proxy(new Request('https://nanobotz.example/api/nano', { method: 'DELETE' }))).status, 405);
  const cross = request(); cross.headers.set('Origin', 'https://attacker.example');
  assert.equal((await proxy(cross)).status, 403);
  for (const body of [null, {}, { message: '' }, { message: 'x'.repeat(4001), sessionId, requestId }, { message: 'Hi', sessionId: '../bad', requestId }]) {
    assert.equal((await proxy(request(body))).status, 400);
  }
  assert.equal((await proxy(request({ message: 'x'.repeat(20001) }))).status, 413);
});
test('forwards jobs to Python, scopes sessions, polls and sanitizes failures', async () => {
  const previous = globalThis.fetch;
  const runtime = globalThis as any;
  const previousNetlify = runtime.Netlify;
  // Ephemeral fixture values, never live credentials.
  const values: Record<string, string> = { NANO_API_URL: 'https://python.example', NANO_API_KEY: 'x'.repeat(32), NANO_SESSION_SECRET: 'y'.repeat(32) };
  runtime.Netlify = { env: { get: (name: string) => values[name] } };
  let scopedSession = '';
  try {
    globalThis.fetch = async (input, init) => {
      assert.equal(String(input), 'https://python.example/api/chat');
      const body = JSON.parse(String(init?.body));
      assert.equal(body.message, 'Hello');
      assert.equal(body.requestId, requestId);
      assert.match(body.sessionId, /^[a-f0-9]{64}$/);
      assert.notEqual(body.sessionId, sessionId);
      scopedSession = body.sessionId;
      assert.equal((init?.headers as any).Authorization, 'Bearer ' + values.NANO_API_KEY);
      return Response.json({ jobId: requestId, status: 'queued' }, { status: 202 });
    };
    assert.equal((await proxy(request())).status, 202);
    globalThis.fetch = async input => {
      const url = new URL(String(input));
      assert.equal(url.pathname, '/api/chat/status');
      assert.equal(url.searchParams.get('sessionId'), scopedSession);
      return Response.json({ jobId: requestId, status: 'completed', response: 'Python result' });
    };
    const result = await proxy(new Request(`https://nanobotz.example/api/nano?sessionId=${sessionId}&jobId=${requestId}`));
    assert.equal((await result.json()).response, 'Python result');
    globalThis.fetch = async () => { throw new Error('private diagnostic'); };
    const failed = await proxy(request());
    assert.equal(failed.status, 502);
    assert.equal((await failed.text()).includes('private diagnostic'), false);
    delete values.NANO_API_URL;
    assert.equal((await proxy(request())).status, 503);
  } finally {
    globalThis.fetch = previous;
    runtime.Netlify = previousNetlify;
  }
});

test('learning uses bounded knowledge context and validates structured notes', async () => {
  process.env.OPENAI_API_KEY = 'synthetic-test-fixture';
  const original = OpenAI.Chat.Completions.prototype.create;
  try {
    for (const body of [{ message: 'Hi', knowledge: ['x'.repeat(301)] }, { message: 'Hi', mode: 'unknown' }]) {
      assert.equal((await proxy(request(body))).status, 400);
    }
    OpenAI.Chat.Completions.prototype.create = (async (body: any) => {
      assert.equal(body.response_format.type, 'json_object');
      assert.ok(body.messages.some((m: any) => m.content.includes('Prefers short answers')));
      return { choices: [{ message: { content: JSON.stringify({ learnings: [{ category: 'preference', text: 'Likes examples' }, { category: 'bad', text: null }] }) } }] };
    }) as any;
    const response = await proxy(request({ mode: 'learn', message: 'Learn from chat', knowledge: ['Prefers short answers'] }));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { learnings: [{ category: 'preference', text: 'Likes examples' }] });
    OpenAI.Chat.Completions.prototype.create = (async () => ({ choices: [{ message: { content: 'invalid JSON' } }] })) as any;
    assert.equal((await proxy(request({ mode: 'learn', message: 'Study' }))).status, 502);
  } finally {
    OpenAI.Chat.Completions.prototype.create = original;
    delete process.env.OPENAI_API_KEY;
  }
});
