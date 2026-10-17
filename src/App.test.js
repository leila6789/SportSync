import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import { resetGameOddsCache } from './odds';
import { LIVE_REFRESH_MS } from './SportsCalendar';
import { resetScheduleCache } from './schedule';

function jsonResponse(data) {
  return { ok: true, status: 200, json: async () => data };
}

function competition(home, away, extra = {}) {
  return {
    timeValid: true,
    venue: { fullName: 'Test Arena', address: { city: 'Atlanta', state: 'GA' } },
    status: { type: { description: 'Scheduled' } },
    broadcasts: [{ names: ['ESPN'] }],
    notes: [],
    competitors: [
      { homeAway: 'home', team: home },
      { homeAway: 'away', team: away },
    ],
    ...extra,
  };
}

beforeEach(() => {
  localStorage.clear();
  resetScheduleCache();
  resetGameOddsCache();
  window.URL.createObjectURL = jest.fn(() => 'blob:sportsync');
  window.URL.revokeObjectURL = jest.fn();
  global.fetch = jest.fn(async (url) => {
    const href = String(url);
    if (href.includes('gamma-api.polymarket.com')) {
      if (href.includes('series_id=10345')) {
        return jsonResponse([{
          eventDate: '2026-10-08',
          slug: 'nba-bos-cle-2026-10-08',
          markets: [{
            sportsMarketType: 'moneyline',
            outcomes: '["Celtics", "Cavaliers"]',
            outcomePrices: '["0.42", "0.58"]',
            gameStartTime: '2026-10-08T23:00:00Z',
          }, {
            sportsMarketType: 'spreads',
            outcomes: '["Celtics", "Cavaliers"]',
            outcomePrices: '["0.51", "0.49"]',
            gameStartTime: '2026-10-08T23:00:00Z',
          }],
        }]);
      }
      return jsonResponse([]);
    }
    if (href.includes('kalshi.com')) {
      if (href.includes('series_ticker=KXNBAGAME')) {
        return jsonResponse({
          markets: [
            { event_ticker: 'KXNBAGAME-26OCT08BOSCLE', yes_sub_title: 'Boston', last_price_dollars: '0.4100' },
            { event_ticker: 'KXNBAGAME-26OCT08BOSCLE', yes_sub_title: 'Cleveland', last_price_dollars: '0.5900' },
          ],
          cursor: '',
        });
      }
      return jsonResponse({ markets: [], cursor: '' });
    }
    if (href.includes('/groups/80/teams')) {
      return jsonResponse({
        pageCount: 1,
        items: [
          { $ref: 'https://sports.core.api.espn.com/v2/sports/football/leagues/college-football/seasons/2026/teams/333?lang=en' },
          { $ref: 'https://sports.core.api.espn.com/v2/sports/football/leagues/college-football/seasons/2026/teams/61?lang=en' },
        ],
      });
    }
    if (href.includes('/groups/8/teams')) {
      return jsonResponse({
        pageCount: 1,
        items: [
          { $ref: 'https://sports.core.api.espn.com/v2/sports/football/leagues/college-football/seasons/2026/teams/238?lang=en' },
        ],
      });
    }
    if (href.includes('/groups/5/teams')) {
      return jsonResponse({
        pageCount: 1,
        items: [
          { $ref: 'https://sports.core.api.espn.com/v2/sports/football/leagues/college-football/seasons/2026/teams/194?lang=en' },
        ],
      });
    }
    if (href.includes('/teams')) {
      if (href.includes('college-football')) {
        return jsonResponse({
          sports: [{ leagues: [{ teams: [
            { team: { id: '333', displayName: 'Alabama Crimson Tide', abbreviation: 'ALA' } },
            { team: { id: '61', displayName: 'Georgia Bulldogs', abbreviation: 'UGA' } },
            { team: { id: '238', displayName: 'Vanderbilt Commodores', abbreviation: 'VAN' } },
            { team: { id: '194', displayName: 'Ohio State Buckeyes', abbreviation: 'OSU' } },
          ] }] }],
        });
      }
      if (href.includes('/nba/')) {
        return jsonResponse({
          sports: [{ leagues: [{ teams: [
            { team: { id: '2', displayName: 'Boston Celtics', abbreviation: 'BOS' } },
            { team: { id: '13', displayName: 'Los Angeles Lakers', abbreviation: 'LAL' } },
          ] }] }],
        });
      }
      return jsonResponse({ sports: [{ leagues: [{ teams: [] }] }] });
    }
    if (href.includes('college-football/scoreboard')) {
      if (href.includes('groups=80')) {
        return jsonResponse({
          events: [{
            id: 'cfb1',
            date: '2026-10-03T23:00:00.000Z',
            name: 'Alabama Crimson Tide at Georgia Bulldogs',
            season: { slug: 'regular-season' },
            competitions: [competition(
              { id: '61', displayName: 'Georgia Bulldogs', abbreviation: 'UGA' },
              { id: '333', displayName: 'Alabama Crimson Tide', abbreviation: 'ALA' },
            )],
          }],
        });
      }
      if (href.includes('groups=8')) {
        return jsonResponse({
          events: [{
            id: 'sec1',
            date: '2026-10-03T23:30:00.000Z',
            name: 'Vanderbilt Commodores at Georgia Bulldogs',
            season: { slug: 'regular-season' },
            competitions: [competition(
              { id: '61', displayName: 'Georgia Bulldogs', abbreviation: 'UGA' },
              { id: '238', displayName: 'Vanderbilt Commodores', abbreviation: 'VAN' },
            )],
          }],
        });
      }
      if (href.includes('groups=5')) {
        return jsonResponse({
          events: [{
            id: 'b1g1',
            date: '2026-10-10T16:00:00.000Z',
            name: 'Ohio State Buckeyes at Iowa Hawkeyes',
            season: { slug: 'regular-season' },
            competitions: [competition(
              { id: '2294', displayName: 'Iowa Hawkeyes', abbreviation: 'IOWA' },
              { id: '194', displayName: 'Ohio State Buckeyes', abbreviation: 'OSU' },
            )],
          }],
        });
      }
      return jsonResponse({ events: [] });
    }
    if (href.includes('basketball/nba/scoreboard')) {
      return jsonResponse({
        events: [{
          id: 'nba1',
          date: '2026-10-08T23:00:00.000Z',
          name: 'Boston Celtics at Cleveland Cavaliers',
          season: { slug: 'preseason' },
          competitions: [competition(
            { id: '5', displayName: 'Cleveland Cavaliers', abbreviation: 'CLE' },
            { id: '2', displayName: 'Boston Celtics', abbreviation: 'BOS' },
            {
              odds: [{
                provider: { displayName: 'DraftKings' },
                pointSpread: {
                  away: { close: { line: '+3.5', odds: '-110' } },
                  home: { close: { line: '-3.5', odds: '-110' } },
                },
                moneyline: {
                  away: { close: { odds: '+150' } },
                  home: { close: { odds: '-170' } },
                },
                total: {
                  over: { close: { line: 'o220.5', odds: '-110' } },
                  under: { close: { line: 'u220.5', odds: '-110' } },
                },
              }],
            },
          )],
        }, {
          id: 'nba2',
          date: '2026-10-02T23:00:00.000Z',
          name: 'Los Angeles Lakers at Boston Celtics',
          season: { slug: 'preseason' },
          competitions: [competition(
            { id: '2', displayName: 'Boston Celtics', abbreviation: 'BOS' },
            { id: '13', displayName: 'Los Angeles Lakers', abbreviation: 'LAL' },
            {
              status: { type: { state: 'post', description: 'Final' } },
              competitors: [
                { homeAway: 'home', score: '110', team: { id: '2', displayName: 'Boston Celtics', abbreviation: 'BOS' } },
                { homeAway: 'away', score: '101', team: { id: '13', displayName: 'Los Angeles Lakers', abbreviation: 'LAL' } },
              ],
            },
          )],
        }],
      });
    }
    return jsonResponse({ events: [] });
  });
});

test('starts empty until a team is picked, then exports that team', async () => {
  render(<App />);
  expect(screen.getByRole('heading', { name: 'SportSync' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'SEC', pressed: true })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Big Ten', pressed: true })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'WNBA', pressed: true })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'NBA', pressed: true })).toBeInTheDocument();
  expect(screen.getByText('Pick a team to see its games.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Export' })).toBeDisabled();
  await waitFor(() => {
    expect(global.fetch).toHaveBeenCalled();
  });
  expect(global.fetch.mock.calls.some(([url]) => String(url).includes('scoreboard'))).toBe(false);

  await userEvent.click(screen.getByRole('button', { name: 'Week' }));
  expect(screen.getByText('Pick a team to see its games.')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'List' }));
  expect(screen.queryByText('Alabama Crimson Tide at Georgia Bulldogs')).not.toBeInTheDocument();
  expect(screen.queryByText('Boston Celtics at Cleveland Cavaliers')).not.toBeInTheDocument();

  await userEvent.type(screen.getByRole('searchbox', { name: 'Search teams' }), 'Alabama');
  await userEvent.click(screen.getByRole('checkbox', { name: 'Alabama Crimson Tide' }));
  expect(await screen.findByText('Alabama Crimson Tide at Georgia Bulldogs')).toBeInTheDocument();
  expect(screen.queryByText('Boston Celtics at Cleveland Cavaliers')).not.toBeInTheDocument();
  expect(screen.queryByText('Vanderbilt Commodores at Georgia Bulldogs')).not.toBeInTheDocument();

  const links = screen.getAllByRole('link', { name: 'Add to Google Calendar' });
  const collegeLink = links.find((link) => link.getAttribute('href').includes('Alabama'));
  const href = new URL(collegeLink.getAttribute('href'));
  expect(href.hostname).toBe('calendar.google.com');
  expect(href.pathname).toBe('/calendar/render');
  expect(href.searchParams.get('text')).toBe('Alabama Crimson Tide at Georgia Bulldogs');
  expect(href.searchParams.get('dates')).toBe('20261003T230000Z/20261004T023000Z');

  await userEvent.click(screen.getByRole('button', { name: 'Alabama Crimson Tide at Georgia Bulldogs' }));
  expect(await screen.findByText('Odds are not posted yet.')).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: 'Export' }));
  await userEvent.click(screen.getByRole('button', { name: /Download iCal/i }));
  expect(window.URL.createObjectURL).toHaveBeenCalled();
});

test('shows Polymarket and Kalshi prices, and the ESPN score when a game is final', async () => {
  render(<App />);
  await userEvent.click(screen.getByRole('button', { name: 'List' }));
  await userEvent.type(screen.getByRole('searchbox', { name: 'Search teams' }), 'Boston');
  await userEvent.click(await screen.findByRole('checkbox', { name: 'Boston Celtics' }));
  await userEvent.click(await screen.findByRole('button', { name: 'Boston Celtics at Cleveland Cavaliers' }));
  expect(await screen.findByText('Polymarket Celtics 42¢')).toBeInTheDocument();
  expect(screen.getByText('Polymarket Cavaliers 58¢')).toBeInTheDocument();
  expect(screen.getByText('Kalshi Boston 41¢')).toBeInTheDocument();
  expect(screen.getByText('Kalshi Cleveland 59¢')).toBeInTheDocument();
  const polymarketLink = screen.getByRole('link', { name: 'Polymarket Celtics 42¢' });
  expect(polymarketLink).toHaveAttribute('href', 'https://polymarket.com/event/nba-bos-cle-2026-10-08');
  expect(polymarketLink).toHaveAttribute('target', '_blank');
  const kalshiLink = screen.getByRole('link', { name: 'Kalshi Boston 41¢' });
  expect(kalshiLink).toHaveAttribute('href', 'https://kalshi.com/markets/kxnbagame/professional-basketball-game/kxnbagame-26oct08boscle');
  expect(kalshiLink).toHaveAttribute('target', '_blank');
  const winChance = screen.getByRole('link', { name: 'CLE 58% from Polymarket' });
  expect(winChance).toHaveAttribute('href', 'https://polymarket.com/event/nba-bos-cle-2026-10-08');
  expect(winChance).toHaveTextContent('CLE 58%');
  expect(screen.queryByText('DraftKings via ESPN')).not.toBeInTheDocument();
  expect(screen.queryByText('BOS +3.5 -110')).not.toBeInTheDocument();
  expect(screen.queryByText('Spread')).not.toBeInTheDocument();
  expect(screen.queryByText(/51¢/)).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Close' }));
  await userEvent.click(screen.getByRole('button', { name: 'Los Angeles Lakers at Boston Celtics' }));
  expect(screen.getByText('LAL 101')).toBeInTheDocument();
  expect(screen.getByText('BOS 110')).toBeInTheDocument();
  expect(screen.getAllByText('Final').length).toBeGreaterThan(0);
  expect(screen.queryByText('Polymarket')).not.toBeInTheDocument();
  expect(screen.queryByText('Kalshi')).not.toBeInTheDocument();
});

test('restores a saved team and still filters by league', async () => {
  localStorage.setItem('sportsync.filters.v2', JSON.stringify({
    leagueIds: ['nba', 'mlb', 'nfl', 'ncaaf', 'sec', 'bigten', 'nhl'],
    teamKeys: ['ncaaf:333', 'nba:2'],
  }));
  render(<App />);
  await userEvent.click(screen.getByRole('button', { name: 'List' }));
  expect(await screen.findByText('Alabama Crimson Tide at Georgia Bulldogs')).toBeInTheDocument();
  expect(screen.getByText('Boston Celtics at Cleveland Cavaliers')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: /NCAAF/ }));
  await waitFor(() => {
    expect(screen.queryByText('Alabama Crimson Tide at Georgia Bulldogs')).not.toBeInTheDocument();
  });
  expect(screen.getByText('Boston Celtics at Cleveland Cavaliers')).toBeInTheDocument();
});

test('filters SEC and Big Ten to the selected teams', async () => {
  render(<App />);
  await userEvent.click(screen.getByRole('button', { name: 'List' }));
  await userEvent.type(screen.getByRole('searchbox', { name: 'Search teams' }), 'Vanderbilt');
  await userEvent.click(await screen.findByRole('checkbox', { name: 'Vanderbilt Commodores' }));
  expect(await screen.findByText('Vanderbilt Commodores at Georgia Bulldogs')).toBeInTheDocument();
  expect(screen.queryByText('Ohio State Buckeyes at Iowa Hawkeyes')).not.toBeInTheDocument();

  await userEvent.clear(screen.getByRole('searchbox', { name: 'Search teams' }));
  await userEvent.type(screen.getByRole('searchbox', { name: 'Search teams' }), 'Ohio State');
  await userEvent.click(await screen.findByRole('checkbox', { name: 'Ohio State Buckeyes' }));
  expect(await screen.findByText('Ohio State Buckeyes at Iowa Hawkeyes')).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: 'Big Ten', pressed: true }));
  await waitFor(() => {
    expect(screen.queryByText('Ohio State Buckeyes at Iowa Hawkeyes')).not.toBeInTheDocument();
  });
  expect(screen.getByText('Vanderbilt Commodores at Georgia Bulldogs')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Export' }));
  await userEvent.click(screen.getByRole('button', { name: /Download iCal/i }));
  expect(window.URL.createObjectURL).toHaveBeenCalled();
});

test('today view stays empty until a selected team plays today', async () => {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 19, 0, 0);
  const later = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2, 19, 0, 0);
  global.fetch = jest.fn(async (url) => {
    const href = String(url);
    if (href.includes('gamma-api.polymarket.com')) return jsonResponse([]);
    if (href.includes('kalshi.com')) return jsonResponse({ markets: [], cursor: '' });
    if (href.includes('/teams')) {
      const teams = href.includes('/nba/')
        ? [
          { team: { id: '2', displayName: 'Boston Celtics', abbreviation: 'BOS' } },
          { team: { id: '13', displayName: 'Los Angeles Lakers', abbreviation: 'LAL' } },
        ]
        : [];
      return jsonResponse({ sports: [{ leagues: [{ teams }] }] });
    }
    if (href.includes('basketball/nba/scoreboard') && !href.includes('limit=1')) {
      return jsonResponse({
        events: [{
          id: 'today-game',
          date: today.toISOString(),
          name: 'Boston Celtics at Cleveland Cavaliers',
          season: { slug: 'regular-season' },
          competitions: [competition(
            { id: '5', displayName: 'Cleveland Cavaliers', abbreviation: 'CLE' },
            { id: '2', displayName: 'Boston Celtics', abbreviation: 'BOS' },
            {
              status: { type: { state: 'in', description: 'In Progress' } },
              competitors: [
                { homeAway: 'home', score: '40', team: { id: '5', displayName: 'Cleveland Cavaliers', abbreviation: 'CLE' } },
                { homeAway: 'away', score: '38', team: { id: '2', displayName: 'Boston Celtics', abbreviation: 'BOS' } },
              ],
            },
          )],
        }, {
          id: 'later-game',
          date: later.toISOString(),
          name: 'Los Angeles Lakers at Boston Celtics',
          season: { slug: 'regular-season' },
          competitions: [competition(
            { id: '2', displayName: 'Boston Celtics', abbreviation: 'BOS' },
            { id: '13', displayName: 'Los Angeles Lakers', abbreviation: 'LAL' },
          )],
        }],
      });
    }
    if (href.includes('scoreboard')) {
      return jsonResponse({
        leagues: [{ calendar: [today.toISOString(), later.toISOString()] }],
      });
    }
    return jsonResponse({ events: [] });
  });

  render(<App />);
  expect(screen.getByRole('button', { name: 'Month', pressed: true })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: "Today's games" }));
  expect(screen.getByRole('button', { name: "Today's games", pressed: true })).toBeInTheDocument();
  expect(screen.getByText('Pick a team to see its games.')).toBeInTheDocument();
  expect(screen.queryByText('Boston Celtics at Cleveland Cavaliers')).not.toBeInTheDocument();
  expect(screen.queryByText('Los Angeles Lakers at Boston Celtics')).not.toBeInTheDocument();

  await userEvent.click(await screen.findByRole('checkbox', { name: 'Los Angeles Lakers' }));
  expect(await screen.findByText('No games today')).toBeInTheDocument();
  expect(screen.queryByText('Los Angeles Lakers at Boston Celtics')).not.toBeInTheDocument();

  await userEvent.click(screen.getByRole('checkbox', { name: 'Boston Celtics' }));
  expect(await screen.findByText('Boston Celtics at Cleveland Cavaliers')).toBeInTheDocument();
  expect(screen.getByText(/7:00 PM/)).toBeInTheDocument();
  expect(screen.getByText('LIVE')).toBeInTheDocument();
  expect(screen.getByText(/38–40/)).toBeInTheDocument();
  expect(screen.getByText(/In Progress/)).toBeInTheDocument();
  expect(screen.queryByText(/\d+%/)).not.toBeInTheDocument();
  expect(screen.queryByText('Los Angeles Lakers at Boston Celtics')).not.toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: 'Boston Celtics at Cleveland Cavaliers' }));
  expect(screen.getByText('BOS 38')).toBeInTheDocument();
  expect(screen.getByText('CLE 40')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Close' }));

  await userEvent.click(screen.getByRole('button', { name: 'Month' }));
  expect(screen.getByRole('button', { name: 'Month', pressed: true })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: "Today's games", pressed: false })).toBeInTheDocument();
});

test('shows a later published month for the selected league', async () => {
  const landed = new Date();
  landed.setMonth(landed.getMonth() + 1);
  const laterStamp = `${landed.getFullYear()}${String(landed.getMonth() + 1).padStart(2, '0')}`;
  const laterGame = new Date(landed.getFullYear(), landed.getMonth(), landed.getDate(), 19, 0, 0);
  global.fetch = jest.fn(async (url) => {
    const href = String(url);
    if (href.includes('/teams')) {
      const teams = href.includes('/nba/')
        ? [{ team: { id: '2', displayName: 'Boston Celtics', abbreviation: 'BOS' } }]
        : [];
      return jsonResponse({ sports: [{ leagues: [{ teams }] }] });
    }
    if (href.includes(`dates=${laterStamp}`)) {
      return jsonResponse({
        events: [{
          id: 'nba-nov',
          date: laterGame.toISOString(),
          name: 'Boston Celtics at New York Knicks',
          season: { slug: 'regular-season' },
          competitions: [competition(
            { id: '18', displayName: 'New York Knicks', abbreviation: 'NY' },
            { id: '2', displayName: 'Boston Celtics', abbreviation: 'BOS' },
          )],
        }],
      });
    }
    if (href.includes('dates=202610')) {
      return jsonResponse({
        events: [{
          id: 'nba1',
          date: '2026-10-08T23:00:00.000Z',
          name: 'Boston Celtics at Cleveland Cavaliers',
          season: { slug: 'preseason' },
          competitions: [competition(
            { id: '5', displayName: 'Cleveland Cavaliers', abbreviation: 'CLE' },
            { id: '2', displayName: 'Boston Celtics', abbreviation: 'BOS' },
          )],
        }],
      });
    }
    if (href.includes('scoreboard')) {
      return jsonResponse({
        leagues: [{ calendar: ['2026-10-03T00:00:00Z', '2026-11-03T00:00:00Z', '2026-12-01T00:00:00Z'] }],
      });
    }
    return jsonResponse({ events: [] });
  });

  render(<App />);
  await userEvent.click(await screen.findByRole('checkbox', { name: 'Boston Celtics' }));
  await userEvent.click(screen.getByRole('button', { name: 'List' }));
  expect(await screen.findByText('Boston Celtics at Cleveland Cavaliers')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Next' }));
  expect(await screen.findByText('Boston Celtics at New York Knicks')).toBeInTheDocument();
  expect(screen.queryByText('Boston Celtics at Cleveland Cavaliers')).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Week' }));
  expect(screen.getByText('BOS @ NY')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Month' }));
  expect(screen.getByText('BOS @ NY')).toBeInTheDocument();
});

test('shows a selected WNBA team schedule and its market links', async () => {
  global.fetch = jest.fn(async (url) => {
    const href = String(url);
    if (href.includes('gamma-api.polymarket.com')) {
      if (!href.includes('series_id=10105')) return jsonResponse([]);
      return jsonResponse([{
        eventDate: '2026-10-04',
        slug: 'wnba-nyl-atl-2026-10-04',
        markets: [{
          sportsMarketType: 'moneyline',
          outcomes: '["New York Liberty", "Atlanta Dream"]',
          outcomePrices: '["0.385", "0.615"]',
          gameStartTime: '2026-10-04T18:00:00Z',
        }],
      }]);
    }
    if (href.includes('kalshi.com')) {
      if (!href.includes('series_ticker=KXWNBAGAME')) return jsonResponse({ markets: [], cursor: '' });
      return jsonResponse({
        markets: [
          { event_ticker: 'KXWNBAGAME-26OCT04ATLNY', yes_sub_title: 'New York', last_price_dollars: '0.3900' },
          { event_ticker: 'KXWNBAGAME-26OCT04ATLNY', yes_sub_title: 'Atlanta', last_price_dollars: '0.6100' },
        ],
        cursor: '',
      });
    }
    if (href.includes('/leagues/wnba/teams')) {
      return jsonResponse({
        sports: [{ leagues: [{ teams: [
          { team: { id: '9', displayName: 'New York Liberty', abbreviation: 'NY' } },
          { team: { id: '20', displayName: 'Atlanta Dream', abbreviation: 'ATL' } },
        ] }] }],
      });
    }
    if (href.includes('/teams')) return jsonResponse({ sports: [{ leagues: [{ teams: [] }] }] });
    if (href.includes('basketball/wnba/scoreboard') && !href.includes('limit=1')) {
      return jsonResponse({
        events: [{
          id: 'wnba1',
          date: '2026-10-04T18:00:00.000Z',
          name: 'New York Liberty at Atlanta Dream',
          season: { slug: 'regular-season' },
          competitions: [competition(
            { id: '20', displayName: 'Atlanta Dream', abbreviation: 'ATL' },
            { id: '9', displayName: 'New York Liberty', abbreviation: 'NY' },
          )],
        }],
      });
    }
    if (href.includes('scoreboard')) {
      return jsonResponse({
        leagues: [{ calendar: ['2026-04-25T07:00Z', '2026-10-31T07:00Z'] }],
      });
    }
    return jsonResponse({ events: [] });
  });

  render(<App />);
  expect(screen.getByRole('button', { name: 'WNBA', pressed: true })).toBeInTheDocument();
  expect(screen.getByText('Pick a team to see its games.')).toBeInTheDocument();
  expect(global.fetch.mock.calls.some(([url]) => String(url).includes('scoreboard'))).toBe(false);

  await userEvent.click(screen.getByRole('button', { name: 'List' }));
  await userEvent.type(screen.getByRole('searchbox', { name: 'Search teams' }), 'Liberty');
  await userEvent.click(await screen.findByRole('checkbox', { name: 'New York Liberty' }));
  expect(await screen.findByText('New York Liberty at Atlanta Dream')).toBeInTheDocument();
  expect(screen.queryByText('Boston Celtics at Cleveland Cavaliers')).not.toBeInTheDocument();
  expect(global.fetch.mock.calls.some(([url]) => String(url).includes('basketball/wnba/scoreboard'))).toBe(true);

  await userEvent.click(screen.getByRole('button', { name: 'New York Liberty at Atlanta Dream' }));
  const polymarket = await screen.findByRole('link', { name: 'Polymarket New York Liberty 38.5¢' });
  expect(polymarket).toHaveAttribute('href', 'https://polymarket.com/event/wnba-nyl-atl-2026-10-04');
  expect(polymarket).toHaveAttribute('target', '_blank');
  const kalshi = screen.getByRole('link', { name: 'Kalshi New York 39¢' });
  expect(kalshi).toHaveAttribute('href', 'https://kalshi.com/markets/kxwnbagame/womens-pro-basketball-game/kxwnbagame-26oct04atlny');
  expect(kalshi).toHaveAttribute('target', '_blank');

  await userEvent.click(screen.getByRole('button', { name: 'Close' }));
  await userEvent.click(screen.getByRole('button', { name: 'Export' }));
  await userEvent.click(screen.getByRole('button', { name: /Download iCal/i }));
  expect(window.URL.createObjectURL).toHaveBeenCalled();
});

test('opens a searchable logo grid on a fresh visit', async () => {
  render(<App />);
  expect(screen.getByRole('heading', { name: 'Choose your teams' })).toBeInTheDocument();
  const finder = screen.getByRole('searchbox', { name: 'Find a team' });
  await userEvent.type(finder, 'zzz-no-team');
  expect(await screen.findByText('No teams match.')).toBeInTheDocument();
  await userEvent.clear(finder);
  await userEvent.type(finder, 'Celtics');
  const follow = await screen.findByRole('button', { name: 'Follow Boston Celtics' });
  expect(follow.querySelector('img').getAttribute('src')).toBe('https://a.espncdn.com/i/teamlogos/nba/500/bos.png');
  await userEvent.click(follow);
  await userEvent.click(screen.getByRole('button', { name: /Show my teams/ }));
  expect(screen.queryByRole('heading', { name: 'Choose your teams' })).not.toBeInTheDocument();
  expect(await screen.findByRole('heading', { name: 'Boston Celtics' })).toBeInTheDocument();
});

test('shows next game, last score, and posted odds on My Teams', async () => {
  global.fetch = jest.fn(async (url) => {
    const href = String(url);
    if (href.includes('gamma-api.polymarket.com')) {
      return jsonResponse([{
        eventDate: '2026-10-20',
        slug: 'nba-bos-cle-2026-10-20',
        markets: [{
          sportsMarketType: 'moneyline',
          outcomes: '["Celtics", "Cavaliers"]',
          outcomePrices: '["0.42", "0.58"]',
          gameStartTime: '2026-10-20T23:00:00Z',
        }],
      }]);
    }
    if (href.includes('kalshi.com')) return jsonResponse({ markets: [], cursor: '' });
    if (href.includes('/teams')) {
      const teams = href.includes('/nba/')
        ? [{ team: { id: '2', displayName: 'Boston Celtics', abbreviation: 'BOS', color: '008348' } }]
        : [];
      return jsonResponse({ sports: [{ leagues: [{ teams }] }] });
    }
    if (href.includes('basketball/nba/scoreboard') && !href.includes('limit=1')) {
      return jsonResponse({
        events: [{
          id: 'nba-next',
          date: '2026-10-20T23:00:00.000Z',
          name: 'Boston Celtics at Cleveland Cavaliers',
          season: { slug: 'regular-season' },
          competitions: [competition(
            { id: '5', displayName: 'Cleveland Cavaliers', abbreviation: 'CLE', color: '860038' },
            { id: '2', displayName: 'Boston Celtics', abbreviation: 'BOS', color: '008348' },
          )],
        }, {
          id: 'nba-last',
          date: '2026-10-02T23:00:00.000Z',
          name: 'Los Angeles Lakers at Boston Celtics',
          season: { slug: 'regular-season' },
          competitions: [competition(
            { id: '2', displayName: 'Boston Celtics', abbreviation: 'BOS' },
            { id: '13', displayName: 'Los Angeles Lakers', abbreviation: 'LAL' },
            {
              status: { type: { state: 'post', description: 'Final' } },
              competitors: [
                { homeAway: 'home', score: '110', team: { id: '2', displayName: 'Boston Celtics', abbreviation: 'BOS' } },
                { homeAway: 'away', score: '101', team: { id: '13', displayName: 'Los Angeles Lakers', abbreviation: 'LAL' } },
              ],
            },
          )],
        }],
      });
    }
    if (href.includes('scoreboard')) {
      return jsonResponse({ leagues: [{ calendar: ['2026-10-02T00:00:00Z', '2026-10-20T00:00:00Z'] }] });
    }
    return jsonResponse({ events: [] });
  });

  render(<App />);
  await userEvent.click(await screen.findByRole('checkbox', { name: 'Boston Celtics' }));
  await userEvent.click(screen.getByRole('button', { name: 'My Teams' }));
  expect(await screen.findByRole('heading', { name: 'Boston Celtics' })).toBeInTheDocument();
  expect(await screen.findByText('LAL 101 – BOS 110')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Boston Celtics at Cleveland Cavaliers' })).toBeInTheDocument();
  const chance = await screen.findByRole('link', { name: 'BOS 42% from Polymarket' });
  expect(chance).toHaveAttribute('href', 'https://polymarket.com/event/nba-bos-cle-2026-10-20');
  expect(screen.getByText('Polymarket')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Celtics 42¢' })).toHaveAttribute('target', '_blank');
});

test('collapses a busy day to a count and league dots', async () => {
  global.fetch = jest.fn(async (url) => {
    const href = String(url);
    if (href.includes('/teams')) {
      const teams = href.includes('/nfl/')
        ? [
          { team: { id: '30', displayName: 'Jacksonville Jaguars', abbreviation: 'JAX', color: '007487' } },
          { team: { id: '1', displayName: 'Atlanta Falcons', abbreviation: 'ATL', color: 'a71930' } },
          { team: { id: '5', displayName: 'Cleveland Browns', abbreviation: 'CLE', color: '472a08' } },
          { team: { id: '11', displayName: 'Indianapolis Colts', abbreviation: 'IND', color: '003b75' } },
        ]
        : [];
      return jsonResponse({ sports: [{ leagues: [{ teams }] }] });
    }
    if (href.includes('football/nfl/scoreboard') && !href.includes('limit=1')) {
      const games = [
        ['jax', 'Houston Texans', 'HOU', '34', 'Jacksonville Jaguars', 'JAX', '30'],
        ['atl', 'Chicago Bears', 'CHI', '3', 'Atlanta Falcons', 'ATL', '1'],
        ['cle', 'Baltimore Ravens', 'BAL', '33', 'Cleveland Browns', 'CLE', '5'],
        ['ind', 'Tennessee Titans', 'TEN', '10', 'Indianapolis Colts', 'IND', '11'],
      ];
      return jsonResponse({
        events: games.map(([id, awayName, awayAbbr, awayId, homeName, homeAbbr, homeId]) => ({
          id,
          date: '2026-10-18T17:00:00.000Z',
          name: `${awayName} at ${homeName}`,
          season: { slug: 'regular-season' },
          competitions: [competition(
            { id: homeId, displayName: homeName, abbreviation: homeAbbr },
            { id: awayId, displayName: awayName, abbreviation: awayAbbr },
          )],
        })),
      });
    }
    if (href.includes('scoreboard')) {
      return jsonResponse({ leagues: [{ calendar: ['2026-10-18T17:00:00Z'] }] });
    }
    return jsonResponse({ events: [] });
  });

  render(<App />);
  await userEvent.click(await screen.findByRole('checkbox', { name: 'Jacksonville Jaguars' }));
  await userEvent.click(screen.getByRole('checkbox', { name: 'Atlanta Falcons' }));
  await userEvent.click(screen.getByRole('checkbox', { name: 'Cleveland Browns' }));
  await userEvent.click(screen.getByRole('checkbox', { name: 'Indianapolis Colts' }));
  const count = await screen.findByRole('button', { name: '4 games' });
  expect(count.querySelectorAll('.ss-dot')).toHaveLength(1);
  expect(screen.queryByText('HOU @ JAX')).not.toBeInTheDocument();
  await userEvent.click(count);
  expect(screen.getByText('HOU @ JAX')).toBeInTheDocument();
  expect(screen.getByText('CHI @ ATL')).toBeInTheDocument();
});

test('refreshes a live score on an interval', async () => {
  let awayScore = '38';
  global.fetch = jest.fn(async (url) => {
    const href = String(url);
    if (href.includes('/teams')) {
      const teams = href.includes('/nba/')
        ? [{ team: { id: '2', displayName: 'Boston Celtics', abbreviation: 'BOS' } }]
        : [];
      return jsonResponse({ sports: [{ leagues: [{ teams }] }] });
    }
    if (href.includes('basketball/nba/scoreboard') && !href.includes('limit=1')) {
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 19, 0, 0);
      return jsonResponse({
        events: [{
          id: 'live-refresh',
          date: today.toISOString(),
          name: 'Boston Celtics at Cleveland Cavaliers',
          season: { slug: 'regular-season' },
          competitions: [competition(
            { id: '5', displayName: 'Cleveland Cavaliers', abbreviation: 'CLE' },
            { id: '2', displayName: 'Boston Celtics', abbreviation: 'BOS' },
            {
              status: { type: { state: 'in', description: 'In Progress' } },
              competitors: [
                { homeAway: 'home', score: '40', team: { id: '5', displayName: 'Cleveland Cavaliers', abbreviation: 'CLE' } },
                { homeAway: 'away', score: awayScore, team: { id: '2', displayName: 'Boston Celtics', abbreviation: 'BOS' } },
              ],
            },
          )],
        }],
      });
    }
    if (href.includes('scoreboard')) {
      return jsonResponse({ leagues: [{ calendar: [new Date().toISOString()] }] });
    }
    return jsonResponse({ events: [] });
  });
  const scheduled = [];
  const realSetInterval = window.setInterval.bind(window);
  const spy = jest.spyOn(window, 'setInterval').mockImplementation((fn, ms, ...rest) => {
    if (ms === LIVE_REFRESH_MS) {
      scheduled.push(fn);
      return 0;
    }
    return realSetInterval(fn, ms, ...rest);
  });

  try {
    render(<App />);
    await userEvent.click(screen.getByRole('button', { name: "Today's games" }));
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Boston Celtics' }));
    expect(await screen.findByText(/38–40/)).toBeInTheDocument();
    awayScore = '44';
    expect(scheduled.length).toBeGreaterThan(0);
    await act(async () => {
      await scheduled[scheduled.length - 1]();
    });
    expect(await screen.findByText(/44–40/)).toBeInTheDocument();
  } finally {
    spy.mockRestore();
  }
});

test('follows the system theme until the toggle overrides it', async () => {
  const original = window.matchMedia;
  window.matchMedia = jest.fn().mockImplementation((query) => ({
    matches: String(query).includes('dark'),
    media: query,
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
  }));
  try {
    render(<App />);
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
    await userEvent.click(screen.getByRole('button', { name: 'Switch to light mode' }));
    expect(document.documentElement).toHaveAttribute('data-theme', 'light');
    expect(localStorage.getItem('sportsync.theme')).toBe('light');
    await userEvent.click(screen.getByRole('button', { name: 'Switch to dark mode' }));
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
  } finally {
    window.matchMedia = original;
    document.documentElement.removeAttribute('data-theme');
  }
});
