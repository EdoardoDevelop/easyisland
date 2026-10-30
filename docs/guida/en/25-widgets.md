# Widgets
> section: Connecting services
> summary: Repeatable checks without code: sites, certificates, domains, servers, ports, services, calendars, APIs.

**Settings → Widgets** adds checks you can repeat as many times as you like (a site per client, a server per office…). Unlike integrations, which are one per service, widgets are **probes**.

| Kind | What it checks |
|---|---|
| **Calendar** | Upcoming appointments from an ICS link (Google Calendar, Outlook.com, iCloud), no sign-in; alerts a few minutes before. The link is secret and lives in the Credential Manager |
| **Domain expiry** | Days until one or more domains expire (RDAP, or WHOIS for registries like `.it`) |
| **Website** | That an address answers (2xx/3xx or the status you set) and how fast |
| **HTTPS certificate** | Days until expiry: orange under 30, red under 7 or expired |
| **Ping** | That a host answers (no administrator rights) |
| **TCP port** | That a port is open (e.g. 3389, 22, 443) |
| **Windows service** | That a local service is running (e.g. `Spooler`) |
| **JSON API** | Any API: the fields to show (a path like `data.items[0].status`) and an alert rule (e.g. `open > 10`); secret headers in the Credential Manager |

- **▶** tests a widget right away.
- When a check goes from OK to a problem: dot in the menu, sound, island showing up (following the profile's notifications). A new error shows only if it repeats 15 seconds later, and after standby checks wait for the network to come back.
- Rarer on battery, stopped when paused.
- Widgets belong to the profile and can start an [automation](16-automations.md).

> **Tip:** for a single service with more data (an API with lists, alerts and actions) a [custom integration](24-custom-integrations.md) with a data source is better.
