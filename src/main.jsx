import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import DieDesigner from "./die-designer.jsx";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <DieDesigner />
  </StrictMode>
);
