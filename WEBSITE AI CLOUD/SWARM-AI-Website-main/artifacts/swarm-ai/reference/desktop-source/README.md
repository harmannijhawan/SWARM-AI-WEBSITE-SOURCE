# Desktop source reference

These files are unmodified UI, provider-settings, and key-handling references
from the SWARM AI desktop repository:

https://github.com/harmannijhawan/SWARM-AI-SOURCE-CODE

The web app adapts the product behavior, not Electron's local runtime. Desktop
API keys are entered in Settings and kept in Electron's main process with OS
keychain encryption. The web version uses the signed-in user's settings and
encrypts provider keys on the server before storing them.
