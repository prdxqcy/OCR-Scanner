Set shell = CreateObject("WScript.Shell")
Set environment = shell.Environment("PROCESS")
Set fileSystem = CreateObject("Scripting.FileSystemObject")

environment.Remove "ELECTRON_RUN_AS_NODE"

installDir = fileSystem.GetParentFolderName(WScript.ScriptFullName)
appPath = fileSystem.BuildPath(installDir, "OCR Scanner.exe")

shell.Run """" & appPath & """", 1, False
