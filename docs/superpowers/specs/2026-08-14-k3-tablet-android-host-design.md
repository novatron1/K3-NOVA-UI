# K3 Tablet Android Host Design

## Goal

Turn `K3-NOVA-UI` from a browser-only fake-host presentation prototype into a tablet-ready client that can communicate with a real Nova/K3 host and can be packaged as an installable Android application without embedding provider secrets in the client.

## Current State

The application is a React 19 + Vite presentation client. `NovaMindDemo.tsx` constructs `FakePresentationHost`, while the UI itself depends on the `PresentationHostAdapter` interface. That interface already provides the correct boundary for replacing fake events with a real host connection without rewriting the main UI.

The repository currently has no Android project, Capacitor configuration, native package scripts, or APK build workflow. The README explicitly states that the current UI is not connected to Nova, Kimi/K3, Qwen, tools, ledgers, permissions, evidence, or sandbox features.

## Approaches Considered

### 1. Recommended: Capacitor Android + real HTTP host adapter

Keep the React/Vite UI, implement a production `PresentationHostAdapter` that talks to a trusted backend, and wrap the existing web bundle with Capacitor for Android.

Advantages:
- Reuses the existing UI and controller architecture.
- Produces a normal Android application while preserving the GitHub Pages/browser build.
- Keeps K3/provider credentials on the server rather than in the APK.
- Allows the same UI to target cloud K3, a remote Nova host, or a LAN/local host through one protocol.
- Lowest-risk migration because the fake host remains available for tests and presentation mode.

Trade-offs:
- Requires a reachable backend service for real model execution.
- Android builds require Java/Android SDK tooling in CI or on a build machine.

### 2. Native Android rewrite

Rebuild the client in Kotlin/Jetpack Compose and connect directly to a backend.

Advantages:
- Maximum native Android control.

Trade-offs:
- Throws away the existing React UI and test investment.
- Much larger implementation and maintenance burden.
- Delays K3 connectivity without adding meaningful model capability.

### 3. PWA-only installation

Keep GitHub Pages and add a manifest/service worker so Android can install the site as a PWA.

Advantages:
- Fastest install-like experience.
- No Android build toolchain.

Trade-offs:
- Not a true APK.
- Weaker native integration and distribution options.
- Does not solve real-host connectivity by itself.

## Chosen Architecture

Use approach 1.

The application will support two explicit runtime modes:

1. `demo` — existing `FakePresentationHost`, no network or model execution.
2. `remote` — new `HttpPresentationHost` that connects to a trusted Nova/K3 backend.

Runtime mode is chosen from build/runtime configuration. The public GitHub Pages deployment remains `demo` unless a safe public backend is explicitly configured. The Android build can default to `remote` but must show a clear unavailable state when no backend URL has been configured.

## Client Components

### `src/host/http-presentation-host.ts`

Implements `PresentationHostAdapter` and `PresentationSession`.

Responsibilities:
- Open a host session.
- Submit text and voice transcript requests.
- Submit permission decisions.
- Cancel and close the session.
- Convert backend responses into the existing presentation events consumed by `usePresentationController`.
- Reject malformed or unsupported events before they enter application state.
- Surface connection failures through `onFatalError("host_unavailable")` and invalid protocol data through `onFatalError("invalid_event")`.

The adapter must not contain K3, OpenAI, Kimi, RunPod, Vast.ai, or other provider API keys.

### `src/host/host-config.ts`

Owns client-safe runtime configuration.

Expected values:
- `mode`: `demo | remote`
- `baseUrl`: trusted backend origin for remote mode
- optional non-secret client/session token supplied at runtime

The configuration parser must reject non-HTTP(S) remote URLs. Production Android builds should require HTTPS except for explicitly enabled development/LAN testing.

### `src/app/NovaMindRoot.tsx`

Selects the host implementation and constructs the controller. `NovaMindDemo.tsx` can remain as a focused demo fixture, but `main.tsx` should render the new root rather than hard-wiring the fake-host demo.

### Existing UI

`NovaMindApp.tsx`, presentation domain types, permission UI, and state controller stay intact unless tests expose a compatibility issue. The purpose of the host boundary is to avoid coupling the visual layer to a specific model provider.

## Host Protocol

The first production protocol will use ordinary HTTPS request/response calls. Streaming can be added later without changing the UI-facing host interface.

### Create session

`POST /v1/presentation/sessions`

Response:
```json
{
  "sessionId": "opaque-session-id",
  "events": [
    {
      "type": "snapshot",
      "snapshot": {}
    }
  ]
}
```

### Submit text

`POST /v1/presentation/sessions/{sessionId}/text`

Request:
```json
{
  "text": "user message"
}
```

Response:
```json
{
  "events": []
}
```

### Submit voice transcript

`POST /v1/presentation/sessions/{sessionId}/voice-transcript`

Request:
```json
{
  "transcript": "recognized speech"
}
```

### Permission decision

`POST /v1/presentation/sessions/{sessionId}/permissions/{approvalRequestId}`

Request:
```json
{
  "decision": "approve"
}
```

Allowed decisions remain `approve`, `deny`, and `cancel`.

### Cancel

`POST /v1/presentation/sessions/{sessionId}/cancel`

### Close

`DELETE /v1/presentation/sessions/{sessionId}`

Each successful endpoint may return zero or more presentation events. The client must validate event shape before forwarding it to the controller.

## Backend Boundary

The Android/web client does not call K3 directly. A trusted Nova host/backend owns:
- provider authentication and API keys;
- model selection, including K3 cloud or future local/remote model routing;
- RunContract creation and permission enforcement;
- tool execution;
- ledger writes;
- evidence and sandbox behavior;
- sanitization of the presentation events returned to the client.

This preserves the existing trust-boundary design instead of moving privileged capabilities into the tablet.

## Android Packaging

Add Capacitor with Android support.

Expected repository additions:
- `capacitor.config.ts`
- generated `android/` project
- package scripts for sync, Android build, and APK artifact creation
- Android-specific network/security configuration where required

The Capacitor `webDir` will point at Vite's `dist` directory. Normal `npm run build` remains the web build; an Android build performs the web build first, synchronizes the assets into Capacitor, then invokes Gradle.

Initial target artifact:
- debug APK for direct tablet installation and testing

Release signing is intentionally separate because it requires user-owned signing credentials and should not be committed to the repository.

## Configuration and Secrets

Allowed in the client:
- backend base URL;
- runtime mode;
- short-lived/opaque session token if the backend issues one.

Forbidden in the client, `.env` committed files, JavaScript bundle, Android resources, or GitHub Pages:
- K3/Kimi/provider API keys;
- cloud vendor secrets;
- long-lived backend administrative tokens;
- signing keystore passwords.

GitHub Actions secrets may be used later for release signing or deployment, but the first APK path should require no production signing secret.

## Error Handling

The remote host adapter must handle:
- unreachable backend;
- timeout/abort;
- non-2xx HTTP responses;
- malformed JSON;
- missing session ID;
- invalid event payload;
- calls made after a session is closed;
- cancellation during an in-flight request.

User-facing errors remain sanitized. Raw provider or secret-bearing backend errors must not be rendered into the UI.

## Testing

### Unit tests

Add tests for:
- configuration parsing and URL policy;
- session creation;
- text submission;
- permission decisions;
- cancel and close behavior;
- abort propagation;
- invalid event rejection;
- non-2xx and malformed response handling;
- proof that no provider secret is required by the adapter.

### Existing verification

`npm run verify` must continue to pass.

### Android build verification

A dedicated CI workflow or job should:
1. install Node >= 22.13;
2. run `npm ci`;
3. run the normal verification suite;
4. build the web bundle;
5. synchronize Capacitor Android assets;
6. run the Gradle debug APK build;
7. upload the resulting debug APK as a workflow artifact.

## Acceptance Criteria

The work is complete when:
- the existing browser demo still works;
- `PresentationHostAdapter` can be backed by a real HTTPS service without UI rewrites;
- no model/provider secret is shipped in the client;
- the Android project builds a debug APK;
- GitHub Actions can produce the APK artifact from a clean checkout;
- the app clearly reports host-unavailable state when remote mode has no reachable backend;
- all existing verification tests continue to pass;
- new host/config tests pass;
- README explains browser demo, remote-host configuration, Android build, and where the real K3 model execution occurs.

## Out of Scope for This Implementation

- Embedding a multi-gigabyte K3 model inside the APK.
- Running a full 30B+ model directly on the tablet.
- Release-store signing/publishing.
- New voice-recognition implementation.
- Rebuilding Nova's trusted backend, RunContract, ledger, sandbox, or tool system inside this UI repository.
- Provider-specific credential entry fields in the app.

## Implementation Order

1. Add and test client-safe host configuration.
2. Add and test `HttpPresentationHost`.
3. Add the runtime root that selects demo vs remote host.
4. Preserve and rerun existing UI/security tests.
5. Add Capacitor and Android project/build scripts.
6. Add Android CI artifact workflow.
7. Update documentation and run the full verification/build matrix.
