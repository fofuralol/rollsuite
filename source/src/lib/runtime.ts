export const IS_DESKTOP = typeof window !== "undefined" && (window as any).electronAPI?.isDesktop === true;
