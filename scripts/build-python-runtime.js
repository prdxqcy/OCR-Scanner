const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const runtimeDir = path.join(root, "python", "runtime");
const requirementsPath = path.join(root, "python", "runtime-requirements.txt");
const isWindows = process.platform === "win32";

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    shell: false
  });

  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

if (!fs.existsSync(runtimeDir)) {
  run(isWindows ? "py.exe" : "python3", isWindows ? ["-3.11", "-m", "venv", runtimeDir] : ["-m", "venv", runtimeDir]);
}

const runtimePython = isWindows
  ? path.join(runtimeDir, "Scripts", "python.exe")
  : path.join(runtimeDir, "bin", "python3");

run(runtimePython, ["-m", "ensurepip", "--upgrade"]);
run(runtimePython, ["-m", "pip", "install", "--upgrade", "pip"]);
run(runtimePython, ["-m", "pip", "install", "-r", requirementsPath]);
