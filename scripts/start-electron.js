const path = require("path");
const { spawn } = require("child_process");

const electronBinary = require("electron");
const env = { ...process.env };

delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electronBinary, ["."], {
  cwd: path.join(__dirname, ".."),
  stdio: "inherit",
  env,
  windowsHide: false
});

child.on("exit", (code) => {
  process.exit(code ?? 0);
});
