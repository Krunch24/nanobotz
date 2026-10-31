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
    document: { getElementById: nodes, addEventListener() {} }, fetch, AbortSignal, URLSearchParams, Date,
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
    return Response.json({ status: 'completed', response: 'SYNTHETIC UI CONTRACT RESULT' });
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
  const result = setup(async () => Response.json({ status: 'completed', response: '' }));
  result.nodes('chat-input').value = 'test input';
  await vm.runInContext('handleChatSubmit()', result.context);
  assert.match(result.nodes('chat-error').textContent, /empty response/);
  assert.equal(result.nodes('send-btn').disabled, false);
  assert.equal(result.messages.length, 1);
});

test('hosted chat sends recent conversation once without repeating the current message', async () => {
  const result = setup(async (url, init) => {
    assert.equal(url, '/api/nano');
    const body = JSON.parse(String(init?.body));
    assert.deepEqual(body.history, [{ role: 'assistant', content: 'Earlier reply' }]);
    assert.equal(body.message, 'next');
    assert.equal(body.sessionId, undefined);
    return Response.json({ response: 'Hosted reply' });
  });
  result.context.appState.chatHistory = [{ sender: 'nano', text: 'Earlier reply' }, { sender: 'user', text: 'next' }];
  assert.equal(await vm.runInContext("requestNano('next')", result.context), 'Hosted reply');
});

test('singularity mode sends learned knowledge with chat', async () => {
  const result = setup(async (_url, init) => {
    assert.deepEqual(JSON.parse(String(init?.body)).knowledge, ['Likes tea']);
    return Response.json({ response: 'ok' });
  });
  result.context.appState.chatHistory = [];
  result.context.appState.singularity = { enabled: true, useKnowledge: true, knowledge: [{ text: 'Likes tea' }] };
  assert.equal(await vm.runInContext("requestNano('hi')", result.context), 'ok');
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

function learningSetup(fetch: typeof globalThis.fetch) {
  const nodes: Record<string, any> = {};
  const actions = [{ disabled: false }, { disabled: false }];
  const context = vm.createContext({
    appState: { chatHistory: [] }, AbortSignal, fetch,
    document: { addEventListener() {}, getElementById: (id: string) => nodes[id] ||= {
      textContent: '', value: '', classList: { toggle() {} }, setAttribute() {},
    }, querySelectorAll: () => actions },
    saveLocalState() {}, escapeHtml: (s: string) => s,
    clearInterval() {}, setInterval() {},
  });
  vm.runInContext(readFileSync('public/chat.js', 'utf8'), context);
  vm.runInContext(readFileSync('public/singularity.js', 'utf8'), context);
  return { context, nodes, actions };
}

test('activation loads storage, studies through the HTTP endpoint, and saves notes before reporting success', async () => {
  const calls: string[] = [];
  let saved: any;
  const result = learningSetup(async (url, init) => {
    calls.push(`${init?.method || 'GET'} ${url}`);
    if (url === '/api/nano') {
      const body = JSON.parse(String(init?.body));
      assert.equal(body.mode, 'learn');
      assert.deepEqual(body.history, []);
      return Response.json({ learnings: [{ category: 'topic', text: 'One useful note' }] });
    }
    if (init?.method === 'PUT') {
      saved = JSON.parse(String(init.body)).state;
      assert.doesNotMatch(result.nodes['sing-status'].textContent, /^Learned/);
      return Response.json({ saved: true });
    }
    return Response.json({ state: null });
  });
  await vm.runInContext('toggleSingularity()', result.context);
  assert.deepEqual(calls, ['GET /api/singularity-state', 'POST /api/nano', 'PUT /api/singularity-state']);
  assert.equal(saved.knowledge[0].text, 'One useful note');
  assert.equal(saved.knowledge[0].source, 'study');
  assert.match(result.nodes['sing-status'].textContent, /^Learned 1/);
  assert.ok(result.actions.every(b => !b.disabled));
  const reloaded = learningSetup(async () => Response.json({ state: saved }));
  await vm.runInContext('loadSingularityState();', reloaded.context);
  assert.equal(reloaded.context.appState.singularity.knowledge[0].text, 'One useful note');
  assert.equal(reloaded.context.appState.singularity.enabled, true);
});

test('activation retries storage after a failed initial load', async () => {
  let reads = 0;
  const result = learningSetup(async (url) => {
    if (url === '/api/singularity-state') {
      reads++;
      return reads === 1 ? Response.json({}, { status: 503 }) : Response.json({ state: null });
    }
    return Response.json({ learnings: [] });
  });
  await vm.runInContext('loadSingularityState()', result.context);
  assert.match(result.nodes['sing-status'].textContent, /unavailable/);
  vm.runInContext('sing().selfStudy = false', result.context);
  await vm.runInContext('toggleSingularity()', result.context);
  assert.equal(reads, 2);
  assert.equal(result.context.appState.singularity.enabled, true);
});

test('failed persistence retains notes, reports failure and permits the next cycle', async () => {
  let writes = 0;
  const result = learningSetup(async (url, init) => {
    if (url === '/api/nano') return Response.json({ learnings: [{ category: 'topic', text: 'A note' }] });
    if (init?.method === 'PUT') {
      writes++;
      return Response.json({}, { status: writes === 1 ? 503 : 200 });
    }
    return Response.json({ state: null });
  });
  await vm.runInContext('toggleSingularity()', result.context);
  assert.match(result.nodes['sing-status'].textContent, /could not be saved/);
  assert.equal(result.context.appState.singularity.knowledge.length, 1);
  assert.ok(result.actions.every(b => !b.disabled));
  await vm.runInContext("runLearningCycle('study')", result.context);
  assert.equal(writes, 2);
  assert.equal(result.context.appState.singularity.knowledge.length, 1);
  assert.match(result.nodes['sing-status'].textContent, /Nothing new/);
});

test('learning explains missing deployments and does not fabricate notes', async () => {
  const result = learningSetup(async url => url === '/api/nano'
    ? new Response('Not found', { status: 404 }) : Response.json({ state: null }));
  await vm.runInContext('toggleSingularity()', result.context);
  assert.match(result.nodes['sing-status'].textContent, /missing from this deployment/);
  assert.equal(result.context.appState.singularity.knowledge.length, 0);
  assert.ok(result.actions.every(b => !b.disabled));
});

test('conversation learning runs every second exchange and stops when paused', async () => {
  let inferences = 0;
  const result = learningSetup(async (url, init) => {
    if (url === '/api/nano') {
      inferences++;
      const body = JSON.parse(String(init?.body));
      assert.deepEqual(body.history, [{ role: 'user', content: 'My goal is better sleep' }]);
      return Response.json({ learnings: [{ category: 'goal', text: 'Wants better sleep' }] });
    }
    return Response.json({ state: null });
  });
  vm.runInContext('sing().selfStudy = false', result.context);
  await vm.runInContext('toggleSingularity()', result.context);
  result.context.appState.chatHistory.push({ sender: 'user', text: 'My goal is better sleep' });
  await vm.runInContext('onNanoExchange()', result.context);
  assert.equal(inferences, 0);
  await vm.runInContext('onNanoExchange()', result.context);
  assert.equal(inferences, 1);
  await vm.runInContext('toggleSingularity(); onNanoExchange(); onNanoExchange()', result.context);
  assert.equal(inferences, 1);
});
