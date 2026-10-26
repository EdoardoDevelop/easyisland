# Preview
> section: Artificial intelligence
> summary: Files and web pages next to the chat, in a real browser: highlighted changes, phone sizes, console and tools for the chat.

The **Preview** is a window with tabs, like a small browser, next to the chat. It shows the files the chat works on and web pages: the site you are building on `localhost`, a page the chat has just made, a PDF, a CSV.

![A file's changes in the Preview](../media/anteprima-modifiche.png)

## How it opens
- **A link in a chat message**: it opens in the Preview. **Ctrl+click** sends it to the Windows browser instead.
- **A file the chat mentions** (for example `src/app.ts` or `C:\Projects\site\README.md`): it is underlined with dots, a click opens it. Relative paths start from the chat's folder (Settings → Chat → Work folder).
- **By itself, with terminal mode**: when the chat changes a file, the file shows up in the Preview with the changes highlighted, without stealing your window.
- **The window button** in the chat's header (with terminal mode on).
- **A development server that just started**: the card in the island has a **Preview** button. **+** in the Preview also lists the servers listening on this PC.
- **Dropping a file** on the window, or typing an address or a path in the bar.

In **Settings → Chat → Preview** you choose how to have it:
- **Attached to the island**: it shows next to the open island (right, left or below, wherever there is room), follows it when you move it and hides when the island closes. The **✕** at the top right closes it.
- **Separate window**: a normal window you move wherever you like, even to another screen.
- **Off**: links and files go back to the browser and their programs.

## Files
| Type | What you see |
|---|---|
| Code (ts, js, rs, py, cs, ps1, json…) | Numbered, coloured lines |
| Markdown | Laid-out **Preview** or **Code** |
| CSV | A **table** (first 1000 rows) or the text |
| HTML, SVG, PDF | In the browser, or the code |
| Images | The image; a click shows it at full size |

When the chat changed a file, **Changes +7 −5** appears: removed lines in red, added ones in green, compared with the file before the chat touched it. The file is drawn again by itself when it changes, even when you edit it.

## Web pages
Pages are in a **real browser** (Edge's engine), not a picture.
- **← → ↻** and the address bar, as in a browser; `localhost:5173` is enough, without `http://`.
- **Fit, Desktop, Tablet, Phone**: the page at that device's size, with touch for the phone.
- **Auto, ☀, ☾**: the page in light or dark mode, to try both themes of your site.
- **Console**: the page's messages and errors; the red number on the tab says how many errors there are.
- **⋯**: open in the browser or in the file's program, show in the folder, copy the address, **Developer tools** (Edge's).

![A web page in the Preview](../media/anteprima-web.png)

## The chat uses the Preview
With EasyIsland's tools on, the chat can open a page or a file in the Preview, read its text, take a screenshot, read the console errors and try it at phone size or in dark mode. So after changing your site it checks by itself that it works before telling you.

It can also **click** and **type** in a page's fields, but every time it asks **Allow / Deny** in the island. It never types passwords or payment details.

## Shortcuts
| Keys | What it does |
|---|---|
| Ctrl+L | Goes to the address bar |
| Ctrl+R or F5 | Reload |
| Ctrl+T | New tab |
| Ctrl+W | Closes the tab |
| Ctrl+Tab | Next tab |
| Alt+← / Alt+→ | Back / forward |

Once the window is closed nothing keeps running; the tabs come back the same the next time.
