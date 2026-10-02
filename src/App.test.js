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
    if (href.includes('/teams')) {
      if (href.includes('college-football')) {
        return jsonResponse({
          sports: [{ leagues: [{ teams: [
            { team: { id: '333', displayName: 'Alabama Crimson Tide', abbreviation: 'ALA' } },
            { team: { id: '61', displayName: 'Georgia Bulldogs', abbreviation: 'UGA' } },
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
      return jsonResponse({
        leagues: [{ season: { year: 2026 }, calendar: [] }],
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

test('shows pro and college games, then filters and exports them', async () => {
  render(<App />);
  expect(screen.getByRole('heading', { name: 'SportSync' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /NCAAF/ })).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: 'List' }));
  expect(await screen.findByText('Alabama Crimson Tide at Georgia Bulldogs')).toBeInTheDocument();
  expect(screen.getByText('Boston Celtics at Cleveland Cavaliers')).toBeInTheDocument();

  const links = screen.getAllByRole('link', { name: 'Add to Google Calendar' });
  const collegeLink = links.find((link) => link.getAttribute('href').includes('Alabama'));
  const href = new URL(collegeLink.getAttribute('href'));
  expect(href.hostname).toBe('calendar.google.com');
  expect(href.pathname).toBe('/calendar/render');
  expect(href.searchParams.get('text')).toBe('Alabama Crimson Tide at Georgia Bulldogs');
  expect(href.searchParams.get('dates')).toBe('20261003T230000Z/20261004T023000Z');

  await userEvent.type(screen.getByRole('searchbox', { name: 'Search teams' }), 'Alabama');
  await userEvent.click(screen.getByRole('checkbox', { name: 'Alabama Crimson Tide' }));
  await waitFor(() => {
    expect(screen.queryByText('Boston Celtics at Cleveland Cavaliers')).not.toBeInTheDocument();
  });
  expect(screen.getByText('Alabama Crimson Tide at Georgia Bulldogs')).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: /Download iCal/i }));
  expect(window.URL.createObjectURL).toHaveBeenCalled();
});

test('hides college football when NCAAF is turned off', async () => {
  render(<App />);
  await userEvent.click(screen.getByRole('button', { name: 'List' }));
  expect(await screen.findByText('Alabama Crimson Tide at Georgia Bulldogs')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: /NCAAF/ }));
  await waitFor(() => {
    expect(screen.queryByText('Alabama Crimson Tide at Georgia Bulldogs')).not.toBeInTheDocument();
  });
  expect(screen.getByText('Boston Celtics at Cleveland Cavaliers')).toBeInTheDocument();
});
