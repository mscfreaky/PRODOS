# Architecture

The Windows Forms application (`AtemInspector/Program.cs`, .NET 8) starts or attaches to the Node bridge and reads the private loopback APIs. The executable is branded PRODOS; the internal namespace and project directory retain their original names for traceability.

`bridge/server.js` connects read-only to the ATEM or generates simulated state. `cloud-tally.js` computes eight camera tallies on M/E 1 and manages the isolated public server. `tunnel-process.js` starts Cloudflare Quick Tunnel over HTTP/2 and requires registration before publishing a connected URL.

`production-store.js` owns the schema-1 persistent store, authorization, two-state questions, show lifecycle, explicit acknowledgements and ephemeral push delivery. Atomic file replacement and backups protect writes. `data-lock.js` and `instance.js` prevent competing writers and support verified instance reuse. `show-transfer.js` validates portable bundles and regenerates tokens/IDs on import.

`production.js` routes private and public requests, validates role credentials, serves static assets, builds snapshots and performs presence/preflight checks. `web/app.js` polls and renders with DOM text nodes and a small safe Markdown subset; no runtime CDN is required. `web/ui-state.js` contains reader, timing, live-flash and push replay state.

Internal role identifiers `regie`, `redaktion`, `moderation` remain stable for data compatibility and authorization. They are displayed as Director, Editorial and Presenter. Camera identifiers remain `camera1` through `camera8`. Role paths preserve `/role/redaktion` and `/role/moderation`; visible UI text is English. Export format is `PRODOS-show`, version 1; validated schema-compatible uppercase product-name bundles are accepted for migration.

The dependency versions and production behavior remain those of release 0.3.2. Version/branding, English text, neutral sample content, package metadata and separate PRODOS data/settings paths are the intentional release changes. There is no new input discovery, account system, cloud provider or switcher control feature.
