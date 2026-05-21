import { useEffect, type Dispatch, type SetStateAction } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { ChatMessage } from "../types";
import type { LocalImageDataUrl } from "../appCore";

export function useStoredImageHydration({
  settingsLoaded,
  messages,
  setMessages,
}: {
  settingsLoaded: boolean;
  messages: ChatMessage[];
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
}) {
  useEffect(() => {
    if (!settingsLoaded) return;
    const missingImages: Array<{ messageId: string; partIndex: number; path: string }> = [];
    messages.forEach((message) => {
      if (!Array.isArray(message.content)) return;
      message.content.forEach((part, partIndex) => {
        if (part.type === "image_url" && part.image_url.local_path && !part.image_url.url) {
          missingImages.push({ messageId: message.id, partIndex, path: part.image_url.local_path });
        }
      });
    });
    if (!missingImages.length) return;

    let cancelled = false;
    Promise.all(
      missingImages.map(async (item) => {
        try {
          const result = await invoke<LocalImageDataUrl>("read_local_image_data_url", { path: item.path });
          return { ...item, url: result.data_url };
        } catch (error) {
          console.error("Stored image reload error:", error);
          return { ...item, url: "" };
        }
      }),
    ).then((loaded) => {
      if (cancelled) return;
      const loadedByPart = new Map(loaded.filter((item) => item.url).map((item) => [`${item.messageId}:${item.partIndex}`, item.url]));
      if (!loadedByPart.size) return;
      setMessages((prev) =>
        prev.map((message) => {
          if (!Array.isArray(message.content)) return message;
          let changed = false;
          const content = message.content.map((part, partIndex) => {
            if (part.type !== "image_url") return part;
            const url = loadedByPart.get(`${message.id}:${partIndex}`);
            if (!url) return part;
            changed = true;
            return { ...part, image_url: { ...part.image_url, url } };
          });
          return changed ? { ...message, content } : message;
        }),
      );
    });

    return () => {
      cancelled = true;
    };
  }, [settingsLoaded, messages, setMessages]);
}
