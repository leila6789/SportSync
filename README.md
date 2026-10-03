# SportSync

A sports calendar for NBA, MLB, NFL, college football (NCAAF, SEC, and Big Ten), and NHL. Pick leagues and teams, browse the schedule by month, week, or list, then take the games with you.

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

- Turn leagues on or off. **NCAAF** is the full FBS slate. **SEC** and **Big Ten** are those conferences on their own. NBA, MLB, NFL, and NHL stay alongside them.
- Search teams and check the ones you follow. The calendar stays empty until at least one team is checked. A team you already picked in this browser is restored on the next visit.
- Switch **Month**, **Week**, and **List**. Click a game for the venue, broadcast, and export actions.
- College Saturdays are crowded in month view. Use **List**, or the “+ more” link on a day, to read every game.

Your league and team choices are saved in this browser.

## Export

The download and Google Calendar actions follow the teams you selected, for the month (or week) on screen. Both stay unavailable until a team is picked.

### iCal (.ics)

**Download .ics** saves a calendar file. Apple Calendar, Google Calendar, and Outlook can all import it.

A subscription link (`webcal://`) is not included. Those feeds have to be hosted at a public URL so calendar apps can refresh them, and SportSync is a static web app. Download a fresh `.ics` file when you want an updated schedule. If you host that file yourself, you can subscribe to it from your calendar app.

### Google Calendar

Two paths work without any API key:

1. Open a game and choose **Add to Google Calendar**. Google opens a new event with the title, time, location, and details filled in. Save it.
2. Download the `.ics` file, then open **Add to Google Calendar → Open Google Calendar import** and import the file (Settings → Import & export). That adds every game in the current filtered view.

### Optional direct sync

To create the filtered games on your primary Google Calendar from inside the app, set a Google OAuth client id:

```bash
cp .env.example .env.local
```

```
REACT_APP_GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
```

In Google Cloud Console, create a **Web application** OAuth client, enable the **Google Calendar API**, and add `http://localhost:3000` (and your deployed origin) to **Authorized JavaScript origins**. Restart `npm start` after changing env vars. Create React App only exposes variables that start with `REACT_APP_`.

The sync button then appears in the Add to Google Calendar dialog. Games already added from SportSync are skipped. Per-game links and `.ics` download keep working if this variable is unset.

Do not commit `.env` or `.env.local`.

## Notes

- After a team is picked, that league's published months are loaded from the ESPN scoreboard calendar (`leagues[0].calendar`), then each of those months is requested (`dates=YYYYMM`). Navigating the month or week uses that loaded schedule. Leagues with no selected team are not requested.
- Click a game for details. Past and in-progress games show the ESPN score and status. Upcoming games show Polymarket and Kalshi prices only, each labeled with its site. ESPN spreads, moneylines, and totals are not shown. If neither site has a matching market, the dialog says odds are not posted yet.
- College football uses that same scoreboard with an ESPN group. `groups=80` is the FBS slate (NCAAF). `groups=8` is the SEC. `groups=5` is the Big Ten. Without a group, ESPN returns only the current week. Requests ask for up to 400 games so a full Saturday slate is not cut off.
- A game on both the FBS slate and a conference slate is shown once. The conference label wins when that conference is selected.
- Team pickers read ESPN’s core team API (the public site team list does not allow browser requests). College pickers are the programs in that ESPN group.
