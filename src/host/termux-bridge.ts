import { Capacitor, registerPlugin } from "@capacitor/core";

interface TermuxBridgePlugin {
  readonly startNova: () => Promise<Readonly<{ started: boolean }>>;
}

const TermuxBridge = registerPlugin<TermuxBridgePlugin>("TermuxBridge");

export async function startNovaInTermux(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) {
    return false;
  }

  const result = await TermuxBridge.startNova();
  return result.started === true;
}
