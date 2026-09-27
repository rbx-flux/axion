import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import { MeProvider } from "./auth";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <MeProvider>
        <App />
      </MeProvider>
    </BrowserRouter>
  </StrictMode>,
);
