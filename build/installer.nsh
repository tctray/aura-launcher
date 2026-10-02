!macro customCheckAppRunning
  ; Close any running copy of AURA (including stuck, invisible ones) before installing
  nsExec::Exec 'taskkill /F /IM "aura.exe" /T'
  Sleep 1000
!macroend
