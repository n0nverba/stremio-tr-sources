Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

' Proje ana dizinini belirle (scripts/ ust klasoru)
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
rootDir = fso.GetParentFolderName(scriptDir)

WshShell.CurrentDirectory = rootDir

' Konsol penceresi hic acilmadan arka planda calistir (0 = vbHide, False = arka plan)
WshShell.Run "node dist\index.js", 0, False
