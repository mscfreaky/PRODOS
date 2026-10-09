# ATEM compatibility

PRODOS 1.0.0 preserves release 0.3.2 behavior. It uses the read-only Ethernet state from `atem-connection` 3.10.2. No switcher control commands are sent.

| Configuration | Scope |
| --- | --- |
| ATEM Mini Extreme ISO | Original integration target; physical hardware not available for this release validation |
| Four-input ATEM Mini | Inputs 1–4 may work through the same protocol. Slots 5–8 remain visible; do not use them. Must be tested on the actual device and firmware |
| Other Ethernet ATEM models | Library support may allow connection, but PRODOS has not been verified on every model |
| Multiple M/E buses or more than eight inputs | Only M/E 1 and camera source IDs 1–8 participate in tally calculation |
| SuperSource | Source 6000 and enabled boxes of SuperSource 1 for camera inputs 1–8 are considered |
| Keyers | On-air upstream/downstream camera fill sources contribute to program tally; this is not a complete visibility/compositing model |
| USB connection | Not supported |

Program takes precedence over preview. On network disconnection, public pages show offline rather than a current tally. The inspector may retain a clearly identified last state.

Validate program, preview, transitions, keyers, SuperSource and disconnect behavior with your exact hardware/firmware before a show. Unavailable inputs are not automatically hidden. This release adds no input discovery.

Primary references:
- https://github.com/Sofie-Automation/sofie-atem-connection
- https://github.com/Sofie-Automation/sofie-atem-connection/blob/main/CHANGELOG.md
- https://www.blackmagicdesign.com/products/atemconstellation8k/techspecs

The library documents broad model support and firmware-dependent behavior; it explicitly does not support USB control. That is a library capability statement, not PRODOS certification.
