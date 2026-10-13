# SWARM 1.0.3 verification — 10 October 2026

The unavailable AI state was caused locally by configured Llama model IDs no longer present in Groq discovery. Production also lacked the provider key, model allowlist and public URL required by startup validation. The allowlist now uses discovered GPT OSS 120B, GPT OSS 20B and Qwen 3.8 27B models. Production configuration was updated and the website deployed to https://www.swarmgpt.online.

The composer accepts typing during provider outages. Send remains dependent on an available model.

The verified Clerk identity for harmanminecraft490@gmail.com has an operator exemption in both local SQLite and cloud Postgres. Usage, hourly, concurrency and native operation inference budgets are bypassed for that identity. Other users retain their plan limits. Provider capacity limits and request validation remain in effect.

Desktop and Android version: 1.0.3. Existing desktop logos retained. Android generic hexagonal launcher icon replaced with the SWARM mark; the sign-in wordmark is visible. TensorFlow Lite was replaced by the compatible LiteRT Interpreter dependency following https://developers.google.com/edge/litert/migration.

Verification:
- Website typecheck and production build passed, including Vercel production build.
- Fourteen focused entitlement/billing tests passed, including exemption isolation.
- Broader test suite has configuration/provider timeout failures; it did not pass.
- Local and production authenticated model discovery returned three models.
- Local and production managed inference returned `ready` with HTTP 200.
- Both live download routes returned HTTP 200 and redirected to version 1.0.3 artifacts.
- Packaged desktop startup reached Welcome back, protected IPC rejected unauthenticated access, and authentication uses the production website.
- Android installed and cold-started successfully on SWARM_V3_Test emulator. APK 16 KB zip alignment check passed; after LiteRT migration the observed startup reached the sign-in screen without the previous compatibility dialog. Google sign-in itself was not performed.

Artifacts:
- apps/native/release/SWARM-AI-Setup-1.0.3.exe
- apps/native/app/build/outputs/apk/debug/app-debug.apk
- apps/native/_screenshots/android-1.0.3.png

Android artifact is debug-signed, not a production-signed release. An existing installation signed with a different identity may require uninstalling before installing this APK. No production keystore was configured.

The local development server is running on http://127.0.0.1:3000. Refresh the page to load the updated composer and entitlement display.
