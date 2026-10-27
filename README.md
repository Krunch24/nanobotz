# NanoBotz

NanoBotz runs on Netlify without a separate Python backend. The static dashboard calls `/api/nano`, a TypeScript Netlify Function that uses GPT-4.1 mini through Netlify AI Gateway. No VPS, Docker container, GGUF download, `NANO_API_URL`, or `NANO_API_KEY` is required for the website.

Chat sends the current message and up to 12 recent conversation messages. The original Python controller and its private memory are not used by hosted chat. Browser notes, reflections, exports and preferences retain their existing local storage behavior; notes are not automatically uploaded. Chat requires internet access and available Netlify AI credits. AI Gateway supplies runtime credentials automatically, with no browser API key.

The function validates input and same-origin requests, caps request and output sizes, limits requests per client IP, and returns safe errors. Chat uses one request per response rather than Python job submission and polling. Reflection uses the same hosted assistant and recent chat context.

## Development

Run `npm ci`, `npm run check` and `npm test`. Use `netlify dev --port 8889` for local Netlify emulation. Netlify publishes `public/` and deploys `netlify/functions/`; no frontend build command is required.

The files under `backend/`, the Python scripts and Docker configuration are retained as optional legacy tools. They are not part of website startup or deployment and do not need to be configured. Their dependencies are needed only if you explicitly run those legacy tools.

## Singularity mode

The Singularity tab (also reachable from the header button) lets Nano learn on its own. When activated, Nano extracts learnings from every two chat exchanges, runs scheduled self-study sessions on the user's curiosity topics while the page is open, and sends its 40 most recent learnings as background context with each chat. Learned knowledge is stored in the browser alongside other notes and included in backups; it can be reviewed, deleted or erased from the tab. Learning uses `/api/nano` with `mode: "learn"`.
