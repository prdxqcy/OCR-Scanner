!macro preInit
  SetRegView 64
  WriteRegExpandStr HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation "$PROGRAMFILES64\FarmTracker4V"
  WriteRegExpandStr HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation "$PROGRAMFILES64\FarmTracker4V"
  SetRegView 32
  WriteRegExpandStr HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation "$PROGRAMFILES\FarmTracker4V"
  WriteRegExpandStr HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation "$PROGRAMFILES\FarmTracker4V"
!macroend

!macro customInit
  ${if} ${RunningX64}
    StrCpy $INSTDIR "$PROGRAMFILES64\FarmTracker4V"
  ${else}
    StrCpy $INSTDIR "$PROGRAMFILES\FarmTracker4V"
  ${endif}
!macroend

!macro customInstall
  Delete "$DESKTOP\FarmTracker.lnk"
  Delete "$SMPROGRAMS\FarmTracker.lnk"
  CreateShortCut "$DESKTOP\FarmTracker.lnk" "$WINDIR\System32\wscript.exe" '"$INSTDIR\FarmTracker Launcher.vbs"' "$INSTDIR\FarmTracker.exe" 0
  CreateShortCut "$SMPROGRAMS\FarmTracker.lnk" "$WINDIR\System32\wscript.exe" '"$INSTDIR\FarmTracker Launcher.vbs"' "$INSTDIR\FarmTracker.exe" 0
!macroend

!macro customUnInstall
  Delete "$DESKTOP\FarmTracker.lnk"
  Delete "$SMPROGRAMS\FarmTracker.lnk"
!macroend
