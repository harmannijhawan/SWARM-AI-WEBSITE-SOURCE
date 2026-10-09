# SWARM website and working chat

Node.js 24+ is required for the integrated SQLite backend. Run `pnpm install` and `pnpm dev`, then open http://localhost:3000/app. The main marketing homepage and links remain at `/`; `/app/settings` configures providers. The duplicate imported homepage is excluded.

The web backend reuses SWARM desktop provider adapters from `C:/Users/user/Documents/SWARM---ai/electron/providers`: HTTP streaming, model discovery, timeout handling, provider errors, and free model filtering. Adapted source is in `lib/server/desktop-providers`. Electron-only IPC, PC control, and terminal execution are not exposed through the website.

Local mode uses provider keys already present in this machine's environment. New keys can be saved in Settings. Credentials are masked in responses and encrypted with AES-256-GCM before database storage. Conversation history and encryption material stay in `.swarm-web/`, which is ignored by Git. Local mode is restricted to loopback and dev/start bind to 127.0.0.1.

For hosted accounts, set `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, and a stable `SESSION_SECRET`. Each authenticated account gets its own conversations and credentials; machine environment provider keys are not exposed to account users. Deploy to a Node 24 server with persistent disk for `.swarm-web/`. This is not an Edge/serverless database deployment. The original Postgres cloud backend remains in the downloaded reference and can optionally be selected with `SWARM_API_URL`.

Chat supports streaming, persisted conversation history/search, rename/delete, edit/regenerate/continue, cancellation, and Build with planning, code generation, review, and packaging. Provider failures show errors rather than fabricated replies. Code answers become downloadable files with collapsed previews; all files can be downloaded together as a ZIP. Filenames are sanitized.

Checks: `pnpm test`, `pnpm typecheck`, `pnpm build`. Live QA generated `hello.py` through Groq and downloaded the actual 23-byte file from the browser.


Homepage and downloads
----------------------
The white homepage includes an interactive project starter with website, dashboard, and Python templates, an editable prompt, example file structures, and a direct handoff into Build. It also uses scroll-linked spatial accents, keyboard-accessible capability nodes, and reduced-motion support. The product preview is a screenshot of the actual web Build UI.

`public/downloads/SWARM-AI-Setup.exe` is a byte-identical copy of the supplied installer. `public/downloads/SWARM-AI.apk` is the existing Android project's Gradle `:app:assembleDebug` output, signed with the development key; APK v2 signature verified with apksigner. It is an Android development build, not a store release. Device installation was not tested. Rebuild it from `C:/Users/user/Documents/SWARM---ai` with JAVA_HOME set to Android Studio's jbr, then replace the public APK.

Build reuses the desktop graph source, adapted from Electron state to web props. Its four real stages are planner, coder, reviewer, and file packaging. It generates code; it does not execute local desktop shell tools. Clicking a graph node displays that stage's actual output. Auto shares the desktop purpose scoring, excludes the paid-only OpenAI adapter, filters cooldown/context failures, records model health, and retries up to four available candidates.


