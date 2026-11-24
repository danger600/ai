import { jsPDF } from 'jspdf';
import { Briefcase, Download, FileUp, Lock, ShieldCheck, Sparkles, Unlock } from 'lucide-react';
import { ChangeEvent, useEffect, useState } from 'react';
import type { CvProfile, CvVersion } from '../types';
import { MarkdownRenderer } from './MarkdownRenderer';

interface LocalComparison {
  mode: string;
  matchScorePercent: number;
  matchedSkills: string[];
  jdKeywordsFound: string[];
  gapsInCv: string[];
  unusedCvSkills: string[];
}

export function CvVault({ model }: { model: string }) {
  const [profile, setProfile] = useState<CvProfile | null>(null);
  const [versions, setVersions] = useState<CvVersion[]>([]);
  const [externalAllowed, setExternalAllowed] = useState(false);

  const [cvTextDraft, setCvTextDraft] = useState('');
  const [versionLabel, setVersionLabel] = useState('');
  const [targetRole, setTargetRole] = useState('');
  const [jobDescription, setJobDescription] = useState('');
  const [localMatch, setLocalMatch] = useState<LocalComparison | null>(null);
  const [coachOutput, setCoachOutput] = useState('');
  const [coachLoading, setCoachLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const loadCv = async () => {
    const res = await fetch('/api/cv');
    const data = await res.json();
    setProfile(data.profile);
    setVersions(data.versions || []);
    setExternalAllowed(Boolean(data.externalAllowed));
    if (data.profile?.raw_text) {
      setCvTextDraft(data.profile.raw_text);
    }
  };

  useEffect(() => {
    loadCv();
  }, []);

  const togglePrivacy = async () => {
    const next = !externalAllowed;
    const res = await fetch('/api/cv/privacy', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ allowExternal: next }),
    });
    const data = await res.json();
    setExternalAllowed(Boolean(data.externalAllowed));
    setStatusMessage(
      data.externalAllowed
        ? 'CV external AI consent enabled for explicit career coaching actions.'
        : 'CV locked to strictly private local mode.'
    );
  };

  const handleCvUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const form = new FormData();
    form.append('file', file);
    const res = await fetch('/api/cv/upload', { method: 'POST', body: form });
    const data = await res.json();
    if (res.ok) {
      setStatusMessage(`Parsed ${data.filename} locally and saved as a new CV version.`);
      await loadCv();
    } else {
      setStatusMessage(data.error || 'CV import failed');
    }
    e.target.value = '';
  };

  const handleSaveVersion = async () => {
    if (!versionLabel.trim() || !cvTextDraft.trim()) return;
    const res = await fetch('/api/cv/versions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        versionLabel,
        targetRole,
        rawText: cvTextDraft,
        notes: 'Saved manually in CV Vault',
      }),
    });
    if (res.ok) {
      setVersionLabel('');
      setTargetRole('');
      setStatusMessage('Saved new CV version to SQLite vault.');
      await loadCv();
    }
  };

  const handleLocalCompare = async () => {
    if (!jobDescription.trim()) return;
    const res = await fetch('/api/cv/compare-local', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobDescription }),
    });
    const data = await res.json();
    setLocalMatch(data);
  };

  const runAiCoach = async (mode: 'optimize' | 'cover_letter' | 'interview' | 'career_plan') => {
    setCoachLoading(true);
    setCoachOutput('');
    try {
      const res = await fetch('/api/cv/ai-coach', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, jobDescription, model }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Career coach blocked or failed');
      setCoachOutput(data.result || '');
    } catch (err) {
      setCoachOutput(`Notice: ${err instanceof Error ? err.message : 'Request failed'}`);
    } finally {
      setCoachLoading(false);
    }
  };

  const exportCvPdf = () => {
    if (!profile) return;
    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    doc.setFontSize(16);
    doc.text(profile.full_name, 44, 52);
    doc.setFontSize(10);
    doc.text(`${profile.education} | ${profile.location}`, 44, 70);
    doc.text(`GitHub: ${profile.github_url}`, 44, 86);

    const lines = doc.splitTextToSize(cvTextDraft || profile.raw_text, 505);
    let y = 114;
    for (const line of lines) {
      if (y > 780) {
        doc.addPage();
        y = 48;
      }
      doc.text(line, 44, y);
      y += 14;
    }
    doc.save('Remy_Nsanzimana_CV.pdf');
  };

  if (!profile) {
    return <div className="p-6 text-sm text-slate-500">Loading private CV vault...</div>;
  }

  const skills = JSON.parse(profile.skills_json) as string[];
  const projects = JSON.parse(profile.projects_json) as Array<{ name: string; category: string; stack: string[] }>;

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mx-auto max-w-6xl space-y-6">
        {/* Top Header + Privacy Gate */}
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4 dark:border-slate-800">
          <div>
            <h1 className="text-xl font-semibold text-slate-900 dark:text-white">Personal Profile & CV Intelligence</h1>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Source-of-truth profile for {profile.full_name} · Private by default
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={togglePrivacy}
              className={`inline-flex items-center gap-2 rounded-lg border px-3.5 py-2 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                externalAllowed
                  ? 'border-amber-500/50 bg-amber-500/10 text-amber-600 dark:text-amber-300'
                  : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
              }`}
            >
              {externalAllowed ? <Unlock className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
              <span>{externalAllowed ? 'CV AI Analysis Unlocked' : 'CV Locked (Private Local Only)'}</span>
            </button>

            <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-[#101724] dark:text-slate-200 whitespace-nowrap shrink-0">
              <FileUp className="h-3.5 w-3.5" />
              <span>Import PDF/DOCX</span>
              <input type="file" accept=".pdf,.docx,.txt,.md" onChange={handleCvUpload} className="hidden" />
            </label>

            <button
              type="button"
              onClick={exportCvPdf}
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-medium text-white hover:bg-blue-500 whitespace-nowrap shrink-0"
            >
              <Download className="h-3.5 w-3.5" />
              <span>Export PDF</span>
            </button>
          </div>
        </div>

        {statusMessage && (
          <div className="flex items-center gap-2 rounded-lg border border-blue-500/30 bg-blue-500/10 px-4 py-2 text-xs text-blue-700 dark:text-blue-300">
            <ShieldCheck className="h-4 w-4 shrink-0" />
            <span>{statusMessage}</span>
          </div>
        )}

        {/* Authentic Profile Summary Grid */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-[#101724]">
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Verified Identity</div>
            <div className="mt-1 text-base font-semibold text-slate-900 dark:text-white">{profile.full_name}</div>
            <div className="mt-1 text-xs text-slate-600 dark:text-slate-300">{profile.education}</div>
            <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {profile.location} ·{' '}
              <a
                href={profile.github_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-500 hover:underline"
              >
                github.com/danger600
              </a>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-[#101724]">
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Internship & Selected Projects</div>
            <div className="mt-1 text-xs font-medium text-amber-600 dark:text-amber-400">{profile.internship}</div>
            <ul className="mt-2 space-y-1 text-xs text-slate-700 dark:text-slate-300">
              {projects.map((p) => (
                <li key={p.name}>
                  {p.name} <span className="text-slate-400">· {p.category}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-[#101724]">
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
              Technical Skills ({skills.length})
            </div>
            <p className="mt-2 text-xs leading-relaxed text-slate-700 dark:text-slate-300">{skills.join(' · ')}</p>
          </div>
        </div>

        {/* Job Description Comparison (Local Offline + Optional AI Coach) */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <div className="space-y-4 lg:col-span-6">
            <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-[#101724]">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
                <Briefcase className="h-4 w-4 text-blue-500" />
                <span>Job Description Skill Matcher</span>
              </div>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Compare any job description locally with zero external data transmission, or unlock AI coaching when ready.
              </p>
              <textarea
                value={jobDescription}
                onChange={(e) => setJobDescription(e.target.value)}
                rows={5}
                placeholder="Paste a target job description (e.g., Full-Stack React/Node or Python Developer role)..."
                className="mt-3 w-full rounded-lg border border-slate-300 bg-slate-50 p-3 text-xs text-slate-900 outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              />

              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={!jobDescription.trim()}
                  onClick={handleLocalCompare}
                  className="rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50 dark:bg-blue-600 dark:hover:bg-blue-500"
                >
                  Run Local Match (Offline)
                </button>
                <button
                  type="button"
                  disabled={coachLoading}
                  onClick={() => runAiCoach('optimize')}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  <Sparkles className="h-3.5 w-3.5 text-amber-500" />
                  <span>Optimize CV</span>
                </button>
                <button
                  type="button"
                  disabled={coachLoading}
                  onClick={() => runAiCoach('cover_letter')}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  Cover Letter
                </button>
                <button
                  type="button"
                  disabled={coachLoading}
                  onClick={() => runAiCoach('interview')}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  Interview Prep
                </button>
              </div>

              {localMatch && (
                <div className="mt-4 space-y-3 border-t border-slate-200 pt-4 dark:border-slate-800">
                  <div className="flex items-baseline justify-between">
                    <span className="text-xs font-medium text-slate-600 dark:text-slate-300">Local Keyword Alignment</span>
                    <span className="font-mono text-lg font-semibold text-emerald-500 tabular-nums">
                      {localMatch.matchScorePercent}%
                    </span>
                  </div>
                  <div className="text-xs text-slate-600 dark:text-slate-300">
                    <span className="font-medium text-slate-900 dark:text-white">Matched Skills: </span>
                    {localMatch.matchedSkills.length > 0 ? localMatch.matchedSkills.join(', ') : 'None detected'}
                  </div>
                  <div className="text-xs text-amber-600 dark:text-amber-400">
                    <span className="font-medium">JD Keywords Not in CV: </span>
                    {localMatch.gapsInCv.length > 0 ? localMatch.gapsInCv.join(', ') : 'All detected JD stack keywords covered'}
                  </div>
                </div>
              )}
            </div>

            {coachOutput && (
              <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-[#101724]">
                <h3 className="mb-2 text-sm font-semibold text-slate-900 dark:text-white">Career Coach Output</h3>
                <MarkdownRenderer content={coachOutput} />
              </div>
            )}
          </div>

          {/* Right: CV Text Editor & Version History */}
          <div className="space-y-4 lg:col-span-6">
            <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-[#101724]">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-900 dark:text-white">CV Document & Version Manager</h2>
                <span className="font-mono text-xs text-slate-500 tabular-nums">{versions.length} versions</span>
              </div>

              <textarea
                value={cvTextDraft}
                onChange={(e) => setCvTextDraft(e.target.value)}
                rows={12}
                className="w-full rounded-lg border border-slate-300 bg-slate-50 p-3 font-mono text-xs leading-relaxed text-slate-900 outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />

              <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
                <input
                  type="text"
                  value={versionLabel}
                  onChange={(e) => setVersionLabel(e.target.value)}
                  placeholder="Version label (e.g. v1.1 Backend)"
                  className="rounded-lg border border-slate-300 bg-slate-50 px-3 py-1.5 text-xs text-slate-900 outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                />
                <input
                  type="text"
                  value={targetRole}
                  onChange={(e) => setTargetRole(e.target.value)}
                  placeholder="Target role"
                  className="rounded-lg border border-slate-300 bg-slate-50 px-3 py-1.5 text-xs text-slate-900 outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                />
                <button
                  type="button"
                  disabled={!versionLabel.trim()}
                  onClick={handleSaveVersion}
                  className="rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-amber-400 disabled:opacity-50"
                >
                  Save New Version
                </button>
              </div>

              <div className="mt-4 space-y-2 border-t border-slate-200 pt-3 dark:border-slate-800">
                {versions.map((v) => (
                  <div
                    key={v.id}
                    className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-xs dark:border-slate-800"
                  >
                    <div>
                      <div className="font-medium text-slate-900 dark:text-white">{v.version_label}</div>
                      <div className="text-slate-500">
                        {v.target_role || 'General'} · {new Date(v.created_at).toLocaleDateString()}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setCvTextDraft(v.raw_text)}
                      className="rounded border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                    >
                      Load
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
