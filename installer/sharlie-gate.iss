; Per-user setup. People who run this do not need Node.js or Inno Setup.
#ifndef MyAppVersion
  #define MyAppVersion "0.1.0"
#endif

#define MyAppName "Sharlie Gate"
#define MyAppPublisher "liviu-stefan-pit"
#define MyAppURL "https://github.com/liviu-stefan-pit/sharlie-gate"

[Setup]
AppId={{8F3E2A91-4C7B-4D15-9E6A-2B1F0C8D5A47}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
DefaultDirName={localappdata}\Programs\Sharlie-Gate
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir=..\dist\installer
OutputBaseFilename=SharlieGate-Setup
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
ChangesEnvironment=yes
CloseApplications=yes
RestartApplications=no
LicenseFile=..\LICENSE
UninstallDisplayName={#MyAppName}

[Files]
Source: "staging\node.exe"; DestDir: "{app}\node"; DestName: "node.exe"; Flags: ignoreversion
Source: "staging\sharlie-gate.mjs"; DestDir: "{app}\app"; Flags: ignoreversion
Source: "staging\tree-sitter.wasm"; DestDir: "{app}\app"; Flags: ignoreversion
Source: "staging\grammars\*"; DestDir: "{app}\app\grammars"; Flags: ignoreversion recursesubdirs
Source: "sharlie-gate.cmd"; DestDir: "{app}"; Flags: ignoreversion
Source: "dashboard-hidden.vbs"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{autoprograms}\Sharlie Gate Dashboard"; Filename: "{sys}\wscript.exe"; Parameters: """{app}\dashboard-hidden.vbs"""; WorkingDir: "{app}"
Name: "{autoprograms}\Uninstall Sharlie Gate"; Filename: "{uninstallexe}"

[Run]
Filename: "{app}\node\node.exe"; Parameters: """{app}\app\sharlie-gate.mjs"" init"; WorkingDir: "{app}"; StatusMsg: "Configuring detected editors..."; Flags: runhidden waituntilterminated

[UninstallRun]
Filename: "{app}\node\node.exe"; Parameters: """{app}\app\sharlie-gate.mjs"" uninstall --purge"; WorkingDir: "{app}"; Flags: runhidden waituntilterminated; RunOnceId: "PurgeSharlieGate"

[Code]
const
  SMTO_ABORTIFHUNG = 2;
  WM_SETTINGCHANGE = $001A;

function SendMessageTimeout(Wnd: HWND; Msg: UINT; wParam: LongWord; lParam: String; fuFlags: UINT; uTimeout: UINT; var lpdwResult: DWORD): LongWord;
  external 'SendMessageTimeoutW@user32.dll stdcall';

procedure NotifyEnvChange;
var
  ResultCode: DWORD;
begin
  SendMessageTimeout($FFFF, WM_SETTINGCHANGE, 0, 'Environment', SMTO_ABORTIFHUNG, 5000, ResultCode);
end;

function PathHasEntry(Orig, Entry: string): Boolean;
begin
  Result := Pos(';' + LowerCase(Entry) + ';', ';' + LowerCase(Orig) + ';') > 0;
end;

function RemovePathEntry(Orig, Entry: string): string;
var
  Rest, Part: string;
  Mark: Integer;
begin
  Result := '';
  Rest := Orig;
  while Rest <> '' do
  begin
    Mark := Pos(';', Rest);
    if Mark = 0 then
    begin
      Part := Rest;
      Rest := '';
    end
    else
    begin
      Part := Copy(Rest, 1, Mark - 1);
      Rest := Copy(Rest, Mark + 1, MaxInt);
    end;
    if (Part <> '') and (CompareText(Part, Entry) <> 0) then
    begin
      if Result <> '' then Result := Result + ';';
      Result := Result + Part;
    end;
  end;
end;

procedure AddAppToPath;
var
  Orig, Entry: string;
begin
  Entry := ExpandConstant('{app}');
  if not RegQueryStringValue(HKEY_CURRENT_USER, 'Environment', 'Path', Orig) then
    Orig := '';
  if PathHasEntry(Orig, Entry) then Exit;
  if Orig = '' then
    RegWriteExpandStringValue(HKEY_CURRENT_USER, 'Environment', 'Path', Entry)
  else
    RegWriteExpandStringValue(HKEY_CURRENT_USER, 'Environment', 'Path', Orig + ';' + Entry);
  NotifyEnvChange;
end;

procedure RemoveAppFromPath;
var
  Orig, Entry: string;
begin
  Entry := ExpandConstant('{app}');
  if not RegQueryStringValue(HKEY_CURRENT_USER, 'Environment', 'Path', Orig) then Exit;
  if not PathHasEntry(Orig, Entry) then Exit;
  RegWriteExpandStringValue(HKEY_CURRENT_USER, 'Environment', 'Path', RemovePathEntry(Orig, Entry));
  NotifyEnvChange;
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssPostInstall then
    AddAppToPath;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if CurUninstallStep = usPostUninstall then
    RemoveAppFromPath;
end;
