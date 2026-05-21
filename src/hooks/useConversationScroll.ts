import { useCallback, useEffect, useRef, useState } from "react";

export function useConversationScroll({
  markUiInteraction,
  messagesLength,
  selectedPersonalityId,
}: {
  markUiInteraction: () => void;
  messagesLength: number;
  selectedPersonalityId: string;
}) {
  const [showScrollBottom, setShowScrollBottom] = useState(false);
  const conversationScrollRef = useRef<HTMLElement | null>(null);
  const conversationEndRef = useRef<HTMLDivElement | null>(null);
  const lastMessageCountRef = useRef(0);

  const handleChatScroll = useCallback((event: React.UIEvent<HTMLDivElement>) => {
    markUiInteraction();
    const target = event.target as HTMLDivElement;
    const isScrolledUp =
      target.scrollHeight - target.scrollTop - target.clientHeight > 150;
    setShowScrollBottom(isScrolledUp);
  }, [markUiInteraction]);

  const scrollToBottom = useCallback(() => {
    if (conversationScrollRef.current) {
      conversationScrollRef.current.scrollTo({
        top: conversationScrollRef.current.scrollHeight,
        behavior: "smooth",
      });
    }
  }, []);

  const snapConversationToBottom = useCallback(() => {
    const container = conversationScrollRef.current;
    if (!container) return;
    container.scrollTo({
      top: container.scrollHeight,
      behavior: "auto",
    });
  }, []);

  const ensureConversationStartsAtBottom = useCallback(() => {
    window.requestAnimationFrame(() => {
      snapConversationToBottom();
      window.requestAnimationFrame(() => {
        snapConversationToBottom();
      });
    });
    window.setTimeout(() => {
      snapConversationToBottom();
    }, 60);
  }, [snapConversationToBottom]);

  useEffect(() => {
    if (messagesLength !== 0) {
      return;
    }

    window.requestAnimationFrame(() => {
      const container = conversationScrollRef.current;
      if (!container) return;
      container.scrollTo({
        top: container.scrollHeight,
        behavior: "auto",
      });
    });
  }, [messagesLength, selectedPersonalityId]);

  return {
    conversationScrollRef,
    conversationEndRef,
    lastMessageCountRef,
    showScrollBottom,
    handleChatScroll,
    scrollToBottom,
    ensureConversationStartsAtBottom,
  };
}
