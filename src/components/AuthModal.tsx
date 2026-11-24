import React, { useEffect, useState } from 'react';
import { CheckCircle2, KeyRound, Lock, Mail, Phone, ShieldAlert, X } from 'lucide-react';
import { apiFetch, setInMemoryToken } from '../api';
import { useFirebase } from '../contexts/FirebaseContext';
import type { Country, LanguageCode, User } from '../types';

interface AuthModalProps {
  initialMode?: 'otp' | 'admin';
  countries: Country[];
  onClose: () => void;
  onAuthenticated: (user: User) => void;
}

export const AuthModal: React.FC<AuthModalProps> = ({ initialMode = 'otp', countries, onClose, onAuthenticated }) => {
  const { signInWithGoogle } = useFirebase();
  const [mode, setMode] = useState<'otp' | 'admin'>(initialMode);
  const [step, setStep] = useState<'request' | 'verify' | 'onboarding'>('request');
  const [channel, setChannel] = useState<'email' | 'phone'>('email');
  const [identifier, setIdentifier] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [previewOtpHint, setPreviewOtpHint] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [acceptedTerms, setAcceptedTerms] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Admin bootstrap/login state
  const [adminStatus, setAdminStatus] = useState<{ adminClaimed: boolean; envPasscodeConfigured: boolean } | null>(null);
  const [adminEmail, setAdminEmail] = useState('');
  const [adminName, setAdminName] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [adminPasscode, setAdminPasscode] = useState('');

  // Onboarding state
  const [authedUser, setAuthedUser] = useState<User | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [city, setCity] = useState('');
  const [stateName, setStateName] = useState('');
  const [preferredLanguage, setPreferredLanguage] = useState<LanguageCode>('en');
  const [qualification, setQualification] = useState('B.Tech / B.E.');
  const [specialization, setSpecialization] = useState('');
  const [englishProficiency, setEnglishProficiency] = useState('IELTS 7.0');
  const [otherLang, setOtherLang] = useState('');
  const [primaryCountry, setPrimaryCountry] = useState('germany');
  const [purpose, setPurpose] = useState('Study');
  const [intake, setIntake] = useState('Winter 2027');
  const [stage, setStage] = useState('Prepare');
  const [wantsMentor, setWantsMentor] = useState(true);
  const [privateBudget, setPrivateBudget] = useState('');

  useEffect(() => {
    if (mode === 'admin') {
      apiFetch<{ adminClaimed: boolean; envPasscodeConfigured: boolean }>('/auth/admin/status')
        .then(setAdminStatus)
        .catch(() => {});
    }
  }, [mode]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  const handleRequestOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await apiFetch<{
        expiresInSec: number;
        resendCooldownSec: number;
        previewMode?: boolean;
        previewOtp?: string;
      }>('/auth/otp/request', {
        method: 'POST',
        body: JSON.stringify({ channel, identifier }),
      });
      setCooldown(res.resendCooldownSec || 25);
      setPreviewOtpHint(res.previewOtp || null);
      setStep('verify');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to send OTP.');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!acceptedTerms) {
      setError('Please accept the Terms of Service and acknowledge the Privacy Policy.');
      return;
    }
    setError('');
    setLoading(true);
    try {
      const res = await apiFetch<{ token: string; isNewUser: boolean; user: User }>('/auth/otp/verify', {
        method: 'POST',
        body: JSON.stringify({ channel, identifier, code: otpCode, acceptedTerms }),
      });
      setInMemoryToken(res.token);
      if (res.isNewUser || !res.user.onboarding_completed) {
        setAuthedUser(res.user);
        setDisplayName(res.user.display_name || '');
        setStep('onboarding');
      } else {
        onAuthenticated(res.user);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'OTP verification failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleCompleteOnboarding = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await apiFetch<{ user: User }>('/profiles/me', {
        method: 'PUT',
        body: JSON.stringify({
          display_name: displayName || authedUser?.display_name || 'Member',
          city,
          state: stateName,
          preferred_language: preferredLanguage,
          highest_qualification: qualification,
          degree_specialization: specialization,
          english_proficiency: englishProficiency,
          other_language_proficiency: otherLang,
          primary_destination_country: primaryCountry,
          purpose,
          intended_intake: intake,
          application_stage: stage,
          wants_mentor: wantsMentor,
          budget_range_private: privateBudget,
          accept_terms: true,
          onboarding_completed: true,
        }),
      });
      onAuthenticated(res.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save onboarding details.');
    } finally {
      setLoading(false);
    }
  };

  const handleAdminSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await apiFetch<{ token: string; user: User }>('/auth/admin/claim', {
        method: 'POST',
        body: JSON.stringify({
          email: adminEmail,
          displayName: adminName || undefined,
          password: adminPassword,
          passcode: adminPasscode || undefined,
        }),
      });
      setInMemoryToken(res.token);
      onAuthenticated(res.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Administrator authentication failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-sm p-4 overflow-y-auto" role="dialog" aria-modal="true">
      <div className="w-full max-w-lg rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-6 sm:p-8 my-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="font-display text-xl font-bold text-[#0F172A] dark:text-white">
              {step === 'onboarding'
                ? 'Set Up Your Abroad Plan'
                : mode === 'admin'
                  ? adminStatus?.adminClaimed
                    ? 'Administrator & Moderator Sign-In'
                    : 'First-Run Admin Setup'
                  : 'Join or Sign In to AbroadConnect'}
            </h2>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {step === 'onboarding'
                ? 'Personalizes your group recommendations. Skip any optional fields anytime.'
                : 'Passwordless OTP authentication · No government ID required'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-700 dark:hover:text-slate-200"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {step !== 'onboarding' && (
          <div className="mt-5 flex items-center gap-1 rounded-lg bg-slate-100 dark:bg-slate-800 p-1">
            <button
              type="button"
              onClick={() => {
                setMode('otp');
                setError('');
              }}
              className={`flex-1 rounded-md py-2 text-xs font-semibold transition-colors ${
                mode === 'otp' ? 'bg-white dark:bg-slate-900 text-[#142B5F] dark:text-white shadow-sm' : 'text-slate-600 dark:text-slate-300'
              }`}
            >
              Member OTP Login / Signup
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('admin');
                setError('');
              }}
              className={`flex-1 rounded-md py-2 text-xs font-semibold transition-colors ${
                mode === 'admin' ? 'bg-white dark:bg-slate-900 text-[#142B5F] dark:text-white shadow-sm' : 'text-slate-600 dark:text-slate-300'
              }`}
            >
              Admin / Moderator Access
            </button>
          </div>
        )}

        {error && (
          <div role="alert" className="mt-4 flex items-start gap-2 rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/50 px-3.5 py-2.5 text-xs text-red-700 dark:text-red-300">
            <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {mode === 'otp' && step === 'request' && (
          <form onSubmit={handleRequestOtp} className="mt-5 space-y-4">
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setChannel('email');
                  setIdentifier('');
                }}
                className={`flex-1 flex items-center justify-center gap-2 rounded-lg border py-2.5 text-xs font-medium ${
                  channel === 'email'
                    ? 'border-[#2563EB] bg-blue-50/60 dark:bg-blue-950/30 text-[#142B5F] dark:text-blue-300'
                    : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                }`}
              >
                <Mail className="w-4 h-4" />
                <span>Email OTP</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setChannel('phone');
                  setIdentifier('');
                }}
                className={`flex-1 flex items-center justify-center gap-2 rounded-lg border py-2.5 text-xs font-medium ${
                  channel === 'phone'
                    ? 'border-[#2563EB] bg-blue-50/60 dark:bg-blue-950/30 text-[#142B5F] dark:text-blue-300'
                    : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                }`}
              >
                <Phone className="w-4 h-4" />
                <span>Mobile OTP</span>
              </button>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-200 mb-1.5">
                {channel === 'email' ? 'Email Address' : 'Mobile Number (with country code)'}
              </label>
              <input
                type={channel === 'email' ? 'email' : 'tel'}
                required
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                placeholder={channel === 'email' ? 'student@example.in' : '+91 9876543210'}
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3.5 py-2.5 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-[#142B5F] hover:bg-[#1e3f8a] dark:bg-[#2563EB] dark:hover:bg-[#1d4ed8] py-2.5 text-sm font-semibold text-white transition-colors disabled:opacity-50"
            >
              {loading ? 'Issuing Verification Code...' : 'Send 6-Digit OTP'}
            </button>

            <div className="relative py-1 flex items-center justify-center">
              <div className="border-t border-slate-200 dark:border-slate-700 w-full" />
              <span className="bg-white dark:bg-[#111827] px-3 text-[11px] text-slate-400 shrink-0">OR</span>
              <div className="border-t border-slate-200 dark:border-slate-700 w-full" />
            </div>

            <button
              type="button"
              disabled={loading}
              onClick={async () => {
                setError('');
                setLoading(true);
                try {
                  const res = await signInWithGoogle();
                  onAuthenticated(res.user);
                } catch (err) {
                  setError(err instanceof Error ? err.message : 'Google Sign-In failed.');
                } finally {
                  setLoading(false);
                }
              }}
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 py-2.5 text-sm font-semibold text-slate-800 dark:text-white transition-colors disabled:opacity-50"
            >
              Continue with Google
            </button>
          </form>
        )}

        {mode === 'otp' && step === 'verify' && (
          <form onSubmit={handleVerifyOtp} className="mt-5 space-y-4">
            <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 p-3.5 text-xs text-slate-600 dark:text-slate-300">
              <p>
                Verification code issued for <strong>{identifier}</strong>. Expires in 10 minutes.
              </p>
              {previewOtpHint && (
                <p className="mt-2 font-mono text-xs text-[#142B5F] dark:text-blue-300">
                  Preview Delivery Code: <strong>{previewOtpHint}</strong> (External SMS/SMTP gateway activates once configured in Secrets)
                </p>
              )}
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-200 mb-1.5">6-Digit Code</label>
              <input
                type="text"
                inputMode="numeric"
                pattern="\d{6}"
                maxLength={6}
                required
                value={otpCode}
                onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="123456"
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3.5 py-2.5 font-mono text-base tracking-widest text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
              />
            </div>

            <label className="flex items-start gap-2.5 text-xs text-slate-600 dark:text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={acceptedTerms}
                onChange={(e) => setAcceptedTerms(e.target.checked)}
                className="mt-0.5 rounded border-slate-300 text-[#2563EB]"
              />
              <span>
                I accept the Terms of Service, Community Anti-Scam Guidelines, and acknowledge the DPDP Privacy Policy.
              </span>
            </label>

            <div className="flex items-center justify-between gap-3">
              <button
                type="button"
                disabled={cooldown > 0}
                onClick={() => setStep('request')}
                className="text-xs font-medium text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 disabled:opacity-50"
              >
                {cooldown > 0 ? `Resend in ${cooldown}s` : 'Change contact / Resend'}
              </button>
              <button
                type="submit"
                disabled={loading}
                className="rounded-lg bg-[#142B5F] hover:bg-[#1e3f8a] dark:bg-[#2563EB] px-5 py-2.5 text-sm font-semibold text-white transition-colors disabled:opacity-50"
              >
                {loading ? 'Verifying...' : 'Verify & Continue'}
              </button>
            </div>
          </form>
        )}

        {step === 'onboarding' && (
          <form onSubmit={handleCompleteOnboarding} className="mt-5 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-200 mb-1">Display Name</label>
                <input
                  type="text"
                  required
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="e.g. Aarav Mehta"
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-200 mb-1">Preferred Language</label>
                <select
                  value={preferredLanguage}
                  onChange={(e) => setPreferredLanguage(e.target.value as LanguageCode)}
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-white"
                >
                  <option value="en">English</option>
                  <option value="hi">हिन्दी (Hindi)</option>
                  <option value="ta">தமிழ் (Tamil)</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-200 mb-1">Current City (India / Abroad)</label>
                <input
                  type="text"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  placeholder="e.g. Chennai, Pune, Bengaluru"
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-200 mb-1">State</label>
                <input
                  type="text"
                  value={stateName}
                  onChange={(e) => setStateName(e.target.value)}
                  placeholder="e.g. Tamil Nadu, Maharashtra"
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-200 mb-1">Primary Destination Country</label>
                <select
                  value={primaryCountry}
                  onChange={(e) => setPrimaryCountry(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-white"
                >
                  {countries.map((c) => (
                    <option key={c.slug} value={c.slug}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-200 mb-1">Primary Purpose</label>
                <select
                  value={purpose}
                  onChange={(e) => setPurpose(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-white"
                >
                  <option value="Study">Study (Master’s / Bachelor’s)</option>
                  <option value="Job">International Job</option>
                  <option value="Apprenticeship">Apprenticeship / Ausbildung</option>
                  <option value="Scholarship">Scholarship</option>
                  <option value="Research">Research / PhD</option>
                  <option value="Business">Business / Entrepreneurship</option>
                  <option value="Relocation">Relocation</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-200 mb-1">Intended Intake / Timeline</label>
                <select
                  value={intake}
                  onChange={(e) => setIntake(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-white"
                >
                  <option value="Winter 2027">Winter 2027</option>
                  <option value="Summer 2027">Summer 2027</option>
                  <option value="Fall 2027">Fall 2027</option>
                  <option value="Moving Abroad in 2027">Moving Abroad in 2027</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-200 mb-1">Current Stage</label>
                <select
                  value={stage}
                  onChange={(e) => setStage(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-white"
                >
                  <option value="Explore">Explore</option>
                  <option value="Prepare">Prepare</option>
                  <option value="Apply">Apply</option>
                  <option value="Receive Decision">Receive Decision</option>
                  <option value="Travel">Travel</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-200 mb-1">Highest Qualification</label>
                <input
                  type="text"
                  value={qualification}
                  onChange={(e) => setQualification(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-200 mb-1">Specialization / Field</label>
                <input
                  type="text"
                  value={specialization}
                  onChange={(e) => setSpecialization(e.target.value)}
                  placeholder="e.g. Data Science, Nursing, Embedded"
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-200 mb-1">English / Local Language</label>
                <input
                  type="text"
                  value={englishProficiency}
                  onChange={(e) => setEnglishProficiency(e.target.value)}
                  placeholder="e.g. IELTS 7.0 · German A2"
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-200 mb-1">
                  Budget Range <span className="text-slate-400 font-normal">(Private by default)</span>
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={privateBudget}
                    onChange={(e) => setPrivateBudget(e.target.value)}
                    placeholder="Optional · Never shown publicly"
                    className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-white"
                  />
                </div>
              </div>
            </div>

            <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={wantsMentor}
                onChange={(e) => setWantsMentor(e.target.checked)}
                className="rounded border-slate-300 text-[#2563EB]"
              />
              <span>Suggest verified mentors matching my destination & goal</span>
            </label>

            <div className="flex items-center justify-between pt-2">
              <button
                type="button"
                onClick={() => authedUser && onAuthenticated(authedUser)}
                className="text-xs font-medium text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
              >
                Skip for now
              </button>
              <button
                type="submit"
                disabled={loading}
                className="inline-flex items-center gap-2 rounded-lg bg-[#142B5F] hover:bg-[#1e3f8a] dark:bg-[#2563EB] px-5 py-2.5 text-sm font-semibold text-white transition-colors"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>{loading ? 'Saving...' : 'Complete Setup & Open Dashboard'}</span>
              </button>
            </div>
          </form>
        )}

        {mode === 'admin' && step !== 'onboarding' && (
          <form onSubmit={handleAdminSubmit} className="mt-5 space-y-4">
            <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 p-3.5 text-xs text-slate-600 dark:text-slate-300">
              {adminStatus?.adminClaimed ? (
                <p>Sign in with your administrator email and password to access Moderation Queue and Admin Console.</p>
              ) : (
                <p>
                  No administrator has claimed this instance yet. Complete this one-time setup to claim Platform Admin, Super Admin, and Moderator access.
                </p>
              )}
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-200 mb-1">Administrator Email</label>
              <input
                type="email"
                required
                value={adminEmail}
                onChange={(e) => setAdminEmail(e.target.value)}
                placeholder="admin@abroadconnect.in"
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3.5 py-2 text-sm text-slate-900 dark:text-white"
              />
            </div>

            {!adminStatus?.adminClaimed && (
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-200 mb-1">Display Name</label>
                <input
                  type="text"
                  value={adminName}
                  onChange={(e) => setAdminName(e.target.value)}
                  placeholder="Platform Administrator"
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3.5 py-2 text-sm text-slate-900 dark:text-white"
                />
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-200 mb-1">
                {adminStatus?.adminClaimed ? 'Password' : 'Choose Strong Password (8+ chars)'}
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                <input
                  type="password"
                  required
                  minLength={8}
                  value={adminPassword}
                  onChange={(e) => setAdminPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 pl-9 pr-3.5 py-2 text-sm text-slate-900 dark:text-white"
                />
              </div>
            </div>

            {adminStatus?.envPasscodeConfigured && (
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-200 mb-1">Server Admin Passcode</label>
                <div className="relative">
                  <KeyRound className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                  <input
                    type="password"
                    required
                    value={adminPasscode}
                    onChange={(e) => setAdminPasscode(e.target.value)}
                    placeholder="Configured in environment secrets"
                    className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 pl-9 pr-3.5 py-2 text-sm text-slate-900 dark:text-white"
                  />
                </div>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-[#142B5F] hover:bg-[#1e3f8a] dark:bg-[#2563EB] py-2.5 text-sm font-semibold text-white transition-colors disabled:opacity-50"
            >
              {loading ? 'Authenticating...' : adminStatus?.adminClaimed ? 'Sign In to Admin Console' : 'Claim Admin Access'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
};
