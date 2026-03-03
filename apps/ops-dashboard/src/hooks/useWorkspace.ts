import { useCallback, useEffect, useState } from "react";

import type { AppConfig } from "../config/loadConfig";

export interface WorkspaceState {
  workspaceId: string;
  setWorkspace: (nextWorkspaceId: string) => void;
}

function readWorkspace(defaultWorkspaceId: string): string {
  const params = new URLSearchParams(window.location.search);
  const fromUrl = params.get("workspace")?.trim();
  return fromUrl && fromUrl.length > 0 ? fromUrl : defaultWorkspaceId;
}

function writeWorkspace(workspaceId: string): void {
  const url = new URL(window.location.href);
  url.searchParams.set("workspace", workspaceId);
  window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
}

export function useWorkspace(config: AppConfig): WorkspaceState {
  const [workspaceId, setWorkspaceId] = useState(() => readWorkspace(config.defaultWorkspaceId));

  useEffect(() => {
    const onPopState = () => {
      setWorkspaceId(readWorkspace(config.defaultWorkspaceId));
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [config.defaultWorkspaceId]);

  const setWorkspace = useCallback((nextWorkspaceId: string) => {
    const normalized = nextWorkspaceId.trim();
    if (!normalized) return;
    setWorkspaceId(normalized);
    writeWorkspace(normalized);
  }, []);

  useEffect(() => {
    writeWorkspace(workspaceId);
  }, [workspaceId]);

  return {
    workspaceId,
    setWorkspace,
  };
}
