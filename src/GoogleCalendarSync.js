import { toGoogleEventResource } from './CalendarExport';

const SCOPES = 'https://www.googleapis.com/auth/calendar.events';
const CLIENT_ID = process.env.REACT_APP_GOOGLE_CLIENT_ID || '';
const GAPI_SRC = 'https://apis.google.com/js/api.js';
const GIS_SRC = 'https://accounts.google.com/gsi/client';

let tokenClient;
let initPromise;

export function isGoogleSyncConfigured() {
  return Boolean(CLIENT_ID);
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      if (existing.dataset.loaded === 'true') {
        resolve();
        return;
      }
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error('Could not load Google Calendar.')), { once: true });
      return;
    }
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload = () => {
      script.dataset.loaded = 'true';
      resolve();
    };
    script.onerror = () => reject(new Error('Could not load Google Calendar.'));
    document.head.appendChild(script);
  });
}

async function doInit() {
  if (!CLIENT_ID) {
    throw new Error('Set REACT_APP_GOOGLE_CLIENT_ID to sync directly to Google Calendar.');
  }
  await loadScript(GAPI_SRC);
  await loadScript(GIS_SRC);
  await new Promise((resolve, reject) => {
    if (!window.gapi) {
      reject(new Error('Google API failed to load.'));
      return;
    }
    window.gapi.load('client', async () => {
      try {
        await window.gapi.client.init({
          discoveryDocs: ['https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest'],
        });
        resolve();
      } catch (error) {
        reject(error);
      }
    });
  });
  if (!window.google?.accounts?.oauth2) {
    throw new Error('Google sign-in failed to load.');
  }
  tokenClient = window.google.accounts.oauth2.initTokenClient({
    client_id: CLIENT_ID,
    scope: SCOPES,
    callback: () => {},
  });
}

export function initGoogleServices() {
  if (!initPromise) {
    initPromise = doInit().catch((error) => {
      initPromise = null;
      throw error;
    });
  }
  return initPromise;
}

function errorCode(error) {
  return error?.result?.error?.code || error?.status || error?.code;
}

function errorMessage(error) {
  return error?.result?.error?.message || error?.message || 'Google Calendar rejected this game.';
}

async function insertEvents(events, onProgress) {
  const result = { added: 0, skipped: 0, failed: 0, firstError: '' };
  for (const event of events) {
    try {
      await window.gapi.client.calendar.events.insert({
        calendarId: 'primary',
        resource: toGoogleEventResource(event),
      });
      result.added += 1;
    } catch (error) {
      if (errorCode(error) === 409) result.skipped += 1;
      else {
        result.failed += 1;
        if (!result.firstError) result.firstError = errorMessage(error);
      }
    }
    if (onProgress) onProgress({ ...result, total: events.length });
  }
  return result;
}

/**
 * Creates one Google Calendar event per game on the user's primary calendar.
 * Games already imported with the same iCal UID are skipped.
 */
export function signInAndAddEvents(events, { onProgress } = {}) {
  return initGoogleServices().then(() => new Promise((resolve, reject) => {
    tokenClient.callback = async (response) => {
      if (response.error) {
        reject(new Error(response.error === 'access_denied' ? 'Google sign-in was canceled.' : response.error));
        return;
      }
      try {
        resolve(await insertEvents(events, onProgress));
      } catch (error) {
        reject(error);
      }
    };
    tokenClient.requestAccessToken({ prompt: '' });
  }));
}
