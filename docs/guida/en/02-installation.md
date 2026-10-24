# Installation
> section: Getting started
> summary: Download, install, update and uninstall EasyIsland.

## Install
1. Open the [releases on GitHub](https://github.com/EdoardoDevelop/easyisland/releases/latest) and download **EasyIsland-Windows-X.Y.Z-setup.exe**.
2. Run it. It installs **for the current user only**: no administrator prompt.
3. The installer is not yet signed with a certificate, so Windows SmartScreen shows a warning: click **More info → Run anyway**.

When it's done EasyIsland starts and the character greets you. From then on you'll find it in the Start menu and in the **notification area** (the ^ arrow next to the clock).

> **Tip:** if Defender blocks the installer, it's the usual false positive for unsigned programs: use "Run anyway".

## Where files go
| What | Where |
|---|---|
| The program | `%LOCALAPPDATA%\EasyIsland` |
| The relay for agents | `%LOCALAPPDATA%\EasyIsland\bin\easyisland-hook.exe` |
| The log | `%LOCALAPPDATA%\EasyIsland\easyisland.log` |
| Settings, memory, tasks, skills, custom integrations | `%APPDATA%\EasyIsland` |
| Keys, tokens, passwords | Windows Credential Manager (never on disk) |

## Update
At startup and then once a day EasyIsland checks GitHub for a newer version. If there is one, the island shows an update card with **Install** and **Later**:
- nothing is installed without your click;
- the update is **signed** and the signature is verified before running it;
- while installing, EasyIsland closes and reopens by itself; settings and keys stay.

In **Settings → General → Updates** you see the version, check by hand with **Check now** or turn the automatic check off.

## Uninstall
1. First, in **Settings → Coding agents**, click **Uninstall…** on the row of each connected agent: on purpose, the Windows uninstaller doesn't touch the agents' configuration files (for example Claude Code's `settings.json`).
2. Then **Windows Settings → Apps → Installed apps → EasyIsland → Uninstall**.

The `%APPDATA%\EasyIsland` folder (memory, tasks, skills) stays: delete it by hand if you no longer need it.

## Build it yourself
If you prefer to start from the source code you need Git, Node.js, Rust and the Visual Studio Build Tools: the steps are in [For developers](28-development.md). The result is the same installer.
