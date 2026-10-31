import { createContext, useContext, type ReactNode } from "react";

const PortalContainerContext = createContext<HTMLElement | null>(null);

/** Keep floating document controls inside the embedding host’s styled surface. */
export function PortalProvider({ container, children }: { container: HTMLElement; children: ReactNode }) {
  return <PortalContainerContext.Provider value={container}>{children}</PortalContainerContext.Provider>;
}

/** Null retains the standalone app’s document.body placement. */
export const usePortalContainer = () => useContext(PortalContainerContext);
