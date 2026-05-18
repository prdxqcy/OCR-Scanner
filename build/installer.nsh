!macro customInstall
  Delete "$DESKTOP\OCR Scanner.lnk"
  Delete "$SMPROGRAMS\OCR Scanner.lnk"
  CreateShortCut "$DESKTOP\OCR Scanner.lnk" "$WINDIR\System32\wscript.exe" '"$INSTDIR\OCR Scanner Launcher.vbs"'
  CreateShortCut "$SMPROGRAMS\OCR Scanner.lnk" "$WINDIR\System32\wscript.exe" '"$INSTDIR\OCR Scanner Launcher.vbs"'
!macroend

!macro customUnInstall
  Delete "$DESKTOP\OCR Scanner.lnk"
  Delete "$SMPROGRAMS\OCR Scanner.lnk"
!macroend
