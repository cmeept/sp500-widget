; installer.nsh - Installer script for S&P 500 Widget
; Handles cleanup of old version, autostart, and data preservation

!macro customInstall
  ; --- Kill running old widget process before installing ---
  nsExec::ExecToLog 'taskkill /F /IM "S&P 500 Widget.exe"'
  nsExec::ExecToLog 'taskkill /F /IM "SP500Widget.exe"'
  ; Small delay to let processes fully terminate
  Sleep 1000

  ; --- Clean up old version files ---
  ; Remove old temp/config files (portfolio is migrated by the app on first launch)
  Delete "$PROFILE\.sp500-widget-config.json"
  Delete "$PROFILE\.sp500-widget-temp.json"
  Delete "$APPDATA\sp500-widget-autostart.txt"

  ; --- Set up autostart in Windows registry ---
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "SP500Widget" '"$INSTDIR\${PRODUCT_FILENAME}.exe"'

  ; Show success message
  MessageBox MB_ICONINFORMATION "S&P 500 Widget installed successfully!$\n$\nFeatures:$\n• Real-time S&P 500 tracking$\n• Stock portfolio management$\n• Live quotes and prices$\n• Autostart with Windows$\n$\nWidget will start automatically with Windows.$\n$\nNote: Your portfolio data has been preserved."
!macroend

!macro customUnInstall
  ; --- Kill running widget process ---
  nsExec::ExecToLog 'taskkill /F /IM "S&P 500 Widget.exe"'
  Sleep 500

  ; --- Remove autostart from registry ---
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "SP500Widget"

  ; --- Ask user about data files ---
  MessageBox MB_YESNO|MB_ICONQUESTION "Remove user data files?$\n$\nThis includes:$\n• Window position settings$\n• Portfolio data$\n• Price cache$\n$\nChoose 'Yes' for complete removal or 'No' to keep data." IDYES DeleteUserData IDNO SkipUserData

  DeleteUserData:
    ; Remove electron-store data (new format)
    RMDir /r "$APPDATA\sp500-widget"
    ; Remove legacy config files (old format)
    Delete "$PROFILE\.sp500-widget-config.json"
    Delete "$PROFILE\.sp500-widget-portfolio.json"
    Delete "$PROFILE\.sp500-widget-temp.json"
    Delete "$APPDATA\sp500-widget-autostart.txt"
    MessageBox MB_ICONINFORMATION "S&P 500 Widget completely removed.$\nAll user data has been cleared."
    Goto EndUninstall

  SkipUserData:
    MessageBox MB_ICONINFORMATION "S&P 500 Widget removed.$\nUser data preserved."

  EndUninstall:
!macroend
