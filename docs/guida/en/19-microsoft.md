# Microsoft: Outlook, Teams, To Do
> section: Connecting services
> summary: Mail and calendar, Teams meetings, To Do tasks and the Microsoft account.

## Outlook
The **Outlook** integration shows **unread mail** and **today's and tomorrow's appointments**, and alerts you a few minutes before a meeting.
- By default it reads **classic Outlook already open** (it never starts it). The new Outlook doesn't allow this.
- With the **Microsoft account** (below) it uses Microsoft Graph instead, even without Outlook open, with sender and subject of the latest mails.

## Teams
Without any account:
- **Teams open** and **in a meeting** are detected from Windows (microphone or webcam in use);
- meeting controls in the card and **next to the closed character**: **Microphone**, **Video**, **Raise hand**, **Leave** (Teams' shortcuts);
- **Join from the copied link**: copy a Teams meeting link and one click gets you in;
- **automations** when a meeting starts or ends.

With the Microsoft account: your **presence** and today's and tomorrow's **online meetings** with **Join**.

## Microsoft To Do
The chat's tools read and write your **To Do** tasks through **classic Outlook** (which must be open): "what do I have to do this week?", "add call Rossi tomorrow at 10 to the Clients list", "mark Bianchi's invoice done". Adding and changing ask Allow / Deny. Changes reach To Do with Outlook's sync.

## Microsoft account (API)
In the Outlook and Teams rows, the **Microsoft account (API)** block connects your work account with **Microsoft Graph**:
1. register an application in **Microsoft Entra** (public application ID, no secret);
2. enter application ID and tenant and click **Sign in**: Microsoft's sign-in page opens.

Delegated permissions, **read-only**: profile, mail, calendar, presence. If your company requires admin consent, ask your IT. Calls go only to `login.microsoftonline.com` and `graph.microsoft.com`, and only after signing in.
