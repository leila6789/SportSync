import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import { resetScheduleCache } from './schedule';

function jsonResponse(data) {
  return { ok: true, status: 200, json: async () => data };
}

function competition(home, away) {
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
  };
}

beforeEach(() => {
  localStorage.clear();
  resetScheduleCache();
  window.URL.createObjectURL = jest.fn(() => 'blob:sportsync');
  window.URL.revokeObjectURL = jest.fn();
  global.fetch = jest.fn(async (url) => {
    const href = String(url);
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
      if (href.includes('basketball/nba')) {
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
  expect(screen.getByText('Pick a team to see its games.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Download iCal/i })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Add to Google Calendar' })).toBeDisabled();
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

  await userEvent.click(screen.getByRole('button', { name: /Download iCal/i }));
  expect(window.URL.createObjectURL).toHaveBeenCalled();
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
  await userEvent.click(screen.getByRole('button', { name: /Download iCal/i }));
  expect(window.URL.createObjectURL).toHaveBeenCalled();
});

test('shows a later published month for the selected league', async () => {
  global.fetch = jest.fn(async (url) => {
    const href = String(url);
    if (href.includes('/teams')) {
      const teams = href.includes('/nba/')
        ? [{ team: { id: '2', displayName: 'Boston Celtics', abbreviation: 'BOS' } }]
        : [];
      return jsonResponse({ sports: [{ leagues: [{ teams }] }] });
    }
    if (href.includes('dates=202611')) {
      return jsonResponse({
        events: [{
          id: 'nba-nov',
          date: '2026-11-03T23:00:00.000Z',
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
