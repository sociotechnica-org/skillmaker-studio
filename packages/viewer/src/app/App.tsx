import type { FC } from "react";
import { AppShell } from "./components/AppShell.tsx";
import { Board } from "./components/Board.tsx";
import { BundlePanel } from "./components/BundlePanel.tsx";
import { Catalog } from "./components/Catalog.tsx";
import { ActivityFeed } from "./components/ActivityFeed.tsx";
import { Skillbook, SkillbookBundlePage } from "./components/Skillbook.tsx";
import { RouterProvider, useRouter } from "./runtime/router.tsx";

/**
 * The whole client-routed React app (ui-pass-spec §3.1/§4.2): a hand-rolled
 * pushState router feeding a route switch, with `AppShell` (nav + persistent
 * TodosPanel) wrapping every route.
 */
const Routes: FC = () => {
  const { route } = useRouter();

  switch (route.name) {
    case "board":
      return <Board />;
    case "bundle":
      return <BundlePanel slug={route.slug} tab={route.tab} runId={route.runId} />;
    case "catalog":
      return <Catalog />;
    case "activity":
      return <ActivityFeed />;
    case "skillbook":
      return <Skillbook />;
    case "skillbook-bundle":
      return <SkillbookBundlePage slug={route.slug} />;
    case "not-found":
      return (
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          Page not found.
        </p>
      );
  }
};

const App: FC = () => (
  <RouterProvider>
    <AppShell>
      <Routes />
    </AppShell>
  </RouterProvider>
);

export default App;
