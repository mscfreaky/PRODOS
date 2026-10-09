# Third-party notices and provenance

PRODOS project-owned code is distributed under the MIT License in LICENSE. Dependencies and platform components retain their original copyright and license terms.

The application continues the supplied ATEM Inspector 1.3 codebase through release 0.3.2. Original archive SHA-256: `8160b5872d438c61a02fc8dc5cf6616d3240e5ae4e28ec9f29986396d8110e5c`. The original development ZIP is not included in the public package. The Windows inspector, bridge and production workflow are continued source, not a replacement application.

Direct Node dependencies:
- atem-connection 3.10.2 — MIT — https://github.com/Sofie-Automation/sofie-atem-connection
- qrcode 1.5.4 — MIT — https://github.com/soldair/node-qrcode

Exact transitive versions are pinned in bridge/package-lock.json. Their distributed license and notice files remain in node_modules in the Windows package; npm restores them for source builds. See docs/DEPENDENCIES.json for the installed package inventory. Optional native font dependencies are not used by the read-only bridge; installation scripts are intentionally disabled.

The Windows package contains the .NET runtime. Its license and third-party notices are in licenses/. Node.js and cloudflared are external prerequisites and are not bundled executables. cloudflared is provided by Cloudflare under its own license.

Product names belong to their respective owners. No endorsement or affiliation is implied.
