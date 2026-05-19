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

function runJson(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    shell: false
  });

  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }

  if (result.status !== 0) {
    process.stderr.write(result.stderr || "");
    process.exit(result.status ?? 1);
  }

  return JSON.parse(result.stdout.trim());
}

function getPythonInfo() {
  const command = isWindows ? "py.exe" : "python3";
  const args = isWindows
    ? ["-3.11", "-c", "import json, sys; print(json.dumps({'executable': sys.executable, 'base_prefix': sys.base_prefix}))"]
    : ["-c", "import json, sys; print(json.dumps({'executable': sys.executable, 'base_prefix': sys.base_prefix}))"];

  return runJson(command, args);
}

function copyPortablePython(sourceDir, destinationDir) {
  fs.rmSync(destinationDir, { recursive: true, force: true });
  fs.mkdirSync(destinationDir, { recursive: true });

  fs.cpSync(sourceDir, destinationDir, {
    recursive: true,
    filter: (sourcePath) => {
      const relativePath = path.relative(sourceDir, sourcePath);
      if (!relativePath) {
        return true;
      }

      const normalized = relativePath.split(path.sep).join("/");
      if (normalized.startsWith("Lib/site-packages/")) {
        return false;
      }

      return !normalized.includes("/__pycache__/");
    }
  });

  fs.rmSync(path.join(destinationDir, "Lib", "site-packages"), { recursive: true, force: true });
  fs.mkdirSync(path.join(destinationDir, "Lib", "site-packages"), { recursive: true });
}

const pythonInfo = getPythonInfo();
copyPortablePython(pythonInfo.base_prefix, runtimeDir);

const runtimePython = isWindows
  ? path.join(runtimeDir, "python.exe")
  : path.join(runtimeDir, "bin", "python3");

run(runtimePython, ["-m", "ensurepip", "--upgrade"]);
run(runtimePython, ["-m", "pip", "install", "--upgrade", "pip", "setuptools"]);
run(runtimePython, ["-m", "pip", "install", "--no-warn-script-location", "-r", requirementsPath]);
