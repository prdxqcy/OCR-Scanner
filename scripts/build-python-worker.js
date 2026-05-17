const { spawnSync } = require("child_process");
const path = require("path");

const root = path.join(__dirname, "..");
const scannerPath = path.join(root, "python", "scanner.py");

const isWindows = process.platform === "win32";
const pythonCommand = isWindows ? "py" : "python3";
const pythonArgs = isWindows ? ["-3.11"] : [];

const args = [
  ...pythonArgs,
  "-m",
  "PyInstaller",
  "--noconfirm",
  "--clean",
  "--onedir",
  "--name",
  "scanner-worker",
  "--distpath",
  path.join("python", "dist"),
  "--workpath",
  path.join("python", "build", "pyinstaller-work"),
  "--specpath",
  path.join("python", "build", "spec"),
  "--collect-all",
  "rapidocr_onnxruntime",
  scannerPath
];

const result = spawnSync(pythonCommand, args, {
  cwd: root,
  stdio: "inherit",
  shell: false
});

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}
