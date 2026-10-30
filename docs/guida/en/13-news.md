# News
> section: Artificial intelligence
> summary: News from Google News on the subjects you follow, also suggested by your memory, with “More” and “Not interested”.

EasyIsland searches the news on the subjects you choose and shows them in the island. As long as you follow no subject it contacts nobody.

## The News tab
The island's menu has a **News** entry, with how many are new. If you don't need it: **Settings → News → “News” tab in the island**, switched off, removes the entry and the box in the Overview.

## The subjects
EasyIsland **chooses them by itself** from your memory: once a day the memory's engine (or, if you haven't chosen one, the chat's) looks at the pages and notes and follows only subjects fit for news, that is products, software, companies, sectors, places, with the right search words. Never people, yourself, customers or internal projects. **Choose now** does it right away; **Add subjects by themselves**, switched off, stops it.

In **Settings → News**:
- **Your subjects:** each with its own switch to turn it off (it stays there, it isn't searched), the words to search and those to avoid; ✕ removes it, and if it came from the memory it never comes back by itself. Those chosen by themselves say so under the name.
- **Suggested by the memory:** the other subjects the memory talks about, with the reason (“mentioned by 3 pages”). **Add** follows one, **Exclude** removes it from the suggestions for good.
- **Excluded:** **Allow again** brings them back among the suggestions.
- You can also type a subject yourself.

## Where they come from
One search per subject on **Google News** or, if you choose it in **Settings → News → Source**, on **Bing News**, which also gives the article's picture and a summary line, or on **both together**: the news are mixed and a story told by both appears only once. It searches in the app's language and over the last 3 days, every 4 hours and right after you add or remove a subject. No account, no key. The PC does the filtering: no news with the words to avoid, none already seen, no same story told again by another paper.

## How they look
**Settings → News → Tab look**: **List** (headlines only), **With thumbnails** (a small picture next to each headline) or **Cards** (a grid with the picture on top). With Google News the thumbnail is the paper's logo, with Bing News the article's picture. The list scrolls when there are many. EasyIsland downloads the pictures from the same service and keeps them on the PC.

## Where you see them
- The **News** tab: filter by subject, a click opens the article, **Update** searches now, **Subjects** opens the Settings.
- A **News** box at the bottom of the **Overview**, with the latest headlines.
- In the morning **Good morning** card, the news found since the day before.
- On **Telegram** with `/notizie`.
- As an element of the **fixed bar** (Appearance → Fixed bar → Bar widgets → + Add → News): how many are new, the latest headline on hover, a click opens the News.

## Teaching it what you care about
Hovering a news item:
- **More:** more news on that subject at each check, and more on the same story right away.
- **Save:** the news goes to the memory, among the things to read.
- **✕ Not interested:** the news disappears and the subject gets fewer. After a few “not interested” the island asks whether to stop following it: **Stop following it** moves it to the excluded ones, **Keep it** starts over.

News and preferences stay on the PC only, in `%LOCALAPPDATA%\EasyIsland\notizie.json`.
