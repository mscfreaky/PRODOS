# Security and deployment

This release is designed for trusted production crews and local demonstrations. It has not undergone an independent security audit.

The director server binds to loopback and checks Host and Origin. A separate loopback server exposes only role pages/assets and authenticated role actions to Cloudflare. Never tunnel the director port, expose it using another proxy, or bind it to a public interface. Public users must not receive raw ATEM state, director management, export, QR management or tunnel controls.

Role QR codes and URL fragments are bearer credentials. Anyone holding one can act as that role. Share them privately; renew role links if exposed. Switching active shows invalidates old active-show access. There is no user account system or multi-factor authentication. People sharing a role share its acknowledgement identity.

Markdown supports a small safe subset. Raw HTML and links are rendered as inert text. Treat exported shows, ATEM JSON exports, local databases and backups as sensitive: they may contain scripts, messages, personal information and configuration. Local data is not encrypted by this application. Exports omit role tokens but are not automatically anonymized.

Cloudflare Quick Tunnel is retained. It is intended for testing, has temporary hostnames and no uptime SLA. Internet/DNS/firewall restrictions can prevent startup; a printed URL alone does not establish a working tunnel. Corporate IT approval may be needed for the ATEM network, Node.js, cloudflared, firewall/proxy rules and unsigned software. Phones need internet access but do not need to share the ATEM LAN.

The director PC must stay running with network access. Keep an independent production communication fallback. Blue push overlays fill the browser viewport, not operating-system chrome; they last three seconds and are not a guaranteed emergency alert channel. Delivery depends on connectivity and foreground browser execution.

Do not post credentials or private show files in public GitHub issues. Before publishing a security report, use a private maintainer contact or GitHub private vulnerability reporting if the repository owner enables it. No security response SLA is offered.
