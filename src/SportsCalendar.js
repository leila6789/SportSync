import React, { useEffect, useState } from 'react';
import { Calendar, Views, dateFnsLocalizer } from 'react-big-calendar';
import format from 'date-fns/format';
import parse from 'date-fns/parse';
import startOfWeek from 'date-fns/startOfWeek';
import getDay from 'date-fns/getDay';
import 'react-big-calendar/lib/css/react-big-calendar.css';
import { generateGoogleCalendarUrl, downloadICS } from './CalendarExport';
import { initGoogleServices, signInAndAddEvents } from './GoogleCalendarSync';

const locales = {
  'en-US': require('date-fns/locale/en-US'),
};

const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek,
  getDay,
  locales,
});

async function fetchNBATeams() {
  const res = await fetch('https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams');
  const data = await res.json();
  return data.sports[0].leagues[0].teams.map(teamEntry => teamEntry.team.displayName);
}

async function fetchMLBTeams() {
  const res = await fetch('https://statsapi.mlb.com/api/v1/teams?sportId=1');
  const data = await res.json();
  return data.teams.map(team => team.name);
}

async function fetchScheduleBySport(sport) {
  const events = [];

  if (sport === 'baseball/mlb') {
    const url = 'https://statsapi.mlb.com/api/v1/schedule?sportId=1&startDate=2025-03-01&endDate=2025-11-01';
    const res = await fetch(url);
    const data = await res.json();

    const dates = data.dates || [];
    dates.forEach((day) => {
      day.games.forEach((game) => {
        const startTime = new Date(game.gameDate);
        const title = `${game.teams.away.team.name} vs ${game.teams.home.team.name}`;

        events.push({
          title,
          start: startTime,
          end: new Date(startTime.getTime() + 3 * 60 * 60 * 1000),
          homeTeam: game.teams.home.team.name,
          awayTeam: game.teams.away.team.name,
        });
      });
    });
  } else if (sport === 'basketball/nba') {
    const url = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard';
    const res = await fetch(url);
    const data = await res.json();

    const games = data.events || [];
    games.forEach((game) => {
      const name = game.name;
      const date = game.date;
      const startTime = new Date(date);
      const homeTeam = game.competitions?.[0]?.competitors.find(c => c.homeAway === 'home')?.team.displayName || '';
      const awayTeam = game.competitions?.[0]?.competitors.find(c => c.homeAway === 'away')?.team.displayName || '';

      events.push({
        title: name,
        start: startTime,
        end: new Date(startTime.getTime() + 3 * 60 * 60 * 1000),
        homeTeam,
        awayTeam,
      });
    });
  }

  return events;
}

function Event({ event }) {
  return (
    <div>
      <strong>{event.title}</strong>
      <div style={{ marginTop: 5 }}>
        <a
          href={generateGoogleCalendarUrl(event)}
          target="_blank"
          rel="noreferrer"
          style={{ marginRight: 10 }}
        >
          Add to Google Calendar
        </a>
        <button onClick={() => downloadICS([event])}>Download iCal (.ics)</button>
      </div>
    </div>
  );
}

export default function SportsCalendar() {
  const [sport, setSport] = useState('basketball/nba');
  const [events, setEvents] = useState([]);
  const [teams, setTeams] = useState([]);
  const [selectedTeams, setSelectedTeams] = useState([]);
  const [teamSearch, setTeamSearch] = useState('');
  const [loadingEvents, setLoadingEvents] = useState(true);
  const [loadingTeams, setLoadingTeams] = useState(true);
  const [currentView, setCurrentView] = useState(Views.MONTH);

  useEffect(() => {
    initGoogleServices()
      .then(() => {
        console.log('Google API initialized');
      })
      .catch(err => {
        console.error('Failed to init Google API', err);
      });
  }, []);

  useEffect(() => {
    setLoadingTeams(true);
    setSelectedTeams([]);
    const fetchTeams = sport === 'basketball/nba' ? fetchNBATeams : fetchMLBTeams;
    fetchTeams().then(fetched => {
      setTeams(fetched);
      setLoadingTeams(false);
    });
  }, [sport]);

  useEffect(() => {
    setLoadingEvents(true);
    fetchScheduleBySport(sport).then((data) => {
      setEvents(data);
      setLoadingEvents(false);
    });
  }, [sport]);

  const filteredEvents = selectedTeams.length
    ? events.filter((e) =>
        selectedTeams.includes(e.homeTeam) || selectedTeams.includes(e.awayTeam)
      )
    : events;

  const filteredTeamsList = teams.filter(team =>
    team.toLowerCase().includes(teamSearch.toLowerCase())
  );

  function toggleTeamSelection(team) {
    setSelectedTeams(prev =>
      prev.includes(team) ? prev.filter(t => t !== team) : [...prev, team]
    );
  }

  return (
    <div style={{ height: 750, margin: '50px' }}>
      <h2>{sport.includes('nba') ? 'NBA' : 'MLB'} Game Schedule</h2>

      <div style={{ marginBottom: 20 }}>
        <button onClick={() => setSport('basketball/nba')} disabled={sport === 'basketball/nba'}>
          NBA
        </button>
        <button
          onClick={() => setSport('baseball/mlb')}
          disabled={sport === 'baseball/mlb'}
          style={{ marginLeft: 10 }}
        >
          MLB
        </button>
      </div>

      <div style={{ marginBottom: 20 }}>
        <input
          type="text"
          placeholder="Search teams..."
          value={teamSearch}
          onChange={e => setTeamSearch(e.target.value)}
          style={{ width: '100%', padding: '8px', marginBottom: '8px' }}
          disabled={loadingTeams}
        />
        <div
          style={{
            maxHeight: 150,
            overflowY: 'auto',
            border: '1px solid #ccc',
            padding: 5,
            backgroundColor: loadingTeams ? '#f9f9f9' : 'white',
          }}
        >
          {loadingTeams ? (
            <p>Loading teams...</p>
          ) : filteredTeamsList.length === 0 ? (
            <div>No teams found</div>
          ) : (
            filteredTeamsList.map(team => (
              <div key={team}>
                <label>
                  <input
                    type="checkbox"
                    checked={selectedTeams.includes(team)}
                    onChange={() => toggleTeamSelection(team)}
                  />
                  {' '}
                  {team}
                </label>
              </div>
            ))
          )}
        </div>
      </div>

      {filteredEvents.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <button
            onClick={() => signInAndAddEvents(filteredEvents)}
            style={{ marginBottom: 10, backgroundColor: '#4285F4', color: 'white', padding: '10px', border: 'none', borderRadius: '4px' }}
          >
            Add All to Google Calendar
          </button>

          <button onClick={() => downloadICS(filteredEvents)}>
            Download All as iCal (.ics)
          </button>
        </div>
      )}

      {loadingEvents ? (
        <p>Loading schedule...</p>
      ) : filteredEvents.length === 0 ? (
        <p>No games found for the selected teams.</p>
      ) : (
        <Calendar
          localizer={localizer}
          events={filteredEvents}
          startAccessor="start"
          endAccessor="end"
          style={{ height: 500 }}
          view={currentView}
          onView={setCurrentView}
          views={[Views.MONTH, Views.WEEK, Views.DAY]}
          components={{ event: Event }}
        />
      )}
    </div>
  );
}
