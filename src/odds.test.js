import {
  assignTeams,
  fetchGameOdds,
  formatPrice,
  kalshiPageUrl,
  kalshiPrice,
  matchKalshi,
  matchPolymarket,
  polymarketPageUrl,
  parseKalshiTicker,
  teamMatchScore,
} from './odds';

const heatAtRaptors = {
  leagueId: 'nba',
  awayTeam: 'Miami Heat',
  homeTeam: 'Toronto Raptors',
  awayAbbr: 'MIA',
  homeAbbr: 'TOR',
  start: new Date('2026-10-03T23:00:00Z'),
};

test('matches nicknames without treating Georgia Tech as Georgia', () => {
  expect(teamMatchScore('Miami Heat', 'MIA', 'Heat')).toBeGreaterThan(0);
  expect(teamMatchScore('Miami Heat', 'MIA', 'MIA')).toBeGreaterThan(0);
  expect(teamMatchScore('Georgia Bulldogs', 'UGA', 'Georgia Tech')).toBe(0);
  expect(teamMatchScore('Georgia Tech Yellow Jackets', 'GT', 'Georgia Tech')).toBeGreaterThan(0);
  const indexes = assignTeams(
    {
      awayTeam: 'Georgia Bulldogs',
      awayAbbr: 'UGA',
      homeTeam: 'Georgia Tech Yellow Jackets',
      homeAbbr: 'GT',
    },
    ['Georgia', 'Georgia Tech']
  );
  expect(indexes).toEqual([0, 1]);
});

test('formats posted prices and ignores 0 or 1', () => {
  expect(formatPrice('0.5300')).toBe('53¢');
  expect(formatPrice('0.505')).toBe('50.5¢');
  expect(formatPrice('0')).toBe('');
  expect(formatPrice('1')).toBe('');
  expect(kalshiPrice({ last_price_dollars: '0.0000', yes_bid_dollars: '0.4700', yes_ask_dollars: '0.4900' })).toBe('47¢–49¢');
});

test('matches a Polymarket moneyline and ignores a different start time', () => {
  const events = [{
    eventDate: '2026-10-03',
    startTime: '2026-10-03T23:00:00Z',
    slug: 'nba-mia-tor-2026-10-03',
    markets: [{
      sportsMarketType: 'spreads',
      outcomes: '["Heat", "Raptors"]',
      outcomePrices: '["0.4", "0.6"]',
      gameStartTime: '2026-10-03 23:00:00+00',
    }, {
      sportsMarketType: 'moneyline',
      outcomes: '["Heat", "Raptors"]',
      outcomePrices: '["0.505", "0.495"]',
      gameStartTime: '2026-10-03 23:00:00+00',
    }],
  }, {
    eventDate: '2026-10-03',
    startTime: '2026-10-03T16:00:00Z',
    markets: [{
      sportsMarketType: 'moneyline',
      outcomes: '["Heat", "Raptors"]',
      outcomePrices: '["0.2", "0.8"]',
      gameStartTime: '2026-10-03 16:00:00+00',
    }],
  }];
  expect(matchPolymarket(events, heatAtRaptors)).toEqual([
    { label: 'Heat', price: '50.5¢', url: 'https://polymarket.com/event/nba-mia-tor-2026-10-03' },
    { label: 'Raptors', price: '49.5¢', url: 'https://polymarket.com/event/nba-mia-tor-2026-10-03' },
  ]);
  expect(matchPolymarket([], heatAtRaptors)).toBeNull();
  expect(polymarketPageUrl({ slug: 'nba-mia-tor-2026-10-03', url: 'https://www.nfl.com/scores' })).toBe(
    'https://polymarket.com/event/nba-mia-tor-2026-10-03',
  );
  expect(polymarketPageUrl({ url: 'https://polymarket.com/event/given-by-api' })).toBe(
    'https://polymarket.com/event/given-by-api',
  );
  expect(polymarketPageUrl({})).toBe('');
});

test('matches a Kalshi ticker to the Eastern game date', () => {
  expect(parseKalshiTicker('KXNBAGAME-26OCT03MIATOR')).toEqual({ date: '2026-10-03', minutes: null });
  expect(parseKalshiTicker('KXMLBGAME-26OCT031300CWSCLE').minutes).toBe(13 * 60);
  const markets = [
    {
      event_ticker: 'KXNBAGAME-26OCT03MIATOR',
      yes_sub_title: 'Miami',
      last_price_dollars: '0.5300',
    },
    {
      event_ticker: 'KXNBAGAME-26OCT03MIATOR',
      yes_sub_title: 'Toronto',
      last_price_dollars: '0.4700',
    },
    {
      event_ticker: 'KXNBAGAME-26OCT04MIATOR',
      yes_sub_title: 'Miami',
      last_price_dollars: '0.2000',
    },
    {
      event_ticker: 'KXNBAGAME-26OCT04MIATOR',
      yes_sub_title: 'Toronto',
      last_price_dollars: '0.8000',
    },
  ];
  expect(matchKalshi(markets, heatAtRaptors)).toEqual([
    { label: 'Miami', price: '53¢', url: 'https://kalshi.com/markets/kxnbagame/professional-basketball-game/kxnbagame-26oct03miator' },
    { label: 'Toronto', price: '47¢', url: 'https://kalshi.com/markets/kxnbagame/professional-basketball-game/kxnbagame-26oct03miator' },
  ]);
  expect(kalshiPageUrl('KXMLBGAME-26OCT03CHWCLE')).toBe('');
  expect(matchKalshi([
    { event_ticker: 'KXMLBGAME-26OCT03CHWCLE', yes_sub_title: 'Miami', last_price_dollars: '0.5300', url: 'https://example.com/nope' },
    { event_ticker: 'KXMLBGAME-26OCT03CHWCLE', yes_sub_title: 'Toronto', last_price_dollars: '0.4700' },
  ], heatAtRaptors).map((side) => side.url)).toEqual(['', '']);
  const linked = matchKalshi([
    {
      event_ticker: 'KXMLBGAME-26OCT03CHWCLE',
      yes_sub_title: 'Miami',
      last_price_dollars: '0.5300',
      url: 'https://kalshi.com/markets/kxmlbgame/professional-baseball-game/kxmlbgame-26oct03chwcle',
    },
    { event_ticker: 'KXMLBGAME-26OCT03CHWCLE', yes_sub_title: 'Toronto', last_price_dollars: '0.4700' },
  ], heatAtRaptors);
  expect(linked[0].url).toBe('https://kalshi.com/markets/kxmlbgame/professional-baseball-game/kxmlbgame-26oct03chwcle');
});

test('says odds are not posted when neither site has a matching market', async () => {
  global.fetch = jest.fn(async (url) => {
    const href = String(url);
    if (href.includes('gamma-api.polymarket.com')) return { ok: true, json: async () => [] };
    if (href.includes('kalshi.com')) return { ok: true, json: async () => ({ markets: [], cursor: '' }) };
    throw new Error(href);
  });
  await expect(fetchGameOdds(heatAtRaptors)).resolves.toEqual({
    quotes: [],
    message: 'Odds are not posted yet.',
  });
  const called = global.fetch.mock.calls.map(([url]) => String(url));
  expect(called.some((url) => url.includes('series_id=10345'))).toBe(true);
  expect(called.some((url) => url.includes('series_ticker=KXNBAGAME'))).toBe(true);
  expect(called.some((url) => url.includes('espn'))).toBe(false);
});
