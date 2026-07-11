import type { FC } from "react";
import { Board } from "./components/Board.tsx";

/**
 * The whole client-routed React app. Phase 3 has exactly one route (the
 * Board) -- no router library.
 */
const App: FC = () => <Board />;

export default App;
