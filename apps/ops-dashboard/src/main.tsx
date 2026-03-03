import React from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import { loadConfig } from "./config/loadConfig";
import { translate } from "./i18n/messages";
import "./index.css";

async function bootstrap() {
  const rootElement = document.getElementById("root");
  if (!rootElement) {
    throw new Error("Missing #root element");
  }

  try {
    const config = await loadConfig();
    createRoot(rootElement).render(
      <React.StrictMode>
        <App config={config} />
      </React.StrictMode>,
    );
  } catch (error) {
    rootElement.innerHTML = `<pre style="padding:16px;color:#b91c1c;">${translate("bootstrap.failed", {
      value: String(error),
    })}</pre>`;
  }
}

void bootstrap();
