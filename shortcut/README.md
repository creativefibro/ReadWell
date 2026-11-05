# Save to ReadWell Shortcut

Made by `tools/make_shortcut.py`. The unsigned file holds no secrets; Shortcuts asks for the
capture key, Client ID and Client secret on import. To install (on the Mac):

    cd ~/Projects/ReadWell/shortcut
    shortcuts sign --mode anyone --input "Save to ReadWell (unsigned).shortcut" --output "Save to ReadWell.shortcut"
    open "Save to ReadWell.shortcut"

The signed copy is not kept in git. iCloud syncs the imported Shortcut to iPhone and iPad.
