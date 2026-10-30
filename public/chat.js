/* Chat proxies to the existing Python controller and Llama backend. */
let nanoBusy = false;

function showChatError(message) {
    const error = document.getElementById('chat-error');
    error.textContent = message;
    error.classList.remove('hidden');
}

async function nanoFetch(query = '', body) {
    let response;
    try {
        response = await fetch('/api/nano' + query, {
            method: body ? 'POST' : 'GET', credentials: 'same-origin',
            headers: body ? { 'Content-Type': 'application/json' } : {},
            ...(body ? { body: JSON.stringify(body) } : {}),
            signal: AbortSignal.timeout(55000),
        });
    } catch {
        throw new Error('Nano server is unreachable or the request timed out. Check your connection and try again.');
    }
    let data;
    try { data = await response.json(); } catch {
        throw new Error('Nano returned an invalid server response. Contact the site owner.');
    }
    if (!response.ok) throw new Error(data.error || 'Nano is unavailable. Please try again shortly.');
    return data;
}

// Notes Nano learned in Singularity mode, sent as background context when enabled.
function singularityKnowledge(force = false) {
    const s = appState.singularity;
    if (!s || !s.enabled || (!s.useKnowledge && !force) || !Array.isArray(s.knowledge)) return [];
    return s.knowledge.slice(-40).map(item => String(item.text).slice(0, 300));
}

async function requestNano(message) {
    if (nanoBusy) throw new Error('Nano is already working on a message.');
    nanoBusy = true;
    const button = document.getElementById('send-btn');
    button.disabled = true;
    document.getElementById('chat-form').setAttribute('aria-busy', 'true');
    try {
        let sessionId;
        try { sessionId = localStorage.getItem('nano_python_session'); } catch {}
        if (!/^[A-Za-z0-9_-]{16,128}$/.test(sessionId || '')) {
            sessionId = crypto.randomUUID();
            try { localStorage.setItem('nano_python_session', sessionId); } catch {}
        }
        let data = await nanoFetch('', { message, sessionId, requestId: crypto.randomUUID() });
        const jobId = data.jobId;
        const deadline = Date.now() + 660000;
        while (data.status === 'queued' || data.status === 'running') {
            if (Date.now() >= deadline) throw new Error('Llama is still processing. Please wait before sending another message.');
            await new Promise(resolve => setTimeout(resolve, 2000));
            data = await nanoFetch('?' + new URLSearchParams({ sessionId, jobId }));
        }
        if (data.status === 'failed') throw new Error(data.error || 'Python/Llama generation failed.');
        if (data.status !== 'completed') throw new Error('Nano returned an invalid job status.');
        const history = (appState.chatHistory || []).slice(-13);
        // The submit handler already appended the current user message.
        if (history.at(-1)?.sender === 'user' && history.at(-1).text === message) history.pop();
        const knowledge = singularityKnowledge();
        const data = await nanoFetch('', {
            message,
            ...(knowledge.length ? { knowledge } : {}),
            history: history.slice(-12).map(item => ({
                role: item.sender === 'nano' ? 'assistant' : 'user',
                content: item.text.slice(0, 4000),
            })),
        });
        if (typeof data.response !== 'string' || !data.response.trim()) throw new Error('Nano returned an empty response.');
        return data.response;
    } finally {
        nanoBusy = false;
        button.disabled = false;
        document.getElementById('chat-form').setAttribute('aria-busy', 'false');
    }
}

async function handleChatSubmit(event) {
    if (event) event.preventDefault();
    if (nanoBusy) return;
    const input = document.getElementById('chat-input');
    const message = input.value.trim();
    if (!message) return;
    if (message.length > 4000) return showChatError('Please limit messages to 4000 characters.');
    document.getElementById('chat-error').classList.add('hidden');
    appendChatMessage('user', message);
    input.value = '';
    const loading = appendLoadingIndicator();
    try {
        const response = await requestNano(message);
        appendChatMessage('nano', response);
        if (appState.autoMemory && message.length > 20) autoExtractMemory(message, response);
        saveLocalState();
        if (typeof onNanoExchange === 'function') onNanoExchange();
    } catch (error) {
        // Transport failures are interface errors, never fabricated Nano messages.
        showChatError(error.message);
        if (!input.value) input.value = message;
    } finally {
        removeMessage(loading);
        input.focus();
    }
}

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('backend-status').textContent = 'Chat with Nano · Python + Llama';
});
