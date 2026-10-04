/**
 * Upcoming-game prices come from Polymarket and Kalshi, never from ESPN.
 *
 * Polymarket: the league's sports series (NCAAF, SEC, and Big Ten share series
 * 12756). Events whose end date is within a day of the game are loaded, and
 * the moneyline market is used only when both outcomes match the two ESPN
 * teams and the market start is within three hours of the ESPN start (or, if
 * no start is present, the event date matches and there is only one candidate).
 *
 * Kalshi: the league's game series (KXNCAAFGAME for NCAAF, SEC, and Big Ten).
 * Open markets whose close time falls between one day before the game and five
 * days after it are grouped by event ticker. The ticker date (YYMONDD, plus
 * HHMM when MLB includes a start time) must match the Eastern schedule, and
 * both yes-side labels must match the ESPN teams. Prices are the site's own
 * last trade, or the posted bid and ask when there is no last trade.
 */

export const POLYMARKET_SERIES = {
  nba: '10345',
  wnba: '10105',
  nfl: '12185',
  mlb: '3',
  nhl: '10346',
  ncaaf: '12756',
  sec: '12756',
  bigten: '12756',
};

export const KALSHI_SERIES = {
  nba: 'KXNBAGAME',
  wnba: 'KXWNBAGAME',
  nfl: 'KXNFLGAME',
  mlb: 'KXMLBGAME',
  nhl: 'KXNHLGAME',
  ncaaf: 'KXNCAAFGAME',
  sec: 'KXNCAAFGAME',
  bigten: 'KXNCAAFGAME',
};

const MONTH_INDEX = {
  JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6,
  JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12,
};

const THREE_HOURS = 3 * 60 * 60 * 1000;

export function easternDateKey(date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export function easternMinutes(date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const hour = Number(parts.find((part) => part.type === 'hour')?.value);
  const minute = Number(parts.find((part) => part.type === 'minute')?.value);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  return (hour % 24) * 60 + minute;
}

function shiftDateKey(key, days) {
  const [year, month, day] = key.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

function words(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/&/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

export function teamMatchScore(teamName, teamAbbr, label) {
  const labelWords = words(label);
  const nameWords = words(teamName);
  const abbr = words(teamAbbr).join('');
  const compact = labelWords.join('');
  if (abbr && abbr.length >= 2 && compact === abbr) return 5;
  if (!labelWords.length || !nameWords.length) return 0;
  const prefix = labelWords.every((word, index) => nameWords[index] === word);
  const suffix = labelWords.length <= nameWords.length
    && labelWords.every((word, index) => nameWords[nameWords.length - labelWords.length + index] === word);
  if (prefix) return 2 + labelWords.length;
  if (suffix) return 1 + labelWords.length;
  return 0;
}

/** Indexes into `labels` for the away team and the home team. */
export function assignTeams(game, labels) {
  const teams = [
    { name: game.awayTeam, abbr: game.awayAbbr },
    { name: game.homeTeam, abbr: game.homeAbbr },
  ];
  let best = null;
  for (let awayIndex = 0; awayIndex < labels.length; awayIndex += 1) {
    for (let homeIndex = 0; homeIndex < labels.length; homeIndex += 1) {
      if (awayIndex === homeIndex) continue;
      const away = teamMatchScore(teams[0].name, teams[0].abbr, labels[awayIndex]);
      const home = teamMatchScore(teams[1].name, teams[1].abbr, labels[homeIndex]);
      if (!away || !home) continue;
      const total = away + home;
      if (!best || total > best.total) best = { total, indexes: [awayIndex, homeIndex] };
    }
  }
  return best ? best.indexes : null;
}

export function formatPrice(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0 || number >= 1) return '';
  const cents = Math.round(number * 1000) / 10;
  const text = Number.isInteger(cents) ? String(cents) : String(cents);
  return `${text}¢`;
}

function parseJsonList(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string' || !value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseTime(value) {
  if (!value) return null;
  const normalized = String(value).includes('T') ? value : String(value).replace(' ', 'T').replace(/\+00$/, 'Z');
  const time = new Date(normalized).getTime();
  return Number.isNaN(time) ? null : time;
}

function quoteFromLabels(labels, prices, game, urls = []) {
  const indexes = assignTeams(game, labels);
  if (!indexes) return null;
  const sides = indexes.map((index) => ({
    label: String(labels[index]),
    price: prices[index],
    url: urls[index] || '',
  }));
  if (sides.some((side) => !side.price)) return null;
  return sides;
}

function httpsUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return '';
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:') return '';
    return url.href;
  } catch {
    return '';
  }
}

function siteUrl(value, host) {
  const href = httpsUrl(value);
  if (!href) return '';
  const name = new URL(href).hostname.replace(/^www\./, '');
  return name === host ? href : '';
}

/**
 * Polymarket's gamma payload has no page URL. The event `slug` is the public
 * event page: https://polymarket.com/event/{slug}. An explicit polymarket.com
 * URL on the event or market wins when one is present.
 */
export function polymarketPageUrl(event, market) {
  const direct = [market?.url, event?.url].map((value) => siteUrl(value, 'polymarket.com')).find(Boolean);
  if (direct) return direct;
  const slug = String(event?.slug || market?.slug || '').trim();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(slug)) return '';
  return `https://polymarket.com/event/${slug}`;
}

/**
 * Kalshi's markets payload has no page URL. These category paths are the
 * public event pages checked for that series. Other series stay unlinked.
 */
const KALSHI_EVENT_PATH = {
  KXNFLGAME: 'professional-football-game',
  KXNBAGAME: 'professional-basketball-game',
  KXWNBAGAME: 'womens-pro-basketball-game',
  KXNHLGAME: 'nhl-game',
};

export function kalshiPageUrl(eventTicker) {
  const ticker = String(eventTicker || '').trim();
  const series = ticker.split('-')[0];
  const path = KALSHI_EVENT_PATH[series];
  if (!path || !/^[A-Z0-9]+(?:-[A-Z0-9]+)+$/i.test(ticker)) return '';
  return `https://kalshi.com/markets/${series.toLowerCase()}/${path}/${ticker.toLowerCase()}`;
}

export function matchPolymarket(events, game) {
  const paired = [];
  for (const event of events || []) {
    const market = (event.markets || []).find((item) => item.sportsMarketType === 'moneyline');
    if (!market) continue;
    const outcomes = parseJsonList(market.outcomes).map(String);
    const prices = parseJsonList(market.outcomePrices).map(formatPrice);
    const page = polymarketPageUrl(event, market);
    const quote = quoteFromLabels(outcomes, prices, game, outcomes.map(() => page));
    if (!quote) continue;
    paired.push({
      quote,
      start: parseTime(market.gameStartTime || event.startTime),
      eventDate: event.eventDate,
    });
  }
  const timed = paired.filter((item) => item.start != null && Math.abs(item.start - game.start.getTime()) <= THREE_HOURS);
  if (timed.length === 1) return timed[0].quote;
  if (timed.length > 1) {
    const tip = game.start.getTime();
    timed.sort((a, b) => Math.abs(a.start - tip) - Math.abs(b.start - tip));
    const best = Math.abs(timed[0].start - tip);
    const next = Math.abs(timed[1].start - tip);
    if (best + 30 * 60 * 1000 < next) return timed[0].quote;
    return null;
  }
  const sameDay = paired.filter((item) => item.eventDate === easternDateKey(game.start));
  return sameDay.length === 1 ? sameDay[0].quote : null;
}

export function parseKalshiTicker(ticker) {
  const match = String(ticker || '').match(/-(\d{2})([A-Z]{3})(\d{2})(\d{4})?/);
  if (!match || !MONTH_INDEX[match[2]]) return null;
  const time = match[4];
  return {
    date: `20${match[1]}-${String(MONTH_INDEX[match[2]]).padStart(2, '0')}-${match[3]}`,
    minutes: time ? Number(time.slice(0, 2)) * 60 + Number(time.slice(2)) : null,
  };
}

export function kalshiPrice(market) {
  const last = formatPrice(market?.last_price_dollars);
  if (last) return last;
  const bid = formatPrice(market?.yes_bid_dollars);
  const ask = formatPrice(market?.yes_ask_dollars);
  if (bid && ask) return bid === ask ? bid : `${bid}–${ask}`;
  return ask || bid || '';
}

export function matchKalshi(markets, game) {
  const groups = new Map();
  for (const market of markets || []) {
    const ticker = market.event_ticker;
    if (!ticker) continue;
    if (!groups.has(ticker)) groups.set(ticker, []);
    groups.get(ticker).push(market);
  }
  const day = easternDateKey(game.start);
  const tip = easternMinutes(game.start);
  const hits = [];
  for (const [ticker, group] of groups) {
    const parsed = parseKalshiTicker(ticker);
    if (!parsed || parsed.date !== day) continue;
    if (parsed.minutes != null && tip != null && Math.abs(parsed.minutes - tip) > 180) continue;
    const labels = group.map((market) => market.yes_sub_title || '');
    const prices = group.map((market) => kalshiPrice(market));
    const page = [group[0]?.url, group[1]?.url].map((value) => siteUrl(value, 'kalshi.com')).find(Boolean)
      || kalshiPageUrl(ticker);
    const quote = quoteFromLabels(labels, prices, game, labels.map(() => page));
    if (!quote) continue;
    hits.push({ quote, minutes: parsed.minutes });
  }
  if (!hits.length) return null;
  const timed = hits.filter((hit) => hit.minutes != null);
  const pool = timed.length ? timed : hits;
  if (pool.length === 1) return pool[0].quote;
  if (!timed.length || tip == null) return null;
  pool.sort((a, b) => Math.abs(a.minutes - tip) - Math.abs(b.minutes - tip));
  if (Math.abs(pool[0].minutes - tip) + 30 < Math.abs(pool[1].minutes - tip)) return pool[0].quote;
  return null;
}

async function fetchPolymarketEvents(seriesId, game) {
  const day = easternDateKey(game.start);
  const min = shiftDateKey(day, -1);
  const max = shiftDateKey(day, 2);
  const url = `https://gamma-api.polymarket.com/events?series_id=${seriesId}&closed=false&limit=100&end_date_min=${min}T00:00:00Z&end_date_max=${max}T00:00:00Z`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Polymarket request failed (${response.status})`);
  const data = await response.json();
  return Array.isArray(data) ? data : [];
}

async function fetchKalshiMarkets(series, game) {
  const minClose = Math.floor(game.start.getTime() / 1000) - 24 * 60 * 60;
  const maxClose = Math.floor(game.start.getTime() / 1000) + 5 * 24 * 60 * 60;
  const markets = [];
  let cursor = '';
  for (let page = 0; page < 5; page += 1) {
    const url = new URL('https://external-api.kalshi.com/trade-api/v2/markets');
    url.searchParams.set('series_ticker', series);
    url.searchParams.set('status', 'open');
    url.searchParams.set('limit', '200');
    url.searchParams.set('min_close_ts', String(minClose));
    url.searchParams.set('max_close_ts', String(maxClose));
    if (cursor) url.searchParams.set('cursor', cursor);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Kalshi request failed (${response.status})`);
    const data = await response.json();
    markets.push(...(data.markets || []));
    cursor = data.cursor || '';
    if (!cursor) break;
  }
  return markets;
}

export async function fetchGameOdds(game) {
  const polySeries = POLYMARKET_SERIES[game.leagueId];
  const kalshiSeries = KALSHI_SERIES[game.leagueId];
  let polymarket = null;
  let kalshi = null;
  let sawResponse = false;
  let failures = 0;
  const jobs = [];
  if (polySeries) {
    jobs.push(fetchPolymarketEvents(polySeries, game).then((events) => {
      sawResponse = true;
      polymarket = matchPolymarket(events, game);
    }).catch(() => {
      failures += 1;
    }));
  }
  if (kalshiSeries) {
    jobs.push(fetchKalshiMarkets(kalshiSeries, game).then((markets) => {
      sawResponse = true;
      kalshi = matchKalshi(markets, game);
    }).catch(() => {
      failures += 1;
    }));
  }
  await Promise.all(jobs);
  const quotes = [];
  if (polymarket) quotes.push({ source: 'Polymarket', sides: polymarket });
  if (kalshi) quotes.push({ source: 'Kalshi', sides: kalshi });
  if (quotes.length) return { quotes, message: '' };
  if (!sawResponse && failures) return { quotes: [], message: 'Odds could not be loaded.' };
  return { quotes: [], message: 'Odds are not posted yet.' };
}
