import { useEffect, useRef, useState } from "react";

const RESOURCE_CACHE = new Map();

function readCachedResource(cacheKey, staleTimeMs) {
  if (!cacheKey || staleTimeMs <= 0) {
    return undefined;
  }

  const cachedEntry = RESOURCE_CACHE.get(cacheKey);
  if (!cachedEntry) {
    return undefined;
  }

  if (Date.now() - cachedEntry.timestamp > staleTimeMs) {
    RESOURCE_CACHE.delete(cacheKey);
    return undefined;
  }

  return cachedEntry.data;
}

function writeCachedResource(cacheKey, data) {
  if (!cacheKey) {
    return;
  }

  RESOURCE_CACHE.set(cacheKey, {
    data,
    timestamp: Date.now(),
  });
}

export function usePollingResource(request, dependencies, options = {}) {
  const {
    enabled = true,
    intervalMs = 0,
    initialData = null,
    cacheKey = "",
    staleTimeMs = 0,
    pauseInBackground = intervalMs > 0,
  } = options;
  const requestRef = useRef(request);
  const initialDataRef = useRef(initialData);
  requestRef.current = request;
  initialDataRef.current = initialData;

  const buildInitialState = () => {
    const cachedData = readCachedResource(cacheKey, staleTimeMs);

    return {
      data: cachedData !== undefined ? cachedData : initialDataRef.current,
      error: null,
      isLoading: enabled && cachedData === undefined,
      isRefreshing: false,
    };
  };

  const [state, setState] = useState(buildInitialState);

  useEffect(() => {
    if (!enabled) {
      setState({
        data: readCachedResource(cacheKey, staleTimeMs) ?? initialDataRef.current,
        error: null,
        isLoading: false,
        isRefreshing: false,
      });
      return;
    }

    setState(buildInitialState());
  }, [enabled, cacheKey, staleTimeMs]);

  useEffect(() => {
    if (!enabled) {
      return undefined;
    }

    let isActive = true;
    let intervalId;

    const load = async (isRefresh) => {
      if (!isRefresh) {
        const cachedData = readCachedResource(cacheKey, staleTimeMs);
        if (cachedData !== undefined) {
          setState({
            data: cachedData,
            error: null,
            isLoading: false,
            isRefreshing: false,
          });
          return;
        }
      }

      setState((previous) => ({
        ...previous,
        isLoading: previous.data === null && !isRefresh,
        isRefreshing: previous.data !== null || isRefresh,
        error: null,
      }));

      try {
        const data = await requestRef.current();

        if (!isActive) {
          return;
        }

        writeCachedResource(cacheKey, data);
        setState({
          data,
          error: null,
          isLoading: false,
          isRefreshing: false,
        });
      } catch (error) {
        if (!isActive) {
          return;
        }

        setState((previous) => ({
          ...previous,
          error,
          isLoading: false,
          isRefreshing: false,
        }));
      }
    };

    void load(false);

    if (intervalMs > 0) {
      intervalId = window.setInterval(() => {
        if (pauseInBackground && typeof document !== "undefined" && document.hidden) {
          return;
        }

        void load(true);
      }, intervalMs);
    }

    const handleVisibilityChange = () => {
      if (!pauseInBackground || typeof document === "undefined" || document.hidden) {
        return;
      }

      void load(true);
    };

    if (pauseInBackground && typeof document !== "undefined") {
      document.addEventListener("visibilitychange", handleVisibilityChange);
    }

    return () => {
      isActive = false;
      if (intervalId) {
        window.clearInterval(intervalId);
      }
      if (pauseInBackground && typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", handleVisibilityChange);
      }
    };
  }, [enabled, intervalMs, pauseInBackground, cacheKey, staleTimeMs, ...dependencies]);

  return state;
}
