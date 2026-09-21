# Receipt Tracker

My Costco purchase history, from every warehouse receipt and costco.com order, searchable on my phone and computer.

**App:** https://adamdubrow.github.io/receipt-tracker

---

## Where everything lives

| What | Where | What it does |
|---|---|---|
| **The app** | `docs/index.html` in this repo | The page at the address above. Reads everything from my Google Sheet. |
| **Old app** | `docs/legacy.html` in this repo | The earlier version with the receipt scanner. Reachable from the app's **More** menu. |
| **Import script** | `costco-import.js` in this repo | Collects my Costco receipts and online orders. Runs on costco.com. |
| **My data** | Google Sheet, tabs **Purchases**, **Names**, **Coupons** | One row per item bought, item names, and recent coupon books. The single copy all devices read. |
| **Backend** | Apps Script project (`Code.gs`), at script.google.com | Connects the app to the Sheet. Guarded by my passphrase. |
| **Passphrase** | Apps Script: **Project Settings → Script Properties → `PASSPHRASE`** | Never stored in this repo. The repo is public. |

---

## Routine: import new purchases (once a month)

At a **computer**, in **Chrome**. Takes about 5 minutes.

1. Go to **costco.com**, sign in, and click **Orders & Returns** once.
2. Press **F12** and click the **Console** tab.
3. Open `costco-import.js` in this repo, click **Raw**, then select all (**Ctrl+A**) and copy (**Ctrl+C**).
4. Click in the Console and paste (**Ctrl+V**). If Chrome blocks it, *type* `allow pasting`, press Enter, and paste again.
5. Press **Enter** and wait about 3 minutes, until it says **COPIED TO CLIPBOARD**.
6. **Don't copy anything else.** Open the app, tap **Paste import**, paste, and tap **Import**.

It reports how many new trips were added, how many item names were updated from Costco's catalog, and how many coupon offers were saved. Trips already in the Sheet are skipped, so running it again, or with overlapping dates, never creates duplicates.

**When:** once per coupon book, in its first few days. A new book starts about every four weeks, and Costco's price adjustment window is 30 days, so one import early in each book catches every coupon match on recent purchases. (For history alone, every few months would do: Costco keeps two years of receipts, and every run collects all of them.)

**Why not automatically?** It can't run on its own: it needs my signed-in Costco session, and Costco's site blocks sending data straight to Google, which is why it goes through the clipboard.

---

## Setting up a new phone or computer

1. Open the app address. It shows **Connect this device**.
2. Enter the passphrase. It's saved on that device only.
3. On a phone, add it to the home screen:
   - **iPhone (Safari):** Share button → **Add to Home Screen**.
   - **Android (Chrome):** ⋮ menu → **Add to Home screen**.

On iPhone, the home-screen icon asks for the passphrase once more, since iOS keeps it separate from Safari. Using plain Safari is fine too, but Safari forgets the passphrase if the site isn't opened for about a week.

---

## Updating the app (when Claude gives me a new index.html)

**Always upload the file. Never open it and copy-paste.** Opening an .html file shows the finished page, and copying that grabs the visible text instead of the code, which breaks the app into a "text blob."

1. **Download** the new file, keeping its name (`index.html`).
2. Go to https://github.com/adamdubrow/receipt-tracker/upload/main/docs
3. Drag the file onto the page. A file with the same name replaces the old one.
4. Keep **Commit directly to the main branch** selected, and click **Commit changes**.
5. Wait 1–2 minutes, then open the app and press **Ctrl+F5** (or pull to refresh on a phone).

The same method works for `costco-import.js`, uploaded to the top of the repo instead: https://github.com/adamdubrow/receipt-tracker/upload/main

---

## Updating the backend (when Claude gives me a new Code.gs)

1. Open the project at **script.google.com**, then **Code.gs**.
2. Select all, delete, paste the new code, and press **Ctrl+S**. (Copy-paste is fine here; .gs files open as plain text.)
3. **Deploy → Manage deployments** → pencil icon → **Version: New version** → **Deploy**.

**Never use "New deployment."** It creates a different address, and the app would stop reaching the Sheet.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| Chrome won't let me paste into the Console | *Type* `allow pasting` (not paste it), press Enter, then paste again. |
| Paste import says it isn't the script's output | The clipboard got overwritten. In the costco.com Console, type `copy(costcoCSV)`, press Enter, and paste again. |
| `costcoCSV is not defined` | The costco.com tab was reloaded. Run the import script again. |
| The app shows plain text with no layout | `index.html` was copy-pasted instead of uploaded. Upload the real file (see *Updating the app*). |
| App asks for the passphrase again | Normal after clearing browser data, or after a week unused in Safari. Re-enter it. |
| "That passphrase didn't match" | Check for autocorrect on phones (a capitalized first letter, or a hyphen turned into a dash). The real value is in Script Properties. |
| Want to change the passphrase | Edit `PASSPHRASE` in Script Properties. Each device will ask for the new one. No redeploy needed. |
| App can't reach the Sheet | Check the connection, then **More → Refresh from Sheet**. The app keeps showing the last saved copy meanwhile. |

---

## Good to know

- **Returns** appear as their own trips with negative amounts. **Hide returns** filters them out.
- **"Return only"** items have a return but no purchase in the history, usually because the purchase was more than two years ago, before Costco's records begin.
- **Prices** are per-unit before instant savings. Savings show separately on each line.
- **Names** come from three places, and a higher one always wins:
  1. **Mine**: typed in the app (tap an item, type a name, save).
  2. **Costco's catalog**: official product names, fetched by item number during each import. Shown as "Name from costco.com catalog." They describe the *current* listing, so a pack size can differ from what I bought years ago; the receipt text stays visible in each item's detail.
  3. **Suggested**: generated from receipt abbreviations, labelled "suggested," and possibly wrong. Only used where the catalog has nothing.
- **Online orders** leave out delivery fees and cancelled items. Order-level discounts aren't spread across lines.
- **Savings tab: price adjustments.** Costco refunds the difference if its price drops within **30 days** of purchase (warehouse against warehouse, online against online). The tab shows:
  - **Likely owed:** something still inside its 30 days that's now in the coupon book, or that a later trip shows at a lower price, with the amount and the deadline. A number badge on the tab counts these. Coupon matches subtract any instant savings already received.
  - **Still in the window:** everything bought in the last 30 days, soonest deadline first, for checking against shelf tags.
  - **Recently missed:** drops found after the window closed (last 90 days).
  - To claim a warehouse purchase: Member Services at the same warehouse, with the item number. Online orders: the Price Adjustment form on costco.com.
  - It uses only in-warehouse evidence: my own receipts and Costco's coupon book (dollars off, the same at every U.S. warehouse). It never compares against online prices, which often run higher. Drops outside the coupon book, like markdowns or clearance, still show up only if I buy the item again or spot a lower shelf tag.
- **Stats → Price changes** compares the first and latest price paid for anything bought at least three times.
