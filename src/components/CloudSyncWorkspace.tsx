import React, { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, Cloud, Mic, Plus, Square, Trash2 } from 'lucide-react';
import { getInMemoryToken } from '../api';
import { useFirebase, type JourneyChecklistItem } from '../contexts/FirebaseContext';
import type { Country } from '../types';

interface SqlApplicationRow {
  id: number;
  institutionName: string;
  countrySlug: string;
  programTitle: string;
  intake: string;
  status: string;
  deadlineDate: string;
  notes: string;
}

interface SqlNoteRow {
  id: number;
  title: string;
  category: string;
  content: string;
  countrySlug: string;
}

export const CloudSyncWorkspace: React.FC<{ countries: Country[] }> = ({ countries }) => {
  const {
    firebaseUser,
    firebaseIdToken,
    checklistItems,
    signInWithGoogle,
    refreshIdToken,
    addChecklistItem,
    updateChecklistStatus,
    deleteChecklistItem,
  } = useFirebase();

  const [applications, setApplications] = useState<SqlApplicationRow[]>([]);
  const [notes, setNotes] = useState<SqlNoteRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Form states
  const [instName, setInstName] = useState('');
  const [programTitle, setProgramTitle] = useState('');
  const [appCountry, setAppCountry] = useState('germany');
  const [appDeadline, setAppDeadline] = useState('');

  const [noteTitle, setNoteTitle] = useState('');
  const [noteContent, setNoteContent] = useState('');
  const [noteCountry, setNoteCountry] = useState('germany');
  const [recordingNote, setRecordingNote] = useState(false);
  const [transcribingNote, setTranscribingNote] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);

  const [checkTitle, setCheckTitle] = useState('');
  const [checkCat, setCheckCat] = useState<JourneyChecklistItem['category']>('Documents');
  const [checkNotes, setCheckNotes] = useState('');

  const sqlFetch = useCallback(
    async <T,>(path: string, options: RequestInit = {}): Promise<T> => {
      const token = firebaseIdToken || (await refreshIdToken());
      if (!token) {
        throw new Error('Sign in with Google to access synced applications and notes.');
      }
      const headers = new Headers(options.headers || {});
      headers.set('Authorization', `Bearer ${token}`);
      headers.set('X-Requested-With', 'AbroadConnect');
      if (options.body && !headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/json');
      }
      const res = await fetch(`/api/v1${path}`, { ...options, headers, credentials: 'include' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof data.error === 'string' ? data.error : 'Request failed');
      }
      return data as T;
    },
    [firebaseIdToken, refreshIdToken]
  );

  const loadCloudRecords = useCallback(async () => {
    if (!firebaseUser) return;
    setLoading(true);
    setError('');
    try {
      const [appsRes, notesRes] = await Promise.all([
        sqlFetch<{ applications: SqlApplicationRow[] }>('/sql/applications'),
        sqlFetch<{ notes: SqlNoteRow[] }>('/sql/notes'),
      ]);
      setApplications(appsRes.applications || []);
      setNotes(notesRes.notes || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load saved records.');
    } finally {
      setLoading(false);
    }
  }, [firebaseUser, sqlFetch]);

  useEffect(() => {
    if (firebaseUser) {
      void loadCloudRecords();
    }
  }, [firebaseUser, loadCloudRecords]);

  const handleAddApplication = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await sqlFetch('/sql/applications', {
        method: 'POST',
        body: JSON.stringify({
          institutionName: instName,
          countrySlug: appCountry,
          programTitle,
          deadlineDate: appDeadline,
        }),
      });
      setInstName('');
      setProgramTitle('');
      setAppDeadline('');
      await loadCloudRecords();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save application.');
    }
  };

  const handleAddNote = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await sqlFetch('/sql/notes', {
        method: 'POST',
        body: JSON.stringify({
          title: noteTitle,
          content: noteContent,
          countrySlug: noteCountry,
        }),
      });
      setNoteTitle('');
      setNoteContent('');
      await loadCloudRecords();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save note.');
    }
  };

  const handleVoiceDictateNote = async () => {
    setError('');
    if (recordingNote && recorderRef.current) {
      recorderRef.current.stop();
      setRecordingNote(false);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (ev) => {
        if (ev.data.size > 0) chunksRef.current.push(ev.data);
      };
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const mimeType = rec.mimeType || 'audio/webm';
        const blob = new Blob(chunksRef.current, { type: mimeType });
        if (blob.size < 256) return;
        setTranscribingNote(true);
        try {
          const base64 = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => {
              const str = String(reader.result || '');
              const idx = str.indexOf(',');
              resolve(idx >= 0 ? str.slice(idx + 1) : str);
            };
            reader.onerror = () => reject(new Error('Audio read error'));
            reader.readAsDataURL(blob);
          });
          const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            'X-Requested-With': 'AbroadConnect',
          };
          const tok = getInMemoryToken();
          if (tok) headers.Authorization = `Bearer ${tok}`;
          const res = await fetch('/api/v1/ai/transcribe', {
            method: 'POST',
            headers,
            credentials: 'include',
            body: JSON.stringify({ audioBase64: base64, mimeType }),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.error || 'Transcription error');
          if (data.transcript) {
            setNoteContent((prev) => (prev ? `${prev} ${data.transcript}` : data.transcript));
          }
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Unable to transcribe audio memo.');
        } finally {
          setTranscribingNote(false);
        }
      };
      recorderRef.current = rec;
      rec.start();
      setRecordingNote(true);
    } catch {
      setError('Microphone permission is required for voice notes.');
    }
  };

  if (!firebaseUser) {
    return (
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-8 max-w-2xl space-y-4">
        <div className="flex items-center gap-2 text-[#2563EB]">
          <Cloud className="w-6 h-6" />
          <h1 className="font-display text-xl font-bold text-[#0F172A] dark:text-white">
            Cloud Synced Applications & Checklist
          </h1>
        </div>
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Connect your Google account to save university applications, voice-dictated study notes, and your cross-device preparation checklist securely.
        </p>
        {error && <p className="text-xs text-red-600">{error}</p>}
        <button
          type="button"
          onClick={() =>
            void signInWithGoogle().catch((err) =>
              setError(err instanceof Error ? err.message : 'Google Sign-In failed.')
            )
          }
          className="rounded-lg bg-[#142B5F] hover:bg-[#1e3f8a] dark:bg-[#2563EB] px-5 py-2.5 text-sm font-semibold text-white"
        >
          Continue with Google
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-[#0F172A] dark:text-white">
          Cloud Applications, Study Notes & Checklist
        </h1>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Private workspace synced for {firebaseUser.email}
        </p>
      </div>

      {error && (
        <div role="alert" className="rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 px-4 py-2.5 text-xs text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Applications Tracker */}
        <div className="lg:col-span-7 space-y-4">
          <form
            onSubmit={handleAddApplication}
            className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-5 space-y-3"
          >
            <h2 className="font-display text-base font-semibold text-[#0F172A] dark:text-white">
              Add Target Application
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input
                type="text"
                required
                value={instName}
                onChange={(e) => setInstName(e.target.value)}
                placeholder="University or Employer (e.g. TU Munich)"
                className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs"
              />
              <input
                type="text"
                required
                value={programTitle}
                onChange={(e) => setProgramTitle(e.target.value)}
                placeholder="Program / Role (e.g. MSc Data Science)"
                className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs"
              />
              <select
                value={appCountry}
                onChange={(e) => setAppCountry(e.target.value)}
                className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs"
              >
                {countries.map((c) => (
                  <option key={c.slug} value={c.slug}>
                    {c.name}
                  </option>
                ))}
              </select>
              <input
                type="text"
                value={appDeadline}
                onChange={(e) => setAppDeadline(e.target.value)}
                placeholder="Deadline (e.g. 2027-05-31)"
                className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs"
              />
            </div>
            <button
              type="submit"
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#142B5F] dark:bg-[#2563EB] px-4 py-2 text-xs font-semibold text-white"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Save Application</span>
            </button>
          </form>

          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] divide-y divide-slate-100 dark:divide-slate-800">
            <div className="p-4 flex items-center justify-between">
              <h3 className="font-display text-sm font-semibold">Saved Applications ({applications.length})</h3>
              {loading && <span className="text-xs text-slate-400">Loading...</span>}
            </div>
            {applications.length === 0 ? (
              <p className="p-4 text-xs text-slate-500">No saved applications yet.</p>
            ) : (
              applications.map((app) => (
                <div key={app.id} className="p-4 flex flex-wrap items-center justify-between gap-3 text-xs">
                  <div>
                    <p className="font-semibold text-sm text-[#0F172A] dark:text-white">{app.institutionName}</p>
                    <p className="text-slate-500">
                      {app.programTitle} · <span className="capitalize">{app.countrySlug}</span>
                      {app.deadlineDate ? ` · Due ${app.deadlineDate}` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <select
                      aria-label={`Status for ${app.institutionName}`}
                      value={app.status}
                      onChange={async (e) => {
                        await sqlFetch(`/sql/applications/${app.id}`, {
                          method: 'PATCH',
                          body: JSON.stringify({ status: e.target.value }),
                        });
                        await loadCloudRecords();
                      }}
                      className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1 text-xs"
                    >
                      <option value="researching">Researching</option>
                      <option value="preparing">Preparing</option>
                      <option value="submitted">Submitted</option>
                      <option value="offer_received">Offer Received</option>
                      <option value="visa_stage">Visa Stage</option>
                    </select>
                    <button
                      type="button"
                      onClick={async () => {
                        await sqlFetch(`/sql/applications/${app.id}`, { method: 'DELETE' });
                        await loadCloudRecords();
                      }}
                      aria-label="Delete application"
                      className="p-1.5 text-slate-400 hover:text-red-600"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Study Notes with Voice Transcription */}
          <form
            onSubmit={handleAddNote}
            className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-5 space-y-3"
          >
            <div className="flex items-center justify-between">
              <h2 className="font-display text-base font-semibold text-[#0F172A] dark:text-white">
                Study & Visa Notes
              </h2>
              <button
                type="button"
                onClick={() => void handleVoiceDictateNote()}
                disabled={transcribingNote}
                className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-semibold ${
                  recordingNote
                    ? 'bg-red-600 text-white border-red-600'
                    : 'border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200'
                }`}
              >
                {recordingNote ? <Square className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
                <span>{recordingNote ? 'Stop' : transcribingNote ? 'Transcribing...' : 'Dictate Note'}</span>
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <input
                type="text"
                required
                value={noteTitle}
                onChange={(e) => setNoteTitle(e.target.value)}
                placeholder="Note title"
                className="sm:col-span-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs"
              />
              <select
                value={noteCountry}
                onChange={(e) => setNoteCountry(e.target.value)}
                className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs"
              >
                {countries.map((c) => (
                  <option key={c.slug} value={c.slug}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <textarea
              required
              rows={3}
              value={noteContent}
              onChange={(e) => setNoteContent(e.target.value)}
              placeholder="Write or dictate reminders for APS, SOP drafts, or embassy appointments..."
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs"
            />
            <button
              type="submit"
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#142B5F] dark:bg-[#2563EB] px-4 py-2 text-xs font-semibold text-white"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Save Note</span>
            </button>

            {notes.length > 0 && (
              <div className="pt-3 border-t border-slate-200 dark:border-slate-800 space-y-2">
                {notes.map((n) => (
                  <div key={n.id} className="rounded-lg border border-slate-200 dark:border-slate-800 p-3 text-xs flex justify-between gap-3">
                    <div>
                      <p className="font-semibold text-[#0F172A] dark:text-white">{n.title}</p>
                      <p className="text-slate-600 dark:text-slate-300 mt-1">{n.content}</p>
                    </div>
                    <button
                      type="button"
                      onClick={async () => {
                        await sqlFetch(`/sql/notes/${n.id}`, { method: 'DELETE' });
                        await loadCloudRecords();
                      }}
                      aria-label="Delete note"
                      className="text-slate-400 hover:text-red-600 shrink-0 self-start"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </form>
        </div>

        {/* Real-Time Firestore Preparation Checklist */}
        <div className="lg:col-span-5 space-y-4">
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-5 space-y-4">
            <h2 className="font-display text-base font-semibold text-[#0F172A] dark:text-white flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-[#0D9488]" />
              <span>Live Journey Checklist ({checklistItems.length})</span>
            </h2>

            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (!checkTitle.trim()) return;
                try {
                  await addChecklistItem({
                    title: checkTitle,
                    category: checkCat,
                    countrySlug: appCountry,
                    notes: checkNotes,
                  });
                  setCheckTitle('');
                  setCheckNotes('');
                } catch (err) {
                  setError(err instanceof Error ? err.message : 'Unable to add checklist item.');
                }
              }}
              className="space-y-2.5"
            >
              <input
                type="text"
                required
                maxLength={140}
                value={checkTitle}
                onChange={(e) => setCheckTitle(e.target.value)}
                placeholder="Milestone (e.g. Request University Transcripts)"
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs"
              />
              <div className="grid grid-cols-2 gap-2">
                <select
                  value={checkCat}
                  onChange={(e) => setCheckCat(e.target.value as JourneyChecklistItem['category'])}
                  className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-2 text-xs"
                >
                  <option value="Documents">Documents</option>
                  <option value="Language">Language</option>
                  <option value="University">University</option>
                  <option value="Visa">Visa</option>
                  <option value="Housing">Housing</option>
                  <option value="Finance">Finance</option>
                </select>
                <button
                  type="submit"
                  className="rounded-lg bg-[#0D9488] hover:bg-[#0f766e] px-3 py-2 text-xs font-semibold text-white"
                >
                  Add Milestone
                </button>
              </div>
              <input
                type="text"
                maxLength={600}
                value={checkNotes}
                onChange={(e) => setCheckNotes(e.target.value)}
                placeholder="Optional note..."
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs"
              />
            </form>

            <div className="divide-y divide-slate-100 dark:divide-slate-800 max-h-[460px] overflow-y-auto">
              {checklistItems.length === 0 ? (
                <p className="py-4 text-xs text-slate-500">Add your first preparation milestone above.</p>
              ) : (
                checklistItems.map((item) => (
                  <div key={item.id} className="py-3 flex items-start justify-between gap-2 text-xs">
                    <div className="min-w-0">
                      <p className="font-semibold text-[#0F172A] dark:text-white">{item.title}</p>
                      <p className="text-[11px] text-slate-500">
                        {item.category} · <span className="capitalize">{item.countrySlug}</span>
                      </p>
                      {item.notes && <p className="text-[11px] text-slate-600 dark:text-slate-300 mt-1">{item.notes}</p>}
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <select
                        aria-label={`Checklist status for ${item.title}`}
                        value={item.status}
                        disabled={item.status === 'archived'}
                        onChange={(e) =>
                          void updateChecklistStatus(item.id, e.target.value as JourneyChecklistItem['status'])
                        }
                        className="rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1 text-[11px]"
                      >
                        <option value="todo">To Do</option>
                        <option value="in_progress">In Progress</option>
                        <option value="done">Done</option>
                        <option value="archived">Archive</option>
                      </select>
                      <button
                        type="button"
                        onClick={() => void deleteChecklistItem(item.id)}
                        aria-label="Delete milestone"
                        className="p-1 text-slate-400 hover:text-red-600"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
