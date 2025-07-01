const CLIENT_ID = '991865387557-ghhakmiq2h1or97i3n6mk8gmqq7rbs92.apps.googleusercontent.com';
const SCOPES = 'https://www.googleapis.com/auth/calendar.events';

let tokenClient;
let gapiInited = false;
let gisInited = false;

export function gapiLoadClient() {
  return new Promise((resolve, reject) => {
    if (!window.gapi) return reject('gapi not loaded');
    window.gapi.load('client', async () => {
      try {
        await window.gapi.client.init({
          discoveryDocs: ['https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest'],
        });
        gapiInited = true;
        resolve();
      } catch (e) {
        reject(e);
      }
    });
  });
}

export function gisInit() {
  return new Promise((resolve) => {
    tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPES,
      callback: '', // set later
    });
    gisInited = true;
    resolve();
  });
}

export async function initGoogleServices() {
  if (!gapiInited) await gapiLoadClient();
  if (!gisInited) await gisInit();
}

export async function signInAndAddEvents(events) {
  await initGoogleServices();

  return new Promise((resolve, reject) => {
    tokenClient.callback = async (resp) => {
      if (resp.error) {
        reject(resp);
        return;
      }

      try {
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

        alert('Events added to Google Calendar!');
        resolve();
      } catch (err) {
        console.error('Calendar insert error', err);
        reject(err);
      }
    };

    tokenClient.requestAccessToken();
  });
}
