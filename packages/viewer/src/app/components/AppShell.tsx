/**
 * The shared layout wrapping every route (ui-pass-spec.md §3.2): a top nav
 * bar (`Header`) plus `<TodosPanel>` as a persistent right-side sibling to
 * whatever the current route renders in the main area. This is what keeps
 * the "single-active-badge" discipline (ui-pass-spec.md §1.7) load-bearing
 * across routes -- one shell owns cross-cutting chrome (workspace name,
 * bundle count, todos) instead of each route reinventing it, the way
 * `StudioApp.tsx` used to.
 *
 * `useBundles()` is called here (for the todos bundle-picker and the
 * header's bundle count) AND separately inside `Board` (for the stage
 * columns) -- two independent SSE-refreshed hook instances, not a shared
 * store. That mirrors the existing pattern documented in
 * `runtime/useBundleDetail.ts` et al: each hook subscribes to the journal
 * stream on its own, so there is no cross-route cache to invalidate.
 */
import type { FC, ReactNode } from "react";
import { useBundles } from "../runtime/useBundles.ts";
import { useWorkspace } from "../runtime/useWorkspace.ts";
import { Header } from "./Header.tsx";
import { TodosPanel } from "./TodosPanel.tsx";

export const AppShell: FC<{ children: ReactNode }> = ({ children }) => {
  const { bundles } = useBundles();
  const { state } = useWorkspace();

  return (
    <div className="flex min-h-screen flex-col">
      <Header workspaceName={state?.workspace.name} bundleCount={bundles.length} />
      <div className="flex flex-1">
        <main className="flex-1 overflow-x-auto p-6">{children}</main>
        <TodosPanel bundles={bundles} />
      </div>
    </div>
  );
};
