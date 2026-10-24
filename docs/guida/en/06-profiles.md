# Profiles and notifications
> section: Make it yours
> summary: Profiles that switch by themselves, notification rules, "in front of a client" and settings backup.

## Profiles
Each profile has its own **integrations, widgets, quick actions, position, look, sounds, theme, notification rules, chat instructions and connectors**. You start with **Work**, **Home** and **Focus**; you can create more (for example one per client, with its own instructions for the chat). **Telegram** does not: it is one per PC, on or off in every profile.

- Switch profile from Settings or from the notification area icon (**Profile ▸**), and also from the chat or an automation.
- **Automatic switch**: each profile can have rules on **Wi-Fi network**, **days** and **time** (e.g. *Work* on the office Wi-Fi, Mon–Fri 8–18). Every minute EasyIsland activates the first profile that matches; a choice made by hand stays until the situation changes.

## Notifications
**Settings → Notifications** decides how much the island makes itself heard, per profile:
- **Everything**, **alerts only**, or **permission requests only** (as *Focus* is).
- Which events open the island, which play a sound, which stay as a dot in the menu.

## In front of a client
The character steps aside when someone might see your screen:
- **During calls**: microphone or webcam in use by any app (Teams, Zoom, Meet, Webex…). It reads this from where Windows records who uses them.
- **During remote support**: someone is connected to this PC (Remote Desktop, Quick Assist, TeamViewer) or a program you add is open.
- **By hand**: notification area icon → **In front of a client**.

What it does: **hides the character and mutes sounds**, or just mutes. Permission requests still appear; 3CX calls show only the dot, without the caller's name. No name, title or text stays on screen.

## Backup and transfer
**Settings → Backup**:
- **Export…** saves to a JSON file in the Documents folder every setting (profiles included), the chat's memory, skills, tasks, custom integrations, the chat history and the habits.
- **Import…** loads them on another PC. Nothing that was there is deleted: each folder is set aside (`… .prima-del-ripristino-<date>`), then EasyIsland restarts.
- Keys are never in the file: they must be entered again. The Notion map and the recipes, encrypted for this PC, are rebuilt by themselves.
