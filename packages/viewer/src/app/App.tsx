import type { FC } from "react";
import { AppShell } from "./components/AppShell.tsx";
import { Board } from "./components/Board.tsx";
import { Lab } from "./components/Lab.tsx";
import { Receive } from "./components/Receive.tsx";
import { Ship, SkillbookBundlePage } from "./components/Ship.tsx";
import { SkillCard } from "./components/SkillCard.tsx";
import { Track } from "./components/Track.tsx";
import { RouterProvider, useRouter } from "./runtime/router.tsx";

/**
 * The whole client-routed React app (ui-pass-spec §3.1/§4.2): a hand-rolled
 * pushState router feeding a route switch, with `AppShell` (nav chrome only
 * as of #83 -- the persistent TodosPanel rail is retired) wrapping every
 * route. #109: a bundle renders as its skill card (`SkillCard`, replacing
 * `BundlePanel`), and Activity's slot is Track (old `/activity` deep links
 * alias into Track's Feed via the router).
 */
const Routes: FC = () => {
  const { route } = useRouter();

  switch (route.name) {
    case "board":
      return <Board />;
    case "bundle":
      return (
        <SkillCard
          slug={route.slug}
          tab={route.tab}
          runId={route.runId}
          file={route.file}
          fixture={route.fixture}
          from={route.from}
        />
      );
    case "lab":
      return <Lab view={route.view} bundle={route.bundle} />;
    case "track":
      return <Track view={route.view} archive={route.archive} />;
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
