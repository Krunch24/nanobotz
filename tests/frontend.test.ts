import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';

function setup(fetch: typeof globalThis.fetch) {
  const elements: Record<string, any> = {};
  const nodes = (id: string) => elements[id] ||= { textContent: '', disabled: false, value: '',
    classList: { add() {}, remove() {} }, setAttribute() {}, focus() {} };
  const messages: { role: string; text: string }[] = [];
  const context = vm.createContext({ crypto: webcrypto, localStorage: { getItem() {}, setItem() {} },
    document: { getElementById: nodes, addEventListener() {} }, fetch, AbortSignal, URLSearchParams,
    setTimeout: (fn: () => void) => setTimeout(fn, 0), clearTimeout, setInterval() {},
    appendChatMessage: (role: string, text: string) => messages.push({ role, text }),
    appendLoadingIndicator: () => 'loader', removeMessage() {}, appState: { autoMemory: false }, saveLocalState() {},
  });
  vm.runInContext(readFileSync('public/chat.js', 'utf8'), context);
  return { context, nodes, messages };
}

test('chat submits once and displays only actual returned text', async () => {
  let submissions = 0;
  const setupResult = setup(async (_input, init) => {
    assert.equal(init?.method, 'POST');
    submissions++;
    return Response.json({ response: 'SYNTHETIC UI CONTRACT RESULT' });
  });
  setupResult.nodes('chat-input').value = 'test input';
  await Promise.all([vm.runInContext('handleChatSubmit()', setupResult.context), vm.runInContext('handleChatSubmit()', setupResult.context)]);
  assert.equal(submissions, 1);
  assert.deepEqual(setupResult.messages.map(m => m.role), ['user', 'nano']);
  assert.equal(setupResult.messages[1].text, 'SYNTHETIC UI CONTRACT RESULT');
  assert.equal(setupResult.nodes('send-btn').disabled, false);
});
test('network failure is an error banner and restores controls without a fabricated reply', async () => {
  const result = setup(async () => { throw new Error('network failure'); });
  result.nodes('chat-input').value = 'test input';
  await vm.runInContext('handleChatSubmit()', result.context);
  assert.equal(result.messages.length, 1);
  assert.match(result.nodes('chat-error').textContent, /unreachable|timed out/);
  assert.equal(result.nodes('send-btn').disabled, false);
  assert.equal(result.nodes('chat-input').value, 'test input');
});
test('page has unique IDs and scripts parse', () => {
  const html = readFileSync('public/index.html', 'utf8');
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal((html.match(/id="chat-form"/g) || []).length, 1);
  assert.ok(html.includes('!event.isComposing'));
  assert.ok(html.includes('!event.shiftKey'));
  assert.equal(html.includes('generativelanguage.googleapis.com'), false);
  for (const script of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) new vm.Script(script[1]);
});


test('empty responses restore controls without a fabricated reply', async () => {
  const result = setup(async () => Response.json({ response: '' }));
  result.nodes('chat-input').value = 'test input';
  await vm.runInContext('handleChatSubmit()', result.context);
  assert.match(result.nodes('chat-error').textContent, /empty response/);
  assert.equal(result.nodes('send-btn').disabled, false);
  assert.equal(result.messages.length, 1);
});

test('chat sends recent context without a Python session or polling', async () => {
  const result = setup(async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    assert.deepEqual(body, { message: 'next', history: [{ role: 'assistant', content: 'Earlier reply' }] });
    return Response.json({ response: 'Next reply' });
  });
  result.context.appState.chatHistory = [{ sender: 'nano', text: 'Earlier reply' }];
  assert.equal(await vm.runInContext("requestNano('next')", result.context), 'Next reply');
});

test('chat includes learned context only when Singularity knowledge is enabled', async () => {
  const bodies: any[] = [];
  const result = setup(async (_url, init) => {
    bodies.push(JSON.parse(String(init?.body)));
    return Response.json({ response: 'Reply' });
  });
  result.context.appState.singularity = { enabled: true, useKnowledge: true, knowledge: [{ text: 'Prefers examples' }] };
  await vm.runInContext("requestNano('Hello')", result.context);
  assert.deepEqual(bodies[0].knowledge, ['Prefers examples']);
  result.context.appState.singularity.enabled = false;
  await vm.runInContext("requestNano('Hello again')", result.context);
  assert.equal('knowledge' in bodies[1], false);
});

test('a learning cycle retains notes and pauses when Singularity is disabled', async () => {
  let calls = 0;
  const nodes: Record<string, any> = {};
  const context = vm.createContext({
    appState: {}, document: { getElementById: (id: string) => nodes[id] ||= { textContent: '', classList: { toggle() {} }, setAttribute() {} }, querySelectorAll: () => [] },
    saveLocalState() {}, singularityKnowledge: () => [], escapeHtml: (s: string) => s,
    nanoFetch: async () => { calls++; return { learnings: [{ category: 'topic', text: 'One useful note' }] }; },
    clearInterval() {}, setInterval() {},
  });
  vm.runInContext(readFileSync('public/singularity.js', 'utf8'), context);
  await vm.runInContext("runLearningCycle('study')", context);
  assert.equal(calls, 0);
  vm.runInContext('singularityStorageReady = true; sing().enabled = true', context);
  await vm.runInContext("runLearningCycle('study')", context);
  assert.equal(calls, 1);
  assert.equal(context.appState.singularity.knowledge[0].text, 'One useful note');
  assert.equal(context.appState.singularity.log.length, 1);
});
