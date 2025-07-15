; installer.nsh - Simple installer script for S&P 500 Widget
; Basic autostart functionality without problematic sections

!macro customInstall
  ; Add to Windows startup registry
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "SP500Widget" '"$INSTDIR\${PRODUCT_FILENAME}.exe"'
  
  ; Create autostart settings file
  FileOpen $0 "$APPDATA\sp500-widget-autostart.txt" w
  FileWrite $0 "enabled"
  FileClose $0
  
  ; Show success message
  MessageBox MB_ICONINFORMATION "S&P 500 Widget installed successfully!$\n$\nWidget features:$\n• Real-time S&P 500 tracking$\n• Stock portfolio management$\n• Live quotes and prices$\n• Autostart with Windows$\n$\nWidget will start automatically with Windows boot."
!macroend

!macro customUnInstall
  ; Remove from startup registry
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "SP500Widget"
  
  ; Remove autostart settings file
  Delete "$APPDATA\sp500-widget-autostart.txt"
  
  ; Ask user about data files
  MessageBox MB_YESNO|MB_ICONQUESTION "Remove user data files?$\n$\nThis includes:$\n• Window position settings$\n• Portfolio data$\n• Price cache$\n$\nChoose 'Yes' for complete removal or 'No' to keep data files." IDYES DeleteUserData IDNO SkipUserData
  
  DeleteUserData:
    ; Remove user configuration files
    Delete "$PROFILE\.sp500-widget-config.json"
    Delete "$PROFILE\.sp500-widget-portfolio.json"
    MessageBox MB_ICONINFORMATION "S&P 500 Widget completely removed.$\nAll user data has been cleared."
    Goto EndUninstall
  
  SkipUserData:
    MessageBox MB_ICONINFORMATION "S&P 500 Widget removed.$\nUser data preserved in profile folder."
  
  EndUninstall:
!macroend