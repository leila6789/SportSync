# SportSync

A sports calendar for NBA, WNBA, MLB, NFL, college football (NCAAF, SEC, and Big Ten), and NHL. Pick leagues and teams, browse the schedule by month, week, or list, then take the games with you.

Schedules come from ESPN’s public scoreboard. No account is required.

## Run it

```bash
npm install
npm start
```

Open [http://localhost:3000](http://localhost:3000).

```bash
npm test
npm run build
```

## Use the calendar

- On a fresh visit, search the logo grid and tap the teams you follow. **Show my teams** opens a card for each one. **Not now** leaves the calendar empty until a team is picked. A team you already picked in this browser is restored on the next visit, and the first-run grid stays closed.
- Turn leagues on or off. **NCAAF** is the full FBS slate. **SEC** and **Big Ten** are those conferences on their own. NBA, WNBA, MLB, NFL, and NHL stay alongside them.
- **My Teams** shows the next game, the last final score, and the current Polymarket or Kalshi price for each team you follow. **Today**, **Month**, **Week**, and **List** are still there. On a phone, **Today**, **Calendar**, and **My Teams** sit in a bottom tab bar, and a game opens as a bottom sheet.
- Game rows and the team lists use ESPN logos. A game is colored with the two teams’ ESPN colors.
- A game in progress shows a red **LIVE** badge and the score. That score refreshes about every 30 seconds.
- An upcoming row shows a compact win chance, such as **JAX 56.5%**, only when Polymarket or Kalshi has posted a single price for both teams. A bid-ask range is not turned into a percentage. The chance links to that market.
- Busy days in month view show a count and a dot for each league. Click the count to expand the games.
- **Dark mode** follows this device until you use the toggle. The choice is saved in this browser.
- **Export** downloads the `.ics` file or opens Google Calendar’s import page for the month, week, or day on screen.

Your league and team choices are saved in this browser.

## Export

The download and Google Calendar actions follow the teams you selected, for the month (or week) on screen. Both stay unavailable until a team is picked.

### iCal (.ics)

**Download .ics** saves a calendar file. Apple Calendar, Google Calendar, and Outlook can all import it.

A subscription link (`webcal://`) is not included. Those feeds have to be hosted at a public URL so calendar apps can refresh them, and SportSync is a static web app. Download a fresh `.ics` file when you want an updated schedule. If you host that file yourself, you can subscribe to it from your calendar app.

### Google Calendar

Two paths work without any API key:

1. Open a game and choose **Add to Google Calendar**. Google opens a new event with the title, time, location, and details filled in. Save it.
2. Choose **Export**, download the `.ics` file, then choose **Open Google Calendar import** and import the file (Settings → Import & export). That adds every game in the current filtered view.

### Optional direct sync

To create the filtered games on your primary Google Calendar from inside the app, set a Google OAuth client id:

```bash
cp .env.example .env.local
```

```
REACT_APP_GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
```

In Google Cloud Console, create a **Web application** OAuth client, enable the **Google Calendar API**, and add `http://localhost:3000` (and your deployed origin) to **Authorized JavaScript origins**. Restart `npm start` after changing env vars. Create React App only exposes variables that start with `REACT_APP_`.

The sync button then appears in the Export dialog. Games already added from SportSync are skipped. Per-game links and `.ics` download keep working if this variable is unset.

Do not commit `.env` or `.env.local`.

## Notes

- After a team is picked, that league's published months are loaded from the ESPN scoreboard calendar (`leagues[0].calendar`), then each of those months is requested (`dates=YYYYMM`). Navigating the month or week uses that loaded schedule. Leagues with no selected team are not requested.
- WNBA uses `basketball/wnba` on that same scoreboard. The published calendar runs from April 25, 2026 through October 31, 2026. Month requests return games from April 25, 2026 through a last start of November 1, 2026 at 00:00 UTC. The 2027 calendar is empty.
- Click a game for details. Past and in-progress games show the ESPN score and status. A live game keeps its red LIVE badge in the detail sheet, and the score updates with the schedule refresh. Upcoming games show Polymarket and Kalshi prices only, each labeled with its site. ESPN spreads, moneylines, and totals are not shown. If neither site has a matching market, the dialog says odds are not posted yet. The compact percentage on a row is one of those posted prices, not a calculated spread or a guess.
- College football uses that same scoreboard with an ESPN group. `groups=80` is the FBS slate (NCAAF). `groups=8` is the SEC. `groups=5` is the Big Ten. Without a group, ESPN returns only the current week. Requests ask for up to 400 games so a full Saturday slate is not cut off.
- A game on both the FBS slate and a conference slate is shown once. The conference label wins when that conference is selected.
- Team pickers read ESPN’s core team API (the public site team list does not allow browser requests). College pickers are the programs in that ESPN group.
