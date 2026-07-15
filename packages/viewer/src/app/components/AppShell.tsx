/**
 * The shared layout wrapping every route (ui-pass-spec.md §3.2): a top nav
 * bar (`Header`) over a single full-width main area. Until #83 this also
 * mounted `<TodosPanel>` as a persistent right-side sibling on every
 * route -- the todo queue is retired from shell chrome now that it has its
 * own home, the Lab's Queue mode (`/lab?view=queue`, `Queue.tsx`); a route
 * that has nothing to do with todos no longer renders a rail for them.
 * Quick capture (the add-todo form) lives in Queue now, not here.
 *
 * `useBundles()` is called here (for the header's bundle count) AND
 * separately inside `Board`/`Queue` (for their own bundle-scoped needs) --
 * independent SSE-refreshed hook instances, not a shared store. That
 * mirrors the existing pattern documented in `runtime/useBundleDetail.ts`
 * et al: each hook subscribes to the journal stream on its own, so there
 * is no cross-route cache to invalidate.
 */
import type { FC, ReactNode } from "react";
import { useBundles } from "../runtime/useBundles.ts";
import { useWorkspace } from "../runtime/useWorkspace.ts";
import { Header } from "./Header.tsx";

export const AppShell: FC<{ children: ReactNode }> = ({ children }) => {
  const { bundles } = useBundles();
  const { state } = useWorkspace();

  return (
    <div className="flex min-h-screen flex-col">
      <Header workspaceName={state?.workspace.name} bundleCount={bundles.length} />
      <div className="flex flex-1">
        <main className="flex-1 overflow-x-auto p-6">{children}</main>
      </div>
    </div>
  );
};
