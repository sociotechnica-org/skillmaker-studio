import type { FC } from "react";
import { AppShell } from "./components/AppShell.tsx";
import { Board } from "./components/Board.tsx";
import { BundlePanel } from "./components/BundlePanel.tsx";
import { Lab } from "./components/Lab.tsx";
import { ActivityFeed } from "./components/ActivityFeed.tsx";
import { Receive } from "./components/Receive.tsx";
import { Ship, SkillbookBundlePage } from "./components/Ship.tsx";
import { RouterProvider, useRouter } from "./runtime/router.tsx";

/**
 * The whole client-routed React app (ui-pass-spec §3.1/§4.2): a hand-rolled
 * pushState router feeding a route switch, with `AppShell` (nav chrome only
 * as of #83 -- the persistent TodosPanel rail is retired) wrapping every
 * route.
 */
const Routes: FC = () => {
  const { route } = useRouter();

  switch (route.name) {
    case "board":
      return <Board />;
    case "bundle":
      return <BundlePanel slug={route.slug} tab={route.tab} runId={route.runId} file={route.file} />;
    case "lab":
      return <Lab view={route.view} bundle={route.bundle} />;
    case "activity":
      return <ActivityFeed />;
    case "ship":
      return <Ship />;
    case "ship-bundle":
      return <SkillbookBundlePage slug={route.slug} />;
    case "receive":
      return <Receive />;
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
