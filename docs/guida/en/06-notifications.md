# Notifications
> section: Make it yours
> summary: Notification rules, "Do not disturb", "in front of a client" and settings backup.

## What opens the island
**Settings → Notifications** decides how much the island makes itself heard:
- **Everything**, **alerts only**, or **permission requests only**.
- **Do not disturb**, in the notification-area icon's menu (or with a right click on the resting character): switches to *permission requests only* and, turned off, goes back to the earlier choice.
- Which events open the island, which play a sound, which stay as a dot in the menu.

### Notices in a window of their own
Messages from scripts, updates, finished downloads, files in the Tray, copied errors, agents done or failed, the recap and the day's summary appear in a **small window always in front**, which does not take the keyboard and **does not open or change the island**: you can keep working inside the open island.
- A click on a notice opens the island on that thing; its buttons (Open, Show in folder, Install…) do their action at once.
- They stay 8 seconds (15 a warning); errors until you close them with ✕. With the mouse on them the time stops.
- At most three at a time; the others are in «+N more · close all».
- **Where** (Settings → Notifications → Notices): **under the island** (default; beside it, top right, when the island is open), **top right**, **bottom right**, or **in the island (as before)**.
- Permissions, questions, Claude Code cards with choices and 3CX calls stay in the island and the strip, because they wait for your click.

## In front of a client
The character steps aside when someone might see your screen:
- **During calls**: microphone or webcam in use by any app (Teams, Zoom, Meet, Webex…). It reads this from where Windows records who uses them.
- **During remote support**: someone is connected to this PC (Remote Desktop, Quick Assist, TeamViewer) or a program you add is open.
- **By hand**: notification area icon → **In front of a client**.

What it does: **hides the character and mutes sounds**, or just mutes. Permission requests still appear; 3CX calls show only the dot, without the caller's name. No name, title or text stays on screen.

## Backup and transfer
**Settings → Backup**:
- **Export…** saves to a JSON file in the Documents folder every setting, the chat's memory, skills, tasks, custom integrations, the chat history and the habits.
- **Import…** loads them on another PC. Nothing that was there is deleted: each folder is set aside (`… .prima-del-ripristino-<date>`), then EasyIsland restarts.
- Keys are never in the file: they must be entered again. The Notion map and the recipes, encrypted for this PC, are rebuilt by themselves.
