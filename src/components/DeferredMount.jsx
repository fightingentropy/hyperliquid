import { useEffect, useState } from "react";

export default function DeferredMount({
  children,
  fallback = null,
  timeoutMs = 1200,
}) {
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") {
      setIsReady(true);
      return undefined;
    }

    if ("requestIdleCallback" in window) {
      const idleId = window.requestIdleCallback(() => setIsReady(true), {
        timeout: timeoutMs,
      });

      return () => {
        window.cancelIdleCallback(idleId);
      };
    }

    const timeoutId = window.setTimeout(() => setIsReady(true), 0);
    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [timeoutMs]);

  return isReady ? children : fallback;
}
