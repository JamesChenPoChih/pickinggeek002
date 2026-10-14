import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { LanguageProvider } from "./i18n";
import "./styles.css";
import { registerPwa } from './pwa';

registerPwa();

const savedTheme = localStorage.getItem("pickinggeek_theme");
const theme = savedTheme === "dark" || savedTheme === "light" ? savedTheme
  : savedTheme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
localStorage.setItem("pickinggeek_theme", theme);
document.documentElement.dataset.theme = theme;

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode><LanguageProvider><App /></LanguageProvider></React.StrictMode>,
);
