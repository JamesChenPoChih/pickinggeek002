import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { LanguageProvider } from "./i18n";
import "./styles.css";
import { registerPwa } from './pwa';

registerPwa();

document.documentElement.dataset.theme = localStorage.getItem("pickinggeek_theme") || "system";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode><LanguageProvider><App /></LanguageProvider></React.StrictMode>,
);
