/* Singularity mode: Nano learns on its own and keeps what it learns in this browser. */
const SINGULARITY_DEFAULTS = {
    enabled: false, learnFromChat: true, useKnowledge: true, selfStudy: true,
    topics: '', intervalMinutes: 15, knowledge: [], log: [], exchanges: 0,
};
const MAX_KNOWLEDGE = 200;
let learningBusy = false;
let studyTimer = null;

function sing() {
    const current = appState.singularity && typeof appState.singularity === 'object' ? appState.singularity : {};
    const s = { ...SINGULARITY_DEFAULTS, ...current };
    if (!Array.isArray(s.knowledge)) s.knowledge = [];
    if (!Array.isArray(s.log)) s.log = [];
    appState.singularity = s;
    return s;
}

function logSingularity(text) {
    const s = sing();
    s.log.unshift({ time: new Date().toLocaleString(), text });
    s.log = s.log.slice(0, 30);
}

function setSingularityStatus(text) {
    document.getElementById('sing-status').textContent = text;
}

function toggleSingularity() {
    const s = sing();
    s.enabled = !s.enabled;
    logSingularity(s.enabled ? 'Singularity mode activated.' : 'Singularity mode paused.');
    saveLocalState();
    scheduleSelfStudy();
    renderSingularity();
    if (s.enabled && s.selfStudy) runLearningCycle('study');
}

function saveSingularitySettings() {
    const s = sing();
    s.learnFromChat = document.getElementById('sing-learn-chat').checked;
    s.useKnowledge = document.getElementById('sing-use-knowledge').checked;
    s.selfStudy = document.getElementById('sing-self-study').checked;
    s.topics = document.getElementById('sing-topics').value.trim().slice(0, 1000);
    s.intervalMinutes = Math.max(5, Number(document.getElementById('sing-interval').value) || 15);
    saveLocalState();
    scheduleSelfStudy();
    renderSingularity();
    setSingularityStatus('Singularity settings saved.');
}

function scheduleSelfStudy() {
    clearInterval(studyTimer);
    studyTimer = null;
    const s = sing();
    if (!s.enabled || !s.selfStudy) return;
    studyTimer = setInterval(() => {
        if (!document.hidden) runLearningCycle('study');
    }, s.intervalMinutes * 60000);
}

// Called by chat.js after every successful chat exchange.
function onNanoExchange() {
    const s = sing();
    if (!s.enabled || !s.learnFromChat) return;
    s.exchanges = (s.exchanges || 0) + 1;
    if (s.exchanges % 2 === 0) runLearningCycle('chat');
}

async function runLearningCycle(source) {
    const s = sing();
    if (learningBusy) return;
    learningBusy = true;
    document.querySelectorAll('.sing-action').forEach(btn => { btn.disabled = true; });
    setSingularityStatus(source === 'study' ? 'Nano is studying on its own…' : 'Nano is learning from your conversation…');
    const topics = s.topics || "the user's goals, wellbeing and personal growth";
    const message = source === 'study'
        ? `Self-study session. Choose one of these curiosity topics that the learned notes cover least, and learn something new and practical about it: ${topics}`
        : `Learn from the recent conversation. Curiosity topics for context: ${topics}`;
    const history = source === 'study' ? [] : (appState.chatHistory || []).slice(-12).map(item => ({
        role: item.sender === 'nano' ? 'assistant' : 'user', content: String(item.text).slice(0, 4000),
    }));
    try {
        const knowledge = singularityKnowledge(true);
        const data = await nanoFetch('', { mode: 'learn', message, history, ...(knowledge.length ? { knowledge } : {}) });
        const known = new Set(s.knowledge.map(k => k.text.toLowerCase()));
        const fresh = (Array.isArray(data.learnings) ? data.learnings : [])
            .filter(item => typeof item.text === 'string' && !known.has(item.text.toLowerCase()));
        for (const item of fresh) {
            s.knowledge.push({ id: Date.now() + Math.floor(Math.random() * 1000), category: item.category, text: item.text, source, timestamp: new Date().toLocaleString() });
        }
        s.knowledge = s.knowledge.slice(-MAX_KNOWLEDGE);
        const summary = fresh.length ? `Learned ${fresh.length} new thing${fresh.length === 1 ? '' : 's'} from ${source === 'study' ? 'self-study' : 'conversation'}.` : 'Nothing new to learn this cycle.';
        logSingularity(summary);
        setSingularityStatus(summary);
    } catch (error) {
        logSingularity('Learning cycle failed: ' + error.message);
        setSingularityStatus(error.message);
    } finally {
        learningBusy = false;
        saveLocalState();
        renderSingularity();
    }
}

function deleteKnowledge(id) {
    const s = sing();
    s.knowledge = s.knowledge.filter(k => k.id !== id);
    saveLocalState();
    renderSingularity();
}

function clearKnowledge() {
    if (!confirm('Erase everything Nano has learned in this browser?')) return;
    sing().knowledge = [];
    logSingularity('Learned knowledge erased.');
    saveLocalState();
    renderSingularity();
}

function renderSingularity() {
    const s = sing();
    const btn = document.getElementById('sing-toggle');
    btn.setAttribute('aria-pressed', String(s.enabled));
    btn.classList.toggle('glow-active', s.enabled);
    document.getElementById('sing-toggle-label').textContent = s.enabled ? 'Singularity Active' : 'Activate Singularity';
    document.getElementById('sing-header-btn').classList.toggle('glow-active', s.enabled);
    document.getElementById('sing-learn-chat').checked = s.learnFromChat;
    document.getElementById('sing-use-knowledge').checked = s.useKnowledge;
    document.getElementById('sing-self-study').checked = s.selfStudy;
    document.getElementById('sing-topics').value = s.topics;
    document.getElementById('sing-interval').value = String(s.intervalMinutes);
    document.getElementById('sing-count').textContent = s.knowledge.length;
    document.querySelectorAll('.sing-action').forEach(btn => { btn.disabled = learningBusy || !s.enabled; });

    const list = document.getElementById('sing-knowledge');
    list.innerHTML = s.knowledge.length ? [...s.knowledge].reverse().map(k => `
        <div class="p-3 flex items-start justify-between gap-3">
            <div class="space-y-1">
                <span class="text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded bg-slate-800 text-fuchsia-300 border border-darkBorder">${escapeHtml(String(k.category))} · ${k.source === 'study' ? 'self-study' : 'conversation'}</span>
                <p class="text-xs text-slate-200">${escapeHtml(String(k.text))}</p>
                <span class="text-[10px] text-slate-500 block">${escapeHtml(String(k.timestamp))}</span>
            </div>
            <button onclick="deleteKnowledge(${Number(k.id)})" aria-label="Forget this" class="text-slate-500 hover:text-rose-400 p-1 text-xs"><i class="fa-solid fa-trash"></i></button>
        </div>`).join('')
        : '<p class="p-6 text-center text-slate-500 text-xs">Nano hasn’t learned anything yet. Activate Singularity and chat, or start a study session.</p>';

    document.getElementById('sing-log').innerHTML = s.log.length
        ? s.log.map(l => `<li><span class="text-slate-500 font-mono text-[10px] mr-2">${escapeHtml(String(l.time))}</span>${escapeHtml(String(l.text))}</li>`).join('')
        : '<li class="text-slate-500">No activity yet.</li>';
}

window.addEventListener('load', () => {
    renderSingularity();
    scheduleSelfStudy();
});
