import {
  LEAGUES,
  collegeSeasonYear,
  collegeTeamIdFromRef,
  fetchLeagueMonth,
  fetchLeagueTeams,
  collapseConferenceDuplicates,
  filterEvents,
  monthsForView,
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
  expect(LEAGUES.map((league) => league.id)).toEqual(['nba', 'mlb', 'nfl', 'ncaaf', 'sec', 'bigten', 'nhl']);
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
  expect(filterEvents(all, { leagueIds: ['ncaaf'], teamKeys: [] })).toHaveLength(1);
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

  global.fetch = jest.fn(async (requested) => {
    expect(String(requested)).toBe(url);
    return jsonResponse({ events: [game('cfb', 'Pittsburgh Panthers at Virginia Tech Hokies')] });
  });

  const events = await fetchLeagueMonth(ncaaf, 2026, 10);
  expect(events.map((event) => event.id)).toEqual(['ncaaf-cfb']);
  expect(events[0].fullTitle).toBe('Pittsburgh Panthers at Virginia Tech Hokies');
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
  expect(filterEvents([fbsGame, secGame], { leagueIds: ['ncaaf'], teamKeys: [] }).map((event) => event.leagueId)).toEqual(['ncaaf']);
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
