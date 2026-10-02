import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Calendar, dateFnsLocalizer } from 'react-big-calendar';
import {
  addMonths,
  addWeeks,
  endOfMonth,
  endOfWeek,
  format,
  getDay,
  parse,
  startOfMonth,
  startOfWeek,
} from 'date-fns';
import 'react-big-calendar/lib/css/react-big-calendar.css';
import {
  buildFilename,
  buildIcs,
  downloadIcs,
  googleCalendarUrl,
  singleEventFilename,
} from './CalendarExport';
import { isGoogleSyncConfigured, signInAndAddEvents } from './GoogleCalendarSync';
import {
  LEAGUES,
  dedupeEvents,
  eventsInPeriod,
  fetchLeagueMonth,
  fetchLeagueTeams,
  filterEvents,
  mergeTeams,
  monthsForView,
  periodBounds,
  resetScheduleCache,
} from './schedule';

const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek,
  getDay,
  locales: {},
});

const STORAGE_KEY = 'sportsync.filters.v1';

function readFilters() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const known = new Set(LEAGUES.map((league) => league.id));
    const leagueIds = Array.isArray(parsed.leagueIds)
      ? parsed.leagueIds.filter((id) => known.has(id))
      : [];
    const teamKeys = Array.isArray(parsed.teamKeys)
      ? parsed.teamKeys.filter((key) => typeof key === 'string')
      : [];
    if (!leagueIds.length) return null;
    return { leagueIds, teamKeys };
  } catch {
    return null;
  }
}

function writeFilters(leagueIds, teamKeys) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ leagueIds, teamKeys }));
  } catch {
    // Ignore storage failures (private mode, quota).
  }
}

function eventPropGetter(event) {
  return { style: { backgroundColor: event.color } };
}

function CalendarEvent({ event }) {
  const time = event.allDay ? 'TBD' : format(event.start, 'h:mm a');
  return (
    <span className="ss-chip" title={event.fullTitle}>
      <span className="ss-chip-time">{time}</span>
      <span className="ss-chip-name">{event.title}</span>
    </span>
  );
}

function formatWhen(event) {
  if (event.allDay) return `${format(event.start, 'EEEE, MMMM d, yyyy')} · Time TBD`;
  return format(event.start, 'EEEE, MMMM d, yyyy · h:mm a');
}

function periodTitle(view, cursor) {
  if (view === 'week') {
    const { start, end } = periodBounds('week', cursor);
    if (start.getMonth() === end.getMonth()) {
      return `${format(start, 'MMM d')} – ${format(end, 'd, yyyy')}`;
    }
    return `${format(start, 'MMM d')} – ${format(end, 'MMM d, yyyy')}`;
  }
  return format(cursor, 'MMMM yyyy');
}

function groupByDay(events) {
  const groups = [];
  const sorted = [...events].sort((a, b) => a.start - b.start || a.title.localeCompare(b.title));
  for (const event of sorted) {
    const label = format(event.start, 'EEEE, MMMM d');
    const last = groups[groups.length - 1];
    if (!last || last.label !== label) groups.push({ label, events: [event] });
    else last.events.push(event);
  }
  return groups;
}

export default function SportsCalendar() {
  const saved = useRef(readFilters());
  const [view, setView] = useState('month');
  const [cursor, setCursor] = useState(() => new Date());
  const [leagueIds, setLeagueIds] = useState(() => saved.current?.leagueIds || LEAGUES.map((league) => league.id));
  const [teamKeys, setTeamKeys] = useState(() => saved.current?.teamKeys || []);
  const [teamSearch, setTeamSearch] = useState('');
  const [openLeagues, setOpenLeagues] = useState(() => LEAGUES.filter((league) => league.id !== 'ncaaf').map((league) => league.id));
  const [store, setStore] = useState({});
  const [errors, setErrors] = useState({});
  const [pending, setPending] = useState(0);
  const [teams, setTeams] = useState([]);
  const [teamsLoading, setTeamsLoading] = useState(true);
  const [dialog, setDialog] = useState(null);
  const [notice, setNotice] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const cacheRef = useRef(new Map());
  const inflight = useRef(new Map());

  useEffect(() => {
    writeFilters(leagueIds, teamKeys);
  }, [leagueIds, teamKeys]);

  useEffect(() => {
    let cancelled = false;
    setTeamsLoading(true);
    Promise.allSettled(LEAGUES.map((league) => fetchLeagueTeams(league))).then((results) => {
      if (cancelled) return;
      const loaded = results.flatMap((result) => (result.status === 'fulfilled' ? result.value : []));
      setTeams(loaded);
      setTeamsLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const ensureMonths = useCallback((months) => {
    const jobs = [];
    for (const league of LEAGUES) {
      for (const ym of months) {
        const key = `${league.id}:${ym.year}-${ym.month}`;
        if (cacheRef.current.has(key) || inflight.current.has(key)) continue;
        const promise = fetchLeagueMonth(league, ym.year, ym.month)
          .then((events) => {
            cacheRef.current.set(key, events);
            setStore((current) => ({ ...current, [key]: events }));
            setErrors((current) => ({ ...current, [key]: undefined }));
          })
          .catch((error) => {
            setErrors((current) => ({
              ...current,
              [key]: error.message || 'Could not load schedule',
            }));
          })
          .finally(() => {
            inflight.current.delete(key);
            setPending((count) => Math.max(0, count - 1));
          });
        inflight.current.set(key, promise);
        jobs.push(promise);
      }
    }
    if (jobs.length) setPending((count) => count + jobs.length);
  }, []);

  useEffect(() => {
    ensureMonths(monthsForView(view, cursor));
  }, [view, cursor, ensureMonths]);

  useEffect(() => {
    if (!dialog) return undefined;
    const onKey = (event) => {
      if (event.key === 'Escape') setDialog(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dialog]);

  const period = useMemo(() => periodBounds(view, cursor), [view, cursor]);
  const allEvents = useMemo(() => dedupeEvents(Object.values(store).flat()), [store]);
  const filtered = useMemo(
    () => filterEvents(allEvents, { leagueIds, teamKeys }),
    [allEvents, leagueIds, teamKeys]
  );
  const periodEvents = useMemo(
    () => eventsInPeriod(filtered, period.start, period.end),
    [filtered, period]
  );
  const gridRange = useMemo(() => {
    if (view !== 'month') return period;
    return {
      start: startOfWeek(startOfMonth(cursor), { weekStartsOn: 0 }),
      end: endOfWeek(endOfMonth(cursor), { weekStartsOn: 0 }),
    };
  }, [view, cursor, period]);
  const gridEvents = useMemo(
    () => eventsInPeriod(filtered, gridRange.start, gridRange.end),
    [filtered, gridRange]
  );
  const directory = useMemo(() => mergeTeams(teams, allEvents), [teams, allEvents]);
  const label = periodTitle(view, cursor);
  const selectedTeams = directory.filter((team) => teamKeys.includes(team.key));
  const query = teamSearch.trim().toLowerCase();

  const leagueCounts = useMemo(() => {
    const counts = Object.fromEntries(LEAGUES.map((league) => [league.id, 0]));
    const inPeriod = eventsInPeriod(allEvents, period.start, period.end);
    for (const event of inPeriod) {
      if (teamKeys.length && !teamKeys.includes(event.homeKey) && !teamKeys.includes(event.awayKey)) continue;
      counts[event.leagueId] += 1;
    }
    return counts;
  }, [allEvents, period, teamKeys]);

  const visibleMonthKeys = monthsForView(view, cursor).flatMap((ym) => (
    LEAGUES.map((league) => `${league.id}:${ym.year}-${ym.month}`)
  ));
  const hasError = visibleMonthKeys.some((key) => errors[key]);
  const countLabel = pending > 0 && periodEvents.length === 0
    ? 'Loading games…'
    : `${periodEvents.length} ${periodEvents.length === 1 ? 'game' : 'games'}`;

  function shift(direction) {
    setCursor((current) => (view === 'week' ? addWeeks(current, direction) : addMonths(current, direction)));
  }

  function toggleLeague(id) {
    setLeagueIds((current) => (
      current.includes(id) ? current.filter((leagueId) => leagueId !== id) : [...current, id]
    ));
  }

  function toggleTeam(key) {
    setTeamKeys((current) => (
      current.includes(key) ? current.filter((teamKey) => teamKey !== key) : [...current, key]
    ));
  }

  function toggleOpenLeague(id) {
    setOpenLeagues((current) => (
      current.includes(id) ? current.filter((leagueId) => leagueId !== id) : [...current, id]
    ));
  }

  function handleDownload(events = periodEvents) {
    if (!events.length) return;
    const filename = events.length === 1
      ? singleEventFilename(events[0])
      : buildFilename({ leagueIds, view, start: period.start });
    downloadIcs(filename, buildIcs(events));
    setNotice(`Downloaded ${filename}`);
  }

  function retry() {
    cacheRef.current.clear();
    inflight.current.clear();
    resetScheduleCache();
    setStore({});
    setErrors({});
    ensureMonths(monthsForView(view, cursor));
  }

  return (
    <div className="ss-app">
      <header className="ss-header">
        <div className="ss-brand">
          <span className="ss-mark" aria-hidden="true">
            <svg viewBox="0 0 32 32" width="32" height="32">
              <rect width="32" height="32" rx="8" fill="#1c1917" />
              <rect x="6" y="8" width="20" height="16" rx="3" fill="#fffaf3" />
              <path d="M6 11h20v4H6z" fill="#9f1239" />
              <circle cx="16" cy="19" r="2.2" fill="#1c1917" />
            </svg>
          </span>
          <div>
            <h1>SportSync</h1>
            <p>NBA, MLB, NFL, college football, and NHL in one calendar.</p>
          </div>
        </div>
        <div className="ss-header-actions">
          <button
            type="button"
            className="ss-btn ss-filter-toggle"
            aria-expanded={filtersOpen}
            onClick={() => setFiltersOpen((open) => !open)}
          >
            Filters{teamKeys.length ? ` · ${teamKeys.length}` : ''}
          </button>
          <button
            type="button"
            className="ss-btn primary"
            onClick={() => handleDownload()}
            disabled={!periodEvents.length}
            aria-label={`Download iCal file for ${label}`}
          >
            Download .ics
          </button>
          <button type="button" className="ss-btn" onClick={() => setDialog({ type: 'export' })}>
            Add to Google Calendar
          </button>
        </div>
      </header>

      <div className="ss-body">
        <aside className={`ss-sidebar${filtersOpen ? ' is-open' : ''}`}>
          <div className="ss-side-block">
            <h2>Leagues</h2>
            <div className="ss-leagues">
              {LEAGUES.map((league) => {
                const on = leagueIds.includes(league.id);
                return (
                  <button
                    key={league.id}
                    type="button"
                    className={`ss-league${on ? ' is-on' : ''}`}
                    aria-pressed={on}
                    aria-label={league.fullName === league.name ? league.name : `${league.name} ${league.fullName}`}
                    onClick={() => toggleLeague(league.id)}
                  >
                    <span className="ss-dot" style={{ background: league.color }} aria-hidden="true" />
                    <span>{league.name}</span>
                    <span className="ss-league-count" aria-hidden="true">{leagueCounts[league.id] || 0}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="ss-side-block ss-teams-block">
            <div className="ss-teams-head">
              <h2>Teams</h2>
              {teamKeys.length > 0 && (
                <button type="button" className="ss-text-btn" onClick={() => setTeamKeys([])}>
                  Clear
                </button>
              )}
            </div>
            <input
              type="search"
              className="ss-search"
              placeholder="Search teams"
              aria-label="Search teams"
              value={teamSearch}
              onChange={(event) => setTeamSearch(event.target.value)}
            />
            <div className="ss-team-scroll">
              {teamsLoading && teams.length === 0 && <p className="ss-muted">Loading teams…</p>}
              {LEAGUES.filter((league) => leagueIds.includes(league.id)).map((league) => {
                const leagueTeams = directory.filter((team) => team.leagueId === league.id);
                const visible = leagueTeams.filter((team) => (
                  !query
                  || team.name.toLowerCase().includes(query)
                  || team.abbreviation.toLowerCase().includes(query)
                ));
                const expanded = Boolean(query) || openLeagues.includes(league.id);
                return (
                  <section key={league.id} className="ss-team-group">
                    <button
                      type="button"
                      className="ss-team-group-toggle"
                      aria-expanded={expanded}
                      onClick={() => toggleOpenLeague(league.id)}
                    >
                      <span>{league.fullName}</span>
                      <span className="ss-muted">{expanded ? 'Hide' : 'Show'}</span>
                    </button>
                    {expanded && (
                      visible.length === 0
                        ? <p className="ss-muted">{query ? 'No teams match.' : 'No teams loaded.'}</p>
                        : visible.map((team) => (
                          <label key={team.key} className="ss-team">
                            <input
                              type="checkbox"
                              checked={teamKeys.includes(team.key)}
                              onChange={() => toggleTeam(team.key)}
                            />
                            <span>{team.name}</span>
                          </label>
                        ))
                    )}
                  </section>
                );
              })}
              {leagueIds.length === 0 && <p className="ss-muted">Turn a league on to filter its teams.</p>}
            </div>
            <p className="ss-attrib">Schedules from ESPN. College football is the FBS slate.</p>
          </div>
        </aside>

        <main className="ss-main">
          <div className="ss-toolbar">
            <div className="ss-nav">
              <button type="button" className="ss-btn" onClick={() => setCursor(new Date())}>Today</button>
              <button type="button" className="ss-icon-btn" aria-label="Previous" onClick={() => shift(-1)}>‹</button>
              <button type="button" className="ss-icon-btn" aria-label="Next" onClick={() => shift(1)}>›</button>
              <h2>{label}</h2>
            </div>
            <p className="ss-count" role="status">{countLabel}</p>
            <div className="ss-views" role="group" aria-label="Calendar view">
              {[
                ['month', 'Month'],
                ['week', 'Week'],
                ['list', 'List'],
              ].map(([id, name]) => (
                <button
                  key={id}
                  type="button"
                  className={`ss-view${view === id ? ' is-on' : ''}`}
                  aria-pressed={view === id}
                  onClick={() => setView(id)}
                >
                  {name}
                </button>
              ))}
            </div>
          </div>

          {selectedTeams.length > 0 && (
            <div className="ss-chips" aria-label="Selected teams">
              {selectedTeams.map((team) => (
                <button key={team.key} type="button" className="ss-chip-btn" onClick={() => toggleTeam(team.key)}>
                  {team.name}
                  <span aria-hidden="true">×</span>
                </button>
              ))}
            </div>
          )}

          {hasError && (
            <div className="ss-banner" role="alert">
              <span>Some schedules didn’t load.</span>
              <button type="button" className="ss-text-btn" onClick={retry}>Retry</button>
            </div>
          )}

          {pending > 0 && <div className="ss-loading" role="status">Loading schedules…</div>}

          {view === 'list' ? (
            <ListView
              events={periodEvents}
              pending={pending}
              leagueIds={leagueIds}
              teamKeys={teamKeys}
              onOpen={(event) => setDialog({ type: 'event', event })}
              onClearTeams={() => setTeamKeys([])}
              onShowLeagues={() => setLeagueIds(LEAGUES.map((league) => league.id))}
            />
          ) : (
            <div className="ss-calendar">
              {gridEvents.length === 0 && !pending ? (
                <EmptyState
                  leagueIds={leagueIds}
                  teamKeys={teamKeys}
                  onClearTeams={() => setTeamKeys([])}
                  onShowLeagues={() => setLeagueIds(LEAGUES.map((league) => league.id))}
                />
              ) : (
                <Calendar
                  localizer={localizer}
                  culture="en-US"
                  events={gridEvents}
                  startAccessor="start"
                  endAccessor="end"
                  titleAccessor="title"
                  tooltipAccessor="fullTitle"
                  view={view}
                  date={cursor}
                  onNavigate={setCursor}
                  onView={setView}
                  views={['month', 'week']}
                  toolbar={false}
                  popup
                  selectable={false}
                  style={{ height: '100%' }}
                  eventPropGetter={eventPropGetter}
                  components={{ event: CalendarEvent }}
                  onSelectEvent={(event) => setDialog({ type: 'event', event })}
                  onDrillDown={(date) => {
                    setCursor(date);
                    setView('week');
                  }}
                  scrollToTime={new Date(1970, 0, 1, 12, 0, 0)}
                />
              )}
            </div>
          )}
        </main>
      </div>

      {notice && (
        <div className="ss-toast" role="status">{notice}</div>
      )}

      {dialog?.type === 'event' && (
        <EventDialog
          event={dialog.event}
          onClose={() => setDialog(null)}
          onDownload={() => handleDownload([dialog.event])}
        />
      )}
      {dialog?.type === 'export' && (
        <ExportDialog
          events={periodEvents}
          label={label}
          leagueIds={leagueIds}
          teamKeys={teamKeys}
          onClose={() => setDialog(null)}
          onDownload={() => handleDownload()}
        />
      )}
    </div>
  );
}

function EmptyState({ leagueIds, teamKeys, onClearTeams, onShowLeagues }) {
  return (
    <div className="ss-empty">
      <h3>No games in this view</h3>
      {leagueIds.length === 0 && (
        <button type="button" className="ss-btn" onClick={onShowLeagues}>Show all leagues</button>
      )}
      {teamKeys.length > 0 && (
        <button type="button" className="ss-btn" onClick={onClearTeams}>Clear team filters</button>
      )}
      {leagueIds.length > 0 && teamKeys.length === 0 && (
        <p>Try another month, or turn on another league.</p>
      )}
    </div>
  );
}

function ListView({ events, pending, leagueIds, teamKeys, onOpen, onClearTeams, onShowLeagues }) {
  if (!events.length) {
    if (pending) return <p className="ss-muted ss-list-loading">Loading games…</p>;
    return (
      <EmptyState
        leagueIds={leagueIds}
        teamKeys={teamKeys}
        onClearTeams={onClearTeams}
        onShowLeagues={onShowLeagues}
      />
    );
  }
  const groups = groupByDay(events);
  return (
    <div className="ss-list">
      {groups.map((group) => (
        <section key={group.label}>
          <h3 className="ss-day-label">{group.label}</h3>
          <div className="ss-day-games">
            {group.events.map((event) => (
              <article key={event.id} className="ss-game" style={{ '--league': event.color }}>
                <div className="ss-game-time">{event.allDay ? 'Time TBD' : format(event.start, 'h:mm a')}</div>
                <div className="ss-game-body">
                  <button type="button" className="ss-game-title" onClick={() => onOpen(event)}>
                    {event.fullTitle}
                  </button>
                  <p>
                    <span className="ss-league-name" style={{ color: event.color }}>{event.leagueName}</span>
                    {event.venue ? ` · ${event.venue}` : ''}
                    {event.broadcasts.length ? ` · ${event.broadcasts.join(', ')}` : ''}
                    {event.status && event.status !== 'Scheduled' ? ` · ${event.status}` : ''}
                  </p>
                </div>
                <div className="ss-game-actions">
                  <a className="ss-btn small" href={googleCalendarUrl(event)} target="_blank" rel="noopener noreferrer">
                    Add to Google Calendar
                  </a>
                </div>
              </article>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function EventDialog({ event, onClose, onDownload }) {
  const ref = useRef(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <div className="ss-backdrop" onClick={onClose}>
      <div
        className="ss-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ss-event-title"
        tabIndex={-1}
        ref={ref}
        onClick={(click) => click.stopPropagation()}
      >
        <p className="ss-kicker" style={{ color: event.color }}>{event.leagueName}</p>
        <h2 id="ss-event-title">{event.fullTitle}</h2>
        <p>{formatWhen(event)}</p>
        {event.venue && <p>{event.venue}</p>}
        <p className="ss-muted">
          {[event.seasonLabel, event.status, event.broadcasts.join(', '), event.headline]
            .filter(Boolean)
            .join(' · ')}
        </p>
        <div className="ss-dialog-actions">
          <a className="ss-btn primary" href={googleCalendarUrl(event)} target="_blank" rel="noopener noreferrer">
            Add to Google Calendar
          </a>
          <button type="button" className="ss-btn" onClick={onDownload}>Download .ics</button>
          <button type="button" className="ss-text-btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

function ExportDialog({ events, label, leagueIds, teamKeys, onClose, onDownload }) {
  const ref = useRef(null);
  const configured = isGoogleSyncConfigured();
  const [confirming, setConfirming] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [progress, setProgress] = useState(null);
  const [message, setMessage] = useState('');
  const [syncError, setSyncError] = useState('');

  useEffect(() => {
    ref.current?.focus();
  }, []);

  const leagueLabel = LEAGUES.filter((league) => leagueIds.includes(league.id)).map((league) => league.name).join(', ') || 'no leagues';
  const teamLabel = teamKeys.length ? `${teamKeys.length} selected team${teamKeys.length === 1 ? '' : 's'}` : 'every team';

  async function sync() {
    setSyncing(true);
    setSyncError('');
    setMessage('');
    setProgress({ added: 0, skipped: 0, failed: 0, total: events.length });
    try {
      const result = await signInAndAddEvents(events, { onProgress: setProgress });
      if (result.failed && !result.added && !result.skipped) {
        setSyncError(result.firstError || 'Google Calendar could not add these games.');
      } else {
        const parts = [`Added ${result.added}.`];
        if (result.skipped) parts.push(`${result.skipped} already on the calendar.`);
        if (result.failed) parts.push(`${result.failed} failed.`);
        setMessage(parts.join(' '));
      }
    } catch (error) {
      setSyncError(error.message || 'Google Calendar sync failed.');
    } finally {
      setSyncing(false);
      setConfirming(false);
    }
  }

  return (
    <div className="ss-backdrop" onClick={onClose}>
      <div
        className="ss-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ss-export-title"
        tabIndex={-1}
        ref={ref}
        onClick={(click) => click.stopPropagation()}
      >
        <h2 id="ss-export-title">Add to Google Calendar</h2>
        <p>
          {label} · {leagueLabel} · {teamLabel} · {events.length} {events.length === 1 ? 'game' : 'games'}
        </p>
        <ol className="ss-steps">
          <li>Open a game and choose Add to Google Calendar. Google opens with the time and venue filled in. Save the event there.</li>
          <li>For the whole filtered schedule, download the .ics file and import it in Google Calendar under Settings → Import &amp; export.</li>
        </ol>
        <div className="ss-dialog-actions">
          <button type="button" className="ss-btn primary" onClick={onDownload} disabled={!events.length}>
            Download .ics
          </button>
          <a
            className="ss-btn"
            href="https://calendar.google.com/calendar/u/0/r/settings/export"
            target="_blank"
            rel="noopener noreferrer"
          >
            Open Google Calendar import
          </a>
        </div>
        {configured && (
          <div className="ss-sync">
            <h3>Sync this view</h3>
            <p className="ss-muted">
              Adds these games to your primary Google Calendar. Games already added from SportSync are skipped.
              {events.length > 60 ? ' Large months are faster as an .ics import.' : ''}
            </p>
            {!confirming && (
              <button type="button" className="ss-btn" disabled={!events.length || syncing} onClick={() => setConfirming(true)}>
                Sync {events.length} games
              </button>
            )}
            {confirming && (
              <div className="ss-dialog-actions">
                <button type="button" className="ss-btn primary" disabled={syncing} onClick={sync}>
                  {syncing ? 'Waiting for Google…' : 'Create events'}
                </button>
                <button type="button" className="ss-text-btn" disabled={syncing} onClick={() => setConfirming(false)}>
                  Cancel
                </button>
              </div>
            )}
            {progress && syncing && (
              <p role="status">Adding {progress.added + progress.skipped + progress.failed} of {progress.total}…</p>
            )}
            {message && <p role="status">{message}</p>}
            {syncError && <p role="alert">{syncError}</p>}
          </div>
        )}
        <button type="button" className="ss-text-btn" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}
