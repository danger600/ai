import {
  Bell,
  Calculator,
  CheckCircle2,
  CloudSun,
  Coins,
  Plus,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import type { NoteItem, ProjectItem, ReminderItem, TaskItem } from '../types';

interface WeatherData {
  city: string;
  country: string;
  temperatureC: number;
  apparentTemperatureC: number;
  humidityPercent: number;
  windSpeedKmh: number;
  condition: string;
  daily: Array<{ date: string; maxC: number; minC: number; code: number }>;
}

export function ProductivityCenter() {
  const [tab, setTab] = useState<'tasks' | 'notes' | 'tools'>('tasks');
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [notes, setNotes] = useState<NoteItem[]>([]);
  const [reminders, setReminders] = useState<ReminderItem[]>([]);
  const [statusFilter, setStatusFilter] = useState<'all' | 'todo' | 'in_progress' | 'done'>('all');

  // Task form
  const [taskTitle, setTaskTitle] = useState('');
  const [taskPriority, setTaskPriority] = useState<'low' | 'medium' | 'high'>('medium');
  const [taskProjectId, setTaskProjectId] = useState('');

  // Note form
  const [noteTitle, setNoteTitle] = useState('');
  const [noteContent, setNoteContent] = useState('');

  // Reminder form
  const [remTitle, setRemTitle] = useState('');
  const [remAt, setRemAt] = useState('');

  // Weather
  const [weatherCity, setWeatherCity] = useState('Kigali');
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [weatherError, setWeatherError] = useState<string | null>(null);

  // Currency
  const [amount, setAmount] = useState('100');
  const [fromCurr, setFromCurr] = useState('USD');
  const [toCurr, setToCurr] = useState('RWF');
  const [rates, setRates] = useState<Record<string, number> | null>(null);
  const [rateUpdated, setRateUpdated] = useState('');

  // Calculator & Unit Converter
  const [calcInput, setCalcInput] = useState('256 * 1.18');
  const [calcOutput, setCalcOutput] = useState('');
  const [unitVal, setUnitVal] = useState('10');
  const [unitMode, setUnitMode] = useState<'km_mi' | 'c_f' | 'kg_lb' | 'gb_mb'>('km_mi');

  const loadProductivity = async () => {
    const res = await fetch('/api/productivity');
    const data = await res.json();
    setProjects(data.projects || []);
    setTasks(data.tasks || []);
    setNotes(data.notes || []);
    setReminders(data.reminders || []);
  };

  const loadWeather = async (city = weatherCity) => {
    setWeatherError(null);
    try {
      const res = await fetch(`/api/productivity/weather?city=${encodeURIComponent(city)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Weather error');
      setWeather(data);
    } catch (err) {
      setWeatherError(err instanceof Error ? err.message : 'Weather unavailable');
    }
  };

  const loadCurrency = async (base = fromCurr) => {
    try {
      const res = await fetch(`/api/productivity/currency?base=${encodeURIComponent(base)}`);
      const data = await res.json();
      if (res.ok) {
        setRates(data.rates);
        setRateUpdated(data.updatedAt);
      }
    } catch {
      // handled in UI
    }
  };

  useEffect(() => {
    loadProductivity();
    loadWeather('Kigali');
    loadCurrency('USD');
  }, []);

  const addTask = async () => {
    if (!taskTitle.trim()) return;
    await fetch('/api/productivity/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: taskTitle,
        priority: taskPriority,
        projectId: taskProjectId || null,
      }),
    });
    setTaskTitle('');
    await loadProductivity();
  };

  const updateTaskStatus = async (t: TaskItem, nextStatus: 'todo' | 'in_progress' | 'done') => {
    await fetch(`/api/productivity/tasks/${t.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: nextStatus }),
    });
    await loadProductivity();
  };

  const deleteTask = async (id: string) => {
    await fetch(`/api/productivity/tasks/${id}`, { method: 'DELETE' });
    await loadProductivity();
  };

  const addNote = async () => {
    if (!noteTitle.trim() || !noteContent.trim()) return;
    await fetch('/api/productivity/notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: noteTitle, content: noteContent }),
    });
    setNoteTitle('');
    setNoteContent('');
    await loadProductivity();
  };

  const deleteNote = async (id: string) => {
    await fetch(`/api/productivity/notes/${id}`, { method: 'DELETE' });
    await loadProductivity();
  };

  const addReminder = async () => {
    if (!remTitle.trim() || !remAt.trim()) return;
    await fetch('/api/productivity/reminders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: remTitle, remindAt: remAt }),
    });
    setRemTitle('');
    setRemAt('');
    await loadProductivity();
  };

  const triggerTestNotification = async () => {
    if ('Notification' in window) {
      const perm = await Notification.requestPermission();
      if (perm === 'granted') {
        new Notification('REMY THE GRIVER PRO', {
          body: 'Desktop reminder notifications are enabled.',
        });
      }
    }
  };

  const evaluateMath = () => {
    const safe = calcInput.replace(/[^0-9+\-*/().%\s]/g, '');
    if (!safe.trim()) return;
    try {
      const fn = new Function(`"use strict"; return (${safe});`);
      const res = fn();
      setCalcOutput(String(res));
    } catch {
      setCalcOutput('Invalid expression');
    }
  };

  const convertedUnit = () => {
    const v = parseFloat(unitVal);
    if (Number.isNaN(v)) return '—';
    switch (unitMode) {
      case 'km_mi':
        return `${(v * 0.621371).toFixed(3)} miles`;
      case 'c_f':
        return `${((v * 9) / 5 + 32).toFixed(2)} °F`;
      case 'kg_lb':
        return `${(v * 2.20462).toFixed(3)} lbs`;
      case 'gb_mb':
        return `${(v * 1024).toLocaleString()} MB`;
    }
  };

  const convertedCurrency = () => {
    const val = parseFloat(amount);
    if (Number.isNaN(val) || !rates || !rates[toCurr]) return '—';
    return (val * rates[toCurr]).toLocaleString(undefined, { maximumFractionDigits: 2 });
  };

  const doneCount = tasks.filter((t) => t.status === 'done').length;
  const completionPct = tasks.length > 0 ? Math.round((doneCount / tasks.length) * 100) : 0;
  const filteredTasks = tasks.filter((t) => (statusFilter === 'all' ? true : t.status === statusFilter));

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4 dark:border-slate-800">
          <div>
            <h1 className="text-xl font-semibold text-slate-900 dark:text-white">Productivity Command Center</h1>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Projects, tasks, notes, reminders, live Open-Meteo weather, currency rates, and utilities.
            </p>
          </div>

          <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1 dark:bg-[#101724]">
            {[
              { id: 'tasks', label: 'Projects & Tasks' },
              { id: 'notes', label: 'Notes & Reminders' },
              { id: 'tools', label: 'Weather, Currency & Tools' },
            ].map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id as 'tasks' | 'notes' | 'tools')}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  tab === item.id
                    ? 'bg-white text-slate-900 shadow-sm dark:bg-blue-600 dark:text-white'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        {/* Summary KPI Strip */}
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-[#101724]">
            <div className="text-xs text-slate-500">Active Projects</div>
            <div className="mt-1 font-mono text-2xl font-semibold text-slate-900 dark:text-white tabular-nums">
              {projects.length}
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-[#101724]">
            <div className="text-xs text-slate-500">Task Completion</div>
            <div className="mt-1 font-mono text-2xl font-semibold text-emerald-500 tabular-nums">
              {completionPct}%
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-[#101724]">
            <div className="text-xs text-slate-500">Saved Notes</div>
            <div className="mt-1 font-mono text-2xl font-semibold text-slate-900 dark:text-white tabular-nums">
              {notes.length}
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-[#101724]">
            <div className="text-xs text-slate-500">{weather ? `${weather.city} Weather` : 'Kigali Weather'}</div>
            <div className="mt-1 font-mono text-2xl font-semibold text-amber-500 tabular-nums">
              {weather ? `${weather.temperatureC}°C` : '—'}
            </div>
          </div>
        </div>

        {tab === 'tasks' && (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            {/* Projects Tracker */}
            <div className="space-y-3 lg:col-span-5">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Active Engineering Projects</h2>
              {projects.map((p) => (
                <div
                  key={p.id}
                  className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-[#101724]"
                >
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-semibold text-slate-900 dark:text-white">{p.name}</div>
                    <span className="font-mono text-xs font-medium text-blue-500 tabular-nums">{p.progress}%</span>
                  </div>
                  <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">{p.description}</p>
                  <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                    <div className="h-full rounded-full bg-blue-600" style={{ width: `${p.progress}%` }} />
                  </div>
                  <div className="mt-2 text-[11px] text-slate-500">{p.stack}</div>
                </div>
              ))}
            </div>

            {/* Task Manager */}
            <div className="space-y-4 lg:col-span-7">
              <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-[#101724]">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Task Queue</h2>
                  <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-900">
                    {(['all', 'todo', 'in_progress', 'done'] as const).map((st) => (
                      <button
                        key={st}
                        type="button"
                        onClick={() => setStatusFilter(st)}
                        className={`rounded px-2.5 py-1 text-[11px] font-medium ${
                          statusFilter === st
                            ? 'bg-white text-slate-900 shadow-sm dark:bg-blue-600 dark:text-white'
                            : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
                        }`}
                      >
                        {st === 'all' ? 'All' : st.replace('_', ' ')}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
                  <input
                    type="text"
                    value={taskTitle}
                    onChange={(e) => setTaskTitle(e.target.value)}
                    placeholder="New task title..."
                    className="rounded-lg border border-slate-300 bg-slate-50 px-3 py-1.5 text-xs text-slate-900 outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 sm:col-span-2"
                  />
                  <select
                    value={taskPriority}
                    onChange={(e) => setTaskPriority(e.target.value as 'low' | 'medium' | 'high')}
                    className="rounded-lg border border-slate-300 bg-slate-50 px-2.5 py-1.5 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                  >
                    <option value="high">High priority</option>
                    <option value="medium">Medium priority</option>
                    <option value="low">Low priority</option>
                  </select>
                  <button
                    type="button"
                    onClick={addTask}
                    className="inline-flex items-center justify-center gap-1 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <span>Add Task</span>
                  </button>
                </div>

                <div className="mt-4 space-y-2">
                  {filteredTasks.map((t) => (
                    <div
                      key={t.id}
                      className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2.5 text-xs dark:border-slate-800"
                    >
                      <div className="min-w-0 flex-1">
                        <div className={`font-medium ${t.status === 'done' ? 'line-through text-slate-400' : 'text-slate-900 dark:text-white'}`}>
                          {t.title}
                        </div>
                        <div className="mt-0.5 text-[11px] text-slate-500">
                          Priority: {t.priority} · {t.due_date || 'No due date'}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <select
                          value={t.status}
                          onChange={(e) => updateTaskStatus(t, e.target.value as 'todo' | 'in_progress' | 'done')}
                          className="rounded border border-slate-300 bg-slate-50 px-2 py-1 text-[11px] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                        >
                          <option value="todo">To do</option>
                          <option value="in_progress">In progress</option>
                          <option value="done">Done</option>
                        </select>
                        <button
                          type="button"
                          onClick={() => deleteTask(t.id)}
                          aria-label="Delete task"
                          className="rounded p-1 text-slate-400 hover:text-red-500"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {tab === 'notes' && (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-[#101724]">
              <h2 className="mb-3 text-sm font-semibold text-slate-900 dark:text-white">Quick Notes</h2>
              <input
                type="text"
                value={noteTitle}
                onChange={(e) => setNoteTitle(e.target.value)}
                placeholder="Note title"
                className="w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-xs text-slate-900 outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              />
              <textarea
                value={noteContent}
                onChange={(e) => setNoteContent(e.target.value)}
                rows={3}
                placeholder="Write a note..."
                className="mt-2 w-full rounded-lg border border-slate-300 bg-slate-50 p-3 text-xs text-slate-900 outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              />
              <button
                type="button"
                onClick={addNote}
                className="mt-2 rounded-lg bg-blue-600 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-blue-500"
              >
                Save Note
              </button>

              <div className="mt-4 space-y-2.5">
                {notes.map((n) => (
                  <div key={n.id} className="rounded-lg border border-slate-200 p-3 text-xs dark:border-slate-800">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-slate-900 dark:text-white">{n.title}</span>
                      <button type="button" onClick={() => deleteNote(n.id)} className="text-slate-400 hover:text-red-500">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <p className="mt-1 whitespace-pre-wrap text-slate-600 dark:text-slate-300">{n.content}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-[#101724]">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Reminders & Alerts</h2>
                <button
                  type="button"
                  onClick={triggerTestNotification}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300"
                >
                  <Bell className="h-3.5 w-3.5 text-amber-500" />
                  <span>Enable Desktop Alerts</span>
                </button>
              </div>

              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <input
                  type="text"
                  value={remTitle}
                  onChange={(e) => setRemTitle(e.target.value)}
                  placeholder="Reminder title"
                  className="rounded-lg border border-slate-300 bg-slate-50 px-3 py-1.5 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                />
                <input
                  type="datetime-local"
                  value={remAt}
                  onChange={(e) => setRemAt(e.target.value)}
                  className="rounded-lg border border-slate-300 bg-slate-50 px-3 py-1.5 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                />
                <button
                  type="button"
                  onClick={addReminder}
                  className="rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-amber-400"
                >
                  Add Reminder
                </button>
              </div>

              <div className="mt-4 space-y-2">
                {reminders.length === 0 ? (
                  <p className="text-xs text-slate-500">No reminders scheduled yet.</p>
                ) : (
                  reminders.map((r) => (
                    <div
                      key={r.id}
                      className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-xs dark:border-slate-800"
                    >
                      <div>
                        <div className="font-medium text-slate-900 dark:text-white">{r.title}</div>
                        <div className="font-mono text-[11px] text-slate-500">{r.remind_at}</div>
                      </div>
                      <CheckCircle2 className={`h-4 w-4 ${r.completed ? 'text-emerald-500' : 'text-slate-400'}`} />
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}

        {tab === 'tools' && (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            {/* Open-Meteo Weather */}
            <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-[#101724]">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
                  <CloudSun className="h-4 w-4 text-amber-500" />
                  <span>Open-Meteo Weather</span>
                </div>
                <button type="button" onClick={() => loadWeather(weatherCity)} className="text-slate-400 hover:text-blue-500">
                  <RefreshCw className="h-3.5 w-3.5" />
                </button>
              </div>

              <div className="flex gap-2">
                <input
                  type="text"
                  value={weatherCity}
                  onChange={(e) => setWeatherCity(e.target.value)}
                  placeholder="City (e.g. Kigali)"
                  className="w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-1.5 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                />
                <button
                  type="button"
                  onClick={() => loadWeather(weatherCity)}
                  className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white"
                >
                  Check
                </button>
              </div>

              {weatherError && <p className="mt-2 text-xs text-red-500">{weatherError}</p>}

              {weather && (
                <div className="mt-4 space-y-3">
                  <div className="flex items-baseline justify-between">
                    <div>
                      <div className="text-base font-semibold text-slate-900 dark:text-white">
                        {weather.city}, {weather.country}
                      </div>
                      <div className="text-xs text-slate-500">{weather.condition}</div>
                    </div>
                    <div className="font-mono text-2xl font-semibold text-amber-500 tabular-nums">
                      {weather.temperatureC}°C
                    </div>
                  </div>
                  <div className="text-xs text-slate-500 tabular-nums">
                    Feels like {weather.apparentTemperatureC}°C · Humidity {weather.humidityPercent}% · Wind {weather.windSpeedKmh} km/h
                  </div>
                  <div className="space-y-1 border-t border-slate-200 pt-2 text-xs dark:border-slate-800">
                    {weather.daily.map((d) => (
                      <div key={d.date} className="flex justify-between font-mono tabular-nums">
                        <span className="text-slate-500">{d.date}</span>
                        <span className="text-slate-700 dark:text-slate-300">
                          {d.minC}° / {d.maxC}°C
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Live Currency Converter */}
            <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-[#101724]">
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
                <Coins className="h-4 w-4 text-emerald-500" />
                <span>Live Currency Converter</span>
              </div>
              <div className="space-y-3">
                <input
                  type="number"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 font-mono text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                />
                <div className="grid grid-cols-2 gap-2">
                  <select
                    value={fromCurr}
                    onChange={(e) => {
                      setFromCurr(e.target.value);
                      loadCurrency(e.target.value);
                    }}
                    className="rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-xs font-medium dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                  >
                    {['USD', 'EUR', 'GBP', 'RWF', 'KES', 'UGX'].map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                  <select
                    value={toCurr}
                    onChange={(e) => setToCurr(e.target.value)}
                    className="rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-xs font-medium dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                  >
                    {['RWF', 'USD', 'EUR', 'GBP', 'KES', 'UGX'].map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </div>
                <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-900">
                  <div className="text-xs text-slate-500">Converted Result</div>
                  <div className="mt-1 font-mono text-xl font-semibold text-slate-900 dark:text-white tabular-nums">
                    {convertedCurrency()} {toCurr}
                  </div>
                  {rateUpdated && <div className="mt-1 text-[11px] text-slate-400">Live rate updated: {rateUpdated}</div>}
                </div>
              </div>
            </div>

            {/* Calculator & Unit Converter */}
            <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-[#101724]">
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
                <Calculator className="h-4 w-4 text-blue-500" />
                <span>Calculator & Units</span>
              </div>
              <div className="space-y-4">
                <div>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={calcInput}
                      onChange={(e) => setCalcInput(e.target.value)}
                      className="w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-1.5 font-mono text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                    />
                    <button
                      type="button"
                      onClick={evaluateMath}
                      className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white dark:bg-blue-600"
                    >
                      =
                    </button>
                  </div>
                  {calcOutput && (
                    <div className="mt-1.5 font-mono text-sm font-semibold text-amber-500 tabular-nums">
                      = {calcOutput}
                    </div>
                  )}
                </div>

                <div className="border-t border-slate-200 pt-3 dark:border-slate-800">
                  <div className="mb-2 text-xs font-medium text-slate-700 dark:text-slate-300">Unit Conversion</div>
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="number"
                      value={unitVal}
                      onChange={(e) => setUnitVal(e.target.value)}
                      className="rounded-lg border border-slate-300 bg-slate-50 px-3 py-1.5 font-mono text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                    />
                    <select
                      value={unitMode}
                      onChange={(e) => setUnitMode(e.target.value as 'km_mi' | 'c_f' | 'kg_lb' | 'gb_mb')}
                      className="rounded-lg border border-slate-300 bg-slate-50 px-2 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                    >
                      <option value="km_mi">km → miles</option>
                      <option value="c_f">°C → °F</option>
                      <option value="kg_lb">kg → lbs</option>
                      <option value="gb_mb">GB → MB</option>
                    </select>
                  </div>
                  <div className="mt-2 font-mono text-sm font-semibold text-slate-900 dark:text-white tabular-nums">
                    {convertedUnit()}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
