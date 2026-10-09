# Operator guide

## Prepare a show
Open Production Suite on the director PC. Create a show, or load/duplicate a saved one. Only one is active. Changes save automatically. Duplicate copies script, schedule, assignments and questions, resets question completion and actual timing, and starts with new role links and no chat history.

Set planned start/end using the local PC time zone. Click Start show at the actual start and End at the actual finish. Before start the clock counts down; on air it counts up and shows remaining scheduled time or overrun. Reset actual timing retains the event log. Keep the PC clock correct.

Import `examples/Studio-show.md` or your own Markdown. Headings of levels 1–3 become chapters. Director, editorial and presenter can use chapter arrows or selection; camera roles cannot. Chapter changes highlight the current heading and do not force scrolling. Jump to chapter is explicit. Set optional chapter durations in minutes (0 means no target).

Assign the presenter camera (HDMI 1–8) and role display names. These names label chat/presence; they are not accounts or access controls. Select required roles to define Production team recipients and preflight expectations. Previously sent messages keep their original recipients. Direct addressing and All roles still work independently of this selection.

## Connect the crew
Start Cloudflare, wait for a connected state and run the external preflight check. Scan individual role QR codes. A local preview link only works on the director PC. Use the public HTTPS links for phones on mobile data. Rescan after a tunnel URL change, active show change or role-link renewal.

Editorial and presenter workspaces show the script/questions on the left and status/chat on the right. The presenter status uses the assigned camera. Adjust reading mode, text size, line width, spacing and theme locally. Director and editorial keep chat access in reading mode. Camera pages prioritize tally, timing and the current cue; message history scrolls inside its panel.

## Questions and chat
Editorial staff manually paste questions from an external platform. Mark answered questions Done; they become grey and move to the bottom. Reactivate to return them to active questions. Presenter can mark questions done but cannot add them.

Send chat to the production team, all roles or an individual role. Camera replies go to the director. Press Understood to acknowledge a message. One check means at least one intended role acknowledged; two means all intended roles acknowledged. Opening or viewing a message alone does not count. There is no mark-as-unread action.

Director push notifications use the blue three-second overlay on all editorial, presenter and camera pages. Presets: Audio is off and Audio is going live. Free text is limited to 160 characters. Push history is stored, but expired pushes do not replay after restart/import. Only camera pages flash red for one second on a subsequent transition to LIVE; presenter pages do not.

## Persistence and recovery
Live and demo data are stored separately under `%LOCALAPPDATA%\PRODOS`. An explicit `PRODOS_DATA_PATH` is useful for isolated tests. Stop the app before manually backing up/restoring files. Automatic `.bak` and rotating backup files are maintained. Do not edit a running data file or remove a live lock file. A second compatible instance can attach to the existing instance; disconnecting it leaves the owner running.

Export a show before transferring it. Import creates a new show with fresh IDs and role keys. Existing script/question/message language is preserved. Compatible schema-1 show bundles from earlier releases remain importable. Do not put private exports into the public repository.

## Troubleshooting
- Missing bridge: extract the full Windows ZIP or rebuild; keep `publish/bridge` beside `PRODOS.exe`.
- No ATEM: check IPv4, PC-to-ATEM routing, firewall and firmware compatibility. Phones can still use a tunnel without ATEM LAN membership.
- No tunnel: check cloudflared installation, DNS, proxy, firewall and system clock. `CLOUDFLARED_EXE` can point to an installed executable. Diagnostics are available in the director workspace.
- Lost role connection: check the PC, active show and current QR code. A disconnected clock is not a confirmed live time.
- Four-input ATEM: use slots 1–4 only; 5–8 are not automatically disabled in this release.
