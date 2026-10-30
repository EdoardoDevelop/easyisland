# Remote support
> section: Connecting services
> summary: Remote access with WinRM and SSH to work on a client's PC with the chat, and Remote Desktop Manager.

## Remote access
A **temporary** connection to a client's PC, Windows or Linux, for the chat to work on it.

### Connecting
In the **Remote access** tab: **WinRM** or **SSH**, address, port, user, password; for WinRM also "HTTPS (5986)" and "Add to TrustedHosts". A **step-by-step guide** explains how to prepare the client's PC. **Start connection** tests the connection.

- The **password** stays only in EasyIsland's memory while the connection is open; the field is cleared right away. Nothing is saved.
- **WinRM** uses Windows PowerShell; **SSH** Windows' `ssh.exe` (OpenSSH).

### With the chat
With a connection open, **🔌** and the PC's name appear in the chat header (also **Link to the chat** in the tab). From there the chat runs **commands on the client's PC**, one at a time (PowerShell on Windows, sh on Linux), **each with Allow / Deny** and the full command in the chat. Examples: "why won't the spooler start?", "how much space is on the disks?", "check the latest errors in the event log".

### Closing
**Close connection**: the chat is unlinked, the password forgotten, the address removed from TrustedHosts (with Windows' confirmation), WinRM turned off again if it was.

Common errors (TrustedHosts, access denied, PC not answering, connection refused, old OpenSSH) become clear messages saying what to do.

## Remote Desktop Manager
If you use Devolutions' **Remote Desktop Manager**, the integration brings it into the island. **RDM stays the program that connects**: EasyIsland finds the connection and asks RDM to open, edit or search it. It never reads a password.
- **Connection list** from the official `Devolutions.PowerShell` module (needs PowerShell 7.2 or later): the same data source as RDM, **Devolutions Server** and **Hub** with the user's vaults too. It's kept **encrypted** on the PC for offline use and refreshed with **Sync**.
- **Search** by name, folder or host, from the tab and the island's top field; a click opens the session in RDM.
- **Without the module**: search opens inside RDM, and you can connect to an address without saving it (RDP or SSH).
- In Settings you see the state of RDM, PowerShell 7 and the module, with the commands to copy to install them (EasyIsland never runs them).
