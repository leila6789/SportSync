/** RFC 5545 text escaping. */
export function escapeIcsText(value) {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/\r\n|\n|\r/g, '\\n')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,');
}

function foldLine(line) {
  const encoder = new TextEncoder();
  let bytes = 0;
  let current = '';
  const parts = [];
  for (const character of line) {
    const size = encoder.encode(character).length;
    if (current && bytes + size > 75) {
      parts.push(current);
      current = ` ${character}`;
      bytes = 1 + size;
    } else {
      current += character;
      bytes += size;
    }
  }
  if (current) parts.push(current);
  return parts.join('\r\n');
}

export function formatUtc(date) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

export function formatDateOnly(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

function formatIsoDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function eventSummary(event) {
  return event.fullTitle || event.title || 'Game';
}

export function eventDescription(event) {
  return [
    event.leagueName ? `${event.leagueName} · SportSync` : 'SportSync',
    event.headline || null,
    event.seasonLabel || null,
    event.status ? `Status: ${event.status}` : null,
    event.broadcasts?.length ? `Watch: ${event.broadcasts.join(', ')}` : null,
    event.url || null,
  ].filter(Boolean).join('\n');
}

function icsStatus(status) {
  const value = (status || '').toLowerCase();
  if (value.includes('cancel')) return 'CANCELLED';
  if (value.includes('postpon')) return 'TENTATIVE';
  return 'CONFIRMED';
}

function eventLines(event, now) {
  const lines = [
    'BEGIN:VEVENT',
    `UID:${event.uid}`,
    `DTSTAMP:${formatUtc(now)}`,
    `SUMMARY:${escapeIcsText(eventSummary(event))}`,
  ];
  if (event.allDay) {
    lines.push(`DTSTART;VALUE=DATE:${formatDateOnly(event.start)}`);
    lines.push(`DTEND;VALUE=DATE:${formatDateOnly(event.end)}`);
  } else {
    lines.push(`DTSTART:${formatUtc(event.start)}`);
    lines.push(`DTEND:${formatUtc(event.end)}`);
  }
  if (event.venue) lines.push(`LOCATION:${escapeIcsText(event.venue)}`);
  const description = eventDescription(event);
  if (description) lines.push(`DESCRIPTION:${escapeIcsText(description)}`);
  if (event.url) lines.push(`URL:${event.url}`);
  lines.push(`STATUS:${icsStatus(event.status)}`);
  if (event.leagueName) lines.push(`CATEGORIES:${escapeIcsText(event.leagueName)}`);
  lines.push('END:VEVENT');
  return lines;
}

export function buildIcs(events, { calendarName = 'SportSync', now = new Date() } = {}) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//SportSync//Sports Calendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeIcsText(calendarName)}`,
    'X-WR-CALDESC:Games exported from SportSync',
  ];
  const sorted = [...events].sort((a, b) => a.start - b.start);
  for (const event of sorted) lines.push(...eventLines(event, now));
  lines.push('END:VCALENDAR');
  return `${lines.map(foldLine).join('\r\n')}\r\n`;
}

export function downloadIcs(filename, content) {
  const blob = new Blob([content], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/** Opens Google Calendar with the game filled in. No API key required. */
export function googleCalendarUrl(event) {
  const params = new URLSearchParams();
  params.set('action', 'TEMPLATE');
  params.set('text', eventSummary(event));
  if (event.allDay) {
    params.set('dates', `${formatDateOnly(event.start)}/${formatDateOnly(event.end)}`);
  } else {
    params.set('dates', `${formatUtc(event.start)}/${formatUtc(event.end)}`);
  }
  const details = eventDescription(event);
  if (details) params.set('details', details);
  if (event.venue) params.set('location', event.venue);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

export function toGoogleEventResource(event) {
  const resource = {
    summary: eventSummary(event),
    description: eventDescription(event),
    iCalUID: event.uid,
  };
  if (event.venue) resource.location = event.venue;
  if (event.allDay) {
    resource.start = { date: formatIsoDate(event.start) };
    resource.end = { date: formatIsoDate(event.end) };
  } else {
    resource.start = { dateTime: event.start.toISOString() };
    resource.end = { dateTime: event.end.toISOString() };
  }
  return resource;
}

export function buildFilename({ leagueIds, view, start }) {
  const leagues = [...leagueIds].sort().join('-') || 'sports';
  const year = start.getFullYear();
  const month = String(start.getMonth() + 1).padStart(2, '0');
  const day = String(start.getDate()).padStart(2, '0');
  if (view === 'week') return `sportsync-${leagues}-week-${year}-${month}-${day}.ics`;
  return `sportsync-${leagues}-${year}-${month}.ics`;
}

export function singleEventFilename(event) {
  const slug = eventSummary(event)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
  return `sportsync-${slug || 'game'}.ics`;
}
