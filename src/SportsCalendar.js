import React from 'react';
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

const events = [
  {
    title: 'Heat vs Lakers',
    start: new Date(2025, 5, 20, 19, 0),
    end: new Date(2025, 5, 20, 21, 0),
  },
  {
    title: 'Celtics vs Warriors',
    start: new Date(2025, 5, 22, 20, 30),
    end: new Date(2025, 5, 22, 22, 30),
  },
  {
    title: 'Nets vs Bucks',
    start: new Date(2025, 5, 25, 18, 0),
    end: new Date(2025, 5, 25, 20, 0),
  },
];

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
  return (
    <div style={{ height: 600, margin: '50px' }}>
      <h2>Basketball Game Schedule</h2>
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
