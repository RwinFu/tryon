import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./test/browser",
  timeout: 90000,
  workers: 1,
  outputDir: ".cache/browser-results",
  use: {
    baseURL: "http://127.0.0.1:8080",
    viewport: { width: 1000, height: 850 },
    screenshot: "only-on-failure",
    launchOptions: {
      executablePath:
        process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
      args: [
        "--no-sandbox",
        "--use-gl=angle",
        "--use-angle=swiftshader",
        "--enable-unsafe-swiftshader",
      ],
    },
  },
  webServer: {
    command: "node tools/serve.mjs 8080",
    url: "http://127.0.0.1:8080/test/browser/harness.html",
    reuseExistingServer: !process.env.CI,
  },
});
