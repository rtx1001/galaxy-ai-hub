import { Dispatch, MutableRefObject, SetStateAction } from "react";

type UseChatStopOptions = {
  activeChatAbortRef: MutableRefObject<AbortController | null>;
  activeChatRequestRef: MutableRefObject<number>;
  sendInFlightRef: MutableRefObject<boolean>;
  setBrainStatus: Dispatch<SetStateAction<"Idle" | "Loading" | "Ready" | "Thinking" | "Error">>;
  setComposerNotice: Dispatch<SetStateAction<string>>;
  setIsStreaming: Dispatch<SetStateAction<boolean>>;
};

export function useChatStop(options: UseChatStopOptions) {
  const stopActiveResponse = () => {
    options.activeChatRequestRef.current += 1;
    options.activeChatAbortRef.current?.abort();
    options.activeChatAbortRef.current = null;
    options.sendInFlightRef.current = false;
    options.setIsStreaming(false);
    options.setBrainStatus("Ready");
    options.setComposerNotice("Stopped.");
  };

  return { stopActiveResponse };
}
