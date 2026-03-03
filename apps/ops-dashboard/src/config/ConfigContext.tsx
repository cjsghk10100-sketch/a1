import { createContext, useContext } from "react";
import type { ReactNode } from "react";

import type { AppConfig } from "./loadConfig";

type ConfigContextValue = {
  config: AppConfig;
};

const ConfigContext = createContext<ConfigContextValue | null>(null);

export function ConfigProvider({
  value,
  children,
}: {
  value: ConfigContextValue;
  children: ReactNode;
}): JSX.Element {
  return <ConfigContext.Provider value={value}>{children}</ConfigContext.Provider>;
}

export function useConfig(): ConfigContextValue {
  const ctx = useContext(ConfigContext);
  if (!ctx) {
    throw new Error("ConfigContext is not available");
  }
  return ctx;
}
