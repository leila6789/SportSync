import {
  buildFilename,
  buildIcs,
  escapeIcsText,
  googleCalendarUrl,
  toGoogleEventResource,
} from './CalendarExport';

const timed = {
  id: 'ncaaf-1',
  uid: 'ncaaf-1@sportsync.app',
  title: 'ALA @ UGA',
  fullTitle: 'Alabama Crimson Tide at Georgia Bulldogs',
  start: new Date('2026-10-03T23:00:00.000Z'),
  end: new Date('2026-10-04T02:30:00.000Z'),
  allDay: false,
  leagueName: 'NCAAF',
  venue: 'Sanford Stadium, Athens, GA',
  broadcasts: ['ABC'],
  status: 'Scheduled',
  seasonLabel: 'Regular season',
  headline: '',
  url: 'https://www.espn.com/college-football/game/_/gameId/1',
};

const allDay = {
  ...timed,
  id: 'mlb-2',
  uid: 'mlb-2@sportsync.app',
  title: 'NLCS - Game 1',
  fullTitle: 'NLCS - Game 1',
  start: new Date(2026, 9, 11),
  end: new Date(2026, 9, 12),
  allDay: true,
  leagueName: 'MLB',
  venue: '',
  broadcasts: [],
  status: 'Scheduled',
  url: '',
};

test('escapes calendar text', () => {
  expect(escapeIcsText('A, B; C\\D\nE')).toBe('A\\, B\\; C\\\\D\\nE');
});

test('builds a folded ics calendar for timed and all-day games', () => {
  const commaGame = {
    ...timed,
    fullTitle: 'A very long college football title, with a comma; and more words so the line must fold',
  };
  const ics = buildIcs([commaGame, allDay], { now: new Date('2026-10-02T12:00:00.000Z') });
  expect(ics).toContain('PRODID:-//SportSync//Sports Calendar//EN');
  expect(ics).toContain('UID:ncaaf-1@sportsync.app');
  expect(ics).toContain('DTSTART:20261003T230000Z');
  expect(ics).toContain('DTEND:20261004T023000Z');
  expect(ics).toContain('SUMMARY:A very long college football title\\, with a comma\\;');
  expect(ics).toContain('\r\n ');
  expect(ics).toContain('CATEGORIES:NCAAF');
  expect(ics).toContain('LOCATION:Sanford Stadium\\, Athens\\, GA');
  expect(ics).toContain('DTSTART;VALUE=DATE:20261011');
  expect(ics).toContain('DTEND;VALUE=DATE:20261012');
  expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
});

test('builds a Google Calendar template url', () => {
  const url = new URL(googleCalendarUrl(timed));
  expect(url.origin + url.pathname).toBe('https://calendar.google.com/calendar/render');
  expect(url.searchParams.get('action')).toBe('TEMPLATE');
  expect(url.searchParams.get('text')).toBe('Alabama Crimson Tide at Georgia Bulldogs');
  expect(url.searchParams.get('dates')).toBe('20261003T230000Z/20261004T023000Z');
  expect(url.searchParams.get('location')).toBe('Sanford Stadium, Athens, GA');
  expect(url.searchParams.get('details')).toContain('NCAAF · SportSync');

  const allDayUrl = new URL(googleCalendarUrl(allDay));
  expect(allDayUrl.searchParams.get('dates')).toBe('20261011/20261012');
});

test('builds a Google Calendar insert resource', () => {
  expect(toGoogleEventResource(timed)).toMatchObject({
    summary: 'Alabama Crimson Tide at Georgia Bulldogs',
    iCalUID: 'ncaaf-1@sportsync.app',
    location: 'Sanford Stadium, Athens, GA',
    start: { dateTime: '2026-10-03T23:00:00.000Z' },
    end: { dateTime: '2026-10-04T02:30:00.000Z' },
  });
  expect(toGoogleEventResource(allDay).start).toEqual({ date: '2026-10-11' });
});

test('names files from the selected leagues', () => {
  expect(buildFilename({
    leagueIds: ['ncaaf', 'nfl'],
    view: 'month',
    start: new Date(2026, 9, 1),
  })).toBe('sportsync-ncaaf-nfl-2026-10.ics');
  expect(buildFilename({
    leagueIds: ['nba'],
    view: 'week',
    start: new Date(2026, 9, 4),
  })).toBe('sportsync-nba-week-2026-10-04.ics');
});
