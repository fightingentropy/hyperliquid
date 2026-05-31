import { useEffect, useRef, useState } from "react";

const RESOURCE_CACHE = new Map();
const RESOURCE_CACHE_MAX_ENTRIES = 150;

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

  pruneResourceCache();
}

function pruneResourceCache() {
  if (RESOURCE_CACHE.size <= RESOURCE_CACHE_MAX_ENTRIES) {
    return;
  }

  const oldestEntries = [...RESOURCE_CACHE.entries()].sort(
    (left, right) => left[1].timestamp - right[1].timestamp,
  );
  const removeCount = RESOURCE_CACHE.size - RESOURCE_CACHE_MAX_ENTRIES;

  oldestEntries.slice(0, removeCount).forEach(([cacheKey]) => {
    RESOURCE_CACHE.delete(cacheKey);
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
  const dependencyKey = JSON.stringify(dependencies);

  const buildInitialState = () => {
    const cachedData = readCachedResource(cacheKey, staleTimeMs);
    const hasLoaded = cachedData !== undefined;

    return {
      data: hasLoaded ? cachedData : initialDataRef.current,
      error: null,
      isLoading: enabled && !hasLoaded,
      isRefreshing: false,
      hasLoaded,
    };
  };

  const [state, setState] = useState(buildInitialState);

  useEffect(() => {
    if (!enabled) {
      const cachedData = readCachedResource(cacheKey, staleTimeMs);
      setState({
        data: cachedData ?? initialDataRef.current,
        error: null,
        isLoading: false,
        isRefreshing: false,
        hasLoaded: cachedData !== undefined,
      });
      return;
    }

    const cachedData = readCachedResource(cacheKey, staleTimeMs);
    const hasLoaded = cachedData !== undefined;
    setState({
      data: hasLoaded ? cachedData : initialDataRef.current,
      error: null,
      isLoading: !hasLoaded,
      isRefreshing: false,
      hasLoaded,
    });
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
            hasLoaded: true,
          });
          return;
        }
      }

      setState((previous) => ({
        ...previous,
        isLoading: !previous.hasLoaded && !isRefresh,
        isRefreshing: previous.hasLoaded || isRefresh,
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
          hasLoaded: true,
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
  }, [enabled, intervalMs, pauseInBackground, cacheKey, staleTimeMs, dependencyKey]);

  return state;
}
