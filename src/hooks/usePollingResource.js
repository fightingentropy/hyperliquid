import { useEffect, useRef, useState } from "react";

export function usePollingResource(request, dependencies, options = {}) {
  const { enabled = true, intervalMs = 0, initialData = null } = options;
  const requestRef = useRef(request);
  const initialDataRef = useRef(initialData);
  requestRef.current = request;
  initialDataRef.current = initialData;

  const [state, setState] = useState({
    data: initialData,
    error: null,
    isLoading: enabled,
    isRefreshing: false,
  });

  useEffect(() => {
    if (!enabled) {
      setState({
        data: initialDataRef.current,
        error: null,
        isLoading: false,
        isRefreshing: false,
      });
      return undefined;
    }

    let isActive = true;
    let intervalId;

    const load = async (isRefresh) => {
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

    load(false);

    if (intervalMs > 0) {
      intervalId = window.setInterval(() => load(true), intervalMs);
    }

    return () => {
      isActive = false;
      if (intervalId) {
        window.clearInterval(intervalId);
      }
    };
  }, [enabled, intervalMs, ...dependencies]);

  return state;
}
