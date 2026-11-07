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

> **Important:** a custom integration is a **description**: its actions are a fixed list. The only one holding commands is **Script**, and it always shows you what it is about to run.

![A custom integration](../media/custom.png)

## What it can have
### Fields
Text, long text, number, **amount**, date, checkbox, choice and multiple choice, email, phone, link, **file** (from the Tray), **table of rows** (with computed columns too), **computed** (a formula), automatic **numbering** (e.g. `N-2026-0001`), **link** to another integration (e.g. the quote picking a client from the "Clients" records).
- **Shown only if**: a field visible only when a formula is true (e.g. "IBAN" only if payment = Bank transfer).
- **Total in the list**: summed or counted in the records list.

### Formulas
A simple language, in Italian or English: `+ - * / %`, comparisons, `and` / `or` / `not`, `if(condition; yes; no)`, `sum(quantity*price)` over rows, `avg`, `count`, `round`, `min`, `max`, dates (`today()`, `days(from; to)`, `adddays(date; 30)`, year, month), text (`upper`, `concat`, `contains`, `len`). Never code executed.

### Document template
A Markdown document with `{{fields}}`, repeated rows (`{{#rows}} … {{/rows}}`) and the date. **Document** produces it as **printable HTML**, **PDF** (A4) or Markdown, in the Tray; the PDF can also go to a folder of your choice.

The template can also be **real HTML** with your own design: it just has to start with a tag such as `<!doctype html>`, `<style>` or `<div>`. Field values are always escaped, and scripts and dangerous links are removed.

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
| **Script** | Runs PowerShell or Command Prompt commands: it shows them and waits for your click every time. The record's data is in the JSON file named by the `EASYISLAND_SCHEDA` variable: in PowerShell read it with `Get-Content -Raw -Encoding UTF8`, or accented letters get garbled |
| **Notion** | Adds the record to a database |
| **Export CSV** | All records, for Excel |
| **Call a service** | GET/POST/PUT/PATCH/DELETE to one of your services' API, with the fields in the body; the response can fill fields and show in a message |
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
