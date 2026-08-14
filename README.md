# K3 Nova UI

K3 Nova UI is the tablet/browser presentation client for NovaMind. The visual layer stays separated from the trusted host so model credentials, permission enforcement, tool execution, ledgers, and other privileged runtime state do not have to live in the browser or Android package.

## Runtime modes

### Demo mode

Demo mode uses the existing synthetic `FakePresentationHost`. It does not call Nova, K3/Kimi, Qwen, tools, ledgers, permissions, evidence services, or a sandbox.

Demo is the default when `VITE_NOVA_HOST_MODE` is unset. The public GitHub Pages deployment intentionally remains in this mode.

### Remote mode

Remote mode uses `HttpPresentationHost` to connect to a trusted Nova/K3 backend over the presentation protocol.

Client-safe build settings:

```text
VITE_NOVA_HOST_MODE=remote
VITE_NOVA_HOST_BASE_URL=https://your-nova-host.example
```

HTTPS is required by default. For explicit development/LAN testing only, HTTP can be enabled with:

```text
VITE_NOVA_ALLOW_INSECURE_HOST=1
```

If remote mode is selected without a valid backend URL, the client fails closed and displays the existing sanitized host-unavailable state.

## Security boundary

Do not put K3/Kimi/provider API keys, Vast.ai credentials, cloud provider secrets, long-lived administrative tokens, signing passwords, or other secrets in `VITE_*` variables. Vite client variables are bundled into client assets and are not secret storage.

The trusted backend is responsible for provider authentication, model selection, RunContract/permission enforcement, tool execution, ledger writes, evidence/sandbox behavior, and sanitizing the presentation events returned to this client.

Voice capture is still unavailable by default. Message text and code displayed by the presentation client are inert and are never executed by the UI.

## Presentation protocol

The client currently uses ordinary HTTPS request/response calls:

```text
POST   /v1/presentation/sessions
POST   /v1/presentation/sessions/{sessionId}/text
POST   /v1/presentation/sessions/{sessionId}/voice-transcript
POST   /v1/presentation/sessions/{sessionId}/permissions/{approvalRequestId}
POST   /v1/presentation/sessions/{sessionId}/cancel
DELETE /v1/presentation/sessions/{sessionId}
```

Every event returned by the backend is checked by the existing host-event validator before it is forwarded to presentation state.

## Local browser development

Install locked dependencies and start Vite:

```bash
npm ci
npm run dev
```

Run the full web verification suite:

```bash
npm run verify
```

## Android tablet APK

The Android wrapper uses Capacitor 8.4.2 tooling. Capacitor packages are installed only during Android bootstrap with `--no-save --package-lock=false`, so the existing web lockfile remains the source of truth for normal `npm ci` verification.

Build a debug APK locally from an environment with an Android SDK and Java installed:

```bash
npm ci
npm run android:apk
```

The resulting APK is expected at:

```text
android/app/build/outputs/apk/debug/app-debug.apk
```

The generated `android/` directory is intentionally ignored and recreated by `npm run android:bootstrap`.

## GitHub Actions APK

`.github/workflows/android-apk.yml` verifies the web client, generates the Android project, builds the debug APK, and uploads it as the `k3-nova-debug-apk` workflow artifact.

The Android workflow builds in remote mode and reads the optional repository variables:

```text
NOVA_HOST_BASE_URL
NOVA_ALLOW_INSECURE_HOST
```

`NOVA_HOST_BASE_URL` is a non-secret backend address. If it is not set, the APK still builds but opens in the fail-closed host-unavailable state until a real backend address is supplied in a later build.

Release signing and app-store publishing are intentionally separate and require user-owned signing credentials.
