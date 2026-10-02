export const config = {
  runner: "local",
  specs: ["./e2e-tauri/**/*.native.ts"],
  maxInstances: 1,
  capabilities: [
    {
      browserName: "tauri",
      "tauri:options": {
        application: "./src-tauri/target/debug/workshop",
      },
    },
  ],
  services: [["@wdio/tauri-service", { driverProvider: "embedded" }]],
  framework: "mocha",
  reporters: ["spec"],
  mochaOpts: {
    timeout: 30_000,
  },
  waitforTimeout: 5_000,
}
