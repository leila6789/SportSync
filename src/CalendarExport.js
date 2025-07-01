



// Format date for Google Calendar (YYYYMMDDTHHmmssZ)
function formatDateForGoogle(date) {
  return date.toISOString().replace(/-|:|\.\d+/g, '');
}

// --- SINGLE EVENT EXPORT ---

export function generateGoogleCalendarUrl(event) {
  const start = formatDateForGoogle(event.start);
  const end = formatDateForGoogle(event.end);
  const title = encodeURIComponent(event.title);
  const details = encodeURIComponent('Check out this game!');
  const location = '';

  return `https://calendar.google.com/calendar/r/eventedit?text=${title}&dates=${start}/${end}&details=${details}&location=${location}`;
}

export function generateICS(event) {
  return `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
SUMMARY:${event.title}
DTSTART:${formatDateForGoogle(event.start)}
DTEND:${formatDateForGoogle(event.end)}
DESCRIPTION:Check out this game!
END:VEVENT
END:VCALENDAR`;
}

export function downloadICS(eventOrEvents) {
  const events = Array.isArray(eventOrEvents) ? eventOrEvents : [eventOrEvents];

  let icsContent = `BEGIN:VCALENDAR\nVERSION:2.0\n`;
  events.forEach(event => {
    icsContent += `BEGIN:VEVENT
SUMMARY:${event.title}
DTSTART:${formatDateForGoogle(event.start)}
DTEND:${formatDateForGoogle(event.end)}
DESCRIPTION:Check out this game!
END:VEVENT
`;
  });
  icsContent += `END:VCALENDAR`;

  const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `sports_schedule.ics`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// --- BULK GOOGLE CALENDAR LINK ---

export async function handleBulkAddToGoogleCalendar(events) {
  if (!window.gapi || !window.gapi.auth2) {
    alert('Google API not initialized.');
    return;
  }

  try {
    const authInstance = window.gapi.auth2.getAuthInstance();
    if (!authInstance.isSignedIn.get()) {
      await authInstance.signIn();
    }

    for (const event of events) {
      await window.gapi.client.calendar.events.insert({
        calendarId: 'primary',
        resource: {
          summary: event.title,
          start: { dateTime: event.start.toISOString() },
          end: { dateTime: event.end.toISOString() },
          description: 'Synced from Sports Calendar App',
        },
      });
    }

    alert('Events successfully added to Google Calendar!');
  } catch (err) {
    console.error('Error syncing to Google Calendar:', err);
    alert('Failed to sync events. Check the console for details.');
  }
}