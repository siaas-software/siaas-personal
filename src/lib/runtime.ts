// Desktop is an explicit, local-only runtime. Hosting always wins over local flags.
export function isDesktop() {
  return process.env.SIAAS_RUNTIME === "desktop" && process.env.VERCEL !== "1";
}
export const LOCAL_USER_ID = "00000000-0000-4000-8000-000000000001";
