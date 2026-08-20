$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$desktop = [Environment]::GetFolderPath('Desktop')
$shortcutPath = Join-Path $desktop 'Mina.lnk'
$powershell = (Get-Command powershell.exe).Source
$launcher = Join-Path $PSScriptRoot 'launch-mina.ps1'
$icon = Join-Path $ProjectRoot 'assets\Logo\mina-vision.ico'
$appUserModelId = 'fr.sourireconcept.minavision'

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $powershell
$shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$launcher`""
$shortcut.WorkingDirectory = $ProjectRoot
$shortcut.Description = 'Lancer Mina — agent visuel local'
# Icône du raccourci bureau = logo Mina Vision (généré par scripts/generate-icons.mjs),
# jamais l'icône générique d'Electron.
if (Test-Path -LiteralPath $icon) { $shortcut.IconLocation = "$icon,0" }
$shortcut.Save()

# Windows lie mieux l'icône de barre des tâches / gestionnaire à l'app quand le raccourci porte le
# même AppUserModelID que `app.setAppUserModelId(...)` dans Electron.
if (-not ('MinaShortcutIdentity' -as [type])) {
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

[ComImport, Guid("00021401-0000-0000-C000-000000000046")]
public class ShellLink {}

[ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("0000010B-0000-0000-C000-000000000046")]
public interface IPersistFile {
  void GetClassID(out Guid pClassID);
  [PreserveSig] int IsDirty();
  void Load([MarshalAs(UnmanagedType.LPWStr)] string pszFileName, uint dwMode);
  void Save([MarshalAs(UnmanagedType.LPWStr)] string pszFileName, bool fRemember);
  void SaveCompleted([MarshalAs(UnmanagedType.LPWStr)] string pszFileName);
  void GetCurFile([MarshalAs(UnmanagedType.LPWStr)] out string ppszFileName);
}

[StructLayout(LayoutKind.Sequential, Pack = 4)]
public struct PROPERTYKEY {
  public Guid fmtid;
  public uint pid;
}

[StructLayout(LayoutKind.Sequential)]
public struct PROPVARIANT {
  public ushort vt;
  public ushort wReserved1;
  public ushort wReserved2;
  public ushort wReserved3;
  public IntPtr p;
  public int p2;

  public static PROPVARIANT FromString(string value) {
    var variant = new PROPVARIANT();
    variant.vt = 31; // VT_LPWSTR
    variant.p = Marshal.StringToCoTaskMemUni(value);
    return variant;
  }

  [DllImport("ole32.dll")]
  private static extern int PropVariantClear(ref PROPVARIANT pvar);

  public void Clear() {
    PropVariantClear(ref this);
  }
}

[ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99")]
public interface IPropertyStore {
  [PreserveSig] int GetCount(out uint cProps);
  [PreserveSig] int GetAt(uint iProp, out PROPERTYKEY pkey);
  [PreserveSig] int GetValue(ref PROPERTYKEY key, out PROPVARIANT pv);
  [PreserveSig] int SetValue(ref PROPERTYKEY key, ref PROPVARIANT pv);
  [PreserveSig] int Commit();
}

public static class MinaShortcutIdentity {
  public static void SetAppUserModelId(string shortcutPath, string appUserModelId) {
    object link = new ShellLink();
    ((IPersistFile)link).Load(shortcutPath, 2); // STGM_READWRITE
    var store = (IPropertyStore)link;
    var key = new PROPERTYKEY {
      fmtid = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"),
      pid = 5 // System.AppUserModel.ID
    };
    var value = PROPVARIANT.FromString(appUserModelId);
    try {
      int setResult = store.SetValue(ref key, ref value);
      if (setResult != 0) Marshal.ThrowExceptionForHR(setResult);
      int commitResult = store.Commit();
      if (commitResult != 0) Marshal.ThrowExceptionForHR(commitResult);
      ((IPersistFile)link).Save(shortcutPath, true);
    } finally {
      value.Clear();
    }
  }
}
'@
}

[MinaShortcutIdentity]::SetAppUserModelId($shortcutPath, $appUserModelId)

Write-Output $shortcutPath
