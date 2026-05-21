import { useEffect, useRef, useState } from "react";

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

  const handleChatScroll = (event: React.UIEvent<HTMLDivElement>) => {
    markUiInteraction();
    const target = event.target as HTMLDivElement;
    const isScrolledUp =
      target.scrollHeight - target.scrollTop - target.clientHeight > 150;
    setShowScrollBottom(isScrolledUp);
  };

  const scrollToBottom = () => {
    if (conversationScrollRef.current) {
      conversationScrollRef.current.scrollTo({
        top: conversationScrollRef.current.scrollHeight,
        behavior: "smooth",
      });
    }
  };

  const snapConversationToBottom = () => {
    const container = conversationScrollRef.current;
    if (!container) return;
    container.scrollTo({
      top: container.scrollHeight,
      behavior: "auto",
    });
  };

  const ensureConversationStartsAtBottom = () => {
    window.requestAnimationFrame(() => {
      snapConversationToBottom();
      window.requestAnimationFrame(() => {
        snapConversationToBottom();
      });
    });
    window.setTimeout(() => {
      snapConversationToBottom();
    }, 60);
  };

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
