import { endOfMonth, endOfWeek, startOfMonth, startOfWeek } from 'date-fns';

/**
 * ESPN public scoreboard. Pro leagues accept a YYYYMM month. College football
 * does not: a month code returns only the current week, and a very high
 * `limit` (about 900+) returns a partial slate. College games are loaded per
 * FBS week (group 80) with limit=300, which returns the full week.
 */
const MONTH_LIMIT = 400;
const COLLEGE_LIMIT = 300;
const FBS_GROUP = '80';

export const LEAGUES = [
  {
    id: 'nba',
    name: 'NBA',
    fullName: 'NBA',
    path: 'basketball/nba',
    color: '#ea580c',
    durationMs: 2.5 * 60 * 60 * 1000,
  },
  {
    id: 'mlb',
    name: 'MLB',
    fullName: 'MLB',
    path: 'baseball/mlb',
    color: '#1d4ed8',
    durationMs: 3 * 60 * 60 * 1000,
  },
  {
    id: 'nfl',
    name: 'NFL',
    fullName: 'NFL',
    path: 'football/nfl',
    color: '#047857',
    durationMs: 3.5 * 60 * 60 * 1000,
  },
  {
    id: 'ncaaf',
    name: 'NCAAF',
    fullName: 'College football',
    path: 'football/college-football',
    color: '#9f1239',
    durationMs: 3.5 * 60 * 60 * 1000,
  },
  {
    id: 'nhl',
    name: 'NHL',
    fullName: 'NHL',
    path: 'hockey/nhl',
    color: '#6d28d9',
    durationMs: 2.5 * 60 * 60 * 1000,
  },
];

const monthCache = new Map();
const weekCache = new Map();

export function resetScheduleCache() {
  monthCache.clear();
  weekCache.clear();
}

export function leagueById(id) {
  return LEAGUES.find((league) => league.id === id);
}

function pad(month) {
  return String(month).padStart(2, '0');
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Schedule request failed (${response.status})`);
  }
  return response.json();
}

export function scoreboardMonthUrl(league, year, month) {
  const ym = `${year}${pad(month)}`;
  return `https://site.api.espn.com/apis/site/v2/sports/${league.path}/scoreboard?dates=${ym}&limit=${MONTH_LIMIT}`;
}

export function teamsUrl(league) {
  const limit = league.id === 'ncaaf' ? 1000 : 100;
  return `https://site.api.espn.com/apis/site/v2/sports/${league.path}/teams?limit=${limit}`;
}

/** Fall season year. Bowls in January still belong to the previous season. */
export function collegeSeasonYear(now = new Date()) {
  const month = now.getMonth() + 1;
  const year = now.getFullYear();
  return month <= 6 ? year - 1 : year;
}

export function collegeTeamIdFromRef(ref) {
  const match = String(ref || '').match(/\/teams\/(\d+)/);
  return match ? match[1] : '';
}

export function fbsTeamsUrl(seasonYear) {
  return `https://sports.core.api.espn.com/v2/sports/football/leagues/college-football/seasons/${seasonYear}/types/2/groups/${FBS_GROUP}/teams?limit=200`;
}

function seasonLabel(slug) {
  if (!slug) return '';
  if (slug === 'post-season' || slug === 'postseason') return 'Postseason';
  if (slug === 'preseason') return 'Preseason';
  if (slug === 'regular-season') return 'Regular season';
  return String(slug).replace(/-/g, ' ');
}

function broadcastNames(competition) {
  const names = [];
  for (const broadcast of competition.broadcasts || []) {
    if (Array.isArray(broadcast.names)) names.push(...broadcast.names);
    else if (broadcast.name) names.push(broadcast.name);
  }
  if (typeof competition.broadcast === 'string' && competition.broadcast) {
    names.push(competition.broadcast);
  }
  return [...new Set(names.filter(Boolean))];
}

function venueLabel(competition) {
  const venue = competition.venue;
  if (!venue?.fullName) return '';
  const city = venue.address?.city;
  const state = venue.address?.state;
  const place = [city, state].filter(Boolean).join(', ');
  return place ? `${venue.fullName}, ${place}` : venue.fullName;
}

function isTbd(team) {
  if (!team) return true;
  const abbr = team.abbreviation || '';
  const name = team.displayName || '';
  return !abbr || abbr === 'TBD' || name === 'TBD' || !team.id;
}

function teamKey(league, team) {
  if (isTbd(team)) return '';
  return `${league.id}:${team.id}`;
}

export function normalizeEvents(league, data) {
  return (data?.events || []).flatMap((event) => {
    if (!event?.id || !event.date) return [];
    const competition = event.competitions?.[0] || {};
    const competitors = competition.competitors || [];
    const home = competitors.find((c) => c.homeAway === 'home')?.team || {};
    const away = competitors.find((c) => c.homeAway === 'away')?.team || {};
    const timeValid = competition.timeValid !== false;
    const headline = (competition.notes || []).map((note) => note.headline).filter(Boolean).join(' · ');
    const bothTbd = isTbd(home) && isTbd(away);
    const awayName = away.displayName || 'TBD';
    const homeName = home.displayName || 'TBD';
    const fullTitle = bothTbd && headline
      ? headline
      : (event.name || `${awayName} at ${homeName}`);
    const title = !bothTbd && away.abbreviation && home.abbreviation
      ? `${away.abbreviation} @ ${home.abbreviation}`
      : (headline || fullTitle);

    let start;
    let end;
    let allDay = false;
    if (!timeValid) {
      const [y, m, d] = event.date.slice(0, 10).split('-').map(Number);
      if (!y || !m || !d) return [];
      start = new Date(y, m - 1, d);
      end = new Date(y, m - 1, d + 1);
      allDay = true;
    } else {
      start = new Date(event.date);
      if (Number.isNaN(start.getTime())) return [];
      end = new Date(start.getTime() + league.durationMs);
    }

    const link = (event.links || []).find((item) => typeof item.href === 'string' && item.href.startsWith('http'));

    return [{
      id: `${league.id}-${event.id}`,
      uid: `${league.id}-${event.id}@sportsync.app`,
      title,
      fullTitle,
      start,
      end,
      allDay,
      leagueId: league.id,
      leagueName: league.name,
      color: league.color,
      homeTeam: home.displayName || '',
      awayTeam: away.displayName || '',
      homeAbbr: home.abbreviation || '',
      awayAbbr: away.abbreviation || '',
      homeKey: teamKey(league, home),
      awayKey: teamKey(league, away),
      venue: venueLabel(competition),
      broadcasts: broadcastNames(competition),
      status: competition.status?.type?.description || event.status?.type?.description || '',
      headline,
      seasonLabel: seasonLabel(event.season?.slug),
      url: link?.href || '',
    }];
  });
}

export function normalizeTeams(league, data) {
  const teams = data?.sports?.[0]?.leagues?.[0]?.teams || [];
  return teams
    .map(({ team }) => ({
      key: `${league.id}:${team.id}`,
      id: String(team.id),
      leagueId: league.id,
      name: team.displayName,
      abbreviation: team.abbreviation || '',
    }))
    .filter((team) => team.id && team.id !== 'undefined' && team.name && team.abbreviation && team.abbreviation !== 'TBD')
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function filterEvents(events, { leagueIds, teamKeys }) {
  const leagues = new Set(leagueIds);
  const teams = teamKeys || [];
  return events.filter((event) => {
    if (!leagues.has(event.leagueId)) return false;
    if (!teams.length) return true;
    return teams.includes(event.homeKey) || teams.includes(event.awayKey);
  });
}

export function dedupeEvents(events) {
  const map = new Map();
  for (const event of events) map.set(event.id, event);
  return [...map.values()];
}

export function monthsFromRange(range) {
  const dates = Array.isArray(range) ? range : [range.start, range.end];
  const valid = dates.filter((date) => date instanceof Date && !Number.isNaN(date.getTime()));
  if (!valid.length) return [];
  const start = new Date(Math.min(...valid.map((date) => date.getTime())));
  const end = new Date(Math.max(...valid.map((date) => date.getTime())));
  const months = [];
  const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
  const last = new Date(end.getFullYear(), end.getMonth(), 1);
  while (cursor <= last) {
    months.push({ year: cursor.getFullYear(), month: cursor.getMonth() + 1 });
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return months;
}

export function periodBounds(view, cursor) {
  if (view === 'week') {
    const start = startOfWeek(cursor, { weekStartsOn: 0 });
    const end = endOfWeek(cursor, { weekStartsOn: 0 });
    return { start, end };
  }
  return { start: startOfMonth(cursor), end: endOfMonth(cursor) };
}

export function monthsForView(view, cursor) {
  if (view === 'list') {
    return [{ year: cursor.getFullYear(), month: cursor.getMonth() + 1 }];
  }
  if (view === 'week') return monthsFromRange(periodBounds('week', cursor));
  const start = startOfWeek(startOfMonth(cursor), { weekStartsOn: 0 });
  const end = endOfWeek(endOfMonth(cursor), { weekStartsOn: 0 });
  return monthsFromRange({ start, end });
}

export function eventsInPeriod(events, start, end) {
  return events.filter((event) => event.start >= start && event.start <= end);
}

export function weeksOverlappingMonth(calendar, year, month) {
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 1));
  const weeks = [];
  const seen = new Set();
  for (const season of calendar || []) {
    for (const entry of season.entries || []) {
      if (entry.value == null || entry.value === '') continue;
      const weekStart = new Date(entry.startDate);
      const weekEnd = new Date(entry.endDate);
      if (Number.isNaN(weekStart.getTime()) || Number.isNaN(weekEnd.getTime())) continue;
      if (weekStart < end && start < weekEnd) {
        const key = `${season.value}:${entry.value}`;
        if (seen.has(key)) continue;
        seen.add(key);
        weeks.push({
          seasontype: season.value,
          week: entry.value,
          label: entry.label || '',
        });
      }
    }
  }
  return weeks;
}

function collegeWeekUrl(league, seasonYear, seasontype, week) {
  return `https://site.api.espn.com/apis/site/v2/sports/${league.path}/scoreboard?week=${week}&year=${seasonYear}&seasontype=${seasontype}&groups=${FBS_GROUP}&limit=${COLLEGE_LIMIT}`;
}

async function fetchCollegeWeek(league, seasonYear, seasontype, week) {
  const key = `${seasonYear}:${seasontype}:${week}`;
  if (!weekCache.has(key)) {
    const pending = fetchJson(collegeWeekUrl(league, seasonYear, seasontype, week)).catch((error) => {
      weekCache.delete(key);
      throw error;
    });
    weekCache.set(key, pending);
  }
  return weekCache.get(key);
}

async function loadCollegeFootballMonth(league, year, month) {
  const seedUrl = `https://site.api.espn.com/apis/site/v2/sports/${league.path}/scoreboard?dates=${year}${pad(month)}15&groups=${FBS_GROUP}&limit=${COLLEGE_LIMIT}`;
  const seed = await fetchJson(seedUrl);
  const calendar = seed.leagues?.[0]?.calendar || [];
  const seasonYear = seed.leagues?.[0]?.season?.year || year;
  const weeks = weeksOverlappingMonth(calendar, year, month);
  const results = await Promise.allSettled(
    weeks.map((week) => fetchCollegeWeek(league, seasonYear, week.seasontype, week.week))
  );
  const payloads = [seed];
  let failure = null;
  for (const result of results) {
    if (result.status === 'fulfilled') payloads.push(result.value);
    else failure = result.reason;
  }
  const events = dedupeEvents(payloads.flatMap((payload) => normalizeEvents(league, payload)));
  if (!events.length && failure) throw failure;
  return events;
}

async function loadLeagueMonth(league, year, month) {
  if (league.id === 'ncaaf') return loadCollegeFootballMonth(league, year, month);
  const data = await fetchJson(scoreboardMonthUrl(league, year, month));
  return normalizeEvents(league, data);
}

export function fetchLeagueMonth(league, year, month) {
  const key = `${league.id}:${year}-${month}`;
  if (!monthCache.has(key)) {
    const pending = loadLeagueMonth(league, year, month).catch((error) => {
      monthCache.delete(key);
      throw error;
    });
    monthCache.set(key, pending);
  }
  return monthCache.get(key);
}

async function fetchFbsTeamIds(seasonYear) {
  const ids = new Set();
  let page = 1;
  let pageCount = 1;
  while (page <= pageCount && page <= 5) {
    const data = await fetchJson(`${fbsTeamsUrl(seasonYear)}&page=${page}`);
    pageCount = data.pageCount || 1;
    for (const item of data.items || []) {
      const id = collegeTeamIdFromRef(item.$ref);
      if (id) ids.add(id);
    }
    if (!(data.items || []).length) break;
    page += 1;
  }
  return ids;
}

export async function fetchLeagueTeams(league, now = new Date()) {
  if (league.id !== 'ncaaf') {
    const data = await fetchJson(teamsUrl(league));
    return normalizeTeams(league, data);
  }
  const [directory, ids] = await Promise.all([
    fetchJson(teamsUrl(league)),
    fetchFbsTeamIds(collegeSeasonYear(now)),
  ]);
  const teams = normalizeTeams(league, directory).filter((team) => ids.has(team.id));
  return teams.length ? teams : normalizeTeams(league, directory);
}

export function mergeTeams(teams, events) {
  const map = new Map(teams.map((team) => [team.key, team]));
  for (const event of events) {
    [
      ['homeKey', 'homeTeam', 'homeAbbr'],
      ['awayKey', 'awayTeam', 'awayAbbr'],
    ].forEach(([keyName, name, abbr]) => {
      const key = event[keyName];
      if (!key || map.has(key)) return;
      map.set(key, {
        key,
        id: key.split(':')[1],
        leagueId: event.leagueId,
        name: event[name] || event[abbr] || 'Team',
        abbreviation: event[abbr] || '',
      });
    });
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
}
