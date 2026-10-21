Set shell = CreateObject("Wscript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
app = fso.GetParentFolderName(WScript.ScriptFullName)
cmd = """" & app & "\node\node.exe"" """ & app & "\app\sharlie-gate.mjs"" dashboard"
shell.Run cmd, 0, False
