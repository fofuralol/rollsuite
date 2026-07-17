import { createContext, useContext, ReactNode } from "react";

const PaneContainerContext = createContext<HTMLElement | null>(null);

export function PaneContainerProvider({
  container,
  children,
}: {
  container: HTMLElement | null;
  children: ReactNode;
}) {
  return (
    <PaneContainerContext.Provider value={container}>
      {children}
    </PaneContainerContext.Provider>
  );
}

export function usePaneContainer() {
  return useContext(PaneContainerContext);
}
