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
