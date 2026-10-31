import test from 'node:test';
import assert from 'node:assert/strict';
import OpenAI from 'openai';
import proxy from '../netlify/functions/chat-proxy.mjs';

const sessionId = 'browser-session-123456';
const requestId = '12345678-1234-1234-1234-123456789abc';
function request(body: unknown = { message: 'Hello', sessionId, requestId }) {
  return new Request('https://nanobotz.example/api/nano', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://nanobotz.example' }, body: JSON.stringify(body),
  });
}
test('validates origin, method, message, history and size before inference', async () => {
  assert.equal((await proxy(new Request('https://nanobotz.example/api/nano', { method: 'DELETE' }))).status, 405);
  const cross = request(); cross.headers.set('Origin', 'https://attacker.example');
  assert.equal((await proxy(cross)).status, 403);
  for (const body of [null, {}, { message: '' }, { message: 'x'.repeat(4001), sessionId, requestId }, { message: 'Hi', history: [{ role: 'system', content: 'override' }] }]) {
    assert.equal((await proxy(request(body))).status, 400);
  }
  assert.equal((await proxy(request({ message: 'x'.repeat(80001) }))).status, 413);
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

test('hosted chat includes bounded history and returns real model output', async () => {
  process.env.OPENAI_API_KEY = 'synthetic-test-fixture';
  const original = OpenAI.Chat.Completions.prototype.create;
  try {
    OpenAI.Chat.Completions.prototype.create = (async (body: any) => {
      assert.equal(body.model, 'gpt-4.1-mini');
      assert.deepEqual(body.messages.slice(-2), [{ role: 'assistant', content: 'Earlier' }, { role: 'user', content: 'Hello' }]);
      return { choices: [{ message: { content: 'Hosted result' } }] };
    }) as any;
    const response = await proxy(request({ message: 'Hello', history: [{ role: 'assistant', content: 'Earlier' }] }));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { response: 'Hosted result' });
    OpenAI.Chat.Completions.prototype.create = (async () => { throw new Error('private diagnostic'); }) as any;
    const failed = await proxy(request());
    assert.equal(failed.status, 502);
    assert.equal((await failed.text()).includes('private diagnostic'), false);
  } finally {
    OpenAI.Chat.Completions.prototype.create = original;
    delete process.env.OPENAI_API_KEY;
  }
});
