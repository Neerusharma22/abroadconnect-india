import React, { useEffect, useState } from 'react';
import { Bookmark, CheckSquare, ExternalLink, Flag, Plus, Square, Trash2 } from 'lucide-react';
import { apiFetch, safeExternalUrl } from '../api';
import type { Country } from '../types';

interface UniversityItem {
  id: string;
  name: string;
  country_slug: string;
  city: string;
  institution_type: string;
  official_website: string;
  programs_json: string;
  duration: string;
  language_of_instruction: string;
  tuition_info: string;
  deadlines: string;
  eligibility: string;
  application_method: string;
  source_url: string;
  last_verified: string;
}

const APP_STATUSES = [
  'Researching',
  'Shortlisted',
  'Preparing Documents',
  'Applied',
  'Awaiting Decision',
  'Offer Received',
  'Accepted',
  'Visa Preparation',
  'Completed',
  'Rejected or Withdrawn',
];

export const UniversitiesView: React.FC<{ countries: Country[] }> = ({ countries }) => {
  const [universities, setUniversities] = useState<UniversityItem[]>([]);
  const [countryFilter, setCountryFilter] = useState('all');
  const [q, setQ] = useState('');
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [feedback, setFeedback] = useState('');

  useEffect(() => {
    apiFetch<{ universities: UniversityItem[] }>(`/universities?country=${encodeURIComponent(countryFilter)}&q=${encodeURIComponent(q)}`).then(
      (res) => setUniversities(res.universities)
    );
  }, [countryFilter, q]);

  const toggleCompare = (id: string) => {
    setCompareIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 5) return prev;
      return [...prev, id];
    });
  };

  const handleTrackApplication = async (u: UniversityItem) => {
    const programs = (() => {
      try {
        return JSON.parse(u.programs_json) as string[];
      } catch {
        return ['Graduate Program'];
      }
    })();
    await apiFetch('/applications', {
      method: 'POST',
      body: JSON.stringify({
        university_id: u.id,
        program_name: programs[0] || 'Target Program',
        status: 'Shortlisted',
        deadline: u.deadlines,
      }),
    });
    setFeedback(`Added ${u.name} to your private Application Tracker in My Journey.`);
  };

  const handleSave = async (id: string) => {
    await apiFetch('/saved', { method: 'POST', body: JSON.stringify({ item_type: 'university', item_id: id }) });
    setFeedback('Updated saved universities.');
  };

  const compared = universities.filter((u) => compareIds.includes(u.id));

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-[#0F172A] dark:text-white">Universities Directory & Comparison</h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
            Sourced program metadata with official website links and last-verified dates. Select up to 5 to compare.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search university, city, program..."
            className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs"
          />
          <select
            value={countryFilter}
            onChange={(e) => setCountryFilter(e.target.value)}
            className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs"
          >
            <option value="all">All Countries</option>
            {countries.map((c) => (
              <option key={c.slug} value={c.slug}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {feedback && (
        <div className="rounded-lg border border-teal-200 dark:border-teal-900 bg-teal-50 dark:bg-teal-950/30 px-4 py-2.5 text-xs text-teal-900 dark:text-teal-200">
          {feedback}
        </div>
      )}

      {compared.length > 0 && (
        <div className="rounded-xl border border-blue-200 dark:border-blue-900 bg-white dark:bg-[#111827] p-5 overflow-x-auto">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-display text-sm font-semibold text-[#0F172A] dark:text-white">
              Side-by-Side Comparison ({compared.length}/5)
            </h2>
            <button type="button" onClick={() => setCompareIds([])} className="text-xs text-slate-500 hover:underline">
              Clear Comparison
            </button>
          </div>
          <table className="w-full text-left text-xs border-collapse min-w-[640px]">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500">
                <th className="py-2 pr-4">Criteria</th>
                {compared.map((u) => (
                  <th key={u.id} className="py-2 px-3 font-semibold text-[#0F172A] dark:text-white">
                    {u.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              <tr>
                <td className="py-2.5 pr-4 font-medium text-slate-500">City & Type</td>
                {compared.map((u) => (
                  <td key={u.id} className="py-2.5 px-3">
                    {u.city} · {u.institution_type}
                  </td>
                ))}
              </tr>
              <tr>
                <td className="py-2.5 pr-4 font-medium text-slate-500">Language</td>
                {compared.map((u) => (
                  <td key={u.id} className="py-2.5 px-3">
                    {u.language_of_instruction}
                  </td>
                ))}
              </tr>
              <tr>
                <td className="py-2.5 pr-4 font-medium text-slate-500">Published Tuition</td>
                {compared.map((u) => (
                  <td key={u.id} className="py-2.5 px-3">
                    {u.tuition_info}
                  </td>
                ))}
              </tr>
              <tr>
                <td className="py-2.5 pr-4 font-medium text-slate-500">Deadlines</td>
                {compared.map((u) => (
                  <td key={u.id} className="py-2.5 px-3">
                    {u.deadlines}
                  </td>
                ))}
              </tr>
              <tr>
                <td className="py-2.5 pr-4 font-medium text-slate-500">Application Method</td>
                {compared.map((u) => (
                  <td key={u.id} className="py-2.5 px-3">
                    {u.application_method}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {universities.map((u) => {
          const programs = (() => {
            try {
              return (JSON.parse(u.programs_json) as string[]).join(' · ');
            } catch {
              return '';
            }
          })();
          const isCompared = compareIds.includes(u.id);
          return (
            <div key={u.id} className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-5 flex flex-col justify-between space-y-4">
              <div>
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  <span>{u.city}</span> · <span>{u.institution_type}</span> · <span>Verified {u.last_verified}</span>
                </div>
                <h2 className="mt-1.5 font-display text-lg font-semibold text-[#0F172A] dark:text-white">{u.name}</h2>
                <p className="mt-2 text-xs font-medium text-[#2563EB] dark:text-blue-400">{programs}</p>
                <p className="mt-2 text-xs text-slate-600 dark:text-slate-300">
                  <strong>Tuition:</strong> {u.tuition_info}
                </p>
                <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
                  <strong>Deadlines:</strong> {u.deadlines}
                </p>
                <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
                  <strong>Eligibility:</strong> {u.eligibility}
                </p>
              </div>
              <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => toggleCompare(u.id)}
                  className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium ${
                    isCompared ? 'border-[#2563EB] bg-blue-50 dark:bg-blue-950/40 text-[#2563EB]' : 'border-slate-300 dark:border-slate-700'
                  }`}
                >
                  {isCompared ? 'In Comparison' : 'Compare'}
                </button>
                <button
                  type="button"
                  onClick={() => handleTrackApplication(u)}
                  className="rounded-lg bg-[#142B5F] dark:bg-[#2563EB] px-3 py-1.5 text-xs font-semibold text-white"
                >
                  Track Application
                </button>
                <button
                  type="button"
                  onClick={() => handleSave(u.id)}
                  className="p-1.5 text-slate-400 hover:text-[#0D9488]"
                  aria-label="Save university"
                >
                  <Bookmark className="w-4 h-4" />
                </button>
                {safeExternalUrl(u.source_url) && (
                  <a
                    href={safeExternalUrl(u.source_url)!}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs font-medium text-[#2563EB] dark:text-blue-400 hover:underline ml-auto"
                  >
                    <span>Official Source</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export const OpportunitiesPortalView: React.FC<{
  mode: 'jobs' | 'apprenticeships' | 'scholarships' | 'resources';
  countries: Country[];
  onReportTarget: (targetType: string, targetId: string) => void;
}> = ({ mode, countries, onReportTarget }) => {
  const [countryFilter, setCountryFilter] = useState('all');
  const [fundingFilter, setFundingFilter] = useState('all');
  const [items, setItems] = useState<Array<Record<string, unknown>>>([]);
  const [feedback, setFeedback] = useState('');

  useEffect(() => {
    const endpoint =
      mode === 'jobs'
        ? `/jobs?country=${countryFilter}`
        : mode === 'apprenticeships'
          ? `/apprenticeships?country=${countryFilter}`
          : mode === 'scholarships'
            ? `/scholarships?country=${countryFilter}&funding_type=${fundingFilter}`
            : `/resources?country=${countryFilter}`;
    apiFetch<Record<string, Array<Record<string, unknown>>>>(endpoint).then((res) => {
      setItems(res[mode] || []);
    });
  }, [mode, countryFilter, fundingFilter]);

  const handleSave = async (id: string) => {
    const map: Record<string, string> = {
      jobs: 'job',
      apprenticeships: 'apprenticeship',
      scholarships: 'scholarship',
      resources: 'resource',
    };
    await apiFetch('/saved', { method: 'POST', body: JSON.stringify({ item_type: map[mode], item_id: id }) });
    setFeedback('Updated saved items.');
  };

  const titles: Record<string, string> = {
    jobs: 'International Jobs & Official Sponsor Registers',
    apprenticeships: 'Apprenticeships & Vocational Training (Ausbildung)',
    scholarships: 'Scholarships & Funding Directory',
    resources: 'Curated Resource Library',
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-[#0F172A] dark:text-white">{titles[mode]}</h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
            Every listing cites an official source URL and verification status. Report any outdated or suspicious link immediately.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <select
            value={countryFilter}
            onChange={(e) => setCountryFilter(e.target.value)}
            className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs"
          >
            <option value="all">All Countries</option>
            {countries.map((c) => (
              <option key={c.slug} value={c.slug}>
                {c.name}
              </option>
            ))}
          </select>

          {mode === 'scholarships' && (
            <select
              value={fundingFilter}
              onChange={(e) => setFundingFilter(e.target.value)}
              className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs"
            >
              <option value="all">All Funding Types</option>
              <option value="full">Full Funding</option>
              <option value="partial">Partial Funding</option>
              <option value="unspecified">Unspecified Funding</option>
            </select>
          )}
        </div>
      </div>

      {feedback && (
        <div className="rounded-lg border border-teal-200 dark:border-teal-900 bg-teal-50 dark:bg-teal-950/30 px-4 py-2 text-xs text-teal-900 dark:text-teal-200">
          {feedback}
        </div>
      )}

      {items.length === 0 ? (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-8 text-center text-sm text-slate-500">
          No records match the current filter.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {items.map((item) => {
            const id = String(item.id);
            const title = String(item.title);
            const url = String(item.official_url || item.official_source_url || '');
            return (
              <div key={id} className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-5 flex flex-col justify-between space-y-4">
                <div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    <span className="capitalize">{String(item.country_slug || 'Global')}</span>
                    {mode === 'scholarships' && (
                      <>
                        <span aria-hidden="true"> · </span>
                        <span className="font-semibold text-[#0D9488] dark:text-teal-400 uppercase">
                          {String(item.funding_type)} funding
                        </span>
                      </>
                    )}
                    {mode === 'resources' && (
                      <>
                        <span aria-hidden="true"> · </span>
                        <span className="font-medium text-[#2563EB] dark:text-blue-400">
                          {item.source_type === 'official_editorial' ? 'Official Editorial Review' : 'Community Contributed'}
                        </span>
                        <span aria-hidden="true"> · </span>
                        <span>v{String(item.version)} · Reviewed {String(item.last_reviewed)}</span>
                      </>
                    )}
                  </div>
                  <h2 className="mt-1.5 font-display text-base font-semibold text-[#0F172A] dark:text-white">{title}</h2>

                  {mode === 'jobs' && (
                    <div className="mt-2 space-y-1 text-xs text-slate-600 dark:text-slate-300">
                      <p><strong>Source:</strong> {String(item.employer)}</p>
                      <p><strong>Location:</strong> {String(item.city)} · {String(item.employment_type)}</p>
                      <p><strong>Visa Info:</strong> {String(item.visa_sponsorship_info)}</p>
                      <p><strong>Salary:</strong> {String(item.salary_info)}</p>
                    </div>
                  )}

                  {mode === 'apprenticeships' && (
                    <div className="mt-2 space-y-1 text-xs text-slate-600 dark:text-slate-300">
                      <p><strong>Provider:</strong> {String(item.training_provider)}</p>
                      <p><strong>Duration:</strong> {String(item.duration)} · <strong>Language:</strong> {String(item.language_req)}</p>
                      <p><strong>Allowance:</strong> {String(item.allowance_info)}</p>
                      <p><strong>Process:</strong> {String(item.application_process)}</p>
                    </div>
                  )}

                  {mode === 'scholarships' && (
                    <div className="mt-2 space-y-1 text-xs text-slate-600 dark:text-slate-300">
                      <p><strong>Provider:</strong> {String(item.provider)} · {String(item.study_level)}</p>
                      <p>{String(item.funding_details)}</p>
                      <p><strong>Deadline:</strong> {String(item.deadline)} · Checked {String(item.last_checked)}</p>
                    </div>
                  )}

                  {mode === 'resources' && (
                    <div className="mt-2 space-y-2 text-xs text-slate-600 dark:text-slate-300">
                      <p>{String(item.summary)}</p>
                      <p className="whitespace-pre-line rounded-lg bg-slate-50 dark:bg-slate-900 p-3 text-slate-700 dark:text-slate-300">
                        {String(item.body)}
                      </p>
                    </div>
                  )}
                </div>

                <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => handleSave(id)}
                    className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-[#0D9488]"
                  >
                    <Bookmark className="w-3.5 h-3.5" />
                    <span>Save</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onReportTarget(mode === 'resources' ? 'resource' : 'opportunity', id)}
                    className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-amber-600"
                  >
                    <Flag className="w-3.5 h-3.5" />
                    <span>Report / Flag Outdated</span>
                  </button>
                  {safeExternalUrl(url) && (
                    <a
                      href={safeExternalUrl(url)!}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs font-semibold text-[#2563EB] dark:text-blue-400 hover:underline ml-auto"
                    >
                      <span>Official Portal</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export const JourneyAndSavedView: React.FC<{ mode: 'journey' | 'saved' }> = ({ mode }) => {
  const [journey, setJourney] = useState<{ destination_country: string; purpose: string; target_intake: string; current_stage: string } | null>(null);
  const [tasks, setTasks] = useState<Array<{ id: string; title: string; stage: string; due_date: string; is_completed: number }>>([]);
  const [applications, setApplications] = useState<
    Array<{ id: string; university_name: string; university_city: string; program_name: string; status: string; deadline: string; notes: string }>
  >([]);
  const [savedItems, setSavedItems] = useState<Array<{ item_type: string; item_id: string; detail: Record<string, unknown> }>>([]);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [newTaskDue, setNewTaskDue] = useState('');

  const STAGES = ['Explore', 'Prepare', 'Apply', 'Receive Decision', 'Complete Formalities', 'Travel', 'Settle Abroad'];

  const loadData = async () => {
    if (mode === 'journey') {
      const res = await apiFetch<{ journey: typeof journey; tasks: typeof tasks; applications: typeof applications }>('/journeys/me');
      setJourney(res.journey);
      setTasks(res.tasks);
      setApplications(res.applications);
    } else {
      const res = await apiFetch<{ saved: typeof savedItems }>('/saved');
      setSavedItems(res.saved);
    }
  };

  useEffect(() => {
    loadData();
  }, [mode]);

  if (mode === 'saved') {
    return (
      <div className="space-y-6">
        <h1 className="font-display text-2xl font-bold text-[#0F172A] dark:text-white">Saved Items</h1>
        {savedItems.length === 0 ? (
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-8 text-center text-sm text-slate-500">
            Nothing saved yet. Bookmark posts, universities, scholarships, jobs, or guides to access them here.
          </div>
        ) : (
          <div className="divide-y divide-slate-200 dark:divide-slate-800 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827]">
            {savedItems.map((s) => (
              <div key={`${s.item_type}-${s.item_id}`} className="p-4 flex items-center justify-between gap-4">
                <div>
                  <p className="text-xs uppercase font-medium text-[#2563EB] dark:text-blue-400">{s.item_type}</p>
                  <p className="font-medium text-sm text-[#0F172A] dark:text-white">
                    {String(s.detail.title || s.detail.name || 'Saved record')}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    await apiFetch('/saved', { method: 'POST', body: JSON.stringify({ item_type: s.item_type, item_id: s.item_id }) });
                    await loadData();
                  }}
                  className="text-xs text-slate-500 hover:text-red-600"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-[#0F172A] dark:text-white">My Abroad Journey</h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
          Your private planning workspace and university application tracker. Data stays private unless you share it.
        </p>
      </div>

      {journey && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-5">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <div className="text-sm font-semibold text-[#0F172A] dark:text-white capitalize">
              Target: {journey.destination_country} · {journey.purpose} · {journey.target_intake}
            </div>
            <span className="text-xs text-slate-500">Current Stage: {journey.current_stage}</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {STAGES.map((st) => (
              <button
                key={st}
                type="button"
                onClick={async () => {
                  await apiFetch('/journeys/me', {
                    method: 'PUT',
                    body: JSON.stringify({ ...journey, current_stage: st }),
                  });
                  await loadData();
                }}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                  journey.current_stage === st
                    ? 'bg-[#142B5F] dark:bg-[#2563EB] text-white'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                }`}
              >
                {st}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-6 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-5 space-y-4">
          <h2 className="font-display text-base font-semibold text-[#0F172A] dark:text-white">Personal Checklist Tasks</h2>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (!newTaskTitle.trim()) return;
              await apiFetch('/journeys/tasks', {
                method: 'POST',
                body: JSON.stringify({ title: newTaskTitle, due_date: newTaskDue, stage: journey?.current_stage || 'Prepare' }),
              });
              setNewTaskTitle('');
              setNewTaskDue('');
              await loadData();
            }}
            className="flex flex-wrap gap-2"
          >
            <input
              type="text"
              required
              value={newTaskTitle}
              onChange={(e) => setNewTaskTitle(e.target.value)}
              placeholder="Add task (e.g. Request APS verification)..."
              className="flex-1 min-w-[180px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs"
            />
            <input
              type="date"
              value={newTaskDue}
              onChange={(e) => setNewTaskDue(e.target.value)}
              className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-2 text-xs"
            />
            <button type="submit" className="inline-flex items-center gap-1 rounded-lg bg-[#2563EB] px-3 py-2 text-xs font-semibold text-white">
              <Plus className="w-3.5 h-3.5" /> Add
            </button>
          </form>

          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {tasks.length === 0 ? (
              <p className="text-xs text-slate-500 py-4">No tasks added yet.</p>
            ) : (
              tasks.map((task) => (
                <div key={task.id} className="py-2.5 flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={async () => {
                      await apiFetch(`/journeys/tasks/${task.id}`, {
                        method: 'PATCH',
                        body: JSON.stringify({ is_completed: !task.is_completed }),
                      });
                      await loadData();
                    }}
                    className="flex items-center gap-2.5 text-left text-xs"
                  >
                    {task.is_completed ? (
                      <CheckSquare className="w-4 h-4 text-[#0D9488] shrink-0" />
                    ) : (
                      <Square className="w-4 h-4 text-slate-400 shrink-0" />
                    )}
                    <span className={task.is_completed ? 'line-through text-slate-400' : 'text-slate-800 dark:text-slate-200'}>
                      {task.title} {task.due_date && `· Due ${task.due_date}`}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      await apiFetch(`/journeys/tasks/${task.id}`, { method: 'DELETE' });
                      await loadData();
                    }}
                    className="text-slate-400 hover:text-red-500 p-1"
                    aria-label="Delete task"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="lg:col-span-6 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-5 space-y-4">
          <h2 className="font-display text-base font-semibold text-[#0F172A] dark:text-white">Private University Application Tracker</h2>
          {applications.length === 0 ? (
            <p className="text-xs text-slate-500">
              No tracked universities yet. Visit the Universities tab and click “Track Application” on any program.
            </p>
          ) : (
            <div className="space-y-3">
              {applications.map((a) => (
                <div key={a.id} className="rounded-lg border border-slate-200 dark:border-slate-800 p-3.5 space-y-2 text-xs">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold text-[#0F172A] dark:text-white">{a.university_name}</p>
                      <p className="text-slate-500">
                        {a.program_name} · {a.university_city}
                      </p>
                    </div>
                    <select
                      value={a.status}
                      onChange={async (e) => {
                        await apiFetch(`/applications/${a.id}`, {
                          method: 'PATCH',
                          body: JSON.stringify({ status: e.target.value }),
                        });
                        await loadData();
                      }}
                      className="rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1 text-xs"
                    >
                      {APP_STATUSES.map((st) => (
                        <option key={st} value={st}>
                          {st}
                        </option>
                      ))}
                    </select>
                  </div>
                  {a.deadline && <p className="text-slate-500">Deadline: {a.deadline}</p>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
