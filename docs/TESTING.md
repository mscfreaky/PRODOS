# Release validation — PRODOS 1.0.0

Validation date: 2026-10-10 (Europe/Berlin).

## Results
- Node.js 24.20.0: 40 tests passed, 0 failed. See TEST-LOG.txt.
- Windows x64 self-contained publish succeeded using .NET SDK 8.0.425.
- Windows integration harness built with 0 warnings and 0 errors. Four native demo starts/restarts retained the same show; chapter next/previous, push and explicit acknowledgement passed; attaching to an existing owner and detaching preserved that owner's server. See NATIVE-TEST-LOG.txt.
- Browser views checked in English: director, editorial, presenter and camera. Presenter chapter advancement and camera Understood acknowledgement were exercised in the browser. Director reading mode retains chat access.
- Camera layouts measured at 320×480 and 568×320: document dimensions match viewport dimensions; chat composer remains inside the screen. A longer English cue and Understood button were inspected in landscape.
- Dependency versions match the installed dependencies shipped with release 0.3.2. Inherited root lockfile metadata was corrected to match those actual packages; no dependency upgrade was introduced. A clean dependency restore was checked separately.
- Source/package checks reject previous branding, personal workspace paths, runtime show data and accidental credentials. ZIP CRC and SHA-256 checks are generated during packaging.

## Automated coverage
Persistence/reopening, create/load/duplicate, question active/done/reactivate ordering, chapter permissions and concurrency, schedule and actual timing, event history, targeted/broadcast/team chat, explicit receipts, fixed recipients, token rotation, authorization and minimum disclosure, public/private route isolation, offline ATEM, corrupt data handling, atomic-save rollback, locks and instance reuse, portable import/export, backups, presence and preflight, live-flash transitions, reader settings, push replay prevention, tunnel registration/DNS/missing executable/timeout behavior, and the neutral default script.

## Limits
No physical ATEM was connected for release validation. Model/firmware compatibility is not certified. Real Cloudflare internet availability was not verified in this release pass; tunnel lifecycle/error paths were tested using controlled processes and endpoints. The GitHub Actions workflow is supplied but has not been run on GitHub. Operating-system dialogs and external component logs may use the local system language.

## Reproduce
From bridge, run `npm ci --ignore-scripts --no-audit --no-fund` then `npm test`. Build with `01_SETUP_AND_BUILD.cmd`. Run the Windows integration harness with `powershell -ExecutionPolicy Bypass -File .\07_TEST_INSPECTOR.ps1`. Tests use separate temporary files and loopback servers; firewall restrictions can prevent execution.
