import { endOfDay, endOfMonth, endOfWeek, startOfDay, startOfMonth, startOfWeek } from 'date-fns';

/**
 * ESPN public scoreboard. College football needs a group: 80 is FBS, 8 is the SEC,
 * and 5 is the Big Ten. Without a group, a month query returns only the current week.
 * College months use limit=400. A higher limit returns a partial college slate.
 * MLB months need limit=1000 or May is cut off around 400 games.
 * Published months come from the scoreboard calendar, not only the month on screen.
 */
const MONTH_LIMIT = 400;

function monthLimit(league) {
  return league.id === 'mlb' ? 1000 : MONTH_LIMIT;
}

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
    group: '80',
    color: '#9f1239',
    durationMs: 3.5 * 60 * 60 * 1000,
  },
  {
    id: 'sec',
    name: 'SEC',
    fullName: 'SEC',
    path: 'football/college-football',
    group: '8',
    color: '#0f766e',
    durationMs: 3.5 * 60 * 60 * 1000,
  },
  {
    id: 'bigten',
    name: 'Big Ten',
    fullName: 'Big Ten',
    path: 'football/college-football',
    group: '5',
    color: '#9a3412',
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
const jsonCache = new Map();

export function resetScheduleCache() {
  monthCache.clear();
  jsonCache.clear();
}

export function leagueById(id) {
  return LEAGUES.find((league) => league.id === id);
}

function pad(month) {
  return String(month).padStart(2, '0');
}

async function fetchJson(url) {
  if (!jsonCache.has(url)) {
    const pending = fetch(url).then(async (response) => {
      if (!response.ok) {
        throw new Error(`Schedule request failed (${response.status})`);
      }
      return response.json();
    }).catch((error) => {
      jsonCache.delete(url);
      throw error;
    });
    jsonCache.set(url, pending);
  }
  return jsonCache.get(url);
}

export function scoreboardMonthUrl(league, year, month) {
  const ym = `${year}${pad(month)}`;
  const group = league.group ? `&groups=${league.group}` : '';
  return `https://site.api.espn.com/apis/site/v2/sports/${league.path}/scoreboard?dates=${ym}&limit=${monthLimit(league)}${group}`;
}

/** Lightweight scoreboard used to read leagues[0].calendar. `year` asks for that season. */
export function scoreboardCalendarUrl(league, year) {
  const group = league.group ? `&groups=${league.group}` : '';
  const dates = year ? `&dates=${year}` : '';
  return `https://site.api.espn.com/apis/site/v2/sports/${league.path}/scoreboard?limit=1${dates}${group}`;
}

export function teamsUrl(league) {
  const limit = league.path === 'football/college-football' ? 1000 : 100;
  return `https://site.api.espn.com/apis/site/v2/sports/${league.path}/teams?limit=${limit}`;
}

/**
 * The site.api teams list does not send CORS headers, so the browser cannot
 * read it. The core API does. Pro leagues use the league team index; college
 * groups already come from the core API.
 */
export function coreTeamsUrl(league) {
  const [sport, slug] = league.path.split('/');
  return `https://sports.core.api.espn.com/v2/sports/${sport}/leagues/${slug}/teams?limit=100`;
}

function httpsRef(ref) {
  return String(ref || '').replace(/^http:\/\//, 'https://');
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

export function fbsTeamsUrl(seasonYear, groupId = '80') {
  return `https://sports.core.api.espn.com/v2/sports/football/leagues/college-football/seasons/${seasonYear}/types/2/groups/${groupId}/teams?limit=200`;
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
    const homeSide = competitors.find((c) => c.homeAway === 'home') || {};
    const awaySide = competitors.find((c) => c.homeAway === 'away') || {};
    const home = homeSide.team || {};
    const away = awaySide.team || {};
    const scoreText = (value) => (value == null || value === '' ? '' : String(value));
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
    const college = league.path === 'football/college-football';

    return [{
      id: `${league.id}-${event.id}`,
      sourceKey: college ? `cfb:${event.id}` : `${league.id}:${event.id}`,
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
      state: competition.status?.type?.state || event.status?.type?.state || 'pre',
      homeScore: scoreText(homeSide.score),
      awayScore: scoreText(awaySide.score),
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
    if (!teams.length) return false;
    return teams.includes(event.homeKey) || teams.includes(event.awayKey);
  });
}

export function dedupeEvents(events) {
  const map = new Map();
  for (const event of events) map.set(event.id, event);
  return [...map.values()];
}

/** SEC and Big Ten games also appear on the full FBS slate. Keep the conference copy. */
const CONFERENCE_RANK = { sec: 2, bigten: 2, ncaaf: 1 };

export function collapseConferenceDuplicates(events) {
  const map = new Map();
  for (const event of events) {
    const key = event.sourceKey || event.id;
    const current = map.get(key);
    const rank = CONFERENCE_RANK[event.leagueId] || 0;
    const currentRank = current ? (CONFERENCE_RANK[current.leagueId] || 0) : -1;
    if (!current || rank > currentRank) map.set(key, event);
  }
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

export function periodBounds(view, cursor, now = new Date()) {
  if (view === 'today') {
    return { start: startOfDay(now), end: endOfDay(now) };
  }
  if (view === 'week') {
    const start = startOfWeek(cursor, { weekStartsOn: 0 });
    const end = endOfWeek(cursor, { weekStartsOn: 0 });
    return { start, end };
  }
  return { start: startOfMonth(cursor), end: endOfMonth(cursor) };
}

function yearMonthFromStamp(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})/);
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]) };
}

function compareMonths(a, b) {
  return a.year - b.year || a.month - b.month;
}

/** Inclusive month list from the earliest stamp to the latest. */
export function fillMonths(points) {
  if (!points.length) return [];
  const sorted = [...points].sort(compareMonths);
  const start = sorted[0];
  const end = sorted[sorted.length - 1];
  const months = [];
  let year = start.year;
  let month = start.month;
  while (year < end.year || (year === end.year && month <= end.month)) {
    months.push({ year, month });
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return months;
}

export function mergeMonths(lists) {
  const map = new Map();
  for (const list of lists) {
    for (const item of list || []) map.set(`${item.year}-${item.month}`, item);
  }
  return [...map.values()].sort(compareMonths);
}

/**
 * ESPN calendars are either game-day timestamps or season-type blocks of weeks.
 * A flat list with a missing month (MLB's milestone dates) is filled in.
 * A dense list (NBA) keeps only the months that appear.
 * Week blocks use the first and last entry, and skip empty off-season blocks.
 */
export function monthsFromEspnCalendar(calendar) {
  if (!Array.isArray(calendar) || !calendar.length) return [];
  const stamps = [];
  const flat = calendar.every((item) => typeof item === 'string');
  for (const item of calendar) {
    if (typeof item === 'string') {
      stamps.push(item);
      continue;
    }
    const entries = Array.isArray(item?.entries) ? item.entries : null;
    if (entries) {
      for (const entry of entries) {
        if (entry?.startDate) stamps.push(entry.startDate);
        if (entry?.endDate) stamps.push(entry.endDate);
      }
      continue;
    }
    if (item?.startDate) stamps.push(item.startDate);
    if (item?.endDate) stamps.push(item.endDate);
  }
  const points = stamps.map(yearMonthFromStamp).filter(Boolean);
  if (!points.length) return [];
  const filled = fillMonths(points);
  if (!flat) return filled;
  const present = mergeMonths([points]);
  return present.length === filled.length ? present : filled;
}

export async function fetchPublishedMonths(league, now = new Date()) {
  const years = [undefined, now.getFullYear() + 1];
  const lists = [];
  for (const year of years) {
    try {
      const data = await fetchJson(scoreboardCalendarUrl(league, year));
      lists.push(monthsFromEspnCalendar(data?.leagues?.[0]?.calendar));
    } catch {
      lists.push([]);
    }
  }
  return mergeMonths(lists);
}

export function leaguesForTeams(leagueIds, teamKeys) {
  const on = new Set(leagueIds);
  const ids = new Set();
  for (const key of teamKeys || []) {
    const id = String(key).split(':')[0];
    if (on.has(id)) ids.add(id);
  }
  return LEAGUES.filter((league) => ids.has(league.id));
}

export function monthsForView(view, cursor, now = new Date()) {
  if (view === 'today') return monthsFromRange(periodBounds('today', cursor, now));
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

async function loadLeagueMonth(league, year, month) {
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

async function fetchGroupTeamRefs(seasonYear, groupId) {
  const refs = [];
  let page = 1;
  let pageCount = 1;
  while (page <= pageCount && page <= 5) {
    const data = await fetchJson(`${fbsTeamsUrl(seasonYear, groupId)}&page=${page}`);
    pageCount = data.pageCount || 1;
    for (const item of data.items || []) {
      if (item?.$ref) refs.push(item.$ref);
    }
    if (!(data.items || []).length) break;
    page += 1;
  }
  return refs;
}

function teamFromCore(league, data) {
  if (!data?.id || !data.displayName) return null;
  const abbreviation = data.abbreviation || '';
  if (!abbreviation || abbreviation === 'TBD') return null;
  return {
    key: `${league.id}:${data.id}`,
    id: String(data.id),
    leagueId: league.id,
    name: data.displayName,
    abbreviation,
  };
}

async function mapPool(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await fn(items[index]);
    }
  }
  const workers = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: workers }, () => worker()));
  return results;
}

async function teamsFromRefs(league, refs) {
  const details = await mapPool(refs, 12, (ref) => fetchJson(httpsRef(ref)).catch(() => null));
  const directory = details.find((item) => item?.sports);
  if (directory) {
    const ids = new Set(refs.map((ref) => collegeTeamIdFromRef(ref)).filter(Boolean));
    const teams = normalizeTeams(league, directory);
    return ids.size ? teams.filter((team) => ids.has(team.id)) : teams;
  }
  return details
    .map((item) => teamFromCore(league, item))
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function fetchLeagueTeams(league, now = new Date()) {
  if (!league.group) {
    const data = await fetchJson(coreTeamsUrl(league));
    if (data?.sports) return normalizeTeams(league, data);
    const refs = (data?.items || []).map((item) => item.$ref).filter(Boolean);
    return teamsFromRefs(league, refs);
  }
  const refs = await fetchGroupTeamRefs(collegeSeasonYear(now), league.group);
  if (!refs.length) return [];
  return teamsFromRefs(league, refs);
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
