import type {
  DisplayPreferences,
  LivingOrganId,
  SanitizedHostSnapshot,
  UntrustedMessage,
} from "../domain/presentation-types";
import {
  createUnavailableSnapshot,
  trustedActivePermissionGate,
} from "../domain/presentation-types";
import type {
  HostPresentationEvent,
  PresentationAction,
} from "../domain/presentation-events";
import { validateHostEvent } from "../security/validate-host-event";

export interface PresentationState {
  readonly snapshot: SanitizedHostSnapshot;
  readonly messages: readonly UntrustedMessage[];
  readonly draft: string;
  readonly voiceReview: string | null;
  readonly openOrgans: ReadonlySet<LivingOrganId>;
  readonly displayPreferences: DisplayPreferences;
  readonly sessionState: "connecting" | "connected" | "closed" | "failed";
  readonly sessionError: string | null;
}

const DEFAULT_DISPLAY_PREFERENCES: DisplayPreferences = Object.freeze({
  reducedMotion: false,
  audioVolume: 1,
  layoutDensity: "balanced",
  themeIntensity: 1,
});

const LIVING_ORGAN_IDS = new Set<LivingOrganId>([
  "contract",
  "permissions",
  "ledger",
  "evidence",
  "provider",
  "privacy",
  "budgets",
  "isolation",
  "observer",
  "rollback",
]);

function assertNever(value: never): never {
  void value;
  throw new Error("unsupported presentation action");
}

function freezeArray<T>(values: readonly T[]): readonly T[] {
  return Object.freeze([...values]);
}

function freezePermissionGate(
  permissionGate: SanitizedHostSnapshot["permissionGate"],
): SanitizedHostSnapshot["permissionGate"] {
  if (permissionGate === null) {
    return null;
  }

  return Object.freeze({
    approvalRequestId: permissionGate.approvalRequestId,
    kind: permissionGate.kind,
    actionLabel: permissionGate.actionLabel,
    canonicalResource: permissionGate.canonicalResource,
    policyLabels: freezeArray(permissionGate.policyLabels),
    reasonLabels: freezeArray(permissionGate.reasonLabels),
    requiredPermission: permissionGate.requiredPermission,
    actualPermission: permissionGate.actualPermission,
    irreversible: permissionGate.irreversible,
    choices: freezeArray(permissionGate.choices),
  });
}

function freezeSnapshot(snapshot: SanitizedHostSnapshot): SanitizedHostSnapshot {
  return Object.freeze({
    schemaVersion: snapshot.schemaVersion,
    runId: snapshot.runId,
    phase: snapshot.phase,
    trustTone: snapshot.trustTone,
    statusLabel: snapshot.statusLabel,
    providerLabel: snapshot.providerLabel,
    modelLabel: snapshot.modelLabel,
    privacyClass: snapshot.privacyClass,
    cloudConsentRequired: snapshot.cloudConsentRequired,
    cloudConsentGranted: snapshot.cloudConsentGranted,
    isolation: snapshot.isolation,
    isolationLabel: snapshot.isolationLabel,
    contractSummary: freezeArray(snapshot.contractSummary),
    permissionSummary: freezeArray(snapshot.permissionSummary),
    ledgerSummary: freezeArray(snapshot.ledgerSummary),
    evidence: snapshot.evidence,
    evidenceLabel: snapshot.evidenceLabel,
    budgetSummary: freezeArray(snapshot.budgetSummary),
    observerSummary: freezeArray(snapshot.observerSummary),
    rollback: snapshot.rollback,
    rollbackLabel: snapshot.rollbackLabel,
    permissionGate: freezePermissionGate(snapshot.permissionGate),
  });
}

function withoutPermissionGate(
  snapshot: SanitizedHostSnapshot,
): SanitizedHostSnapshot {
  return snapshot.permissionGate === null
    ? snapshot
    : freezeSnapshot({ ...snapshot, permissionGate: null });
}

function freezeMessage(message: UntrustedMessage): UntrustedMessage {
  return Object.freeze({
    id: message.id,
    author: message.author,
    text: message.text,
    createdAt: message.createdAt,
  });
}

function readonlySet<T>(values: Iterable<T>): ReadonlySet<T> {
  const backing = new Set(values);
  const facade: ReadonlySet<T> & {
    readonly [Symbol.toStringTag]: string;
  } = {
    get size(): number {
      return backing.size;
    },
    has(value: T): boolean {
      return backing.has(value);
    },
    entries(): SetIterator<[T, T]> {
      return backing.entries();
    },
    keys(): SetIterator<T> {
      return backing.keys();
    },
    values(): SetIterator<T> {
      return backing.values();
    },
    forEach(
      callback: (value: T, duplicate: T, set: ReadonlySet<T>) => void,
      thisArg?: unknown,
    ): void {
      backing.forEach((value) => {
        callback.call(thisArg, value, value, facade);
      });
    },
    [Symbol.iterator](): SetIterator<T> {
      return backing.values();
    },
    get [Symbol.toStringTag](): string {
      return "Set";
    },
  };

  return Object.freeze(facade);
}

function freezeState(state: PresentationState): PresentationState {
  return Object.freeze(state);
}

function isLivingOrganId(value: unknown): value is LivingOrganId {
  return typeof value === "string" && LIVING_ORGAN_IDS.has(value as LivingOrganId);
}

function isRecord(value: unknown): value is Record<PropertyKey, unknown> {
  return typeof value === "object" && value !== null;
}

function withSnapshot(
  state: PresentationState,
  event: Extract<HostPresentationEvent, { readonly type: "snapshot" }>,
): PresentationState {
  const validation = validateHostEvent(event);
  if (!validation.ok || validation.event.type !== "snapshot") {
    return assertNever(event as never);
  }

  return freezeState({
    ...state,
    snapshot: freezeSnapshot(validation.event.snapshot),
    sessionState: "connected",
    sessionError: null,
  });
}

function withMessage(
  state: PresentationState,
  event: Extract<HostPresentationEvent, { readonly type: "message" }>,
): PresentationState {
  const validation = validateHostEvent(event);
  if (!validation.ok || validation.event.type !== "message") {
    return assertNever(event as never);
  }

  return freezeState({
    ...state,
    messages: freezeArray([
      ...state.messages,
      freezeMessage(validation.event.message),
    ]),
  });
}

function withMessageReplacement(
  state: PresentationState,
  event: Extract<HostPresentationEvent, { readonly type: "message_replaced" }>,
): PresentationState {
  const validation = validateHostEvent(event);
  if (!validation.ok || validation.event.type !== "message_replaced") {
    return assertNever(event as never);
  }
  const replacement = validation.event;

  return freezeState({
    ...state,
    messages: freezeArray(state.messages.map((message) => (
      message.id === replacement.messageId
        ? freezeMessage({
          id: message.id,
          author: message.author,
          text: replacement.text,
          createdAt: message.createdAt,
        })
        : message
    ))),
  });
}

function withHostEvent(
  state: PresentationState,
  event: HostPresentationEvent,
): PresentationState {
  if (!isRecord(event) || typeof event.type !== "string") {
    return assertNever(event as never);
  }

  switch (event.type) {
    case "snapshot":
      return withSnapshot(state, event);
    case "message":
      return withMessage(state, event);
    case "message_replaced":
      return withMessageReplacement(state, event);
    case "session_error":
      if (
        (event.code !== "timeout"
          && event.code !== "disconnected"
          && event.code !== "invalid_event"
          && event.code !== "host_unavailable")
        || typeof event.label !== "string"
      ) {
        return assertNever(event as never);
      }
      return freezeState({
        ...state,
        snapshot: trustedActivePermissionGate(state.snapshot) === null
          ? state.snapshot
          : createUnavailableSnapshot(),
        sessionState: "failed",
        sessionError: event.label,
      });
    case "session_closed":
      if (
        event.reason !== "completed"
        && event.reason !== "cancelled"
        && event.reason !== "failed"
      ) {
        return assertNever(event as never);
      }
      return freezeState({
        ...state,
        snapshot: withoutPermissionGate(state.snapshot),
        sessionState: "closed",
      });
    default:
      return assertNever(event);
  }
}

export function createInitialPresentationState(): PresentationState {
  return freezeState({
    snapshot: createUnavailableSnapshot(),
    messages: freezeArray([]),
    draft: "",
    voiceReview: null,
    openOrgans: readonlySet([]),
    displayPreferences: DEFAULT_DISPLAY_PREFERENCES,
    sessionState: "connecting",
    sessionError: null,
  });
}

export function presentationReducer(
  state: PresentationState,
  action: PresentationAction,
): PresentationState {
  if (!isRecord(action) || typeof action.type !== "string") {
    return assertNever(action as never);
  }

  switch (action.type) {
    case "host_event":
      return withHostEvent(state, action.event);
    case "permission_decision_resolved":
      if (typeof action.approvalRequestId !== "string") {
        return assertNever(action as never);
      }
      if (
        trustedActivePermissionGate(state.snapshot)?.approvalRequestId
        !== action.approvalRequestId
      ) {
        return state;
      }
      return freezeState({
        ...state,
        snapshot: withoutPermissionGate(state.snapshot),
      });
    case "draft_changed":
      if (typeof action.value !== "string") {
        return assertNever(action as never);
      }
      return freezeState({ ...state, draft: action.value });
    case "draft_submission_resolved":
      if (typeof action.submittedValue !== "string") {
        return assertNever(action as never);
      }
      return state.draft === action.submittedValue
        ? freezeState({ ...state, draft: "" })
        : state;
    case "voice_review_changed":
      if (action.value !== null && typeof action.value !== "string") {
        return assertNever(action as never);
      }
      return freezeState({ ...state, voiceReview: action.value });
    case "voice_review_submission_resolved":
      if (typeof action.submittedValue !== "string") {
        return assertNever(action as never);
      }
      return state.voiceReview === action.submittedValue
        ? freezeState({ ...state, voiceReview: null })
        : state;
    case "organ_toggled":
      if (!isLivingOrganId(action.organId)) {
        return assertNever(action as never);
      }
      return freezeState({
        ...state,
        openOrgans: state.openOrgans.has(action.organId)
          ? readonlySet([...state.openOrgans].filter((id) => id !== action.organId))
          : readonlySet([...state.openOrgans, action.organId]),
      });
    case "preference_changed":
      switch (action.key) {
        case "reducedMotion":
          if (typeof action.value !== "boolean") {
            return assertNever(action as never);
          }
          return freezeState({
            ...state,
            displayPreferences: Object.freeze({
              ...state.displayPreferences,
              reducedMotion: action.value,
            }),
          });
        case "audioVolume":
          if (typeof action.value !== "number") {
            return assertNever(action as never);
          }
          return freezeState({
            ...state,
            displayPreferences: Object.freeze({
              ...state.displayPreferences,
              audioVolume: action.value,
            }),
          });
        case "layoutDensity":
          if (action.value !== "balanced" && action.value !== "compact") {
            return assertNever(action as never);
          }
          return freezeState({
            ...state,
            displayPreferences: Object.freeze({
              ...state.displayPreferences,
              layoutDensity: action.value,
            }),
          });
        case "themeIntensity":
          if (typeof action.value !== "number") {
            return assertNever(action as never);
          }
          return freezeState({
            ...state,
            displayPreferences: Object.freeze({
              ...state.displayPreferences,
              themeIntensity: action.value,
            }),
          });
        default:
          return assertNever(action.key);
      }
    default:
      return assertNever(action);
  }
}
