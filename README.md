# NanoBotz

NanoBotz provides chat, reflections, and opt-in Singularity learning through Netlify AI Gateway using GPT-4.1 mini. No separate Python server or model download is required for the website. Gateway credentials are supplied automatically by Netlify at runtime; no browser API key is needed. Internet access and available Netlify AI credits are required.

## Chat and reflections

The browser sends the current message and up to 12 recent conversation messages to `POST /api/nano`. Reflections use the same endpoint with recent conversation as context. The function validates request origin, body size, history, and learning notes before calling the model. Errors appear in the interface without fabricated assistant replies.

Browser notes, chat logs, reflections, and preferences retain their local storage behavior. Ordinary memory notes are not automatically sent to the model. Browser persona, temperature, and voice preferences are legacy settings and do not change the hosted model or device speech voice.

## Singularity mode

When enabled, Nano extracts learning notes after every two successful chat exchanges and studies curiosity topics at the selected interval while the page is open. This uses model knowledge rather than web browsing or model training. Up to 40 recent learning notes are included with chat when knowledge use is enabled.

Learning notes and Singularity settings are saved in Netlify Database, scoped to an anonymous secure browser cookie. Clearing cookies loses access unless a backup was exported. The existing database migration is applied during deployment. Learning pauses when storage is unavailable. Activation and learning buttons retry the storage connection without requiring a reload. A learning cycle reports success only after its notes are saved; failed saves retain notes on the current page for backup or retry. Notes can be reviewed, deleted, exported, and restored through the dashboard.

## Development

Run `npm ci`, `npm run check`, and `npm test`. Use `netlify dev --port 8889` for local Netlify emulation. Netlify publishes `public/` and deploys `netlify/functions/`; no frontend build command is required.

The Python backend, scripts, and Docker configuration are retained as optional legacy tools. They are not used by the website and do not need configuration for website deployment.
