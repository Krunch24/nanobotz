# NanoBotz

NanoBotz runs on Netlify without a separate Python backend. The static dashboard calls `/api/nano`, a TypeScript Netlify Function that uses GPT-4.1 mini through Netlify AI Gateway. No VPS, Docker container, GGUF download, `NANO_API_URL`, or `NANO_API_KEY` is required for the website.

Chat sends the current message and up to 12 recent conversation messages. The original Python controller and its private memory are not used by hosted chat. Browser notes, reflections, exports and preferences retain their existing local storage behavior; ordinary memory notes are not automatically uploaded. Singularity learning notes and settings are saved in Netlify Database, scoped to an anonymous, secure browser cookie. Clearing cookies loses access unless you exported a backup. The database migration is applied by Netlify during deployment. Chat requires internet access and available Netlify AI credits. AI Gateway supplies runtime credentials automatically, with no browser API key.

The function validates input and same-origin requests, caps request and output sizes, limits requests per client IP, and returns safe errors. Chat uses one request per response rather than Python job submission and polling. Reflection uses the same hosted assistant and recent chat context.

## Development

Run `npm ci`, `npm run check` and `npm test`. Use `netlify dev --port 8889` for local Netlify emulation. Netlify publishes `public/` and deploys `netlify/functions/`; no frontend build command is required.

The files under `backend/`, the Python scripts and Docker configuration are retained as optional legacy tools. They are not part of website startup or deployment and do not need to be configured. Their dependencies are needed only if you explicitly run those legacy tools.

## Combined preview features

The consolidated interface includes Singularity controls, conversation learning, scheduled study while the page is open, knowledge review/deletion, backups, reflections, and the NanoBotz branding cleanup. Singularity uses the same hosted AI Gateway endpoint as chat. It creates reusable notes from model responses; it does not retrain the model or browse the web. Up to 40 recent learning notes are sent with chat when enabled. Learning is opt-in and uses AI credits.

The older Python/Llama backend remains available as legacy tooling but is not required by the website. Earlier previews that depended on it were reconciled with the hosted AI setup. Build artifacts and preview URLs are historical deployments, not Git branches to merge. This source consolidation does not close GitHub pull requests or merge their branches.
