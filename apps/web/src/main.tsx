// SPDX-License-Identifier: AGPL-3.0-only
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { App } from "./app/App.tsx";
import { changeLocale, initialLocale } from "./i18n/index.tsx";
import "./theme/tokens.css";
import "./theme/app.css";
import "./theme/screens.css";

const root = createRoot(document.getElementById("root")!);
const render = () =>
  root.render(
    <StrictMode>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </StrictMode>,
  );
// The first paint is already in the visitor's language: Spanish loads its catalogs first (English
// has nothing to load). A failed load shows the page in English rather than nothing.
changeLocale(initialLocale()).then(render, render);
