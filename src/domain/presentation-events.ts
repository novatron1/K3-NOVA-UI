import type {
  DisplayPreferenceKey,
  LivingOrganId,
  SanitizedHostSnapshot,
  UntrustedMessage,
} from "./presentation-types";

export type HostPresentationEvent =
  | {
      readonly type: "snapshot";
      readonly snapshot: SanitizedHostSnapshot;
    }
  | { readonly type: "message"; readonly message: UntrustedMessage }
  | {
      readonly type: "message_replaced";
      readonly messageId: string;
      readonly text: string;
    }
  | {
      readonly type: "session_error";
      readonly code:
        | "timeout"
        | "disconnected"
        | "invalid_event"
        | "host_unavailable";
      readonly label: string;
    }
  | {
      readonly type: "session_closed";
      readonly reason: "completed" | "cancelled" | "failed";
    };

export type PresentationAction =
  | { readonly type: "host_event"; readonly event: HostPresentationEvent }
  | { readonly type: "draft_changed"; readonly value: string }
  | {
      readonly type: "draft_submission_resolved";
      readonly submittedValue: string;
    }
  | { readonly type: "voice_review_changed"; readonly value: string | null }
  | {
      readonly type: "voice_review_submission_resolved";
      readonly submittedValue: string;
    }
  | { readonly type: "organ_toggled"; readonly organId: LivingOrganId }
  | {
      readonly type: "preference_changed";
      readonly key: DisplayPreferenceKey;
      readonly value: string | number | boolean;
    };
