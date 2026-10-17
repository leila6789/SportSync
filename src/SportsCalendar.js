import React, { useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Calendar, dateFnsLocalizer } from 'react-big-calendar';
import {
  addMonths,
  addWeeks,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  getDay,
  isSameDay,
  isSameMonth,
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
import { compactWinChance, loadGameOdds } from './odds';
import {
  LEAGUES,
  collapseConferenceDuplicates,
  dedupeEvents,
  eventsInPeriod,
  fetchLeagueMonth,
  fetchLeagueTeams,
  fetchPublishedMonths,
  filterEvents,
  inactiveTeamKeySet,
  leagueById,
  leaguesForTeams,
  mergeTeams,
  monthsForView,
  periodBounds,
  refreshLeagueMonth,
  resetScheduleCache,
  teamSnapshot,
  themedLogo,
} from './schedule';

const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek,
  getDay,
  locales: {},
});

const STORAGE_KEY = 'sportsync.filters.v2';
const THEME_KEY = 'sportsync.theme';
export const LIVE_REFRESH_MS = 30000;
const BUSY_DAY = 3;
const EXPORT_HINT = 'Follow a team to export its calendar.';
const EXPORT_READY_HINT = 'Export every loaded game for the teams you follow';
const GOOGLE_IMPORT_URL = 'https://calendar.google.com/calendar/u/0/r/settings/export';

const ThemeContext = React.createContext('light');

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

function readThemeChoice() {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {
    // Follow the system preference when storage is unavailable.
  }
  return 'system';
}

function systemIsDark() {
  return typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function isPhoneLayout() {
  return typeof window.matchMedia === 'function'
    && window.matchMedia('(max-width: 800px)').matches;
}

function usePhoneLayout() {
  const [phone, setPhone] = useState(isPhoneLayout);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const media = window.matchMedia('(max-width: 800px)');
    const onChange = () => setPhone(media.matches);
    media.addEventListener?.('change', onChange);
    return () => media.removeEventListener?.('change', onChange);
  }, []);
  return phone;
}

function withAlpha(hex, alpha) {
  const raw = String(hex || '').replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(raw)) return 'transparent';
  const value = Math.round(Math.min(1, Math.max(0, alpha)) * 255).toString(16).padStart(2, '0');
  return `#${raw}${value}`;
}

function isLight(hex) {
  const raw = String(hex || '').replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(raw)) return false;
  const r = parseInt(raw.slice(0, 2), 16);
  const g = parseInt(raw.slice(2, 4), 16);
  const b = parseInt(raw.slice(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 170;
}

export function chipStyle(event) {
  const away = event.awayColor || event.color;
  const home = event.homeColor || event.color;
  const light = isLight(away) && isLight(home);
  return {
    background: `linear-gradient(100deg, ${away} 0%, ${away} 46%, ${home} 54%, ${home} 100%)`,
    color: light ? '#1c1917' : '#ffffff',
    textShadow: light ? 'none' : '0 1px 1px rgba(0, 0, 0, 0.35)',
  };
}

function eventPropGetter(event) {
  return { style: chipStyle(event) };
}

function rowStyle(event) {
  const away = event.awayColor || event.color;
  const home = event.homeColor || event.color;
  return {
    '--away': away,
    '--home': home,
    '--away-tint': withAlpha(away, 0.34),
    '--home-tint': withAlpha(home, 0.34),
  };
}

function CalendarEvent({ event }) {
  const time = event.allDay ? 'TBD' : format(event.start, 'h:mm a');
  return (
    <span className="ss-chip" title={event.fullTitle}>
      <Logo src={event.awayLogo} className="ss-chip-logo" />
      <span className="ss-chip-time">{time}</span>
      <span className="ss-chip-name">{event.title}</span>
      <Logo src={event.homeLogo} className="ss-chip-logo" />
    </span>
  );
}

function leagueMenuNeedsSearch(league, count) {
  return league.id === 'ncaaf' || count >= 16;
}

function LeagueMenu({ league, teams, teamKeys, loading, maxHeight, onToggle }) {
  const [query, setQuery] = useState('');
  const needle = query.trim().toLowerCase();
  const visible = teams.filter((team) => (
    !needle
    || team.name.toLowerCase().includes(needle)
    || team.abbreviation.toLowerCase().includes(needle)
  ));
  const showSearch = leagueMenuNeedsSearch(league, teams.length);
  return (
    <div
      className="ss-league-menu"
      id="ss-league-menu"
      role="region"
      aria-label={`${league.fullName} teams`}
      style={maxHeight ? { maxHeight } : undefined}
    >
      {showSearch && (
        <input
          type="search"
          className="ss-search"
          placeholder={`Search ${league.name}`}
          aria-label={`Search ${league.name} teams`}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      )}
      <div className="ss-league-menu-list">
        {loading && teams.length === 0 && <p className="ss-menu-note">Loading teams…</p>}
        {!loading && visible.length === 0 && (
          <p className="ss-menu-note">{needle ? 'No teams match.' : 'No teams loaded.'}</p>
        )}
        {visible.map((team) => {
          const on = teamKeys.includes(team.key);
          return (
            <label key={team.key} className={`ss-league-row${on ? ' is-on' : ''}`}>
              <input
                type="checkbox"
                checked={on}
                onChange={() => onToggle(team.key)}
              />
              <Logo src={team.logo} className="ss-menu-logo" />
              <span className="ss-league-row-name">{team.name}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

function Logo({ src, className = 'ss-logo' }) {
  const theme = useContext(ThemeContext);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    setAttempt(0);
  }, [src, theme]);
  const darkSrc = themedLogo(src, theme);
  const shown = attempt === 0 ? (darkSrc || src || '') : attempt === 1 && src && src !== darkSrc ? src : '';
  if (!shown) return <span className={`ss-logo-fallback ${className}`} aria-hidden="true" />;
  return (
    <img
      src={shown}
      alt=""
      className={className}
      onError={() => setAttempt((current) => (current === 0 && darkSrc !== src ? 1 : 2))}
    />
  );
}

function formatWhen(event) {
  if (event.allDay) return `${format(event.start, 'EEEE, MMMM d, yyyy')} · Time TBD`;
  return format(event.start, 'EEEE, MMMM d, yyyy · h:mm a');
}

function shortWhen(event) {
  if (event.allDay) return `${format(event.start, 'EEE, MMM d')} · Time TBD`;
  return format(event.start, 'EEE, MMM d · h:mm a');
}

function periodTitle(view, cursor) {
  if (view === 'today') return format(new Date(), 'EEEE, MMMM d');
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

function leaguesRepresented(events) {
  const ids = new Set(events.map((event) => event.leagueId));
  return LEAGUES.filter((league) => ids.has(league.id));
}

/**
 * Badge next to a league. Games are not loaded until a team is followed, so a
 * game count stays at 0 for every league the user has not picked. Show the
 * roster size instead, and the followed/available ratio once they pick teams.
 */
export function leagueCountLabel(followed, total, loading) {
  const picked = Number(followed) || 0;
  const available = Number(total) || 0;
  if (available > 0 && picked > 0) return `${picked}/${available}`;
  if (available > 0) return String(available);
  if (picked > 0) return String(picked);
  return loading ? '…' : '–';
}

export function leagueCountTitle(followed, total, loading) {
  const picked = Number(followed) || 0;
  const available = Number(total) || 0;
  if (available > 0 && picked > 0) return `${picked} of ${available} teams followed`;
  if (available > 0) return `${available} ${available === 1 ? 'team' : 'teams'}`;
  if (picked > 0) return `${picked} ${picked === 1 ? 'team' : 'teams'} followed`;
  return loading ? 'Loading teams' : 'No teams loaded';
}

function hasScore(event) {
  return (event.state === 'in' || event.state === 'post')
    && event.awayScore !== ''
    && event.homeScore !== '';
}

export default function SportsCalendar() {
  const saved = useRef(readFilters());
  const allowSave = useRef(Boolean(saved.current));
  const phone = usePhoneLayout();
  const [view, setView] = useState(() => (isPhoneLayout() ? 'list' : 'month'));
  const [calendarView, setCalendarView] = useState(() => (isPhoneLayout() ? 'list' : 'month'));
  const [cursor, setCursor] = useState(() => new Date());
  const [leagueIds, setLeagueIds] = useState(() => saved.current?.leagueIds || LEAGUES.map((league) => league.id));
  const [teamKeys, setTeamKeys] = useState(() => saved.current?.teamKeys || []);
  const [teamSearch, setTeamSearch] = useState('');
  const [openLeagues, setOpenLeagues] = useState(() => LEAGUES.filter((league) => !league.group).map((league) => league.id));
  const [store, setStore] = useState({});
  const [errors, setErrors] = useState({});
  const [pending, setPending] = useState(0);
  const [teams, setTeams] = useState([]);
  const [inactiveKeys, setInactiveKeys] = useState(() => new Set());
  const [teamsLoading, setTeamsLoading] = useState(true);
  const [dialog, setDialog] = useState(null);
  const [notice, setNotice] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const [pickerOpen, setPickerOpen] = useState(() => !saved.current);
  const [menuLeagueId, setMenuLeagueId] = useState(null);
  const [menuMaxHeight, setMenuMaxHeight] = useState(null);
  const leagueBarRef = useRef(null);
  const [themeChoice, setThemeChoice] = useState(readThemeChoice);
  const [systemDark, setSystemDark] = useState(systemIsDark);
  const cacheRef = useRef(new Map());
  const inflight = useRef(new Map());
  const seasonRef = useRef(new Set());
  const storeRef = useRef(store);
  const viewRef = useRef(view);
  const activeRef = useRef([]);
  const theme = themeChoice === 'system' ? (systemDark ? 'dark' : 'light') : themeChoice;

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#141210' : '#f4f1ea');
  }, [theme]);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setSystemDark(media.matches);
    media.addEventListener?.('change', onChange);
    return () => media.removeEventListener?.('change', onChange);
  }, []);

  function toggleTheme() {
    const next = theme === 'dark' ? 'light' : 'dark';
    setThemeChoice(next);
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      // The toggle still applies for this visit.
    }
  }

  useEffect(() => {
    if (!allowSave.current) return;
    writeFilters(leagueIds, teamKeys);
  }, [leagueIds, teamKeys]);

  useEffect(() => {
    let cancelled = false;
    setTeamsLoading(true);
    Promise.allSettled(LEAGUES.map((league) => fetchLeagueTeams(league).then((loaded) => {
      if (cancelled) return;
      const hidden = inactiveTeamKeySet();
      if (hidden.size) {
        setInactiveKeys((current) => (
          current.size === hidden.size && [...hidden].every((key) => current.has(key)) ? current : hidden
        ));
      }
      if (!loaded?.length) return;
      setTeams((current) => {
        const map = new Map(current.map((team) => [team.key, team]));
        for (const team of loaded) map.set(team.key, team);
        return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
      });
    }))).finally(() => {
      if (!cancelled) setTeamsLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const loadMonths = useCallback((leagues, months) => {
    const jobs = [];
    for (const league of leagues) {
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

  const activeLeagues = useMemo(
    () => leaguesForTeams(leagueIds, teamKeys),
    [leagueIds, teamKeys]
  );
  storeRef.current = store;
  viewRef.current = view;
  activeRef.current = activeLeagues;

  const refreshLive = useCallback(async () => {
    if (typeof document !== 'undefined' && document.hidden) return;
    const events = dedupeEvents(Object.values(storeRef.current).flat());
    const viewNow = viewRef.current;
    const watchToday = viewNow === 'today' || viewNow === 'home';
    const liveEvents = events.filter((event) => event.state === 'in');
    if (!liveEvents.length && !watchToday) return;
    const jobs = new Map();
    const consider = (league, year, month) => {
      if (!league) return;
      jobs.set(`${league.id}:${year}-${month}`, { league, year, month });
    };
    if (watchToday) {
      for (const league of activeRef.current) {
        for (const ym of monthsForView('today', new Date())) consider(league, ym.year, ym.month);
      }
    }
    for (const event of liveEvents) {
      consider(leagueById(event.leagueId), event.start.getFullYear(), event.start.getMonth() + 1);
    }
    await Promise.all([...jobs.values()].map(async (job) => {
      try {
        const loaded = await refreshLeagueMonth(job.league, job.year, job.month);
        const key = `${job.league.id}:${job.year}-${job.month}`;
        cacheRef.current.set(key, loaded);
        setStore((current) => ({ ...current, [key]: loaded }));
      } catch {
        // Keep the score already on screen.
      }
    }));
  }, []);

  useEffect(() => {
    if (!activeLeagues.length) return undefined;
    const timer = window.setInterval(() => {
      refreshLive();
    }, LIVE_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [activeLeagues, refreshLive]);

  useEffect(() => {
    if (!activeLeagues.length) return undefined;
    const gate = { cancel: false };
    const started = [];
    const season = seasonRef.current;
    for (const league of activeLeagues) {
      if (season.has(league.id)) continue;
      const current = league;
      season.add(current.id);
      started.push(current.id);
      fetchPublishedMonths(current)
        .then((months) => {
          if (!gate.cancel && months.length) loadMonths([current], months);
        })
        .catch(() => {
          season.delete(current.id);
        });
    }
    return () => {
      gate.cancel = true;
      for (const id of started) season.delete(id);
    };
  }, [activeLeagues, loadMonths, reloadToken]);

  useEffect(() => {
    if (!activeLeagues.length) return;
    const scheduleView = view === 'home' ? 'month' : view;
    loadMonths(activeLeagues, monthsForView(scheduleView, cursor));
  }, [activeLeagues, view, cursor, loadMonths, reloadToken]);

  useEffect(() => {
    if (!dialog) return undefined;
    const onKey = (event) => {
      if (event.key === 'Escape') setDialog(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dialog]);

  const closePicker = useCallback((nextView) => {
    allowSave.current = true;
    writeFilters(leagueIds, teamKeys);
    setPickerOpen(false);
    if (nextView) setView(nextView);
  }, [leagueIds, teamKeys]);

  useEffect(() => {
    if (!pickerOpen) return undefined;
    const onKey = (event) => {
      if (event.key === 'Escape') closePicker();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pickerOpen, closePicker]);

  useEffect(() => {
    if (!menuLeagueId) return undefined;
    const onKey = (event) => {
      if (event.key === 'Escape') setMenuLeagueId(null);
    };
    const onPointer = (event) => {
      if (!leagueBarRef.current?.contains(event.target)) setMenuLeagueId(null);
    };
    document.addEventListener('mousedown', onPointer);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      window.removeEventListener('keydown', onKey);
    };
  }, [menuLeagueId]);

  useLayoutEffect(() => {
    if (!menuLeagueId) return undefined;
    const place = () => {
      const node = leagueBarRef.current;
      if (!node) return;
      const bottom = node.getBoundingClientRect().bottom;
      const reserve = window.innerWidth <= 800 ? 128 : 24;
      setMenuMaxHeight(Math.max(160, Math.floor(window.innerHeight - bottom - reserve)));
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [menuLeagueId]);

  const periodView = view === 'home' ? 'month' : view;
  const period = useMemo(() => periodBounds(periodView, cursor), [periodView, cursor]);
  const allEvents = useMemo(() => dedupeEvents(Object.values(store).flat()), [store]);
  const filtered = useMemo(
    () => collapseConferenceDuplicates(filterEvents(allEvents, { leagueIds, teamKeys })),
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
  const directory = useMemo(
    () => mergeTeams(teams, allEvents).filter((team) => !inactiveKeys.has(team.key)),
    [teams, allEvents, inactiveKeys]
  );
  const exportEvents = filtered;
  const label = view === 'home' ? 'My Teams' : periodTitle(view, cursor);
  const selectedTeams = directory.filter((team) => teamKeys.includes(team.key));
  const query = teamSearch.trim().toLowerCase();
  const dialogEvent = useMemo(() => {
    if (dialog?.type !== 'event') return null;
    return filtered.find((event) => event.id === dialog.event.id)
      || allEvents.find((event) => event.id === dialog.event.id)
      || dialog.event;
  }, [dialog, filtered, allEvents]);

  const leagueRoster = useMemo(() => {
    const totals = Object.fromEntries(LEAGUES.map((league) => [league.id, 0]));
    const rosterKeys = Object.fromEntries(LEAGUES.map((league) => [league.id, new Set()]));
    for (const team of teams) {
      if (!rosterKeys[team.leagueId]) continue;
      totals[team.leagueId] += 1;
      rosterKeys[team.leagueId].add(team.key);
    }
    const followed = Object.fromEntries(LEAGUES.map((league) => [league.id, 0]));
    for (const key of teamKeys) {
      const leagueId = String(key).split(':')[0];
      if (followed[leagueId] == null) continue;
      if (totals[leagueId] > 0 && !rosterKeys[leagueId].has(key)) continue;
      followed[leagueId] += 1;
    }
    return { totals, followed };
  }, [teams, teamKeys]);

  const menuLeague = leagueById(menuLeagueId);
  const menuTeams = menuLeague
    ? directory.filter((team) => team.leagueId === menuLeague.id)
    : [];

  const visibleMonthKeys = monthsForView(view === 'home' ? 'month' : view, cursor).flatMap((ym) => (
    activeLeagues.map((league) => `${league.id}:${ym.year}-${ym.month}`)
  ));
  const hasError = visibleMonthKeys.some((key) => errors[key]);
  const countLabel = view === 'home'
    ? (teamKeys.length === 0 ? 'No teams selected' : `${teamKeys.length} ${teamKeys.length === 1 ? 'team' : 'teams'}`)
    : teamKeys.length === 0
      ? 'No teams selected'
      : pending > 0 && periodEvents.length === 0
        ? 'Loading games…'
        : `${periodEvents.length} ${periodEvents.length === 1 ? 'game' : 'games'}`;
  const calendarOn = view === 'month' || view === 'week' || view === 'list';

  function chooseView(id) {
    setView(id);
    if (id === 'month' || id === 'week' || id === 'list') setCalendarView(id);
  }

  function shift(direction) {
    setCursor((current) => (view === 'week' ? addWeeks(current, direction) : addMonths(current, direction)));
  }

  function chooseLeague(id) {
    setMenuLeagueId((current) => (current === id ? null : id));
  }

  function toggleTeam(key) {
    setTeamKeys((current) => (
      current.includes(key) ? current.filter((teamKey) => teamKey !== key) : [...current, key]
    ));
  }

  function pickTeam(key) {
    const leagueId = key.split(':')[0];
    setLeagueIds((current) => (current.includes(leagueId) ? current : [...current, leagueId]));
    toggleTeam(key);
  }

  function toggleOpenLeague(id) {
    setOpenLeagues((current) => (
      current.includes(id) ? current.filter((leagueId) => leagueId !== id) : [...current, id]
    ));
  }

  function handleDownload(events = exportEvents, scope = 'season') {
    if (!teamKeys.length || !events?.length) return;
    const filename = scope === 'event'
      ? singleEventFilename(events[0])
      : buildFilename({
        leagueIds: [...new Set(events.map((event) => event.leagueId))],
        view: 'season',
        start: events[0].start,
      });
    downloadIcs(filename, buildIcs(events));
    setNotice(`Downloaded ${filename}`);
  }

  function retry() {
    cacheRef.current.clear();
    inflight.current.clear();
    seasonRef.current.clear();
    resetScheduleCache();
    setStore({});
    setErrors({});
    setReloadToken((value) => value + 1);
  }

  return (
    <ThemeContext.Provider value={theme}>
      <div className={`ss-app${pickerOpen ? ' is-picking' : ''}`}>
        <header className="ss-header">
          <div className="ss-header-row">
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
              <p>NBA, WNBA, MLB, NFL, NCAAF, SEC, Big Ten, and NHL in one calendar.</p>
            </div>
          </div>
          <div className="ss-header-actions">
            <button
              type="button"
              className={`ss-btn ss-theme${theme === 'dark' ? ' is-on' : ''}`}
              aria-pressed={theme === 'dark'}
              aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              onClick={toggleTheme}
            >
              <span className="ss-theme-icon" aria-hidden="true">
                {theme === 'dark' ? (
                  <svg viewBox="0 0 24 24" width="20" height="20">
                    <circle cx="12" cy="12" r="4" fill="currentColor" />
                    <path fill="currentColor" d="M12 2h1v3h-1zm0 17h1v3h-1zM2 12h3v1H2zm17 0h3v1h-3zM4.9 4.2l.7-.7 2.1 2.1-.7.7zM16.3 16.9l.7-.7 2.1 2.1-.7.7zM4.2 19.1l2.1-2.1.7.7-2.1 2.1zM16.9 4.9l2.1-2.1.7.7-2.1 2.1z" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" width="20" height="20">
                    <path fill="currentColor" d="M14.5 2.4a9 9 0 1 0 7.1 13.2A8 8 0 0 1 14.5 2.4z" />
                  </svg>
                )}
              </span>
              <span className="ss-theme-label">Dark mode</span>
            </button>
            <button
              type="button"
              className="ss-btn ss-filter-toggle"
              aria-expanded={filtersOpen}
              onClick={() => setFiltersOpen((open) => !open)}
            >
              Filters{teamKeys.length ? ` · ${teamKeys.length}` : ''}
            </button>
            <div className="ss-export-slot">
              <button
                type="button"
                className="ss-btn primary ss-export"
                onClick={() => setDialog({ type: 'export' })}
                disabled={!teamKeys.length}
                title={teamKeys.length ? EXPORT_READY_HINT : EXPORT_HINT}
                aria-describedby={teamKeys.length ? undefined : 'ss-export-hint'}
              >
                Export
              </button>
              {!teamKeys.length && (
                <span id="ss-export-hint" className="ss-export-hint">{EXPORT_HINT}</span>
              )}
            </div>
          </div>
          </div>
          <nav className="ss-league-anchor" aria-label="Leagues" ref={leagueBarRef}>
            <div className="ss-leagues">
              {LEAGUES.map((league) => {
                const on = leagueIds.includes(league.id);
                const open = menuLeagueId === league.id;
                const followed = leagueRoster.followed[league.id];
                const total = leagueRoster.totals[league.id];
                return (
                  <button
                    key={league.id}
                    type="button"
                    className={`ss-league${open ? ' is-open' : ''}${followed > 0 ? ' has-teams' : ''}`}
                    style={{ '--league': league.color }}
                    aria-pressed={on}
                    aria-expanded={open}
                    aria-controls={open ? 'ss-league-menu' : undefined}
                    aria-haspopup="true"
                    aria-label={league.fullName === league.name ? league.name : `${league.name} ${league.fullName}`}
                    title={leagueCountTitle(followed, total, teamsLoading)}
                    onClick={() => chooseLeague(league.id)}
                  >
                    <span className="ss-dot" style={{ background: league.color }} aria-hidden="true" />
                    <span>{league.name}</span>
                    <span className="ss-league-count" aria-hidden="true">{leagueCountLabel(followed, total, teamsLoading)}</span>
                  </button>
                );
              })}
            </div>
            {menuLeague && (
              <LeagueMenu
                key={menuLeague.id}
                league={menuLeague}
                teams={menuTeams}
                teamKeys={teamKeys}
                loading={teamsLoading}
                maxHeight={menuMaxHeight}
                onToggle={pickTeam}
              />
            )}
          </nav>
        </header>

        <div className="ss-body">
          <aside className={`ss-sidebar${filtersOpen ? ' is-open' : ''}`}>
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
                              <Logo src={team.logo} className="ss-team-logo" />
                              <span>{team.name}</span>
                            </label>
                          ))
                      )}
                    </section>
                  );
                })}
                {leagueIds.length === 0 && <p className="ss-muted">Turn a league on to filter its teams.</p>}
              </div>
              <p className="ss-attrib">Schedules from ESPN. NCAAF is FBS. SEC and Big Ten are those conference slates.</p>
            </div>
          </aside>

          <main className="ss-main">
            <div className="ss-toolbar">
              <div className="ss-nav">
                <button type="button" className="ss-btn" aria-label="Jump to today" onClick={() => setCursor(new Date())}>Today</button>
                <button type="button" className="ss-icon-btn" aria-label="Previous" onClick={() => shift(-1)} disabled={view === 'today' || view === 'home'}>‹</button>
                <button type="button" className="ss-icon-btn" aria-label="Next" onClick={() => shift(1)} disabled={view === 'today' || view === 'home'}>›</button>
                <h2>{label}</h2>
              </div>
              <p className="ss-count" role="status">{countLabel}</p>
              <div className="ss-views" role="group" aria-label="Calendar view">
                {[
                  ['today', "Today's games", 'ss-view-today'],
                  ['home', 'My Teams', 'ss-view-home'],
                  ['month', 'Month', ''],
                  ['week', 'Week', ''],
                  ['list', 'List', ''],
                ].map(([id, name, extra]) => (
                  <button
                    key={id}
                    type="button"
                    className={`ss-view ${extra}${view === id ? ' is-on' : ''}`}
                    aria-pressed={view === id}
                    onClick={() => chooseView(id)}
                  >
                    {name}
                  </button>
                ))}
              </div>
            </div>

            {view !== 'home' && selectedTeams.length > 0 && (
              <div className="ss-chips" aria-label="Selected teams">
                {selectedTeams.map((team) => (
                  <button key={team.key} type="button" className="ss-chip-btn" onClick={() => toggleTeam(team.key)}>
                    <Logo src={team.logo} className="ss-chip-logo" />
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

            {pending > 0 && view !== 'home' && <div className="ss-loading" role="status">Loading schedules…</div>}

            {view === 'home' && (
              <TeamHome
                teams={selectedTeams}
                events={filtered}
                pending={pending}
                leagueIds={leagueIds}
                teamKeys={teamKeys}
                onOpen={(event) => setDialog({ type: 'event', event })}
                onChoose={() => setPickerOpen(true)}
                onClearTeams={() => setTeamKeys([])}
                onShowLeagues={() => setLeagueIds(LEAGUES.map((league) => league.id))}
                onExport={() => setDialog({ type: 'export' })}
              />
            )}

            {(view === 'list' || view === 'today') && (
              <ListView
                events={periodEvents}
                pending={pending}
                leagueIds={leagueIds}
                teamKeys={teamKeys}
                today={view === 'today'}
                onOpen={(event) => setDialog({ type: 'event', event })}
                onClearTeams={() => setTeamKeys([])}
                onShowLeagues={() => setLeagueIds(LEAGUES.map((league) => league.id))}
                onChoose={() => setPickerOpen(true)}
              />
            )}

            {view === 'month' && (
              gridEvents.length === 0 && !pending ? (
                <EmptyState
                  leagueIds={leagueIds}
                  teamKeys={teamKeys}
                  onClearTeams={() => setTeamKeys([])}
                  onShowLeagues={() => setLeagueIds(LEAGUES.map((league) => league.id))}
                  onChoose={() => setPickerOpen(true)}
                />
              ) : (
                <MonthBoard
                  cursor={cursor}
                  events={gridEvents}
                  phone={phone}
                  onOpen={(event) => setDialog({ type: 'event', event })}
                />
              )
            )}

            {view === 'week' && phone && (
              <ListView
                events={periodEvents}
                pending={pending}
                leagueIds={leagueIds}
                teamKeys={teamKeys}
                onOpen={(event) => setDialog({ type: 'event', event })}
                onClearTeams={() => setTeamKeys([])}
                onShowLeagues={() => setLeagueIds(LEAGUES.map((league) => league.id))}
                onChoose={() => setPickerOpen(true)}
              />
            )}

            {view === 'week' && !phone && (
              <div className="ss-calendar">
                {gridEvents.length === 0 && !pending ? (
                  <EmptyState
                    leagueIds={leagueIds}
                    teamKeys={teamKeys}
                    onClearTeams={() => setTeamKeys([])}
                    onShowLeagues={() => setLeagueIds(LEAGUES.map((league) => league.id))}
                    onChoose={() => setPickerOpen(true)}
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
                    view="week"
                    date={cursor}
                    onNavigate={setCursor}
                    views={['week']}
                    toolbar={false}
                    selectable={false}
                    style={{ height: '100%' }}
                    eventPropGetter={eventPropGetter}
                    components={{ event: CalendarEvent }}
                    onSelectEvent={(event) => setDialog({ type: 'event', event })}
                    scrollToTime={new Date(1970, 0, 1, 12, 0, 0)}
                  />
                )}
              </div>
            )}
          </main>
        </div>

        <nav className="ss-tabbar" aria-label="Primary">
          <button
            type="button"
            className={`ss-tab${view === 'today' ? ' is-on' : ''}`}
            aria-label="Today tab"
            aria-current={view === 'today' ? 'page' : undefined}
            onClick={() => chooseView('today')}
          >
            Today
          </button>
          <button
            type="button"
            className={`ss-tab${calendarOn ? ' is-on' : ''}`}
            aria-label="Calendar tab"
            aria-current={calendarOn ? 'page' : undefined}
            onClick={() => setView(calendarView)}
          >
            Calendar
          </button>
          <button
            type="button"
            className={`ss-tab${view === 'home' ? ' is-on' : ''}`}
            aria-label="My Teams tab"
            aria-current={view === 'home' ? 'page' : undefined}
            onClick={() => chooseView('home')}
          >
            My Teams
          </button>
          <button
            type="button"
            className="ss-tab ss-tab-export"
            onClick={() => setDialog({ type: 'export' })}
            disabled={!teamKeys.length}
            title={teamKeys.length ? EXPORT_READY_HINT : EXPORT_HINT}
            aria-describedby={teamKeys.length ? undefined : 'ss-export-hint'}
          >
            Export
          </button>
        </nav>

        {notice && (
          <div className="ss-toast" role="status">{notice}</div>
        )}

        {dialogEvent && (
          <EventDialog
            event={dialogEvent}
            onClose={() => setDialog(null)}
            onDownload={() => handleDownload([dialogEvent], 'event')}
          />
        )}
        {dialog?.type === 'export' && (
          <ExportDialog
            events={exportEvents}
            teamKeys={teamKeys}
            pending={pending}
            onClose={() => setDialog(null)}
            onDownload={() => handleDownload(exportEvents, 'season')}
          />
        )}
        {pickerOpen && (
          <TeamPicker
            teams={directory}
            teamsLoading={teamsLoading}
            teamKeys={teamKeys}
            onToggle={pickTeam}
            onSkip={() => closePicker()}
            onContinue={() => closePicker('home')}
          />
        )}
      </div>
    </ThemeContext.Provider>
  );
}

function EmptyState({ leagueIds, teamKeys, onClearTeams, onShowLeagues, onChoose, today = false }) {
  if (!teamKeys.length) {
    return (
      <div className="ss-empty">
        <h3>No games yet</h3>
        <p>Pick a team to see its games.</p>
        {onChoose && (
          <button type="button" className="ss-btn primary" onClick={onChoose}>Choose teams</button>
        )}
      </div>
    );
  }
  if (today) {
    return (
      <div className="ss-empty">
        <h3>No games today</h3>
        <p>None of the selected teams play today.</p>
      </div>
    );
  }
  return (
    <div className="ss-empty">
      <h3>No games in this view</h3>
      {leagueIds.length === 0 && (
        <button type="button" className="ss-btn" onClick={onShowLeagues}>Show all leagues</button>
      )}
      <button type="button" className="ss-btn" onClick={onClearTeams}>Clear team filters</button>
      {leagueIds.length > 0 && <p>Try another month, or turn on another league.</p>}
    </div>
  );
}

function ScoreLine({ event }) {
  if (event.state === 'in' && hasScore(event)) {
    return (
      <span className="ss-live-wrap">
        {' · '}
        <span className="ss-live">LIVE</span>
        {' '}
        <span className="ss-live-score">{event.awayScore}–{event.homeScore}</span>
      </span>
    );
  }
  if (hasScore(event)) return ` · ${event.awayScore}–${event.homeScore}`;
  return null;
}

function ListView({ events, pending, leagueIds, teamKeys, today = false, onOpen, onClearTeams, onShowLeagues, onChoose }) {
  if (!events.length) {
    if (teamKeys.length && pending) return <p className="ss-muted ss-list-loading">Loading games…</p>;
    return (
      <EmptyState
        leagueIds={leagueIds}
        teamKeys={teamKeys}
        today={today}
        onClearTeams={onClearTeams}
        onShowLeagues={onShowLeagues}
        onChoose={onChoose}
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
              <article key={event.id} className="ss-game" style={rowStyle(event)}>
                <div className="ss-game-time">{event.allDay ? 'Time TBD' : format(event.start, 'h:mm a')}</div>
                <div className="ss-matchup" aria-hidden="true">
                  <Logo src={event.awayLogo} className="ss-matchup-logo" />
                  <span>{event.awayAbbr}</span>
                  <span className="ss-at">@</span>
                  <Logo src={event.homeLogo} className="ss-matchup-logo" />
                  <span>{event.homeAbbr}</span>
                </div>
                <div className="ss-game-body">
                  <button type="button" className="ss-game-title" onClick={() => onOpen(event)}>
                    {event.fullTitle}
                  </button>
                  <p>
                    <span className="ss-league-name">
                      <span className="ss-dot" style={{ background: event.color }} aria-hidden="true" />
                      {event.leagueName}
                    </span>
                    {event.venue ? ` · ${event.venue}` : ''}
                    {event.broadcasts.length ? ` · ${event.broadcasts.join(', ')}` : ''}
                    <ScoreLine event={event} />
                    {event.status && event.status !== 'Scheduled' ? ` · ${event.status}` : ''}
                  </p>
                </div>
                <WinChance event={event} />
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

function WinChance({ event, teamKey }) {
  const [chance, setChance] = useState(null);
  useEffect(() => {
    if (!event || event.state === 'in' || event.state === 'post') {
      setChance(null);
      return undefined;
    }
    let cancel = false;
    loadGameOdds(event).then((result) => {
      if (cancel) return;
      setChance(compactWinChance(result.quotes, event, { teamKey }));
    });
    return () => {
      cancel = true;
    };
  }, [event, teamKey]);
  if (!chance) return null;
  const label = `${chance.text} from ${chance.source}`;
  if (chance.url) {
    return (
      <a className="ss-win" href={chance.url} target="_blank" rel="noopener noreferrer" aria-label={label} title={label}>
        {chance.text}
      </a>
    );
  }
  return <span className="ss-win" title={label}>{chance.text}</span>;
}

function OddsSummary({ event, teamKey }) {
  const [state, setState] = useState({ loading: true, quotes: [], message: '' });
  useEffect(() => {
    let cancel = false;
    setState({ loading: true, quotes: [], message: '' });
    loadGameOdds(event).then((result) => {
      if (cancel) return;
      setState({ loading: false, quotes: result.quotes, message: result.message });
    });
    return () => {
      cancel = true;
    };
  }, [event]);
  const chance = compactWinChance(state.quotes, event, { teamKey });
  return (
    <div className="ss-odds-compact" aria-live="polite">
      {state.loading && <p className="ss-muted">Checking Polymarket and Kalshi…</p>}
      {chance && (
        chance.url ? (
          <a className="ss-win" href={chance.url} target="_blank" rel="noopener noreferrer" aria-label={`${chance.text} from ${chance.source}`}>
            {chance.text}
          </a>
        ) : (
          <span className="ss-win">{chance.text}</span>
        )
      )}
      {!state.loading && state.quotes.map((quote) => (
        <p key={quote.source} className="ss-odds-line">
          <span className="ss-odds-source-name">{quote.source}</span>
          {quote.sides.map((side) => {
            const text = `${side.label} ${side.price}`;
            return side.url ? (
              <a key={`${quote.source}-${side.label}`} href={side.url} target="_blank" rel="noopener noreferrer">{text}</a>
            ) : (
              <span key={`${quote.source}-${side.label}`}>{text}</span>
            );
          })}
        </p>
      ))}
      {!state.loading && !state.quotes.length && <p className="ss-muted">{state.message}</p>}
    </div>
  );
}

function TeamHome({ teams, events, pending, leagueIds, teamKeys, onOpen, onChoose, onClearTeams, onShowLeagues, onExport }) {
  const ready = teamKeys.length > 0;
  const tools = (
    <div className="ss-home-tools">
      <button
        type="button"
        className="ss-btn primary ss-export"
        onClick={onExport}
        disabled={!ready}
        title={ready ? EXPORT_READY_HINT : EXPORT_HINT}
        aria-describedby={ready ? undefined : 'ss-export-hint'}
      >
        Export
      </button>
      {!ready && <span className="ss-export-hint">{EXPORT_HINT}</span>}
    </div>
  );
  if (!ready) {
    return (
      <div className="ss-home">
        {tools}
        <EmptyState
          leagueIds={leagueIds}
          teamKeys={teamKeys}
          onChoose={onChoose}
          onClearTeams={onClearTeams}
          onShowLeagues={onShowLeagues}
        />
      </div>
    );
  }
  if (!events.length && pending) {
    return (
      <div className="ss-home">
        {tools}
        <p className="ss-muted ss-list-loading">Loading games…</p>
      </div>
    );
  }
  const now = new Date();
  const cards = teams
    .map((team) => ({ team, ...teamSnapshot(team.key, events, now) }))
    .sort((a, b) => (a.next?.start?.getTime() ?? Infinity) - (b.next?.start?.getTime() ?? Infinity) || a.team.name.localeCompare(b.team.name));
  return (
    <div className="ss-home">
      {tools}
      <div className="ss-home-grid">
      {cards.map(({ team, next, last, live }) => {
        const league = leagueById(team.leagueId);
        const featured = live || next;
        return (
          <article key={team.key} className="ss-team-card" style={{ '--team': team.color || league?.color }}>
            <header className="ss-team-card-head">
              <Logo src={team.logo} className="ss-card-logo" />
              <div>
                <h3>{team.name}</h3>
                <p>{league?.name}</p>
              </div>
            </header>
            <section>
              <h4>Next game</h4>
              {featured ? (
                <>
                  <button type="button" className="ss-game-title" onClick={() => onOpen(featured)}>
                    {featured.fullTitle}
                  </button>
                  <p className="ss-muted">{shortWhen(featured)}</p>
                  {featured.state === 'in' && (
                    <p className="ss-live-wrap">
                      <span className="ss-live">LIVE</span>
                      {hasScore(featured) && (
                        <span className="ss-live-score">{featured.awayScore}–{featured.homeScore}</span>
                      )}
                    </p>
                  )}
                </>
              ) : (
                <p className="ss-muted">No upcoming game</p>
              )}
            </section>
            <section>
              <h4>Last score</h4>
              {last ? (
                <p className="ss-last-score">
                  {last.awayAbbr} {last.awayScore} – {last.homeAbbr} {last.homeScore}
                  <span className="ss-muted"> · Final</span>
                </p>
              ) : (
                <p className="ss-muted">No final score yet</p>
              )}
            </section>
            <section>
              <h4>Odds</h4>
              {featured && featured.state !== 'in' && <OddsSummary event={featured} teamKey={team.key} />}
              {featured?.state === 'in' && <p className="ss-muted">The live score is on this card.</p>}
              {!featured && <p className="ss-muted">No upcoming game to price.</p>}
            </section>
          </article>
        );
      })}
      </div>
    </div>
  );
}

function PhoneMonth({ cursor, events, onOpen }) {
  const agendaRef = useRef(null);
  const [selected, setSelected] = useState(() => {
    const today = new Date();
    return format(isSameMonth(today, cursor) ? today : startOfMonth(cursor), 'yyyy-MM-dd');
  });
  useEffect(() => {
    const today = new Date();
    setSelected(format(isSameMonth(today, cursor) ? today : startOfMonth(cursor), 'yyyy-MM-dd'));
  }, [cursor]);
  useEffect(() => {
    const node = agendaRef.current;
    if (!node) return undefined;
    const reveal = () => {
      const tab = document.querySelector('.ss-tabbar');
      const limit = (tab?.getBoundingClientRect().top ?? window.innerHeight) - 8;
      if (node.getBoundingClientRect().bottom > limit) {
        node.scrollIntoView({ block: 'nearest' });
      }
    };
    reveal();
    return undefined;
  }, [selected]);

  const start = startOfWeek(startOfMonth(cursor), { weekStartsOn: 0 });
  const end = endOfWeek(endOfMonth(cursor), { weekStartsOn: 0 });
  const days = eachDayOfInterval({ start, end });
  const byDay = useMemo(() => {
    const map = new Map();
    for (const event of events) {
      const key = format(event.start, 'yyyy-MM-dd');
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(event);
    }
    for (const list of map.values()) list.sort((a, b) => a.start - b.start || a.title.localeCompare(b.title));
    return map;
  }, [events]);
  const selectedDate = parse(selected, 'yyyy-MM-dd', new Date());
  const selectedGames = byDay.get(selected) || [];

  return (
    <section className="ss-phone-month" aria-label={format(cursor, 'MMMM yyyy')}>
      <div className="ss-phone-dow" aria-hidden="true">
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, index) => (
          <span key={`${day}-${index}`}>{day}</span>
        ))}
      </div>
      <div className="ss-phone-grid">
        {days.map((day) => {
          const key = format(day, 'yyyy-MM-dd');
          const games = byDay.get(key) || [];
          const countLabel = games.length === 1 ? '1 game' : `${games.length} games`;
          return (
            <button
              key={key}
              type="button"
              className={`ss-phone-day${isSameMonth(day, cursor) ? '' : ' is-out'}${isSameDay(day, new Date()) ? ' is-today' : ''}${key === selected ? ' is-on' : ''}`}
              aria-pressed={key === selected}
              aria-label={`${format(day, 'EEEE, MMMM d')}, ${games.length ? countLabel : 'no games'}`}
              onClick={() => setSelected(key)}
            >
              <span className="ss-day-num">{format(day, 'd')}</span>
              <span className="ss-league-dots">
                {games.slice(0, 3).map((event) => (
                  <span key={event.id} className="ss-dot" style={{ background: event.color }} />
                ))}
              </span>
            </button>
          );
        })}
      </div>
      <div className="ss-phone-agenda" ref={agendaRef}>
        <h3 className="ss-day-label">{format(selectedDate, 'EEEE, MMMM d')}</h3>
        {selectedGames.length === 0 && <p className="ss-muted">No games</p>}
        {selectedGames.map((event) => (
          <button
            key={event.id}
            type="button"
            className="ss-agenda-game"
            onClick={() => onOpen(event)}
          >
            <span className="ss-agenda-kicker">
              <span className="ss-dot" style={{ background: event.color }} aria-hidden="true" />
              {event.allDay ? 'Time TBD' : format(event.start, 'h:mm a')}
              <ScoreLine event={event} />
            </span>
            <span className="ss-agenda-match">
              <Logo src={event.awayLogo} className="ss-matchup-logo" />
              <strong>{event.fullTitle}</strong>
              <Logo src={event.homeLogo} className="ss-matchup-logo" />
            </span>
            <span className="ss-agenda-meta">
              {event.leagueName}
              {event.venue ? ` · ${event.venue}` : ''}
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

function MonthBoard({ cursor, events, onOpen, phone = false }) {
  const [expanded, setExpanded] = useState(null);
  const start = startOfWeek(startOfMonth(cursor), { weekStartsOn: 0 });
  const end = endOfWeek(endOfMonth(cursor), { weekStartsOn: 0 });
  const days = eachDayOfInterval({ start, end });
  const byDay = useMemo(() => {
    const map = new Map();
    for (const event of events) {
      const key = format(event.start, 'yyyy-MM-dd');
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(event);
    }
    for (const list of map.values()) list.sort((a, b) => a.start - b.start || a.title.localeCompare(b.title));
    return map;
  }, [events]);

  if (phone) return <PhoneMonth cursor={cursor} events={events} onOpen={onOpen} />;

  return (
    <section className="ss-month" aria-label={format(cursor, 'MMMM yyyy')}>
      <div className="ss-month-dow">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
          <div key={day}>{day}</div>
        ))}
      </div>
      <div className="ss-month-grid">
        {days.map((day) => {
          const key = format(day, 'yyyy-MM-dd');
          const games = byDay.get(key) || [];
          const busy = games.length >= BUSY_DAY;
          const open = expanded === key;
          const leagues = leaguesRepresented(games);
          return (
            <div
              key={key}
              className={`ss-day${isSameMonth(day, cursor) ? '' : ' is-out'}${isSameDay(day, new Date()) ? ' is-today' : ''}${open ? ' is-open' : ''}`}
            >
              <div className="ss-day-num">{format(day, 'd')}</div>
              {busy ? (
                <button
                  type="button"
                  className="ss-day-count"
                  aria-expanded={open}
                  onClick={() => setExpanded(open ? null : key)}
                >
                  <span>{open ? `Hide ${games.length} games` : `${games.length} games`}</span>
                  <span className="ss-league-dots" aria-hidden="true">
                    {leagues.map((league) => (
                      <span key={league.id} className="ss-dot" style={{ background: league.color }} />
                    ))}
                  </span>
                </button>
              ) : null}
              {(!busy || open) && (
                <div className="ss-day-list">
                  {games.map((event) => (
                    <button
                      key={event.id}
                      type="button"
                      className="ss-mini"
                      style={chipStyle(event)}
                      onClick={() => onOpen(event)}
                    >
                      <Logo src={event.awayLogo} className="ss-chip-logo" />
                      <span>{event.title}</span>
                      <Logo src={event.homeLogo} className="ss-chip-logo" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function TeamPicker({ teams, teamsLoading, teamKeys, onToggle, onSkip, onContinue }) {
  const [query, setQuery] = useState('');
  const [leagueFilter, setLeagueFilter] = useState('all');
  const needle = query.trim().toLowerCase();
  const visible = teams.filter((team) => {
    if (leagueFilter !== 'all' && team.leagueId !== leagueFilter) return false;
    if (!needle) return true;
    return team.name.toLowerCase().includes(needle) || team.abbreviation.toLowerCase().includes(needle);
  });
  return (
    <div className="ss-picker">
      <div className="ss-picker-head">
        <div>
          <p className="ss-kicker">First visit</p>
          <h2>Choose your teams</h2>
          <p className="ss-muted">Search or tap a logo. The calendar stays empty until you follow a team.</p>
        </div>
        <div className="ss-picker-actions">
          <button type="button" className="ss-btn" onClick={onSkip}>Not now</button>
          <button type="button" className="ss-btn primary" onClick={onContinue} disabled={!teamKeys.length}>
            Show my teams{teamKeys.length ? ` · ${teamKeys.length}` : ''}
          </button>
        </div>
      </div>
      <input
        type="search"
        className="ss-search ss-picker-search"
        placeholder="Search teams"
        aria-label="Find a team"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <div className="ss-picker-leagues" role="group" aria-label="Filter teams by league">
        <button type="button" aria-pressed={leagueFilter === 'all'} aria-label="All teams" onClick={() => setLeagueFilter('all')}>All</button>
        {LEAGUES.map((league) => (
          <button
            key={league.id}
            type="button"
            style={{ '--league': league.color }}
            aria-pressed={leagueFilter === league.id}
            aria-label={`${league.name} teams`}
            onClick={() => setLeagueFilter(league.id)}
          >
            <span className="ss-dot" style={{ background: league.color }} aria-hidden="true" />
            {league.name}
          </button>
        ))}
      </div>
      <div className="ss-logo-grid">
        {teamsLoading && teams.length === 0 && <p className="ss-muted">Loading teams…</p>}
        {!teamsLoading && visible.length === 0 && <p className="ss-muted">No teams match.</p>}
        {visible.map((team) => {
          const on = teamKeys.includes(team.key);
          const league = leagueById(team.leagueId);
          return (
            <button
              key={team.key}
              type="button"
              className={`ss-logo-card${on ? ' is-on' : ''}`}
              aria-pressed={on}
              aria-label={on ? `Remove ${team.name}` : `Follow ${team.name}`}
              onClick={() => onToggle(team.key)}
            >
              <Logo src={team.logo} className="ss-picker-logo" />
              <span className="ss-logo-name">{team.name}</span>
              <span className="ss-muted">{league?.name} · {team.abbreviation}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function GameOdds({ event }) {
  const [state, setState] = useState({ loading: true, quotes: [], message: '' });

  useEffect(() => {
    let cancel = false;
    setState({ loading: true, quotes: [], message: '' });
    loadGameOdds(event).then((result) => {
      if (cancel) return;
      setState({ loading: false, quotes: result.quotes, message: result.message });
    });
    return () => {
      cancel = true;
    };
  }, [event]);

  return (
    <section className="ss-odds" aria-live="polite">
      <h3>Odds</h3>
      {state.loading && <p className="ss-muted">Checking Polymarket and Kalshi…</p>}
      {!state.loading && state.quotes.map((quote) => (
        <div key={quote.source} className="ss-odds-source">
          <p>{quote.source}</p>
          <ul>
            {quote.sides.map((side) => {
              const text = `${quote.source} ${side.label} ${side.price}`;
              return (
                <li key={`${quote.source}-${side.label}`}>
                  {side.url ? (
                    <a href={side.url} target="_blank" rel="noopener noreferrer">{text}</a>
                  ) : text}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      {!state.loading && !state.quotes.length && <p>{state.message}</p>}
    </section>
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
        className="ss-dialog ss-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ss-event-title"
        tabIndex={-1}
        ref={ref}
        onClick={(click) => click.stopPropagation()}
      >
        <div className="ss-sheet-handle" aria-hidden="true" />
        <p className="ss-kicker">
          <span className="ss-dot" style={{ background: event.color }} aria-hidden="true" />
          {event.leagueName}
        </p>
        <div className="ss-dialog-teams">
          <div>
            <Logo src={event.awayLogo} className="ss-dialog-logo" />
            <strong>{event.awayTeam || event.awayAbbr || 'Away'}</strong>
          </div>
          <div>
            <Logo src={event.homeLogo} className="ss-dialog-logo" />
            <strong>{event.homeTeam || event.homeAbbr || 'Home'}</strong>
          </div>
        </div>
        <h2 id="ss-event-title">{event.fullTitle}</h2>
        <p>{formatWhen(event)}</p>
        {event.venue && <p>{event.venue}</p>}
        {(event.state === 'in' || event.state === 'post') && (
          <>
            <p className="ss-status">
              {event.state === 'in' && <span className="ss-live">LIVE</span>}
              {' '}
              {event.status || (event.state === 'post' ? 'Final' : 'In progress')}
            </p>
            {hasScore(event) ? (
              <p className="ss-score">
                <span>{event.awayAbbr || event.awayTeam} {event.awayScore}</span>
                <span>{event.homeAbbr || event.homeTeam} {event.homeScore}</span>
              </p>
            ) : (
              <p>Score is not posted yet.</p>
            )}
          </>
        )}
        {event.state !== 'in' && event.state !== 'post' && <GameOdds event={event} />}
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

function ExportDialog({ events, teamKeys, pending, onClose, onDownload }) {
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

  const teamLabel = teamKeys.length === 1 ? '1 followed team' : `${teamKeys.length} followed teams`;

  function addToGoogle() {
    if (!events.length) return;
    if (events.length === 1) {
      window.open(googleCalendarUrl(events[0]), '_blank', 'noopener,noreferrer');
      return;
    }
    window.open(GOOGLE_IMPORT_URL, '_blank', 'noopener,noreferrer');
    onDownload();
  }

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
        className="ss-dialog ss-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ss-export-title"
        tabIndex={-1}
        ref={ref}
        onClick={(click) => click.stopPropagation()}
      >
        <div className="ss-sheet-handle" aria-hidden="true" />
        <h2 id="ss-export-title">Export</h2>
        <p>
          {teamLabel} · {events.length} loaded {events.length === 1 ? 'game' : 'games'}
        </p>
        <p className="ss-muted">
          This is every loaded game for the teams you follow, not only the month on screen.
          {pending > 0 ? ' More games may still be loading.' : ''}
        </p>
        <ol className="ss-steps">
          <li>Download iCal (.ics) and import it in Apple Calendar, Google Calendar, or Outlook.</li>
          <li>Add to Google Calendar opens one game ready to save. With more than one game, it downloads the file and opens Google Calendar’s import page.</li>
        </ol>
        <div className="ss-dialog-actions">
          <button
            type="button"
            className="ss-btn primary"
            onClick={onDownload}
            disabled={!events.length}
          >
            Download iCal (.ics)
          </button>
          <button
            type="button"
            className="ss-btn"
            onClick={addToGoogle}
            disabled={!events.length}
          >
            Add to Google Calendar
          </button>
        </div>
        {configured && (
          <div className="ss-sync">
            <h3>Sync these games</h3>
            <p className="ss-muted">
              Adds these games to your primary Google Calendar. Games already added from SportSync are skipped.
              {events.length > 60 ? ' A full season is faster as an .ics import.' : ''}
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
