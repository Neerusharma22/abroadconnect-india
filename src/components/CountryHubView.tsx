import React, { useEffect, useState } from 'react';
import { ArrowLeft, ExternalLink, Globe2, GraduationCap, Briefcase, Award, ShieldAlert, Users } from 'lucide-react';
import { apiFetch, safeExternalUrl } from '../api';
import type { Country } from '../types';

interface CountryHubViewProps {
  countries: Country[];
  selectedSlug: string | null;
  onSelectCountry: (slug: string | null) => void;
  onOpenGroup: (slug: string) => void;
  onJoinPrompt?: () => void;
  isAuthenticated: boolean;
}

export const CountryHubView: React.FC<CountryHubViewProps> = ({
  countries,
  selectedSlug,
  onSelectCountry,
  onOpenGroup,
  onJoinPrompt,
  isAuthenticated,
}) => {
  const [regionFilter, setRegionFilter] = useState('all');
  const [detail, setDetail] = useState<{
    country: Country;
    groups: Array<{ id: string; slug: string; name: string; category: string; privacy: string; description: string }>;
    universities: Array<{ id: string; name: string; city: string; official_website: string; tuition_info: string }>;
    scholarships: Array<{ id: string; title: string; provider: string; funding_type: string; deadline: string; official_url: string }>;
    jobs: Array<{ id: string; title: string; employer: string; official_url: string }>;
    apprenticeships: Array<{ id: string; title: string; training_provider: string; official_source_url: string }>;
    mentors: Array<{ id: string; display_name: string; mentor_type: string; current_city: string; verification_badge_label: string }>;
    discussions: Array<{ id: string; title: string; group_name: string; group_slug: string; author_name: string; created_at: string }>;
  } | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!selectedSlug) {
      setDetail(null);
      return;
    }
    setLoading(true);
    apiFetch<typeof detail>(`/countries/${selectedSlug}`)
      .then((res) => setDetail(res))
      .catch(() => setDetail(null))
      .finally(() => setLoading(false));
  }, [selectedSlug]);

  if (selectedSlug && detail) {
    const c = detail.country;
    const cities = (() => {
      try {
        return JSON.parse(c.popular_cities_json) as string[];
      } catch {
        return [];
      }
    })();
    const officialLinks = (() => {
      try {
        return JSON.parse(c.official_links_json) as Array<{ label: string; url: string }>;
      } catch {
        return [];
      }
    })();

    return (
      <div className="space-y-8">
        <div>
          <button
            type="button"
            onClick={() => onSelectCountry(null)}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#2563EB] dark:text-blue-400 hover:underline mb-4"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>All 17 Destination Countries</span>
          </button>

          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] overflow-hidden">
            {c.hero_image && (
              <div className="h-52 sm:h-64 w-full overflow-hidden bg-slate-100 dark:bg-slate-800">
                <img src={c.hero_image} alt={c.name} referrerPolicy="no-referrer" className="h-full w-full object-cover" />
              </div>
            )}
            <div className="p-6 sm:p-8">
              <div className="text-xs text-slate-500 dark:text-slate-400">
                <span>{c.region}</span>
                <span aria-hidden="true"> · </span>
                <span>Last Reviewed {c.last_updated}</span>
                {cities.length > 0 && (
                  <>
                    <span aria-hidden="true"> · </span>
                    <span>Popular Cities: {cities.join(', ')}</span>
                  </>
                )}
              </div>
              <h1 className="mt-2 font-display text-2xl sm:text-3xl font-bold text-[#0F172A] dark:text-white">{c.name}</h1>
              <p className="mt-3 text-sm sm:text-base text-slate-600 dark:text-slate-300 leading-relaxed">{c.overview}</p>
            </div>
          </div>
        </div>

        {/* Official Government Links vs Community Estimates Disclaimer */}
        <div className="rounded-xl border border-amber-200 dark:border-amber-900/70 bg-amber-50/70 dark:bg-amber-950/30 p-5">
          <div className="flex items-start gap-3">
            <ShieldAlert className="w-5 h-5 text-amber-700 dark:text-amber-400 shrink-0 mt-0.5" />
            <div className="space-y-2 text-xs sm:text-sm text-amber-950 dark:text-amber-100">
              <p className="font-semibold">Official Verification & Non-Guarantee Notice</p>
              <p className="leading-relaxed">{c.visa_disclaimer_info}</p>
              {officialLinks.length > 0 && (
                <div className="flex flex-wrap gap-4 pt-1">
                  {officialLinks.map((lnk) => {
                    const safeHref = safeExternalUrl(lnk.url);
                    if (!safeHref) return null;
                    return (
                      <a
                        key={lnk.url}
                        href={safeHref}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 font-semibold text-[#142B5F] dark:text-blue-300 underline"
                      >
                        <span>{lnk.label}</span>
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Pathways Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-6">
            <div className="flex items-center gap-2 text-xs font-semibold text-[#2563EB] dark:text-blue-400">
              <GraduationCap className="w-4 h-4" />
              <span>Official Education Pathways</span>
            </div>
            <p className="mt-2.5 text-sm text-slate-700 dark:text-slate-300 leading-relaxed">{c.education_pathways}</p>
            <p className="mt-4 text-xs text-slate-500 dark:text-slate-400">
              <strong>Language Requirements:</strong> {c.language_requirements}
            </p>
          </div>

          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-6">
            <div className="flex items-center gap-2 text-xs font-semibold text-[#0D9488] dark:text-teal-400">
              <Briefcase className="w-4 h-4" />
              <span>Jobs & Vocational Training</span>
            </div>
            <p className="mt-2.5 text-sm text-slate-700 dark:text-slate-300 leading-relaxed">{c.job_pathways}</p>
            <p className="mt-4 text-xs text-slate-500 dark:text-slate-400">
              <strong>Apprenticeships:</strong> {c.apprenticeship_pathways}
            </p>
          </div>

          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-6">
            <div className="flex items-center gap-2 text-xs font-semibold text-[#142B5F] dark:text-blue-300">
              <Award className="w-4 h-4" />
              <span>Scholarships & Funding Summary</span>
            </div>
            <p className="mt-2.5 text-sm text-slate-700 dark:text-slate-300 leading-relaxed">{c.scholarship_summary}</p>
          </div>

          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-6">
            <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">Community-Summarized Living Cost Reference (Estimate Only)</p>
            <p className="mt-2.5 text-sm text-slate-700 dark:text-slate-300 leading-relaxed">{c.living_cost_estimate}</p>
          </div>
        </div>

        {/* Linked Country Communities, Universities & Mentors */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-6">
            <h2 className="font-display text-base font-semibold text-[#0F172A] dark:text-white mb-4">
              {c.name} Community Groups
            </h2>
            {detail.groups.length === 0 ? (
              <p className="text-xs text-slate-500 dark:text-slate-400">No country-specific groups created yet.</p>
            ) : (
              <div className="divide-y divide-slate-200 dark:divide-slate-800">
                {detail.groups.map((g) => (
                  <div key={g.id} className="py-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-[#0F172A] dark:text-white truncate">{g.name}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        {g.category} · <span className="capitalize">{g.privacy}</span>
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => (isAuthenticated ? onOpenGroup(g.slug) : onJoinPrompt?.())}
                      className="rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 shrink-0"
                    >
                      {isAuthenticated ? 'Open Group' : 'Sign in to join'}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-6">
            <h2 className="font-display text-base font-semibold text-[#0F172A] dark:text-white mb-4">
              Verified Mentors & Universities
            </h2>
            <div className="space-y-3">
              {detail.mentors.map((m) => (
                <div key={m.id} className="flex items-center justify-between gap-3 text-sm border-b border-slate-100 dark:border-slate-800 pb-2.5">
                  <div>
                    <p className="font-medium text-[#0F172A] dark:text-white">{m.display_name}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {m.mentor_type} · {m.current_city} · {m.verification_badge_label}
                    </p>
                  </div>
                  <Users className="w-4 h-4 text-[#0D9488] shrink-0" />
                </div>
              ))}
              {detail.universities.map((u) => (
                <div key={u.id} className="flex items-center justify-between gap-3 text-sm border-b border-slate-100 dark:border-slate-800 pb-2.5">
                  <div>
                    <p className="font-medium text-[#0F172A] dark:text-white">{u.name}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">{u.city} · {u.tuition_info}</p>
                  </div>
                  {safeExternalUrl(u.official_website) && (
                    <a
                      href={safeExternalUrl(u.official_website)!}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs font-medium text-[#2563EB] dark:text-blue-400 hover:underline shrink-0"
                    >
                      Official
                    </a>
                  )}
                </div>
              ))}
              {detail.mentors.length === 0 && detail.universities.length === 0 && (
                <p className="text-xs text-slate-500 dark:text-slate-400">Check official links above for regional institutions.</p>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (selectedSlug && loading) {
    return (
      <div className="space-y-4">
        <div className="h-48 rounded-xl bg-slate-200 dark:bg-slate-800 animate-pulse" />
        <div className="h-24 rounded-xl bg-slate-200 dark:bg-slate-800 animate-pulse" />
      </div>
    );
  }

  const regions = ['all', 'Europe', 'North America', 'Oceania', 'Asia', 'Middle East'];
  const filtered = countries.filter((c) => regionFilter === 'all' || c.region === regionFilter);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-[#0F172A] dark:text-white">Explore Destination Countries</h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
            Select any destination hub for official pathways, cost disclaimers, universities, and peer communities.
          </p>
        </div>
        <div className="flex flex-wrap gap-1 rounded-lg bg-slate-100 dark:bg-slate-800 p-1">
          {regions.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRegionFilter(r)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                regionFilter === r
                  ? 'bg-white dark:bg-slate-900 text-[#0F172A] dark:text-white shadow-sm'
                  : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              {r === 'all' ? 'All Regions' : r}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {filtered.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => onSelectCountry(c.slug)}
            className="text-left rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-5 hover:border-[#2563EB] dark:hover:border-blue-500 transition-colors"
          >
            <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
              <span>{c.region}</span>
              <span className="font-mono">{c.flag_code}</span>
            </div>
            <h2 className="mt-2 font-display text-lg font-semibold text-[#0F172A] dark:text-white">{c.name}</h2>
            <p className="mt-2 text-xs text-slate-600 dark:text-slate-300 line-clamp-3 leading-relaxed">{c.overview}</p>
            <p className="mt-4 text-xs font-semibold text-[#2563EB] dark:text-blue-400 flex items-center gap-1">
              <Globe2 className="w-3.5 h-3.5" />
              <span>Open Country Hub</span>
            </p>
          </button>
        ))}
      </div>
    </div>
  );
};
