import { useState } from "react";

import {
  loadHostConfig,
  type HostEnvironment,
} from "../host/host-config";
import { HttpPresentationHost } from "../host/http-presentation-host";
import { usePresentationController } from "../state/use-presentation-controller";
import { UnavailableVoiceCapture } from "../voice/voice-capture";
import { NovaMindApp } from "./NovaMindApp";
import { NovaMindDemo } from "./NovaMindDemo";

export interface NovaMindRootProps {
  readonly environment?: HostEnvironment;
}

function RemoteNovaMind({
  baseUrl,
  sessionToken,
}: {
  readonly baseUrl: string | null;
  readonly sessionToken: string | null;
}) {
  const [host] = useState(
    () => new HttpPresentationHost(baseUrl, sessionToken),
  );
  const [voice] = useState(() => new UnavailableVoiceCapture());
  const controller = usePresentationController(host, voice);

  return <NovaMindApp state={controller} controller={controller} />;
}

export function NovaMindRoot({ environment }: NovaMindRootProps) {
  const config = environment === undefined
    ? loadHostConfig()
    : loadHostConfig(environment);

  return config.mode === "demo"
    ? <NovaMindDemo />
    : (
        <RemoteNovaMind
          baseUrl={config.baseUrl}
          sessionToken={config.sessionToken}
        />
      );
}
