# SWARM desktop and Android source

This directory contains the native application source used for the 1.0.2 builds. It preserves the existing desktop and Android architecture. The repository root is the Next.js website.

Desktop: Node 24+, `pnpm install`, `pnpm typecheck`, `pnpm test`, `pnpm release:windows`. Build output goes to `release/` and includes an NSIS installer. `pnpm start` runs the compiled app without a dev server. Release builds always authenticate at https://www.swarmgpt.online. Development can set SWARM_ACCOUNT_URL to a loopback web server. Credentials use Electron safeStorage and never cross IPC.

Android: install Android SDK 37 and a compatible JDK, set ANDROID_HOME/JAVA_HOME or your untracked local.properties, then run `gradlew.bat :app:assembleDebug`. Release signing requires SWARM_ANDROID_KEYSTORE (absolute path), SWARM_ANDROID_STORE_PASSWORD, SWARM_ANDROID_KEY_ALIAS, SWARM_ANDROID_KEY_PASSWORD. Never commit the keystore or values. Run `:app:assembleRelease` only with the correct existing signing identity for upgrades. An unsigned output is not a distributable release.

The Android account path uses the existing website API and Clerk browser authentication, PKCE and the registered swarm-ai://auth/callback URI. Tokens and pending verification state are encrypted with Android Keystore. The original paired-desktop companion remains available separately.

Machine permissions, executable paths and environment credentials are not synchronized. Portable preferences are validated in shared/preferences.ts (also maintained at the website root). Do not add credentials or execution permissions to that schema.
