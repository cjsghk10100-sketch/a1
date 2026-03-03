import { useCallback, useEffect, useRef, useState } from "react";

import type { ApiErrorInfo, ApiResult, DrilldownItem, DrilldownResponse, HealthIssueKind } from "../api/types";

const DEFAULT_LIMIT = 20;

export interface DrilldownState {
  kind: HealthIssueKind | null;
  items: DrilldownItem[];
  truncated: boolean;
  loading: boolean;
  error: ApiErrorInfo | null;
  open: (kind: HealthIssueKind) => void;
  loadMore: () => void;
  close: () => void;
  refresh: () => void;
}

export function useDrilldown(
  fetcher: (
    kind: HealthIssueKind,
    limit: number,
    cursor?: string,
    signal?: AbortSignal,
  ) => Promise<ApiResult<DrilldownResponse>>,
): DrilldownState {
  const [kind, setKind] = useState<HealthIssueKind | null>(null);
  const [items, setItems] = useState<DrilldownItem[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ApiErrorInfo | null>(null);

  const inFlightRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  const fetchPage = useCallback(
    async (targetKind: HealthIssueKind, nextCursor?: string, replace = false) => {
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      setLoading(true);

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const result = await fetcher(targetKind, DEFAULT_LIMIT, nextCursor, controller.signal);
        if (!result.ok) {
          setError(result.error);
          return;
        }

        setError(null);
        setKind(targetKind);
        setCursor(result.data.next_cursor ?? undefined);
        setTruncated(result.data.truncated);
        setItems((prev) => (replace ? result.data.items : [...prev, ...result.data.items]));
      } finally {
        inFlightRef.current = false;
        setLoading(false);
      }
    },
    [fetcher],
  );

  const open = useCallback(
    (nextKind: HealthIssueKind) => {
      setItems([]);
      setCursor(undefined);
      setTruncated(false);
      setError(null);
      void fetchPage(nextKind, undefined, true);
    },
    [fetchPage],
  );

  const loadMore = useCallback(() => {
    if (!kind || !cursor || !truncated) return;
    void fetchPage(kind, cursor, false);
  }, [kind, cursor, truncated, fetchPage]);

  const close = useCallback(() => {
    abortRef.current?.abort();
    setKind(null);
    setItems([]);
    setCursor(undefined);
    setTruncated(false);
    setError(null);
    setLoading(false);
  }, []);

  const refresh = useCallback(() => {
    if (!kind) return;
    setItems([]);
    setCursor(undefined);
    setTruncated(false);
    void fetchPage(kind, undefined, true);
  }, [kind, fetchPage]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  return {
    kind,
    items,
    truncated,
    loading,
    error,
    open,
    loadMore,
    close,
    refresh,
  };
}
