# Custom integrations
> section: Connecting services
> summary: Ask the chat for the feature you need — a form, a dashboard, a link to an API — and it becomes an entry in the island. No code to write.

## Creating one
Write in the chat what you need, for example:
- "create an integration for quotes, with client, product rows with quantity and price, 22 % VAT and total, that makes the PDF";
- "I want an interventions log with client, date, hours, type and notes, and the month's total hours";
- "make me a dashboard that reads my servers' status from the Uptime Kuma API every 10 minutes and alerts me if one is down";
- "a button that sends the form to my n8n webhook".

The chat proposes useful fields, formulas and actions, asks what isn't clear and shows you **the preview of the description** with **Allow / Deny**. Confirming, the integration appears in the island's menu with its icon. To change it just ask ("add a discount field", "make the total bold"): same preview, same confirmation.

When the chat **changes** an integration, the card says **what changes**: fields removed (and in how many saved records they were filled), type changes, a counter that restarts, new fields, a much shorter template, actions removed or with a changed script. Saved records stay, and the previous version is copied to `integrazioni\versioni`. For a small change the chat sends only the piece that changes (a field, the name, the template), not the whole description; it can also change the **id** (e.g. from `clienti-ddt` to `clienti`), and links, menu and Overview find it again.

> **Important:** a custom integration is a **description**: its actions are a fixed list. The only one holding commands is **Script**, and it always shows you what it is about to run.

![A custom integration](../media/custom.png)

## What it can have
### Fields
Text, long text, number, **amount**, date, checkbox, choice and multiple choice, email, phone, link, **file** (from the Tray or the PC, and you see it in the record: pictures, PDF, text and Word, audio and video with the player), **table of rows** (with computed columns too), **computed** (a formula), automatic **numbering** (e.g. `N-2026-0001`), **link** to another integration.
- **Link with search**: type part of any value (name, town, VAT number…) and the other integration's records that contain it appear over the form (the field takes the name of the record picked); pick one with the mouse or the arrows and <kbd>Enter</kbd>, and **the other fields fill themselves** (e.g. picking the client from "Clients" fills address and VAT number; picking a service from "Price list" gives the row its description and price). It works for any list: clients, suppliers, articles, services, vehicles. It works as a table column too. With **remember**, a new name typed by hand is added to the other integration when you save the record, together with the filled data. Just ask the chat: "when I pick the client fill address and VAT number, and remember new clients".
- **Shown only if**: a field visible only when a formula is true (e.g. "IBAN" only if payment = Bank transfer).
- **Total in the list**: summed or counted in the records list.

### Formulas
A simple language, in Italian or English: `+ - * / %`, comparisons, `and` / `or` / `not`, `if(condition; yes; no)`, `sum(quantity*price)` over rows, `avg`, `count`, `round`, `min`, `max`, dates (`today()`, `days(from; to)`, `adddays(date; 30)`, year, month), text (`upper`, `concat`, `contains`, `len`). Never code executed.

### Document template
A Markdown document with `{{fields}}`, repeated rows (`{{#rows}} … {{/rows}}`) and the date. **Document** produces it as **printable HTML**, **PDF** (A4) or Markdown, in the Tray.

**Where to save and what to call the file** you tell the chat, when you create the integration or later: "save the PDFs in `C:\Documents\DDT`", "name the file number and client", "show number and client in the list". You can use several fields together, such as `{{number}} {{client}}`. The document always goes to the Tray and also to the chosen folder, never overwriting: if the name exists it becomes `name (2).pdf`. Characters Windows does not accept in file names are removed, and `/` becomes `-`.

The template can also be **real HTML** with your own design: it just has to start with a tag such as `<!doctype html>`, `<style>` or `<div>`. Field values are always escaped, and scripts and dangerous links are removed.

**Preview**: the link under the buttons opens the document with the data you typed, **without saving the record or using a number** (the counter shows the one the next record would get). The chat can do the same to try a template before telling you it is ready.

**One look for several integrations**: ask the chat for the register to "use the DDT template"; logo and pictures (`{{file:logo.png}}`) are looked for in the integration's folder, then in the one it takes the template from, then in `integrazioni\_comune`, where you can put the logo once for all.

- `{{date|lunga}}`: the date in full, "7 novembre 2026".
- `{{amount|it}}`: the number the Italian way, "1.234,5".
- `{{#se carrier}}…{{/se}}`: the text only if the field is filled (a formula works too).
- `{{^carrier}}…{{/carrier}}`: the text only if the field is empty.
- `{{file:logo.png}}`: in HTML templates, a picture placed in `%APPDATA%\EasyIsland\integrazioni\<id>\`.

### Actions (the buttons)
| Action | What it does |
|---|---|
| **Save** | Saves the record (list with search, open, duplicate, delete) |
| **Document** | The filled template, in the Tray |
| **Copy** | The text to the clipboard |
| **Ask the AI** | A question to the chat with the fields |
| **Fill with AI** | Paste a mail or a text and the AI fills the fields |
| **Link** | Opens an address with the fields |
| **Quick action** | Runs one of your actions; a script receives the record's data |
| **Script** | Runs PowerShell or Command Prompt commands: it shows them and waits for your click every time. The record's data is in the JSON file named by the `EASYISLAND_SCHEDA` variable: in PowerShell read it with `Get-Content -Raw -Encoding UTF8`, or accented letters get garbled The integration's keys arrive as `EASYISLAND_SECRET_NAME` variables, without writing them in the commands |
| **Notion** | Adds the record to a database |
| **Export CSV** | All records, for Excel |
| **Call a service** | GET/POST/PUT/PATCH/DELETE to one of your services' API, with the fields in the body; the response can fill fields and show in a message. If the service answers with a **file** (a voice in mp3, a picture, a PDF) you hear or see it in the record and save it; with a folder and a name chosen it saves by itself, never over another file |
| **Task** | Starts a [task](14-tasks.md) with the fields in the goal |
| **Notice** | A notice in the island |
| **Sequence** | Several actions in a row (e.g. save, then call the service, then make the document) |

### Data sources: dashboards
A **source** reads a service every N minutes (or when you open the tab) and shows **values** and **lists**. An **alert** is a formula on each item: when true, the island alerts you, once per item, and the first line goes to the Overview. An integration can also be **just a dashboard**, with no form.

![A dashboard](../media/custom-dati.png)

### Keys
Services' keys and tokens are written as `{{secret:name}}` and entered in **Settings → Integrations → Made by you**: they go into the Credential Manager, only EasyIsland reads them at call time and **neither the island nor the chat ever sees them**.

## From the chat and tasks
The chat and tasks can **read records**, **add them** (with Allow / Deny), **read sources** and **call the actions** of your integrations: "how many quotes did I make in October?", "log a 2-hour intervention for Rossi", "check the servers and tell me if anything's wrong".

## Managing them
**Settings → Integrations → Made by you**: show or hide in the menu, edit the JSON description, enter keys, delete. Files live in `%APPDATA%\EasyIsland\integrazioni` (description and records, readable).

## Limits, on purpose
- **Fixed actions**: an action does only what its kind provides; commands run only in a Script action, after you see them and click.
- Calls go **only to the services written in the description** you approved.
- **No data "pushed" by services** (incoming webhooks), because that would need an open port on the PC: a source read every N minutes is used instead.
- It works with the PC on.
