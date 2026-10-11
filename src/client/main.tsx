import { lazy, Suspense, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createTheme, MantineProvider } from "@mantine/core";
import "@mantine/core/styles.css";
import "./styles.css";
const AdminPage = lazy(() => import("./pages/AdminPage.js"));
const PlayerPage = lazy(() => import("./pages/PlayerPage.js"));
const theme = createTheme({
  primaryColor: "teal",
  primaryShade: 6,
  defaultRadius: "sm",
  fontFamily:
    'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  fontSizes: { xs: "0.75rem", sm: "0.8125rem", md: "0.875rem" },
  colors: {
    dark: [
      "#e3e6eb",
      "#b6bec9",
      "#949daa",
      "#626c7b",
      "#3c444f",
      "#2d333d",
      "#222730",
      "#1b1f26",
      "#171b21",
      "#111419",
    ],
    teal: [
      "#e8f9f8",
      "#c9eceb",
      "#a1d9da",
      "#79c7ca",
      "#59b7bc",
      "#43a8ae",
      "#328e96",
      "#297780",
      "#25636b",
      "#21535b",
    ],
  },
});
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <MantineProvider theme={theme} forceColorScheme="dark">
      <Suspense fallback={<div className="app-loading" />}>
        {location.pathname === "/player" ? <PlayerPage /> : <AdminPage />}
      </Suspense>
    </MantineProvider>
  </StrictMode>,
);
