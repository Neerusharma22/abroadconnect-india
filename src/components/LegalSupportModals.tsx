import React, { useEffect, useState } from 'react';
import { Download, ShieldAlert, Trash2, X } from 'lucide-react';
import { apiFetch } from '../api';
import type { Country, LanguageCode, User } from '../types';

interface ReportModalProps {
  target: { targetType: string; targetId: string; reportedUserId?: string; groupId?: string };
  onClose: () => void;
  onSubmitted: (msg: string) => void;
}

export const ReportModal: React.FC<ReportModalProps> = ({ target, onClose, onSubmitted }) => {
  const [category, setCategory] = useState('Scam');
  const [details, setDetails] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await apiFetch<{ message: string }>('/reports', {
        method: 'POST',
        body: JSON.stringify({
          target_type: target.targetType,
          target_id: target.targetId,
          reported_user_id: target.reportedUserId,
          group_id: target.groupId,
          category,
          details,
        }),
      });
      onSubmitted(res.message);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to submit report.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true">
      <form onSubmit={handleSubmit} className="w-full max-w-md rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-bold text-[#0F172A] dark:text-white">Submit Safety Report</h2>
          <button type="button" onClick={onClose} aria-label="Close">
            <X className="w-5 h-5 text-slate-400" />
          </button>
        </div>

        {error && <p className="text-xs text-red-600">{error}</p>}

        <div>
          <label className="block text-xs font-medium text-slate-700 dark:text-slate-200 mb-1">Report Category</label>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm"
          >
            <option>Spam</option>
            <option>Scam</option>
            <option>Fake recruitment</option>
            <option>Impersonation</option>
            <option>Harassment</option>
            <option>Hate or abuse</option>
            <option>Privacy violation</option>
            <option>Inappropriate content</option>
            <option>Misleading information</option>
            <option>Other</option>
          </select>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-700 dark:text-slate-200 mb-1">Details & Context</label>
          <textarea
            required
            rows={4}
            value={details}
            onChange={(e) => setDetails(e.target.value)}
            placeholder="Describe what happened (e.g. asked for upfront payment or passport scan)..."
            className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm"
          />
        </div>

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border px-3 py-2 text-xs">
            Cancel
          </button>
          <button type="submit" disabled={loading} className="rounded-lg bg-red-600 px-4 py-2 text-xs font-semibold text-white">
            {loading ? 'Submitting...' : 'Submit Report'}
          </button>
        </div>
      </form>
    </div>
  );
};

export const LegalAndSupportView: React.FC<{ initialSection?: string; userEmail?: string | null }> = ({
  initialSection = 'about',
  userEmail,
}) => {
  const [section, setSection] = useState(initialSection);
  const [email, setEmail] = useState(userEmail || '');
  const [subject, setSubject] = useState('');
  const [category, setCategory] = useState('support');
  const [description, setDescription] = useState('');
  const [ticketFeedback, setTicketFeedback] = useState('');

  useEffect(() => {
    setSection(initialSection);
  }, [initialSection]);

  const handleSubmitTicket = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await apiFetch<{ message: string }>('/support', {
      method: 'POST',
      body: JSON.stringify({ email, subject, category, description }),
    });
    setTicketFeedback(res.message);
    setSubject('');
    setDescription('');
  };

  const tabs = [
    ['about', 'About Platform'],
    ['guidelines', 'Community Guidelines'],
    ['privacy', 'Privacy Policy (DPDP)'],
    ['terms', 'Terms of Service'],
    ['refunds', 'Refund & Cancellation'],
    ['grievance', 'Grievance Redressal'],
    ['support', 'Contact & Support'],
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-[#0F172A] dark:text-white">Help, Safety & Legal Center</h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
          Transparent policies, anti-scam standards, DPDP privacy rights, and grievance redressal.
        </p>
      </div>

      <div className="flex flex-wrap gap-1 rounded-lg bg-slate-100 dark:bg-slate-800 p-1 w-fit">
        {tabs.map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setSection(key)}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
              section === key ? 'bg-white dark:bg-slate-900 text-[#0F172A] dark:text-white shadow-sm' : 'text-slate-600 dark:text-slate-300'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-6 sm:p-8 space-y-4 text-sm text-slate-700 dark:text-slate-300 leading-relaxed">
        {section === 'about' && (
          <>
            <h2 className="font-display text-lg font-bold text-[#0F172A] dark:text-white">About AbroadConnect India</h2>
            <p>
              AbroadConnect India connects Indian students, graduates, skilled professionals, apprentices, and verified mentors worldwide across 17 destination hubs. Our mission is to replace fragmented consultant hype with free, structured peer guidance and sourced official portals.
            </p>
            <p>
              <strong>Non-Guarantee Principle:</strong> AbroadConnect India is an informational and community platform. We never guarantee visas, university admissions, scholarships, or overseas job offers.
            </p>
          </>
        )}

        {section === 'guidelines' && (
          <>
            <h2 className="font-display text-lg font-bold text-[#0F172A] dark:text-white">Community & Anti-Scam Guidelines</h2>
            <ul className="list-disc pl-5 space-y-2">
              <li>No guaranteed visa, guaranteed job, or pay-before-interview recruitment solicitations.</li>
              <li>Never post or share passport scans, Aadhaar, PAN, bank statements, or personal phone numbers publicly.</li>
              <li>Respect language diversity across English, Hindi, Tamil, and regional communities.</li>
              <li>Cite official government or university URLs when sharing immigration or tuition rules.</li>
            </ul>
          </>
        )}

        {section === 'privacy' && (
          <>
            <h2 className="font-display text-lg font-bold text-[#0F172A] dark:text-white">Privacy Policy & Data Protection (DPDP Framework)</h2>
            <p>
              We collect only the minimum information required to operate community memberships and personalized destination discovery. Sensitive optional fields (academic scores and budget ranges) are private by default and excluded from peer matching and public search.
            </p>
            <p>
              <strong>Your Rights:</strong> Under Settings & Privacy, you may export your personal data in JSON format, revoke active sessions, adjust visibility controls, or permanently delete your account. Messaging is server-authorized via TLS/HTTPS, not marketed as E2EE.
            </p>
          </>
        )}

        {section === 'terms' && (
          <>
            <h2 className="font-display text-lg font-bold text-[#0F172A] dark:text-white">Terms of Service</h2>
            <p>
              Users must provide accurate registration contact details and uphold anti-fraud rules. Verification badges confirm specific reviewed evidence (e.g., email or institution record) and do not constitute an endorsement or outcome guarantee. Underage users require appropriate parental or guardian consent where applicable under Indian law.
            </p>
          </>
        )}

        {section === 'refunds' && (
          <>
            <h2 className="font-display text-lg font-bold text-[#0F172A] dark:text-white">Refund & Cancellation Policy</h2>
            <p>
              AbroadConnect India currently launches with <strong>100% free core community membership</strong> and free mentorship requests. Paid tiers and paid mentor sessions are disabled at launch. Should optional paid services be introduced in future releases, transparent pricing, GST receipts, and merchant-gateway refund workflows will be published prior to activation.
            </p>
          </>
        )}

        {section === 'grievance' && (
          <>
            <h2 className="font-display text-lg font-bold text-[#0F172A] dark:text-white">Grievance Redressal & Appeals</h2>
            <p>
              In accordance with applicable Indian intermediary and data protection guidelines, members and affected individuals may submit content takedown requests, impersonation reports, moderation appeals, or privacy grievances directly through our Support & Grievance form.
            </p>
            <p>
              <strong>Grievance Desk Contact:</strong> grievance@abroadconnect.in
            </p>
          </>
        )}

        {section === 'support' && (
          <form onSubmit={handleSubmitTicket} className="space-y-4 max-w-lg">
            <h2 className="font-display text-lg font-bold text-[#0F172A] dark:text-white">Contact Support / Submit Grievance / Appeal</h2>
            {ticketFeedback && (
              <div className="rounded-lg border border-teal-200 dark:border-teal-900 bg-teal-50 dark:bg-teal-950/30 px-4 py-2.5 text-xs text-teal-900 dark:text-teal-200">
                {ticketFeedback}
              </div>
            )}
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Your contact email"
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm"
            />
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm"
            >
              <option value="support">General Support</option>
              <option value="grievance">Safety / DPDP Grievance</option>
              <option value="appeal">Moderation Appeal</option>
              <option value="waitlist">Early-Access / Regional Language Waitlist</option>
            </select>
            <input
              type="text"
              required
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Subject"
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm"
            />
            <textarea
              required
              rows={4}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe your request or grievance..."
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm"
            />
            <button type="submit" className="rounded-lg bg-[#142B5F] dark:bg-[#2563EB] px-5 py-2 text-xs font-semibold text-white">
              Submit Request
            </button>
          </form>
        )}
      </div>
    </div>
  );
};

export const SettingsPrivacyView: React.FC<{
  user: User;
  countries: Country[];
  onUpdated: (user: User) => void;
  onDeleted: () => void;
}> = ({ user, countries, onUpdated, onDeleted }) => {
  const [displayName, setDisplayName] = useState(user.display_name);
  const [city, setCity] = useState(user.city || '');
  const [bio, setBio] = useState(user.bio || '');
  const [destCountry, setDestCountry] = useState(user.profile?.primary_destination_country || 'germany');
  const [purpose, setPurpose] = useState(user.profile?.purpose || 'Study');
  const [intake, setIntake] = useState(user.profile?.intended_intake || 'Winter 2027');
  const [lang, setLang] = useState<LanguageCode>(user.preferred_language || 'en');
  const [visibility, setVisibility] = useState(user.profile?.profile_visibility || 'members');
  const [msgPerm, setMsgPerm] = useState(user.profile?.messaging_permission || 'anyone');
  const [discoverable, setDiscoverable] = useState(Boolean(user.profile?.discoverable_buddy ?? 1));
  const [sessions, setSessions] = useState<Array<{ id: string; user_agent: string; created_at: string; revoked_at: string | null }>>([]);
  const [currentSessionId, setCurrentSessionId] = useState('');
  const [feedback, setFeedback] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  const loadSessions = () => {
    apiFetch<{ sessions: typeof sessions; currentSessionId: string }>('/auth/sessions').then((r) => {
      setSessions(r.sessions);
      setCurrentSessionId(r.currentSessionId);
    });
  };

  useEffect(() => {
    loadSessions();
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await apiFetch<{ user: User }>('/profiles/me', {
      method: 'PUT',
      body: JSON.stringify({
        display_name: displayName,
        city,
        bio,
        preferred_language: lang,
        primary_destination_country: destCountry,
        purpose,
        intended_intake: intake,
        profile_visibility: visibility,
        messaging_permission: msgPerm,
        discoverable_buddy: discoverable,
      }),
    });
    onUpdated(res.user);
    setFeedback('Profile and privacy settings saved.');
  };

  const handleExport = async () => {
    const data = await apiFetch<Record<string, unknown>>('/users/me/export');
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `abroadconnect-data-export-${user.username}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="font-display text-2xl font-bold text-[#0F172A] dark:text-white">Profile, Privacy & Security Settings</h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
          Control who can discover or message you, manage active sessions, or export/delete your DPDP records.
        </p>
      </div>

      {feedback && (
        <div className="rounded-lg border border-teal-200 dark:border-teal-900 bg-teal-50 dark:bg-teal-950/30 px-4 py-2.5 text-xs text-teal-900 dark:text-teal-200">
          {feedback}
        </div>
      )}

      <form onSubmit={handleSave} className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-6 space-y-4">
        <h2 className="font-display text-base font-semibold text-[#0F172A] dark:text-white">Profile & Abroad Goals</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium mb-1">Display Name</label>
            <input type="text" value={displayName} onChange={(e) => setDisplayName(e.target.value)} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">City</label>
            <input type="text" value={city} onChange={(e) => setCity(e.target.value)} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Primary Destination Country</label>
            <select value={destCountry} onChange={(e) => setDestCountry(e.target.value)} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm">
              {countries.map((c) => (
                <option key={c.slug} value={c.slug}>{c.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Purpose & Intake</label>
            <div className="flex gap-2">
              <select value={purpose} onChange={(e) => setPurpose(e.target.value)} className="flex-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-2 text-xs">
                <option value="Study">Study</option>
                <option value="Job">Job</option>
                <option value="Apprenticeship">Apprenticeship</option>
                <option value="Scholarship">Scholarship</option>
              </select>
              <input type="text" value={intake} onChange={(e) => setIntake(e.target.value)} className="flex-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-2 text-xs" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Language</label>
            <select value={lang} onChange={(e) => setLang(e.target.value as LanguageCode)} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm">
              <option value="en">English</option>
              <option value="hi">हिन्दी (Hindi)</option>
              <option value="ta">தமிழ் (Tamil)</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Who can message you</label>
            <select value={msgPerm} onChange={(e) => setMsgPerm(e.target.value as 'anyone' | 'connections_only' | 'none')} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm">
              <option value="anyone">Signed-in members (with request approval)</option>
              <option value="connections_only">Accepted connections only</option>
              <option value="none">Disable incoming direct messages</option>
            </select>
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium mb-1">Short Bio</label>
          <textarea rows={2} value={bio} onChange={(e) => setBio(e.target.value)} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm" />
        </div>
        <label className="flex items-center gap-2 text-xs cursor-pointer">
          <input type="checkbox" checked={discoverable} onChange={(e) => setDiscoverable(e.target.checked)} />
          <span>Allow consenting peers with similar goals to discover me in Find My Abroad Buddy</span>
        </label>
        <button type="submit" className="rounded-lg bg-[#142B5F] dark:bg-[#2563EB] px-4 py-2 text-xs font-semibold text-white">
          Save Preferences
        </button>
      </form>

      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-6 space-y-3">
        <h2 className="font-display text-base font-semibold text-[#0F172A] dark:text-white">Active Sessions & Security</h2>
        <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
          {sessions.map((s) => (
            <div key={s.id} className="py-2.5 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium truncate">
                  {s.user_agent || 'Browser Session'} {s.id === currentSessionId && <span className="text-[#0D9488]">· Current</span>}
                </p>
                <p className="text-slate-400">Started {new Date(s.created_at).toLocaleString()}</p>
              </div>
              {!s.revoked_at && s.id !== currentSessionId ? (
                <button
                  type="button"
                  onClick={async () => {
                    await apiFetch(`/auth/sessions/${s.id}`, { method: 'DELETE' });
                    loadSessions();
                  }}
                  className="text-red-600 hover:underline shrink-0"
                >
                  Revoke
                </button>
              ) : (
                <span className="text-slate-400">{s.revoked_at ? 'Revoked' : 'Active'}</span>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-base font-semibold text-[#0F172A] dark:text-white">DPDP Data Rights</h2>
          <p className="text-xs text-slate-500 mt-0.5">Download a portable JSON archive or permanently erase your account.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handleExport}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 px-3.5 py-2 text-xs font-medium"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export My Data</span>
          </button>
          {!confirmDelete ? (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-red-300 dark:border-red-900 px-3.5 py-2 text-xs font-medium text-red-600"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Delete Account</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={async () => {
                await apiFetch('/users/me', { method: 'DELETE' });
                onDeleted();
              }}
              className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3.5 py-2 text-xs font-semibold text-white"
            >
              <ShieldAlert className="w-3.5 h-3.5" />
              <span>Confirm Permanent Deletion</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
