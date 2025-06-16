// Format date for Google Calendar (YYYYMMDDTHHmmssZ)
function formatDateForGoogle(date) {
    return date.toISOString().replace(/-|:|\.\d+/g, '');
  }
  
  // Generate Google Calendar event URL
  export function generateGoogleCalendarUrl(event) {
    const start = formatDateForGoogle(event.start);
    const end = formatDateForGoogle(event.end);
    const title = encodeURIComponent(event.title);
    const details = encodeURIComponent('Check out this game!');
    const location = ''; // Add location if you want
  
    return `https://calendar.google.com/calendar/r/eventedit?text=${title}&dates=${start}/${end}&details=${details}&location=${location}`;
  }
  
  // Generate ICS file content for iCal
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
  
  // Trigger download of .ics file
  export function downloadICS(event) {
    const icsContent = generateICS(event);
    const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${event.title.replace(/\s+/g, '_')}.ics`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
  