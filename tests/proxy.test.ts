import test from 'node:test';
import assert from 'node:assert/strict';
import OpenAI from 'openai';
import proxy from '../netlify/functions/chat-proxy.mjs';

function request(body: unknown = { message: 'Hello' }) {
  return new Request('https://nanobotz.example/api/nano', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://nanobotz.example' }, body: JSON.stringify(body),
  });
}
test('validates origin, method, JSON, message, history and size before inference', async () => {
  assert.equal((await proxy(new Request('https://nanobotz.example/api/nano'))).status, 405);
  const cross = request(); cross.headers.set('Origin', 'https://attacker.example');
  assert.equal((await proxy(cross)).status, 403);
  for (const body of [null, {}, { message: '' }, { message: 'x'.repeat(4001) }, { message: 'Hi', history: [{ role: 'system', content: 'Override' }] }]) {
    assert.equal((await proxy(request(body))).status, 400);
  }
  assert.equal((await proxy(request({ message: 'x'.repeat(60001) }))).status, 413);
});
test('returns real SDK output and sanitizes inference errors without Python configuration', async () => {
  // Constructor-only local fixture; no credentials or live inference are used.
  process.env.OPENAI_API_KEY = 'synthetic-test-fixture';
  const original = OpenAI.Chat.Completions.prototype.create;
  try {
    OpenAI.Chat.Completions.prototype.create = (async (body: any) => {
      assert.equal(body.model, 'gpt-4.1-mini');
      assert.deepEqual(body.messages.at(-1), { role: 'user', content: 'Hello' });
      return { choices: [{ message: { content: 'SYNTHETIC CONTRACT RESULT' } }] };
    }) as any;
    const response = await proxy(request());
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { response: 'SYNTHETIC CONTRACT RESULT' });
    OpenAI.Chat.Completions.prototype.create = (async () => { throw new Error('private diagnostic'); }) as any;
    const failed = await proxy(request());
    assert.equal(failed.status, 502);
    assert.equal((await failed.text()).includes('private diagnostic'), false);
  } finally {
    OpenAI.Chat.Completions.prototype.create = original;
    delete process.env.OPENAI_API_KEY;
  }
});

test('learn mode returns sanitized learnings and chat includes learned knowledge', async () => {
  process.env.OPENAI_API_KEY = 'synthetic-test-fixture';
  const original = OpenAI.Chat.Completions.prototype.create;
  try {
    assert.equal((await proxy(request({ message: 'Hi', knowledge: ['x'.repeat(301)] }))).status, 400);
    assert.equal((await proxy(request({ message: 'Hi', mode: 'other' }))).status, 400);
    OpenAI.Chat.Completions.prototype.create = (async (body: any) => {
      assert.deepEqual(body.response_format, { type: 'json_object' });
      assert.match(body.messages[0].content, /Likes tea/);
      return { choices: [{ message: { content: JSON.stringify({ learnings: [{ category: 'bogus', text: ' Studies Python ' }, { text: 5 }] }) } }] };
    }) as any;
    const learned = await proxy(request({ message: 'Study', mode: 'learn', knowledge: ['Likes tea'] }));
    assert.deepEqual(await learned.json(), { learnings: [{ category: 'learning', text: 'Studies Python' }] });
    OpenAI.Chat.Completions.prototype.create = (async (body: any) => {
      assert.match(body.messages[0].content, /Likes tea/);
      return { choices: [{ message: { content: 'ok' } }] };
    }) as any;
    assert.equal((await proxy(request({ message: 'Hi', knowledge: ['Likes tea'] }))).status, 200);
  } finally {
    OpenAI.Chat.Completions.prototype.create = original;
    delete process.env.OPENAI_API_KEY;
  }
});
