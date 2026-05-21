import { useEffect, useRef, useState } from "react";

export function useComposerText() {
  const [input, setInput] = useState("");
  const [composerHasText, setComposerHasText] = useState(false);
  const composerInputRef = useRef<HTMLTextAreaElement | null>(null);
  const lastComposerInputAtRef = useRef(0);

  const resizeComposerTextarea = (node: HTMLTextAreaElement) => {
    node.style.height = "0px";
    node.style.height = `${Math.min(192, Math.max(42, node.scrollHeight))}px`;
  };

  const setComposerText = (text: string) => {
    lastComposerInputAtRef.current = Date.now();
    setInput(text);
    setComposerHasText(Boolean(text.trim()));
    const node = composerInputRef.current;
    if (node) {
      node.value = text;
      resizeComposerTextarea(node);
    }
  };

  const handleComposerInput = (node: HTMLTextAreaElement) => {
    lastComposerInputAtRef.current = Date.now();
    setComposerHasText((previous) => {
      const next = Boolean(node.value.trim());
      return previous === next ? previous : next;
    });
    resizeComposerTextarea(node);
  };

  useEffect(() => {
    const node = composerInputRef.current;
    if (!node) return;
    if (node.value !== input) {
      node.value = input;
    }
    setComposerHasText((previous) => {
      const next = Boolean(node.value.trim());
      return previous === next ? previous : next;
    });
    resizeComposerTextarea(node);
  }, [input]);

  return {
    input,
    composerHasText,
    composerInputRef,
    lastComposerInputAtRef,
    setComposerText,
    handleComposerInput,
  };
}
