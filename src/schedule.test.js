import {
  LEAGUES,
  collegeSeasonYear,
  collegeTeamIdFromRef,
  fetchLeagueMonth,
  fetchLeagueTeams,
  collapseConferenceDuplicates,
  fetchPublishedMonths,
  filterEvents,
  monthsForView,
  monthsFromEspnCalendar,
  periodBounds,
  normalizeEvents,
  resetScheduleCache,
  scoreboardMonthUrl,
} from './schedule';

const ncaaf = LEAGUES.find((league) => league.id === 'ncaaf');
const sec = LEAGUES.find((league) => league.id === 'sec');
const bigten = LEAGUES.find((league) => league.id === 'bigten');
const nba = LEAGUES.find((league) => league.id === 'nba');

function jsonResponse(data, ok = true, status = 200) {
  return { ok, status, json: async () => data };
}

function game(id, name = `Game ${id}`) {
  return {
    id,
    date: '2026-10-03T23:00:00Z',
    name,
    season: { slug: 'regular-season' },
    competitions: [{
      timeValid: true,
      venue: { fullName: 'Lane Stadium', address: { city: 'Blacksburg', state: 'VA' } },
      status: { type: { description: 'Scheduled' } },
      broadcasts: [{ names: ['ABC'] }],
      notes: [],
      competitors: [
        { homeAway: 'home', team: { id: '259', displayName: 'Virginia Tech Hokies', abbreviation: 'VT' } },
        { homeAway: 'away', team: { id: '221', displayName: 'Pittsburgh Panthers', abbreviation: 'PITT' } },
      ],
    }],
  };
}

beforeEach(() => {
  resetScheduleCache();
});

test('includes college football with the pro leagues', () => {
  expect(LEAGUES.map((league) => league.id)).toEqual(['nba', 'wnba', 'mlb', 'nfl', 'ncaaf', 'sec', 'bigten', 'nhl']);
  expect(LEAGUES.find((league) => league.id === 'wnba').name).toBe('WNBA');
  expect(scoreboardMonthUrl(LEAGUES.find((league) => league.id === 'wnba'), 2026, 5))
    .toBe('https://site.api.espn.com/apis/site/v2/sports/basketball/wnba/scoreboard?dates=202605&limit=400');
  expect(ncaaf.path).toBe('football/college-football');
  expect(ncaaf.fullName).toBe('College football');
  expect(sec.name).toBe('SEC');
  expect(sec.group).toBe('8');
  expect(bigten.name).toBe('Big Ten');
  expect(bigten.group).toBe('5');
  expect(LEAGUES.map((league) => league.name)).not.toContain('Big 10');
});

test('normalizes timed games and TBD postseason slots', () => {
  const events = normalizeEvents(nba, {
    events: [
      game('401', 'Boston Celtics at Cleveland Cavaliers'),
      {
        id: '402',
        date: '2026-10-11T04:00:00Z',
        name: 'TBD at TBD',
        season: { slug: 'post-season' },
        competitions: [{
          timeValid: false,
          notes: [{ headline: 'Finals - Game 1' }],
          status: { type: { description: 'Scheduled' } },
          competitors: [
            { homeAway: 'home', team: { displayName: 'TBD', abbreviation: 'TBD' } },
            { homeAway: 'away', team: { displayName: 'TBD', abbreviation: 'TBD' } },
          ],
        }],
      },
    ],
  });

  expect(events[0]).toMatchObject({
    id: 'nba-401',
    title: 'PITT @ VT',
    fullTitle: 'Boston Celtics at Cleveland Cavaliers',
    allDay: false,
    homeKey: 'nba:259',
    awayKey: 'nba:221',
    venue: 'Lane Stadium, Blacksburg, VA',
  });
  expect(events[0].end.getTime() - events[0].start.getTime()).toBe(nba.durationMs);
  expect(events[1]).toMatchObject({
    title: 'Finals - Game 1',
    allDay: true,
    homeKey: '',
    awayKey: '',
    seasonLabel: 'Postseason',
  });
});

test('filters by league and team', () => {
  const events = normalizeEvents(ncaaf, { events: [game('9', 'Pittsburgh Panthers at Virginia Tech Hokies')] });
  const nbaEvents = normalizeEvents(nba, { events: [game('8', 'Celtics at Knicks')] });
  const all = [...events, ...nbaEvents];
  expect(filterEvents(all, { leagueIds: ['ncaaf'], teamKeys: [] })).toHaveLength(0);
  expect(filterEvents(all, { leagueIds: ['ncaaf', 'nba'], teamKeys: ['ncaaf:259'] }).map((event) => event.id))
    .toEqual(['ncaaf-9']);
  expect(filterEvents(all, { leagueIds: ['nba'], teamKeys: ['ncaaf:259'] })).toHaveLength(0);
});

test('month view includes the leading week', () => {
  expect(monthsForView('month', new Date(2026, 9, 2))).toEqual([
    { year: 2026, month: 9 },
    { year: 2026, month: 10 },
  ]);
  expect(monthsForView('list', new Date(2026, 9, 2))).toEqual([{ year: 2026, month: 10 }]);
  const now = new Date(2026, 9, 3, 15, 30);
  expect(periodBounds('today', new Date(2026, 0, 1), now)).toEqual({
    start: new Date(2026, 9, 3, 0, 0, 0, 0),
    end: new Date(2026, 9, 3, 23, 59, 59, 999),
  });
  expect(monthsForView('today', new Date(2026, 0, 1), now)).toEqual([{ year: 2026, month: 10 }]);
});

test('loads college football from the FBS month scoreboard', async () => {
  const url = scoreboardMonthUrl(ncaaf, 2026, 10);
  expect(url).toContain('/football/college-football/scoreboard');
  expect(url).toContain('dates=202610');
  expect(url).toContain('groups=80');
  expect(url).toContain('limit=400');
  expect(scoreboardMonthUrl(sec, 2026, 10)).toContain('groups=8');
  expect(scoreboardMonthUrl(sec, 2026, 10)).not.toContain('groups=80');
  expect(scoreboardMonthUrl(bigten, 2026, 10)).toContain('groups=5');
  expect(scoreboardMonthUrl(nba, 2026, 10)).not.toContain('groups=');
  expect(scoreboardMonthUrl(nba, 2026, 10)).toContain('limit=400');
  expect(scoreboardMonthUrl(LEAGUES.find((league) => league.id === 'mlb'), 2026, 5)).toContain('limit=1000');

  global.fetch = jest.fn(async (requested) => {
    expect(String(requested)).toBe(url);
    return jsonResponse({ events: [game('cfb', 'Pittsburgh Panthers at Virginia Tech Hokies')] });
  });

  const events = await fetchLeagueMonth(ncaaf, 2026, 10);
  expect(events.map((event) => event.id)).toEqual(['ncaaf-cfb']);
  expect(events[0].fullTitle).toBe('Pittsburgh Panthers at Virginia Tech Hokies');
});

test('loads pro teams from core team records', async () => {
  global.fetch = jest.fn(async (url) => {
    const href = String(url);
    if (href.includes('/teams/14')) {
      return jsonResponse({ id: '14', displayName: 'Miami Heat', abbreviation: 'MIA' });
    }
    return jsonResponse({
      items: [{ $ref: 'https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba/seasons/2027/teams/14' }],
    });
  });
  const teams = await fetchLeagueTeams(nba);
  expect(teams).toEqual([{
    key: 'nba:14',
    id: '14',
    leagueId: 'nba',
    name: 'Miami Heat',
    abbreviation: 'MIA',
  }]);
  expect(global.fetch.mock.calls.some(([url]) => String(url).includes('site.api.espn.com'))).toBe(false);
});

test('college team directory keeps FBS ids', async () => {
  expect(collegeSeasonYear(new Date(2026, 9, 2))).toBe(2026);
  expect(collegeSeasonYear(new Date(2027, 0, 10))).toBe(2026);
  expect(collegeTeamIdFromRef('http://sports.core.api.espn.com/v2/sports/football/leagues/college-football/seasons/2026/teams/333?lang=en')).toBe('333');

  global.fetch = jest.fn(async (url) => {
    if (String(url).includes('/groups/80/teams')) {
      return jsonResponse({
        pageCount: 1,
        items: [{ $ref: 'http://sports.core.api.espn.com/v2/sports/football/leagues/college-football/seasons/2026/teams/333?lang=en' }],
      });
    }
    return jsonResponse({
      sports: [{
        leagues: [{
          teams: [
            { team: { id: '333', displayName: 'Alabama Crimson Tide', abbreviation: 'ALA' } },
            { team: { id: '7', displayName: 'Amherst Mammoths', abbreviation: 'AMH' } },
          ],
        }],
      }],
    });
  });

  const teams = await fetchLeagueTeams(ncaaf, new Date(2026, 9, 2));
  expect(teams.map((team) => team.name)).toEqual(['Alabama Crimson Tide']);
  expect(teams[0].key).toBe('ncaaf:333');
});

test('keeps one copy of a game that is both NCAAF and SEC', () => {
  const slate = { events: [game('9', 'Alabama Crimson Tide at Georgia Bulldogs')] };
  const [fbsGame] = normalizeEvents(ncaaf, slate);
  const [secGame] = normalizeEvents(sec, slate);
  const [bigTenGame] = normalizeEvents(bigten, { events: [game('10', 'Ohio State Buckeyes at Iowa Hawkeyes')] });
  const collapsed = collapseConferenceDuplicates([fbsGame, secGame, bigTenGame]);
  expect(collapsed.map((event) => event.id).sort()).toEqual(['bigten-10', 'sec-9']);
  expect(filterEvents(collapsed, { leagueIds: ['sec'], teamKeys: ['sec:221'] })).toHaveLength(1);
  expect(filterEvents([fbsGame, secGame], { leagueIds: ['ncaaf'], teamKeys: ['ncaaf:259'] }).map((event) => event.leagueId)).toEqual(['ncaaf']);
});

test('keeps final scores and reads published months from every league calendar', async () => {
  const [finalGame] = normalizeEvents(nba, {
    events: [{
      ...game('500', 'Boston Celtics at Cleveland Cavaliers'),
      competitions: [{
        ...game('500').competitions[0],
        status: { type: { state: 'post', description: 'Final' } },
        competitors: [
          { homeAway: 'home', score: '98', team: { id: '5', displayName: 'Cleveland Cavaliers', abbreviation: 'CLE' } },
          { homeAway: 'away', score: '102', team: { id: '2', displayName: 'Boston Celtics', abbreviation: 'BOS' } },
        ],
      }],
    }],
  });
  expect(finalGame).toMatchObject({ state: 'post', awayScore: '102', homeScore: '98' });
  expect(finalGame.odds).toBeUndefined();

  expect(monthsFromEspnCalendar([
    '2026-10-03T07:00Z',
    '2026-10-31T07:00Z',
    '2026-11-02T07:00Z',
    '2027-04-11T07:00Z',
  ]).map((item) => `${item.year}-${item.month}`)).toEqual([
    '2026-10', '2026-11', '2026-12', '2027-1', '2027-2', '2027-3', '2027-4',
  ]);
  expect(monthsFromEspnCalendar(['2026-02-19T08:00Z', '2026-11-11T08:00Z'])).toHaveLength(10);
  expect(monthsFromEspnCalendar([
    { label: 'Regular Season', entries: [{ startDate: '2026-09-06T07:00Z', endDate: '2026-09-16T06:59Z' }] },
    { label: 'Off Season', entries: [] },
    { label: 'Postseason', entries: [{ startDate: '2027-02-03T07:00Z', endDate: '2027-02-14T07:59Z' }] },
  ])[0]).toEqual({ year: 2026, month: 9 });

  global.fetch = jest.fn(async (url) => {
    const href = String(url);
    const calendar = ['2026-10-03T00:00:00Z', '2026-11-15T00:00:00Z'];
    if (href.includes('football')) {
      return jsonResponse({ leagues: [{ calendar: [{ entries: [{ startDate: '2026-09-06T07:00Z', endDate: '2026-11-28T07:00Z' }] }] }] });
    }
    if (href.includes('dates=2027')) {
      return jsonResponse({ leagues: [{ calendar: ['2027-02-02T00:00:00Z', '2027-04-11T00:00:00Z'] }] });
    }
    return jsonResponse({ leagues: [{ calendar }] });
  });

  const months = await fetchPublishedMonths(nba, new Date('2026-10-03T00:00:00Z'));
  expect(months).toContainEqual({ year: 2026, month: 10 });
  expect(months).toContainEqual({ year: 2026, month: 11 });
  expect(months).toContainEqual({ year: 2027, month: 3 });
  expect(months).not.toContainEqual({ year: 2027, month: 5 });

  const nfl = LEAGUES.find((league) => league.id === 'nfl');
  const secMonths = await fetchPublishedMonths(sec, new Date('2026-10-03T00:00:00Z'));
  const nflMonths = await fetchPublishedMonths(nfl, new Date('2026-10-03T00:00:00Z'));
  expect(secMonths.map((item) => item.month)).toEqual([9, 10, 11]);
  expect(nflMonths.length).toBeGreaterThan(1);
});

test('SEC team list follows the SEC group', async () => {
  global.fetch = jest.fn(async (url) => {
    const href = String(url);
    if (href.includes('/groups/8/teams')) {
      return jsonResponse({
        pageCount: 1,
        items: [{ $ref: 'http://sports.core.api.espn.com/v2/sports/football/leagues/college-football/seasons/2026/teams/333?lang=en' }],
      });
    }
    return jsonResponse({
      sports: [{
        leagues: [{
          teams: [
            { team: { id: '333', displayName: 'Alabama Crimson Tide', abbreviation: 'ALA' } },
            { team: { id: '194', displayName: 'Ohio State Buckeyes', abbreviation: 'OSU' } },
          ],
        }],
      }],
    });
  });

  const teams = await fetchLeagueTeams(sec, new Date(2026, 9, 2));
  expect(teams.map((team) => team.name)).toEqual(['Alabama Crimson Tide']);
  expect(teams[0].key).toBe('sec:333');
});
