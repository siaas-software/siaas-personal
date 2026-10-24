import type { NextConfig } from "next";
const config: NextConfig = {
  ...(process.env.SIAAS_BUILD_DESKTOP === "1"
    ? { output: "standalone" as const }
    : {}),
  outputFileTracingExcludes: {
    "/*": [
      "./test-results/**",
      "./.env*",
      "./desktop/**",
      "./tests/**",
      "./.desktop/**",
      // Do not exclude generic dist/build directories: Turbopack also matches
      // dependency output, including Next's request context and document readers.
    ],
  },
  // Preserve the original local texts for the offline license viewer in standalone builds.
  outputFileTracingIncludes: {
    "/api/licenses": [
      "./LICENSE",
      "./THIRD_PARTY_NOTICES.md",
      "./services/laya/LICENSE",
      "./services/morphic/LICENSE",
      "./services/morphic/NOTICE",
    ],
  },
  serverExternalPackages: ["mammoth", "unpdf", "exceljs", "papaparse", "yauzl"],
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
};
export default config;
