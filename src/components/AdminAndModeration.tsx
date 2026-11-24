import React, { useEffect, useState } from 'react';
import { ShieldCheck, Users } from 'lucide-react';
import { apiFetch } from '../api';
import type { Country } from '../types';

export const ModerationQueueView: React.FC = () => {
  const [reports, setReports] = useState<Array<Record<string, unknown>>>([]);
  const [notesMap, setNotesMap] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState('');

  const loadQueue = async () => {
    const res = await apiFetch<{ reports: Array<Record<string, unknown>> }>('/moderation/queue');
    setReports(res.reports);
  };

  useEffect(() => {
    loadQueue();
  }, []);

  const takeAction = async (reportId: string, action: string) => {
    await apiFetch(`/moderation/reports/${reportId}/action`, {
      method: 'POST',
      body: JSON.stringify({ action, notes: notesMap[reportId] || '' }),
    });
    setFeedback(`Moderation action "${action.replace('_', ' ')}" recorded and logged.`);
    await loadQueue();
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-[#0F172A] dark:text-white">Trust & Safety Moderation Queue</h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
          Review community reports and automated scam-signal flags. All moderator actions are recorded in the security audit log.
        </p>
      </div>

      {feedback && (
        <div className="rounded-lg border border-teal-200 dark:border-teal-900 bg-teal-50 dark:bg-teal-950/30 px-4 py-2.5 text-xs text-teal-900 dark:text-teal-200">
          {feedback}
        </div>
      )}

      {reports.length === 0 ? (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-8 text-center text-sm text-slate-500">
          No reports in the moderation queue.
        </div>
      ) : (
        <div className="space-y-4">
          {reports.map((r) => {
            const id = String(r.id);
            const signals = (() => {
              try {
                return JSON.parse(String(r.safety_signals_json || '[]')) as string[];
              } catch {
                return [];
              }
            })();
            return (
              <div key={id} className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-5 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div>
                    <span className="font-semibold text-[#0F172A] dark:text-white">{String(r.category)}</span>
                    <span aria-hidden="true"> · </span>
                    <span className="uppercase font-mono">{String(r.priority)} priority</span>
                    <span aria-hidden="true"> · </span>
                    <span>Target: {String(r.target_type)}</span>
                    {Boolean(r.reported_user_name) && (
                      <>
                        <span aria-hidden="true"> · </span>
                        <span>Account: {String(r.reported_user_name)}</span>
                      </>
                    )}
                  </div>
                  <span className="font-semibold capitalize text-[#2563EB]">{String(r.status)}</span>
                </div>

                <p className="text-sm text-slate-700 dark:text-slate-300">{String(r.details)}</p>

                {signals.length > 0 && (
                  <p className="text-xs text-amber-700 dark:text-amber-400">
                    Review signals: {signals.join(' · ')}
                  </p>
                )}

                <input
                  type="text"
                  value={notesMap[id] || ''}
                  onChange={(e) => setNotesMap((prev) => ({ ...prev, [id]: e.target.value }))}
                  placeholder="Moderator resolution notes..."
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs"
                />

                <div className="flex flex-wrap gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => takeAction(id, 'dismiss')}
                    className="rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-1.5 text-xs font-medium"
                  >
                    Dismiss
                  </button>
                  <button
                    type="button"
                    onClick={() => takeAction(id, 'hide_content')}
                    className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white"
                  >
                    Hide Content
                  </button>
                  <button
                    type="button"
                    onClick={() => takeAction(id, 'warn')}
                    className="rounded-lg bg-[#142B5F] px-3 py-1.5 text-xs font-semibold text-white"
                  >
                    Warn Member
                  </button>
                  <button
                    type="button"
                    onClick={() => takeAction(id, 'suspend_user')}
                    className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white"
                  >
                    Suspend Account
                  </button>
                  <button
                    type="button"
                    onClick={() => takeAction(id, 'escalate')}
                    className="rounded-lg border border-red-300 dark:border-red-900 px-3 py-1.5 text-xs font-medium text-red-600"
                  >
                    Escalate to Admin
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export const AdminConsoleView: React.FC<{ onCountryCreated: () => void }> = ({ onCountryCreated }) => {
  const [tab, setTab] = useState<'overview' | 'users' | 'groups' | 'countries' | 'mentors' | 'support' | 'audit'>('overview');
  const [overview, setOverview] = useState<{
    metrics: Record<string, number>;
    countryDistribution: Array<{ country: string; count: number }>;
    settings: Array<{ key: string; value_json: string }>;
  } | null>(null);
  const [users, setUsers] = useState<Array<Record<string, unknown>>>([]);
  const [mentorApps, setMentorApps] = useState<Array<Record<string, unknown>>>([]);
  const [tickets, setTickets] = useState<Array<Record<string, unknown>>>([]);
  const [auditLogs, setAuditLogs] = useState<Array<Record<string, unknown>>>([]);
  const [feedback, setFeedback] = useState('');

  // Create group form
  const [groupName, setGroupName] = useState('');
  const [groupCategory, setGroupCategory] = useState('Country + Purpose');
  const [groupCountry, setGroupCountry] = useState('germany');
  const [groupPrivacy, setGroupPrivacy] = useState<'public' | 'private'>('public');
  const [groupDesc, setGroupDesc] = useState('');

  // Create country form
  const [countryName, setCountryName] = useState('');
  const [countryRegion, setCountryRegion] = useState('Europe');
  const [countryCode, setCountryCode] = useState('');
  const [countryOverview, setCountryOverview] = useState('');

  const loadOverview = () => apiFetch<typeof overview>('/admin/overview').then(setOverview);

  useEffect(() => {
    if (tab === 'overview') loadOverview();
    else if (tab === 'users') apiFetch<{ users: typeof users }>('/admin/users').then((r) => setUsers(r.users));
    else if (tab === 'mentors') apiFetch<{ applications: typeof mentorApps }>('/admin/mentor-applications').then((r) => setMentorApps(r.applications));
    else if (tab === 'support') apiFetch<{ tickets: typeof tickets }>('/admin/support').then((r) => setTickets(r.tickets));
    else if (tab === 'audit') apiFetch<{ logs: typeof auditLogs }>('/admin/audit-logs').then((r) => setAuditLogs(r.logs));
  }, [tab]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-[#0F172A] dark:text-white">Platform Admin Console</h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
          Privacy-respecting aggregate reporting, RBAC management, group/country governance, and security audit trails.
        </p>
      </div>

      <div className="flex flex-wrap gap-1 rounded-lg bg-slate-100 dark:bg-slate-800 p-1 w-fit">
        {(
          [
            ['overview', 'Overview'],
            ['users', 'Users & Roles'],
            ['groups', 'Groups'],
            ['countries', 'Countries'],
            ['mentors', 'Mentor Verifications'],
            ['support', 'Support & Grievances'],
            ['audit', 'Audit Logs'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
              tab === key ? 'bg-white dark:bg-slate-900 text-[#0F172A] dark:text-white shadow-sm' : 'text-slate-600 dark:text-slate-300'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {feedback && (
        <div className="rounded-lg border border-teal-200 dark:border-teal-900 bg-teal-50 dark:bg-teal-950/30 px-4 py-2 text-xs text-teal-900 dark:text-teal-200">
          {feedback}
        </div>
      )}

      {tab === 'overview' && overview && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              ['Total Members', overview.metrics.totalMembers],
              ['Active Members', overview.metrics.activeMembers],
              ['Communities', overview.metrics.totalGroups],
              ['Posts & Comments', overview.metrics.totalPosts + overview.metrics.totalComments],
              ['Messages (Aggregate)', overview.metrics.totalMessagesCount],
              ['Pending Reports', overview.metrics.pendingReports],
              ['Verification Queue', overview.metrics.pendingVerifications],
              ['Open Support Cases', overview.metrics.openSupport],
            ].map(([label, val]) => (
              <div key={String(label)} className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-4">
                <p className="text-xs text-slate-500 dark:text-slate-400">{label}</p>
                <p className="mt-1 font-mono text-2xl font-bold tabular-nums text-[#0F172A] dark:text-white">{val}</p>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-5">
              <h2 className="font-display text-sm font-semibold text-[#0F172A] dark:text-white mb-3">Target Country Distribution</h2>
              <div className="space-y-2 text-xs">
                {overview.countryDistribution.map((row) => (
                  <div key={row.country} className="flex justify-between py-1 border-b border-slate-100 dark:border-slate-800">
                    <span className="capitalize">{row.country}</span>
                    <span className="font-mono tabular-nums font-semibold">{row.count}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-5">
              <h2 className="font-display text-sm font-semibold text-[#0F172A] dark:text-white mb-3">Platform Feature Flags (Launch Configuration)</h2>
              <div className="space-y-2 text-xs">
                {overview.settings.map((s) => (
                  <div key={s.key} className="flex justify-between py-1.5 border-b border-slate-100 dark:border-slate-800">
                    <span className="font-mono">{s.key}</span>
                    <span className="text-slate-600 dark:text-slate-300">{s.value_json}</span>
                  </div>
                ))}
                <p className="pt-2 text-slate-500">
                  Paid memberships & paid mentorship remain disabled by default at launch; core access is free.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {tab === 'users' && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] overflow-x-auto">
          <table className="w-full text-left text-xs min-w-[680px]">
            <thead className="border-b border-slate-200 dark:border-slate-800 text-slate-500">
              <tr>
                <th className="p-3.5">Member</th>
                <th className="p-3.5">Verification</th>
                <th className="p-3.5">Roles</th>
                <th className="p-3.5">Status</th>
                <th className="p-3.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {users.map((u) => {
                const roles = (u.roles as string[]) || [];
                return (
                  <tr key={String(u.id)}>
                    <td className="p-3.5">
                      <p className="font-semibold text-[#0F172A] dark:text-white">{String(u.display_name)}</p>
                      <p className="text-slate-500">@{String(u.username || '')} · {String(u.city || u.current_country)}</p>
                    </td>
                    <td className="p-3.5">{String(u.verification_badge_label || u.verification_level)}</td>
                    <td className="p-3.5">{roles.join(', ')}</td>
                    <td className="p-3.5 capitalize font-medium">{String(u.status)}</td>
                    <td className="p-3.5 text-right space-x-2">
                      <button
                        type="button"
                        onClick={async () => {
                          const next = u.status === 'active' ? 'suspended' : 'active';
                          await apiFetch(`/admin/users/${u.id}/status`, { method: 'PATCH', body: JSON.stringify({ status: next }) });
                          apiFetch<{ users: typeof users }>('/admin/users').then((r) => setUsers(r.users));
                        }}
                        className="rounded border border-slate-300 dark:border-slate-700 px-2.5 py-1 hover:bg-slate-50 dark:hover:bg-slate-800"
                      >
                        {u.status === 'active' ? 'Suspend' : 'Reinstate'}
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          const hasMod = roles.includes('group_moderator');
                          await apiFetch(`/admin/users/${u.id}/roles`, {
                            method: 'POST',
                            body: JSON.stringify({ role: 'group_moderator', action: hasMod ? 'remove' : 'add' }),
                          });
                          apiFetch<{ users: typeof users }>('/admin/users').then((r) => setUsers(r.users));
                        }}
                        className="rounded border border-slate-300 dark:border-slate-700 px-2.5 py-1 hover:bg-slate-50 dark:hover:bg-slate-800"
                      >
                        {roles.includes('group_moderator') ? 'Remove Mod' : 'Grant Mod'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'groups' && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            await apiFetch('/admin/groups', {
              method: 'POST',
              body: JSON.stringify({
                name: groupName,
                category: groupCategory,
                country_slug: groupCountry || null,
                privacy: groupPrivacy,
                description: groupDesc,
              }),
            });
            setFeedback(`Community group "${groupName}" created.`);
            setGroupName('');
            setGroupDesc('');
          }}
          className="max-w-xl rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-6 space-y-4"
        >
          <h2 className="font-display text-base font-semibold text-[#0F172A] dark:text-white">Create Community Group</h2>
          <input
            type="text"
            required
            value={groupName}
            onChange={(e) => setGroupName(e.target.value)}
            placeholder="Group Name (e.g. Sweden — Master's 2027)"
            className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm"
          />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <select value={groupCategory} onChange={(e) => setGroupCategory(e.target.value)} className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs">
              <option>Country + Purpose</option>
              <option>City</option>
              <option>University</option>
              <option>Timeline</option>
              <option>Interest</option>
            </select>
            <input
              type="text"
              value={groupCountry}
              onChange={(e) => setGroupCountry(e.target.value)}
              placeholder="Country slug (e.g. germany)"
              className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs"
            />
            <select value={groupPrivacy} onChange={(e) => setGroupPrivacy(e.target.value as 'public' | 'private')} className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs">
              <option value="public">Public</option>
              <option value="private">Private</option>
            </select>
          </div>
          <textarea
            required
            rows={3}
            value={groupDesc}
            onChange={(e) => setGroupDesc(e.target.value)}
            placeholder="Group description and purpose..."
            className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm"
          />
          <button type="submit" className="rounded-lg bg-[#142B5F] dark:bg-[#2563EB] px-4 py-2 text-xs font-semibold text-white">
            Create Group
          </button>
        </form>
      )}

      {tab === 'countries' && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            await apiFetch('/admin/countries', {
              method: 'POST',
              body: JSON.stringify({
                name: countryName,
                region: countryRegion,
                flag_code: countryCode,
                overview: countryOverview,
              }),
            });
            setFeedback(`Country hub "${countryName}" added without code changes.`);
            setCountryName('');
            setCountryCode('');
            setCountryOverview('');
            onCountryCreated();
          }}
          className="max-w-xl rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-6 space-y-4"
        >
          <h2 className="font-display text-base font-semibold text-[#0F172A] dark:text-white">Add Destination Country Hub</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <input
              type="text"
              required
              value={countryName}
              onChange={(e) => setCountryName(e.target.value)}
              placeholder="Country Name (e.g. Denmark)"
              className="sm:col-span-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm"
            />
            <input
              type="text"
              required
              maxLength={3}
              value={countryCode}
              onChange={(e) => setCountryCode(e.target.value)}
              placeholder="Code (DK)"
              className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm uppercase"
            />
          </div>
          <select value={countryRegion} onChange={(e) => setCountryRegion(e.target.value)} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm">
            <option>Europe</option>
            <option>Asia</option>
            <option>North America</option>
            <option>Oceania</option>
            <option>Middle East</option>
          </select>
          <textarea
            required
            rows={3}
            value={countryOverview}
            onChange={(e) => setCountryOverview(e.target.value)}
            placeholder="Country overview..."
            className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm"
          />
          <button type="submit" className="rounded-lg bg-[#142B5F] dark:bg-[#2563EB] px-4 py-2 text-xs font-semibold text-white">
            Publish Country Hub
          </button>
        </form>
      )}

      {tab === 'mentors' && (
        <div className="space-y-3">
          {mentorApps.length === 0 ? (
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-6 text-sm text-slate-500">
              No mentor verification applications submitted yet.
            </div>
          ) : (
            mentorApps.map((ma) => (
              <div key={String(ma.id)} className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-5 space-y-2">
                <div className="flex justify-between text-xs">
                  <span className="font-semibold text-[#0F172A] dark:text-white">
                    {String(ma.display_name)} · {String(ma.mentor_type)} · {String(ma.current_city)}, {String(ma.current_country)}
                  </span>
                  <span className="capitalize font-medium text-[#2563EB]">{String(ma.status)}</span>
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-300">{String(ma.evidence_summary)}</p>
                {ma.status === 'pending' && (
                  <div className="flex gap-2 pt-2">
                    <button
                      type="button"
                      onClick={async () => {
                        await apiFetch(`/admin/mentor-applications/${ma.id}/review`, {
                          method: 'POST',
                          body: JSON.stringify({ decision: 'approved' }),
                        });
                        apiFetch<{ applications: typeof mentorApps }>('/admin/mentor-applications').then((r) => setMentorApps(r.applications));
                      }}
                      className="rounded-lg bg-[#0D9488] px-3 py-1.5 text-xs font-semibold text-white"
                    >
                      Approve Verification
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        await apiFetch(`/admin/mentor-applications/${ma.id}/review`, {
                          method: 'POST',
                          body: JSON.stringify({ decision: 'rejected' }),
                        });
                        apiFetch<{ applications: typeof mentorApps }>('/admin/mentor-applications').then((r) => setMentorApps(r.applications));
                      }}
                      className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium"
                    >
                      Reject
                    </button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {tab === 'support' && (
        <div className="space-y-3">
          {tickets.length === 0 ? (
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-6 text-sm text-slate-500">
              No open support or grievance tickets.
            </div>
          ) : (
            tickets.map((tk) => (
              <div key={String(tk.id)} className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-5 text-xs space-y-1.5">
                <div className="flex justify-between">
                  <span className="font-semibold text-sm text-[#0F172A] dark:text-white">{String(tk.subject)}</span>
                  <span className="capitalize text-[#2563EB]">{String(tk.status)}</span>
                </div>
                <p className="text-slate-500">{String(tk.email)} · Category: {String(tk.category)}</p>
                <p className="text-slate-700 dark:text-slate-300">{String(tk.description)}</p>
              </div>
            ))
          )}
        </div>
      )}

      {tab === 'audit' && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] divide-y divide-slate-100 dark:divide-slate-800">
          {auditLogs.map((l) => (
            <div key={String(l.id)} className="p-3.5 text-xs flex flex-wrap justify-between gap-2">
              <div>
                <span className="font-mono font-semibold text-[#142B5F] dark:text-blue-300">{String(l.action)}</span>
                <span className="text-slate-500"> · Actor: {String(l.actor_name || l.actor_id || 'System')} · Target: {String(l.target_type)}</span>
              </div>
              <span className="font-mono text-slate-400">{new Date(String(l.created_at)).toLocaleString()}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
