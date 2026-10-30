# NanoBotz

NanoBotz is a Netlify dashboard for your existing Python controller and Llama model. Chat and reflections use your Python backend, not a hosted AI provider. The Netlify Function only validates and forwards requests; inference and controller memory stay on your backend.

## Connect the running backend
Chat sends the current message and up to 12 recent conversation messages. The original Python controller and its private memory are not used by hosted chat. Browser notes, reflections, exports and preferences retain their existing local storage behavior; ordinary memory notes are not automatically uploaded. Singularity learning notes and settings are saved in Netlify Database, scoped to an anonymous, secure browser cookie. Clearing cookies loses access unless you exported a backup. The database migration is applied by Netlify during deployment. Chat requires internet access and available Netlify AI credits. AI Gateway supplies runtime credentials automatically, with no browser API key.

In Netlify project environment settings, configure these variables for Functions runtime and the required deploy contexts, then redeploy:

- `NANO_API_URL`: public HTTPS base URL of your running backend (without `/api/chat`).
- `NANO_API_KEY`: the same private backend credential configured on the Python server, at least 32 characters.
- `NANO_SESSION_SECRET`: a private random value of at least 32 characters used to derive backend session IDs. Keep it stable to retain access to existing sessions.

Never put credentials in browser code or commit them. The proxy fails with a connection error if settings are missing; it never falls back to hosted AI. It submits to `POST /api/chat` and polls `GET /api/chat/status`, matching `backend/api.py`. The server must expose this contract. Chat submits a message, opaque session ID and request ID. Python manages conversation context. The browser retains its session ID on the current origin; clearing browser storage starts a new session.

## Python and Llama

Keep the existing Python/Llama service running. The included backend adapter loads `NanoAI` from your original `ai.py` via `NANO_SOURCE_DIR` and calls `NanoAI.chat`. Original application source and model weights are not bundled into this dashboard. Configure the source directory, persistent data directory, Llama model and llama-cli paths on that server using `backend/config.py`. The backend health endpoint reports readiness, including the model, inference engine and controller integration. The backend retains its existing queue, memory and backup behavior.

Browser memory notes and exports are separate from Python controller memory. They are not automatically uploaded. Reflections submit recent-reflection requests through the same Python controller.

## Development

Run `npm ci`, `npm run check` and `npm test`. Use `netlify dev --port 8889` for local Netlify emulation. Netlify publishes `public/` and deploys `netlify/functions/`; no frontend build command is required. Python dependencies are listed in `requirements.txt` for the backend server.
The files under `backend/`, the Python scripts and Docker configuration are retained as optional legacy tools. They are not part of website startup or deployment and do not need to be configured. Their dependencies are needed only if you explicitly run those legacy tools.

## Singularity mode

The Singularity tab (also reachable from the header button) lets Nano learn on its own. When activated, Nano extracts learnings from every two chat exchanges, runs scheduled self-study sessions on the user's curiosity topics while the page is open, and sends its 40 most recent learnings as background context with each chat. Learned knowledge is stored in the browser alongside other notes and included in backups; it can be reviewed, deleted or erased from the tab. Learning uses `/api/nano` with `mode: "learn"`.
## Combined preview features

The consolidated interface includes Singularity controls, conversation learning, scheduled study while the page is open, knowledge review/deletion, backups, reflections, and the NanoBotz branding cleanup. Singularity uses the same hosted AI Gateway endpoint as chat. It creates reusable notes from model responses; it does not retrain the model or browse the web. Up to 40 recent learning notes are sent with chat when enabled. Learning is opt-in and uses AI credits.

The older Python/Llama backend remains available as legacy tooling but is not required by the website. Earlier previews that depended on it were reconciled with the hosted AI setup. Build artifacts and preview URLs are historical deployments, not Git branches to merge. This source consolidation does not close GitHub pull requests or merge their branches.
