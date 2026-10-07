<!-- Added by aura-reliability-setup.cjs -->
# AURA's checks

Run them all:

    npm test

GitHub runs the same thing before it builds a release. If anything fails, no release is built,
so a broken version can't reach the update button.

## What is checked

| Part | What it catches |
|---|---|
| Project files | A typing mistake in the main-process code, the window calling something that doesn't answer, keys or backups about to be packed into the installer |
| The error log | The log file being written, capped and rotated properly |
| Database rules | Who can read, send, delete, block, report and call, checked against a real Postgres engine using the SQL in the `supabase` folder |
| Messaging | The real `electron/social.js` with several pretend users sending to each other |
| Voice calls | Ringing, accepting, hanging up and missed calls between pretend users. The sound itself can only be checked by making a real call |
| The window | The built window opens and every page in the menu loads without crashing |

## Reading a failure

Look for lines starting with `FAIL`. Each says what was expected in plain words, and what
happened instead. Copy those lines to Claude.

## Running part of it

    npm test -- files
    npm test -- messages
    npm test -- window

The window check needs a browser. It uses Edge or Chrome if you have one; otherwise run
`npx playwright install chromium` once.

## The `supabase` folder

These are the SQL files that set up friends, messages and voice calls, kept here so the checks test exactly
what is in your database. If you change the database, change the file here too and run it in
Supabase.
