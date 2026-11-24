import React, { useEffect, useState } from 'react';
import { Award, Check, Flag, MessageSquare, UserPlus, Users } from 'lucide-react';
import { apiFetch } from '../api';
import type { Country } from '../types';

interface DiscoverPeopleProps {
  countries: Country[];
  onOpenDirectChat: (conversationId: string) => void;
  onReportTarget: (targetType: string, targetId: string, reportedUserId?: string) => void;
}

interface BuddyPerson {
  id: string;
  display_name: string;
  username: string;
  bio: string;
  city: string;
  current_country: string;
  verification_badge_label: string;
  highest_qualification: string;
  degree_specialization: string;
  primary_destination_country: string;
  purpose: string;
  intended_intake: string;
  application_stage: string;
  connection_status: string;
  match_explanation: string;
}

export const DiscoverPeopleView: React.FC<DiscoverPeopleProps> = ({ countries, onOpenDirectChat, onReportTarget }) => {
  const [people, setPeople] = useState<BuddyPerson[]>([]);
  const [countryFilter, setCountryFilter] = useState('all');
  const [purposeFilter, setPurposeFilter] = useState('all');
  const [buddyOnly, setBuddyOnly] = useState(true);
  const [feedback, setFeedback] = useState('');

  const loadPeople = async () => {
    const res = await apiFetch<{ people: BuddyPerson[] }>(
      `/people/discover?country=${encodeURIComponent(countryFilter)}&purpose=${encodeURIComponent(purposeFilter)}&buddy=${buddyOnly ? '1' : '0'}`
    );
    setPeople(res.people);
  };

  useEffect(() => {
    loadPeople();
  }, [countryFilter, purposeFilter, buddyOnly]);

  const handleConnect = async (userId: string) => {
    await apiFetch('/connections/request', {
      method: 'POST',
      body: JSON.stringify({ user_id: userId }),
    });
    setFeedback('Connection request sent.');
    await loadPeople();
  };

  const handleRespond = async (requesterId: string, decision: 'accepted' | 'declined') => {
    await apiFetch(`/connections/${requesterId}/respond`, {
      method: 'POST',
      body: JSON.stringify({ decision }),
    });
    await loadPeople();
  };

  const handleStartMessage = async (userId: string) => {
    try {
      const res = await apiFetch<{ conversationId: string }>('/conversations/direct', {
        method: 'POST',
        body: JSON.stringify({ user_id: userId }),
      });
      onOpenDirectChat(res.conversationId);
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Unable to start conversation.');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-[#0F172A] dark:text-white">Discover People & Find My Abroad Buddy</h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
            Transparent rule-based peer matching among consenting members. Private budgets, grades, and phone numbers are never shared.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={countryFilter}
            onChange={(e) => setCountryFilter(e.target.value)}
            className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs font-medium"
          >
            <option value="all">All Target Countries</option>
            {countries.map((c) => (
              <option key={c.slug} value={c.slug}>
                {c.name}
              </option>
            ))}
          </select>

          <select
            value={purposeFilter}
            onChange={(e) => setPurposeFilter(e.target.value)}
            className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs font-medium"
          >
            <option value="all">All Purposes</option>
            <option value="Study">Study</option>
            <option value="Job">Job</option>
            <option value="Apprenticeship">Apprenticeship</option>
            <option value="Scholarship">Scholarship</option>
          </select>

          <button
            type="button"
            onClick={() => setBuddyOnly((b) => !b)}
            className={`rounded-lg border px-3 py-2 text-xs font-medium ${
              buddyOnly
                ? 'border-[#2563EB] bg-blue-50 dark:bg-blue-950/40 text-[#2563EB] dark:text-blue-300'
                : 'border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300'
            }`}
          >
            Buddy Match Ranking: {buddyOnly ? 'On' : 'Off'}
          </button>
        </div>
      </div>

      {feedback && (
        <div className="rounded-lg border border-blue-200 dark:border-blue-900 bg-blue-50 dark:bg-blue-950/30 px-4 py-2.5 text-xs text-blue-900 dark:text-blue-200">
          {feedback}
        </div>
      )}

      {people.length === 0 ? (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-8 text-center text-sm text-slate-500">
          No consenting peers match those filters yet. Try expanding your country or purpose filter.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {people.map((p) => (
            <div
              key={p.id}
              className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-5 flex flex-col justify-between space-y-4"
            >
              <div>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="font-display text-base font-semibold text-[#0F172A] dark:text-white">{p.display_name}</h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {p.city || p.current_country}
                      {p.verification_badge_label && ` · ${p.verification_badge_label}`}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => onReportTarget('user', p.id, p.id)}
                    aria-label="Report member"
                    className="p-1.5 text-slate-400 hover:text-amber-600"
                  >
                    <Flag className="w-3.5 h-3.5" />
                  </button>
                </div>

                <p className="mt-2.5 text-xs font-medium text-[#0D9488] dark:text-teal-400">{p.match_explanation}</p>
                <p className="mt-2 text-sm text-slate-600 dark:text-slate-300 line-clamp-2">{p.bio || `${p.highest_qualification} · ${p.degree_specialization}`}</p>
                <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                  Target: <span className="capitalize font-medium">{p.primary_destination_country || 'Undecided'}</span> · {p.purpose || 'General'} · {p.intended_intake || 'Flexible'} · Stage: {p.application_stage}
                </p>
              </div>

              <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-center gap-2">
                {p.connection_status === 'none' && (
                  <button
                    type="button"
                    onClick={() => handleConnect(p.id)}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-[#142B5F] dark:bg-[#2563EB] px-3 py-1.5 text-xs font-semibold text-white"
                  >
                    <UserPlus className="w-3.5 h-3.5" />
                    <span>Connect</span>
                  </button>
                )}
                {p.connection_status === 'pending' && (
                  <span className="text-xs font-medium text-slate-500">Request Sent</span>
                )}
                {p.connection_status === 'incoming_pending' && (
                  <button
                    type="button"
                    onClick={() => handleRespond(p.id, 'accepted')}
                    className="inline-flex items-center gap-1 rounded-lg bg-[#0D9488] px-3 py-1.5 text-xs font-semibold text-white"
                  >
                    <Check className="w-3.5 h-3.5" />
                    <span>Accept Request</span>
                  </button>
                )}
                {p.connection_status === 'accepted' && (
                  <span className="text-xs font-semibold text-[#0D9488] dark:text-teal-400">Connected</span>
                )}

                <button
                  type="button"
                  onClick={() => handleStartMessage(p.id)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 ml-auto"
                >
                  <MessageSquare className="w-3.5 h-3.5" />
                  <span>Message</span>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

interface MentorsViewProps {
  onReportTarget: (targetType: string, targetId: string, reportedUserId?: string) => void;
}

interface MentorItem {
  id: string;
  user_id: string;
  display_name: string;
  mentor_type: string;
  current_country: string;
  current_city: string;
  institution_or_employer: string;
  expertise_json: string;
  languages_json: string;
  years_experience: number;
  bio: string;
  availability_slots_json: string;
  verification_badge_label: string;
}

export const MentorsView: React.FC<MentorsViewProps> = ({ onReportTarget }) => {
  const [mentors, setMentors] = useState<MentorItem[]>([]);
  const [mySessions, setMySessions] = useState<Array<{ id: string; mentor_name: string; topic: string; scheduled_slot: string; status: string }>>([]);
  const [requestMentor, setRequestMentor] = useState<MentorItem | null>(null);
  const [topic, setTopic] = useState('');
  const [slot, setSlot] = useState('');
  const [question, setQuestion] = useState('');
  const [showApply, setShowApply] = useState(false);
  const [applyType, setApplyType] = useState('International Student');
  const [applyCountry, setApplyCountry] = useState('Germany');
  const [applyCity, setApplyCity] = useState('');
  const [applyInst, setApplyInst] = useState('');
  const [applyEvidence, setApplyEvidence] = useState('');
  const [feedback, setFeedback] = useState('');

  const loadData = async () => {
    const [mRes, sRes] = await Promise.all([
      apiFetch<{ mentors: MentorItem[] }>('/mentors'),
      apiFetch<{ sessions: typeof mySessions }>('/mentors/sessions/me'),
    ]);
    setMentors(mRes.mentors);
    setMySessions(sRes.sessions);
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleRequestSession = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!requestMentor) return;
    await apiFetch(`/mentors/${requestMentor.id}/sessions`, {
      method: 'POST',
      body: JSON.stringify({ topic, scheduled_slot: slot || 'Weekend IST', question }),
    });
    setFeedback(`Free mentorship request sent to ${requestMentor.display_name}.`);
    setRequestMentor(null);
    setTopic('');
    setQuestion('');
    await loadData();
  };

  const handleApplyMentor = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await apiFetch<{ message: string }>('/mentors/apply', {
      method: 'POST',
      body: JSON.stringify({
        mentor_type: applyType,
        current_country: applyCountry,
        current_city: applyCity,
        institution_or_employer: applyInst,
        evidence_summary: applyEvidence,
      }),
    });
    setFeedback(res.message);
    setShowApply(false);
    setApplyEvidence('');
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-[#0F172A] dark:text-white">Verified Mentors</h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
            Free community mentorship. Verification confirms evidence was reviewed—it never guarantees admission or visa outcomes.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowApply((v) => !v)}
          className="rounded-lg bg-[#142B5F] dark:bg-[#2563EB] px-4 py-2 text-xs font-semibold text-white whitespace-nowrap shrink-0"
        >
          Apply as Verified Mentor
        </button>
      </div>

      {feedback && (
        <div className="rounded-lg border border-teal-200 dark:border-teal-900 bg-teal-50 dark:bg-teal-950/30 px-4 py-2.5 text-xs text-teal-900 dark:text-teal-200">
          {feedback}
        </div>
      )}

      {showApply && (
        <form onSubmit={handleApplyMentor} className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-6 space-y-4">
          <h2 className="font-display text-base font-semibold text-[#0F172A] dark:text-white">Mentor Verification Application (Private Review)</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <select
              value={applyType}
              onChange={(e) => setApplyType(e.target.value)}
              className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm"
            >
              <option>International Student</option>
              <option>Alumni</option>
              <option>Working Professional</option>
              <option>Apprenticeship Participant</option>
              <option>Scholarship Recipient</option>
            </select>
            <input
              type="text"
              required
              value={applyCountry}
              onChange={(e) => setApplyCountry(e.target.value)}
              placeholder="Current Country"
              className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm"
            />
            <input
              type="text"
              required
              value={applyCity}
              onChange={(e) => setApplyCity(e.target.value)}
              placeholder="Current City"
              className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm"
            />
            <input
              type="text"
              value={applyInst}
              onChange={(e) => setApplyInst(e.target.value)}
              placeholder="University or Employer (Optional)"
              className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm"
            />
          </div>
          <textarea
            required
            rows={3}
            value={applyEvidence}
            onChange={(e) => setApplyEvidence(e.target.value)}
            placeholder="Summarize your relevant abroad experience and what verification evidence (e.g. university email, alumni record) you can provide to reviewers..."
            className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm"
          />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setShowApply(false)} className="rounded-lg border px-3 py-1.5 text-xs">
              Cancel
            </button>
            <button type="submit" className="rounded-lg bg-[#2563EB] px-4 py-1.5 text-xs font-semibold text-white">
              Submit for Review
            </button>
          </div>
        </form>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {mentors.map((m) => {
          const expertise = (() => {
            try {
              return (JSON.parse(m.expertise_json) as string[]).join(' · ');
            } catch {
              return '';
            }
          })();
          const slots = (() => {
            try {
              return JSON.parse(m.availability_slots_json) as string[];
            } catch {
              return [];
            }
          })();
          return (
            <div key={m.id} className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-5 flex flex-col justify-between space-y-4">
              <div>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-xs text-[#0D9488] dark:text-teal-400 font-medium">
                      {m.mentor_type} · {m.verification_badge_label || 'Evidence Reviewed'}
                    </p>
                    <h2 className="mt-1 font-display text-lg font-semibold text-[#0F172A] dark:text-white">{m.display_name}</h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {m.current_city}, {m.current_country} {m.institution_or_employer && `· ${m.institution_or_employer}`}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => onReportTarget('mentor', m.id, m.user_id)}
                    aria-label="Report mentor"
                    className="p-1.5 text-slate-400 hover:text-amber-600"
                  >
                    <Flag className="w-3.5 h-3.5" />
                  </button>
                </div>
                <p className="mt-3 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">{m.bio}</p>
                {expertise && <p className="mt-2.5 text-xs text-slate-500 dark:text-slate-400">Topics: {expertise}</p>}
              </div>
              <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2">
                <span className="text-xs text-slate-500">Free Session · {slots[0] || 'Flexible'}</span>
                <button
                  type="button"
                  onClick={() => {
                    setRequestMentor(m);
                    setSlot(slots[0] || 'Weekend IST');
                  }}
                  className="rounded-lg bg-[#142B5F] dark:bg-[#2563EB] px-3.5 py-1.5 text-xs font-semibold text-white"
                >
                  Request Mentorship
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {mySessions.length > 0 && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-5">
          <h2 className="font-display text-base font-semibold text-[#0F172A] dark:text-white mb-3">My Mentorship Sessions</h2>
          <div className="divide-y divide-slate-100 dark:divide-slate-800 text-sm">
            {mySessions.map((s) => (
              <div key={s.id} className="py-2.5 flex items-center justify-between">
                <div>
                  <p className="font-medium text-slate-900 dark:text-white">{s.topic}</p>
                  <p className="text-xs text-slate-500">
                    Mentor: {s.mentor_name} · {s.scheduled_slot}
                  </p>
                </div>
                <span className="text-xs font-medium capitalize text-[#2563EB]">{s.status}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {requestMentor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true">
          <form
            onSubmit={handleRequestSession}
            className="w-full max-w-md rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-6 space-y-4"
          >
            <h3 className="font-display text-lg font-bold text-[#0F172A] dark:text-white">
              Request Free Session with {requestMentor.display_name}
            </h3>
            <input
              type="text"
              required
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="Topic (e.g. APS India + TUM Informatics SOP structure)"
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm"
            />
            <input
              type="text"
              required
              value={slot}
              onChange={(e) => setSlot(e.target.value)}
              placeholder="Preferred Time Slot"
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm"
            />
            <textarea
              required
              rows={3}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Share your background and specific questions..."
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm"
            />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setRequestMentor(null)} className="rounded-lg border px-3 py-2 text-xs">
                Cancel
              </button>
              <button type="submit" className="rounded-lg bg-[#2563EB] px-4 py-2 text-xs font-semibold text-white">
                Send Request
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
