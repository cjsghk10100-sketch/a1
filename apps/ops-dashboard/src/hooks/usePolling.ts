import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { ApiErrorInfo, ApiResult } from "../api/types";

export interface PollingState<T> {
  data: T | null;
  error: ApiErrorInfo | null;
  loading: boolean;
  lastUpdatedAt: Date | null;
  stale: boolean;
  forceRefresh: () => void;
}

export function usePolling<T>(
  fetcher: (signal: AbortSignal) => Promise<ApiResult<T>>,
  intervalMs: number,
  options?: { enabled?: boolean; minIntervalMs?: number; resetKey?: string | number; stopOnAuthError?: boolean },
): PollingState<T> {
  const enabled = options?.enabled ?? true;
  const stopOnAuthError = options?.stopOnAuthError ?? true;
  const minIntervalMs = options?.minIntervalMs ?? 0;
  const effectiveIntervalMs = useMemo(() => Math.max(intervalMs, minIntervalMs), [intervalMs, minIntervalMs]);

  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiErrorInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const [stale, setStale] = useState(false);

  const mountedRef = useRef(true);
  const inFlightRef = useRef(false);
  const dataRef = useRef<T | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const resetRef = useRef(options?.resetKey);
  const pausedByAuthRef = useRef(false);

  const execute = useCallback(async (manual = false) => {
    if (!enabled || inFlightRef.current || (pausedByAuthRef.current && !manual)) {
      return;
    }

    inFlightRef.current = true;
    setLoading(dataRef.current == null);

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const result = await fetcher(controller.signal);
      if (!mountedRef.current) return;
      if (result.ok) {
        pausedByAuthRef.current = false;
        dataRef.current = result.data;
        setData(result.data);
        setError(null);
        setStale(false);
        setLastUpdatedAt(new Date());
      } else {
        if (stopOnAuthError && result.error.category === "auth") {
          pausedByAuthRef.current = true;
        }
        setError(result.error);
        setStale(dataRef.current != null);
      }
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
      inFlightRef.current = false;
    }
  }, [enabled, fetcher, stopOnAuthError]);

  const forceRefresh = useCallback(() => {
    pausedByAuthRef.current = false;
    void execute(true);
  }, [execute]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    void execute();

    const onVisibility = () => {
      if (!document.hidden) {
        void execute();
      }
    };

    const timer = window.setInterval(() => {
      if (document.hidden) return;
      void execute();
    }, effectiveIntervalMs);

    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.clearInterval(timer);
    };
  }, [enabled, effectiveIntervalMs, execute]);

  useEffect(() => {
    const current = options?.resetKey;
    if (resetRef.current === current) {
      return;
    }
    resetRef.current = current;

    abortRef.current?.abort();
    inFlightRef.current = false;
    pausedByAuthRef.current = false;
    dataRef.current = null;
    setData(null);
    setError(null);
    setLastUpdatedAt(null);
    setStale(false);
    setLoading(true);

    if (enabled) {
      void execute();
    }
  }, [enabled, execute, options?.resetKey]);

  return {
    data,
    error,
    loading,
    lastUpdatedAt,
    stale,
    forceRefresh,
  };
}
