import React, { useEffect, useState } from 'react';
import { Calendar, dateFnsLocalizer } from 'react-big-calendar';
import format from 'date-fns/format';
import parse from 'date-fns/parse';
import startOfWeek from 'date-fns/startOfWeek';
import getDay from 'date-fns/getDay';
import 'react-big-calendar/lib/css/react-big-calendar.css';
import { generateGoogleCalendarUrl, downloadICS } from './CalendarExport';

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

      events.push({
        title: name,
        start: startTime,
        end: new Date(startTime.getTime() + 3 * 60 * 60 * 1000),
      });
    });
  }

  return events;
}
// Export buttons for each event
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
        <button onClick={() => downloadICS(event)}>Download iCal (.ics)</button>
      </div>
    </div>
  );
}

export default function SportsCalendar() {
  const [sport, setSport] = useState('basketball/nba');
  const [events, setEvents] = useState([]);

  useEffect(() => {
    fetchScheduleBySport(sport).then((data) => {
      console.log('Loaded events:', data);
      setEvents(data);
    });
  }, [sport]);

  return (
    <div style={{ height: 650, margin: '50px' }}>
      <h2>{sport.includes('nba') ? 'NBA' : 'MLB'} Game Schedule</h2>

      {/* Sport toggle */}
      <div style={{ marginBottom: 20 }}>
        <button onClick={() => setSport('basketball/nba')} disabled={sport === 'basketball/nba'}>
          NBA
        </button>
        <button onClick={() => setSport('baseball/mlb')} disabled={sport === 'baseball/mlb'} style={{ marginLeft: 10 }}>
          MLB
        </button>
      </div>

      <Calendar
        localizer={localizer}
        events={events}
        startAccessor="start"
        endAccessor="end"
        style={{ height: 500 }}
        defaultView="week"
        components={{
          event: Event,
        }}
      />
    </div>
  );
}
