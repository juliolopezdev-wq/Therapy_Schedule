import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { lazy, Suspense } from "react";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import ProtectedRoute from "./components/ProtectedRoute";
import SessionTimeoutNotice from "./components/SessionTimeoutNotice";
import { ThemeProvider } from "./contexts/ThemeContext";

const AdminUsers = lazy(() => import("./pages/AdminUsers"));
const Login = lazy(() => import("./pages/Login"));
const NotFound = lazy(() => import("./pages/NotFound"));
const TherapyBoard = lazy(() => import("./pages/TherapyBoard"));

function PageFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
      Loading…
    </div>
  );
}

function Router() {
  return (
    <Switch>
      <Route path={"/login"} component={Login} />
      <Route path={"/"}>
        <ProtectedRoute>
          <TherapyBoard />
        </ProtectedRoute>
      </Route>
      <Route path={"/board"}>
        <ProtectedRoute>
          <TherapyBoard />
        </ProtectedRoute>
      </Route>
      <Route path={"/admin/users"}>
        <ProtectedRoute roles={["admin"]}>
          <AdminUsers />
        </ProtectedRoute>
      </Route>
      <Route path={"/404"} component={NotFound} />
      {/* Final fallback route */}
      <Route component={NotFound} />
    </Switch>
  );
}

// NOTE: About Theme
// - First choose a default theme according to your design style (dark or light bg), than change color palette in index.css
//   to keep consistent foreground/background color across components
// - If you want to make theme switchable, pass `switchable` ThemeProvider and use `useTheme` hook

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider
        defaultTheme="light"
        // switchable
      >
        <TooltipProvider>
          <Toaster />
          <SessionTimeoutNotice />
          <Suspense fallback={<PageFallback />}>
            <Router />
          </Suspense>
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
