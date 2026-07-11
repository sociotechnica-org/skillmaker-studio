/**
 * Subscribes to the server's `/api/events-stream` SSE endpoint and invokes
 * `onMessage` for every non-comment message the server emits (the server
 * sends an unnamed "journal" message on journal changes, plus periodic
 * heartbeat comments the browser's EventSource never surfaces as messages).
 * Reconnects automatically (native EventSource behavior);
 * this hook just owns the lifecycle.
 */
import { useEffect, useRef } from "react";

export const useEventStream = (path: string, onMessage: () => void): void => {
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  useEffect(() => {
    const source = new EventSource(path);
    const handleMessage = () => onMessageRef.current();
    source.addEventListener("message", handleMessage);
    return () => {
      source.removeEventListener("message", handleMessage);
      source.close();
    };
  }, [path]);
};
