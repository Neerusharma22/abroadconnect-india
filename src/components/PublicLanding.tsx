import React, { useState } from 'react';
import {
  ArrowRight,
  ChevronDown,
  ChevronUp,
  Globe2,
  Moon,
  ShieldCheck,
  Sun,
  Users,
} from 'lucide-react';
import type { Country, Group, LanguageCode } from '../types';
import { t } from '../i18n';
import { PWAInstallButton } from './PWAComponents';

interface PublicLandingProps {
  countries: Country[];
  groups: Group[];
  lang: LanguageCode;
  darkMode: boolean;
  onToggleDark: () => void;
  onChangeLang: (lang: LanguageCode) => void;
  onOpenAuth: (mode?: 'otp' | 'admin') => void;
  onExploreCountry: (slug: string) => void;
  onOpenLegal: (section: string) => void;
}

const FAQS = [
  {
    q: 'Is AbroadConnect India free to join?',
    a: 'Yes. Essential community access—including destination country hubs, public communities, peer networking, university/scholarship discovery, and safety reporting—is free. We never charge fees to access basic guidance.',
  },
  {
    q: 'Are you an immigration consultant or recruitment agency?',
    a: 'No. AbroadConnect India is a community-first peer platform. We do not sell visa guarantees, fake job letters, or paid admission promises. All official visa, tuition, and work-permit rules link directly to government and university portals.',
  },
  {
    q: 'What does "Verified" mean on a mentor or member profile?',
    a: 'Verification badges state specifically what was checked—such as Email Verified, Phone Verified, Institution Evidence Reviewed, or Mentor Reviewed. Verification never guarantees a mentor’s personal advice or admission/visa outcomes.',
  },
  {
    q: 'How do you protect students from overseas job and rental scams?',
    a: 'We flag review signals like "guaranteed visa", "pay before interview", or requests to send passport copies privately, restrict suspicious external links, separate private groups from public search, and maintain a moderator safety queue.',
  },
];

export const PublicLanding: React.FC<PublicLandingProps> = ({
  countries,
  groups,
  lang,
  darkMode,
  onToggleDark,
  onChangeLang,
  onOpenAuth,
  onExploreCountry,
  onOpenLegal,
}) => {
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const [showAllCountries, setShowAllCountries] = useState(false);

  const featuredSlugs = ['germany', 'united-kingdom', 'canada'];
  const featuredCountries = featuredSlugs
    .map((s) => countries.find((c) => c.slug === s))
    .filter((c): c is Country => Boolean(c));

  const visibleCountries = showAllCountries ? countries : countries.slice(0, 9);

  return (
    <div className="min-h-screen bg-[#F8FAFC] dark:bg-[#0B1120] text-[#0F172A] dark:text-[#F1F5F9]">
      {/* Strict 3-Zone Top Bar Contract */}
      <header className="sticky top-0 z-30 border-b border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-[#0B1120]/95 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-8 px-4 sm:px-6 lg:px-8 h-16">
          <a
            href="#top"
            className="font-display text-lg font-bold tracking-tight text-[#142B5F] dark:text-white whitespace-nowrap shrink-0"
          >
            AbroadConnect India
          </a>

          <nav aria-label="Primary" className="hidden md:flex items-center gap-7 text-sm font-medium text-slate-600 dark:text-slate-300">
            <a href="#countries" className="hover:text-[#142B5F] dark:hover:text-white transition-colors whitespace-nowrap shrink-0">
              Countries
            </a>
            <a href="#communities" className="hover:text-[#142B5F] dark:hover:text-white transition-colors whitespace-nowrap shrink-0">
              Communities
            </a>
            <a href="#opportunities" className="hover:text-[#142B5F] dark:hover:text-white transition-colors whitespace-nowrap shrink-0">
              Opportunities
            </a>
            <a href="#mentors" className="hover:text-[#142B5F] dark:hover:text-white transition-colors whitespace-nowrap shrink-0">
              Mentors
            </a>
            <a href="#safety" className="hover:text-[#142B5F] dark:hover:text-white transition-colors whitespace-nowrap shrink-0">
              Safety
            </a>
          </nav>

          <div className="shrink-0">
            <button
              type="button"
              onClick={() => onOpenAuth('otp')}
              className="rounded-lg bg-[#142B5F] hover:bg-[#1e3f8a] dark:bg-[#2563EB] dark:hover:bg-[#1d4ed8] px-4 py-2.5 text-sm font-semibold text-white transition-colors whitespace-nowrap shrink-0 min-h-[40px]"
            >
              {t(lang, 'joinCommunity')}
            </button>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section id="top" className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827]">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-12 lg:py-20">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-12 items-stretch">
            <div className="lg:col-span-6 flex flex-col justify-center">
              <p className="text-xs font-medium tracking-wide text-[#0D9488] dark:text-[#14B8A6] mb-3">
                India’s Community-First Global Opportunity Network · 17 Destination Hubs
              </p>
              <h1
                className="font-display font-bold tracking-tight text-[#0F172A] dark:text-white leading-[1.12]"
                style={{ fontSize: 'clamp(2.25rem, 4vw, 3.5rem)', textWrap: 'balance' }}
              >
                {t(lang, 'heroHeadline')}
              </h1>
              <p className="mt-5 text-base sm:text-lg text-slate-600 dark:text-slate-300 leading-relaxed max-w-2xl">
                {t(lang, 'heroSub')}
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-4">
                <button
                  type="button"
                  onClick={() => onOpenAuth('otp')}
                  className="inline-flex items-center gap-2 rounded-lg bg-[#142B5F] hover:bg-[#1e3f8a] dark:bg-[#2563EB] dark:hover:bg-[#1d4ed8] px-6 py-3 text-sm font-semibold text-white transition-colors whitespace-nowrap min-h-[44px]"
                >
                  <span>{t(lang, 'joinCommunity')}</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
                <a
                  href="#countries"
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-6 py-3 text-sm font-semibold text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors whitespace-nowrap min-h-[44px]"
                >
                  <span>{t(lang, 'exploreCountries')}</span>
                </a>
              </div>
              <p className="mt-6 text-xs text-slate-500 dark:text-slate-400">
                Free essential guidance · Zero paid visa promises · English, हिन्दी & தமிழ் UI
              </p>
            </div>

            <div className="lg:col-span-6">
              <div className="relative h-full min-h-[280px] sm:min-h-[360px] overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-900">
                <img
                  src="/src/assets/images/hero_abroad_community_1795454653807.jpg"
                  alt="Indian university students and young professionals collaborating abroad"
                  referrerPolicy="no-referrer"
                  className="h-full w-full object-cover"
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Featured Destination Country Hubs */}
      <section id="countries" className="py-16 lg:py-20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-10">
            <div>
              <h2 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-[#0F172A] dark:text-white">
                Explore Destination Countries
              </h2>
              <p className="mt-2 text-sm sm:text-base text-slate-600 dark:text-slate-300 max-w-2xl">
                Official government links separated clearly from peer community advice across 17 destinations.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowAllCountries((v) => !v)}
              className="text-sm font-semibold text-[#2563EB] dark:text-blue-400 hover:underline whitespace-nowrap shrink-0 self-start sm:self-auto"
            >
              {showAllCountries ? 'Show fewer countries' : `View all ${countries.length} countries`}
            </button>
          </div>

          {/* 3 Editorial Featured Country Visual Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
            {featuredCountries.map((country) => (
              <button
                key={country.slug}
                type="button"
                onClick={() => onExploreCountry(country.slug)}
                className="group text-left overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] hover:border-[#2563EB] dark:hover:border-blue-500 transition-colors"
              >
                <div className="aspect-[4/3] w-full overflow-hidden bg-slate-100 dark:bg-slate-800">
                  {country.hero_image ? (
                    <img
                      src={country.hero_image}
                      alt={`${country.name} destination hub`}
                      referrerPolicy="no-referrer"
                      className="h-full w-full object-cover group-hover:scale-[1.02] transition-transform duration-200"
                    />
                  ) : (
                    <div className="h-full w-full flex items-center justify-center text-slate-400">
                      <Globe2 className="w-10 h-10" />
                    </div>
                  )}
                </div>
                <div className="p-5">
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    <span>{country.region}</span>
                    <span aria-hidden="true"> · </span>
                    <span>Updated {country.last_updated}</span>
                  </div>
                  <h3 className="mt-1.5 font-display text-lg font-semibold text-[#0F172A] dark:text-white group-hover:text-[#2563EB] dark:group-hover:text-blue-400 transition-colors">
                    {country.name}
                  </h3>
                  <p className="mt-2 text-sm text-slate-600 dark:text-slate-300 line-clamp-2">{country.overview}</p>
                </div>
              </button>
            ))}
          </div>

          {/* Clean Directory Grid for All 17 Countries */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {visibleCountries.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => onExploreCountry(c.slug)}
                className="flex items-center justify-between gap-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] px-5 py-4 text-left hover:border-[#2563EB] dark:hover:border-blue-500 transition-colors"
              >
                <div className="min-w-0">
                  <p className="font-display text-sm font-semibold text-[#0F172A] dark:text-white truncate">{c.name}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 truncate">
                    {c.region} · Official portals & peer hubs
                  </p>
                </div>
                <ArrowRight className="w-4 h-4 text-slate-400 shrink-0" />
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* How AbroadConnect Works + Find People With Similar Goals */}
      <section className="border-y border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] py-16 lg:py-20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="max-w-2xl mb-12">
            <h2 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-[#0F172A] dark:text-white">
              How AbroadConnect India Works
            </h2>
            <p className="mt-2 text-sm sm:text-base text-slate-600 dark:text-slate-300">
              Built around transparent rules, verified community roles, and peer solidarity from every Indian state.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
            <div>
              <p className="font-mono text-xs font-semibold text-[#2563EB] dark:text-blue-400">01.</p>
              <h3 className="mt-2 font-display text-base font-semibold text-[#0F172A] dark:text-white">Verify with Email or Mobile OTP</h3>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                Register without submitting government IDs. Keep sensitive academic scores and budget ranges private by default.
              </p>
            </div>
            <div>
              <p className="font-mono text-xs font-semibold text-[#2563EB] dark:text-blue-400">02.</p>
              <h3 className="mt-2 font-display text-base font-semibold text-[#0F172A] dark:text-white">Match with Target Cohorts</h3>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                Select Germany, UK, Canada, or 14 other hubs and get transparent rule-based group and buddy matches for your intake.
              </p>
            </div>
            <div>
              <p className="font-mono text-xs font-semibold text-[#2563EB] dark:text-blue-400">03.</p>
              <h3 className="mt-2 font-display text-base font-semibold text-[#0F172A] dark:text-white">Ask Verified Peers & Mentors</h3>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                Join public discussions, request access to private city cohorts, or schedule free guidance sessions with reviewed mentors.
              </p>
            </div>
            <div>
              <p className="font-mono text-xs font-semibold text-[#2563EB] dark:text-blue-400">04.</p>
              <h3 className="mt-2 font-display text-base font-semibold text-[#0F172A] dark:text-white">Track Applications Privately</h3>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                Compare universities side by side, save sourced scholarships and apprenticeships, and track your own checklist privately.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Active Communities & Opportunities Preview */}
      <section id="communities" className="py-16 lg:py-20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">
            <div className="lg:col-span-7">
              <h2 className="font-display text-2xl font-bold tracking-tight text-[#0F172A] dark:text-white">
                Structured Country, City & Timeline Communities
              </h2>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                Join open public groups immediately or request moderator approval for verified cohort spaces.
              </p>
              <div className="mt-6 divide-y divide-slate-200 dark:divide-slate-800 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827]">
                {groups.slice(0, 6).map((g) => (
                  <div key={g.id} className="flex items-center justify-between gap-4 px-5 py-4">
                    <div className="min-w-0">
                      <div className="text-xs text-slate-500 dark:text-slate-400">
                        <span>{g.category}</span>
                        <span aria-hidden="true"> · </span>
                        <span className="capitalize">{g.privacy.replace('_', '-')} group</span>
                        {typeof g.member_count === 'number' && (
                          <>
                            <span aria-hidden="true"> · </span>
                            <span className="tabular-nums">{g.member_count} members</span>
                          </>
                        )}
                      </div>
                      <h3 className="mt-1 font-display text-sm font-semibold text-[#0F172A] dark:text-white truncate">
                        {g.name}
                      </h3>
                    </div>
                    <button
                      type="button"
                      onClick={() => onOpenAuth('otp')}
                      className="rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
                    >
                      Join to view
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <div id="opportunities" className="lg:col-span-5 flex flex-col justify-between rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-6 sm:p-8">
              <div>
                <p className="text-xs font-medium text-[#0D9488] dark:text-[#14B8A6]">Find My Abroad Buddy</p>
                <h3 className="mt-2 font-display text-xl font-bold text-[#0F172A] dark:text-white">
                  Connect with peers targeting the exact same intake
                </h3>
                <p className="mt-3 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                  For example, a student in Chennai preparing for a Master’s in Germany for Winter 2027 can discover consenting peers with matching goals—without exposing private budgets, grades, or phone numbers.
                </p>
                <div className="mt-6 rounded-lg border border-slate-200 dark:border-slate-800 bg-[#F8FAFC] dark:bg-slate-900 p-4">
                  <p className="text-sm font-semibold text-[#0F172A] dark:text-white">Example Match Explanation</p>
                  <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
                    “Both of you are targeting Germany, Study track, and Winter 2027.”
                  </p>
                </div>
              </div>
              <div className="mt-8 pt-6 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between gap-4">
                <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                  <Users className="w-4 h-4 text-[#2563EB]" />
                  <span>Consent-first discovery</span>
                </div>
                <button
                  type="button"
                  onClick={() => onOpenAuth('otp')}
                  className="rounded-lg bg-[#2563EB] hover:bg-[#1d4ed8] px-4 py-2 text-xs font-semibold text-white whitespace-nowrap"
                >
                  Find Peers
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Mentor Spotlight + Safety & Anti-Scam Commitments */}
      <section id="mentors" className="border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] py-16 lg:py-20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-stretch">
            <div className="lg:col-span-5">
              <div className="h-full min-h-[260px] overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-900">
                <img
                  src="/src/assets/images/mentor_spotlight_1795454653444.jpg"
                  alt="Indian graduate mentor discussing study plans in a university library"
                  referrerPolicy="no-referrer"
                  className="h-full w-full object-cover"
                />
              </div>
            </div>

            <div id="safety" className="lg:col-span-7 flex flex-col justify-center">
              <div className="flex items-center gap-2 text-xs font-medium text-[#0D9488] dark:text-[#14B8A6]">
                <ShieldCheck className="w-4 h-4" />
                <span>Trust, Verification & Anti-Scam Architecture</span>
              </div>
              <h2 className="mt-2 font-display text-2xl sm:text-3xl font-bold tracking-tight text-[#0F172A] dark:text-white">
                Honest Guidance Over Paid Consultant Hype
              </h2>
              <p className="mt-3 text-sm sm:text-base text-slate-600 dark:text-slate-300 leading-relaxed">
                Every mentor application undergoes private administrative review of academic or employment evidence. Verification means evidence was checked—never that the platform guarantees outcomes.
              </p>
              <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4">
                  <h3 className="font-display text-sm font-semibold text-[#0F172A] dark:text-white">Scam Signal Detection</h3>
                  <p className="mt-1 text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                    Phrases like “guaranteed visa”, “pay before interview”, or requests for private passport scans automatically raise a moderation review signal.
                  </p>
                </div>
                <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4">
                  <h3 className="font-display text-sm font-semibold text-[#0F172A] dark:text-white">Sourced Opportunity Records</h3>
                  <p className="mt-1 text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                    Universities, scholarships, and apprenticeships show official source links and last-verified dates alongside community discussions.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="py-16 lg:py-20 border-t border-slate-200 dark:border-slate-800">
        <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
          <h2 className="font-display text-2xl font-bold tracking-tight text-[#0F172A] dark:text-white mb-8">
            Frequently Asked Questions
          </h2>
          <div className="divide-y divide-slate-200 dark:divide-slate-800 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827]">
            {FAQS.map((item, idx) => {
              const isOpen = openFaq === idx;
              return (
                <div key={item.q}>
                  <button
                    type="button"
                    onClick={() => setOpenFaq(isOpen ? null : idx)}
                    aria-expanded={isOpen}
                    className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left text-sm font-semibold text-[#0F172A] dark:text-white hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
                  >
                    <span>{item.q}</span>
                    {isOpen ? <ChevronUp className="w-4 h-4 shrink-0 text-slate-400" /> : <ChevronDown className="w-4 h-4 shrink-0 text-slate-400" />}
                  </button>
                  {isOpen && (
                    <div className="px-5 pb-4 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                      {item.a}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Quiet Footer with Legal, Support, Language & Theme Controls */}
      <footer className="border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] py-12">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 pb-8 border-b border-slate-200 dark:border-slate-800">
            <div>
              <p className="font-display text-base font-bold text-[#142B5F] dark:text-white">AbroadConnect India</p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 max-w-xl">
                {t(lang, 'officialDisclaimer')}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 p-1">
                {(['en', 'hi', 'ta'] as LanguageCode[]).map((code) => (
                  <button
                    key={code}
                    type="button"
                    onClick={() => onChangeLang(code)}
                    className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                      lang === code
                        ? 'bg-[#142B5F] text-white dark:bg-[#2563EB]'
                        : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    {code === 'en' ? 'EN' : code === 'hi' ? 'हिन्दी' : 'தமிழ்'}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={onToggleDark}
                aria-label="Toggle theme"
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 min-h-[40px]"
              >
                {darkMode ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
                <span>{darkMode ? 'Light' : 'Dark'}</span>
              </button>
              <PWAInstallButton />
            </div>
          </div>

          <div className="mt-8 flex flex-wrap items-center justify-between gap-4 text-xs text-slate-500 dark:text-slate-400">
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
              <button type="button" onClick={() => onOpenLegal('about')} className="hover:text-slate-900 dark:hover:text-white">
                About Platform
              </button>
              <button type="button" onClick={() => onOpenLegal('guidelines')} className="hover:text-slate-900 dark:hover:text-white">
                Community Guidelines
              </button>
              <button type="button" onClick={() => onOpenLegal('privacy')} className="hover:text-slate-900 dark:hover:text-white">
                Privacy Policy (DPDP)
              </button>
              <button type="button" onClick={() => onOpenLegal('terms')} className="hover:text-slate-900 dark:hover:text-white">
                Terms of Service
              </button>
              <button type="button" onClick={() => onOpenLegal('refunds')} className="hover:text-slate-900 dark:hover:text-white">
                Refund & Cancellation
              </button>
              <button type="button" onClick={() => onOpenLegal('grievance')} className="hover:text-slate-900 dark:hover:text-white">
                Grievance Redressal
              </button>
              <button type="button" onClick={() => onOpenLegal('support')} className="hover:text-slate-900 dark:hover:text-white">
                Contact & Support
              </button>
              <button type="button" onClick={() => onOpenAuth('admin')} className="hover:text-slate-900 dark:hover:text-white">
                Admin / Moderator Access
              </button>
            </div>
            <p>© {new Date().getFullYear()} AbroadConnect India</p>
          </div>
        </div>
      </footer>
    </div>
  );
};
