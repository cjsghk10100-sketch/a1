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

type PollingCacheEntry = {
  data: unknown;
  lastUpdatedAt: Date;
};

const pollingCache = new Map<string, PollingCacheEntry>();

export function usePolling<T>(
  fetcher: (signal: AbortSignal) => Promise<ApiResult<T>>,
  intervalMs: number,
  options?: {
    enabled?: boolean;
    minIntervalMs?: number;
    resetKey?: string | number;
    stopOnAuthError?: boolean;
    cacheKey?: string;
  },
): PollingState<T> {
  const enabled = options?.enabled ?? true;
  const stopOnAuthError = options?.stopOnAuthError ?? true;
  const minIntervalMs = options?.minIntervalMs ?? 0;
  const effectiveIntervalMs = useMemo(() => Math.max(intervalMs, minIntervalMs), [intervalMs, minIntervalMs]);
  const cacheKey = options?.cacheKey;
  const cached = useMemo(() => {
    if (!cacheKey) return null;
    return pollingCache.get(cacheKey) ?? null;
  }, [cacheKey]);

  const [data, setData] = useState<T | null>(() => (cached?.data as T | null) ?? null);
  const [error, setError] = useState<ApiErrorInfo | null>(null);
  const [loading, setLoading] = useState(cached == null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(() => cached?.lastUpdatedAt ?? null);
  const [stale, setStale] = useState(false);

  const mountedRef = useRef(true);
  const inFlightRef = useRef(false);
  const dataRef = useRef<T | null>((cached?.data as T | null) ?? null);
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
      // Ignore intentional aborts (route change/reset/manual cancel) so they don't
      // surface as timeout/network errors in panel status.
      if (controller.signal.aborted) {
        return;
      }
      if (result.ok) {
        pausedByAuthRef.current = false;
        dataRef.current = result.data;
        setData(result.data);
        setError(null);
        setStale(false);
        const now = new Date();
        setLastUpdatedAt(now);
        if (cacheKey) {
          pollingCache.set(cacheKey, {
            data: result.data,
            lastUpdatedAt: now,
          });
        }
      } else {
        if (stopOnAuthError && result.error.category === "auth") {
          pausedByAuthRef.current = true;
        }
        setError(result.error);
        setStale(dataRef.current != null);
      }
    } catch {
      if (!mountedRef.current || controller.signal.aborted) return;
      setError({
        status: 0,
        reason: "polling_exception",
        category: "server",
      });
      setStale(dataRef.current != null);
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
      inFlightRef.current = false;
    }
  }, [cacheKey, enabled, fetcher, stopOnAuthError]);

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
    const resetCached = cacheKey ? pollingCache.get(cacheKey) ?? null : null;
    dataRef.current = (resetCached?.data as T | null) ?? null;
    setData((resetCached?.data as T | null) ?? null);
    setError(null);
    setLastUpdatedAt(resetCached?.lastUpdatedAt ?? null);
    setStale(false);
    setLoading(resetCached == null);

    if (enabled) {
      void execute();
    }
  }, [cacheKey, enabled, execute, options?.resetKey]);

  return {
    data,
    error,
    loading,
    lastUpdatedAt,
    stale,
    forceRefresh,
  };
}
