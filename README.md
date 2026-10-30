# NanoBotz

NanoBotz is a Netlify dashboard for your existing Python controller and Llama model. Chat and reflections use your Python backend, not a hosted AI provider. The Netlify Function only validates and forwards requests; inference and controller memory stay on your backend.

## Connect the running backend

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
