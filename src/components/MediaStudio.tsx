import { Download, Film, Image as ImageIcon, Loader2, Sparkles } from 'lucide-react';
import { useState } from 'react';

export function MediaStudio() {
  const [mode, setMode] = useState<'image' | 'video'>('image');
  const [prompt, setPrompt] = useState('');
  const [imageAspect, setImageAspect] = useState<'1:1' | '16:9' | '9:16' | '4:3' | '3:4'>('1:1');
  const [videoAspect, setVideoAspect] = useState<'16:9' | '9:16'>('16:9');
  const [videoDuration, setVideoDuration] = useState('8s');
  const [videoResolution, setVideoResolution] = useState<'360p' | '720p' | '1080p'>('720p');

  const [generating, setGenerating] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [imageResult, setImageResult] = useState<{
    imageDataUrl: string;
    textNote?: string;
    model: string;
    aspectRatio: string;
  } | null>(null);
  const [videoResult, setVideoResult] = useState<{
    videoDataUrl?: string;
    videoUri?: string;
    model: string;
    aspectRatio: string;
    duration: string;
    resolution: string;
  } | null>(null);

  const handleGenerate = async () => {
    if (!prompt.trim() || generating) return;
    setGenerating(true);
    setErrorMsg(null);
    try {
      if (mode === 'image') {
        const res = await fetch('/api/media/generate-image', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: prompt.trim(), aspectRatio: imageAspect }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        setImageResult(data);
      } else {
        const res = await fetch('/api/media/generate-video', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt: prompt.trim(),
            aspectRatio: videoAspect,
            duration: videoDuration,
            resolution: videoResolution,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        setVideoResult(data);
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Media generation failed.');
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4 dark:border-slate-800">
          <div>
            <h1 className="text-xl font-semibold text-slate-900 dark:text-white">AI Media Studio</h1>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Generate real images (gemini-3.1-flash-lite-image) and videos from text (gemini-omni-1.2-flash) via server-side Gemini Interactions API.
            </p>
          </div>
          <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1 dark:bg-[#101724]">
            <button
              type="button"
              onClick={() => {
                setMode('image');
                setErrorMsg(null);
              }}
              className={`inline-flex items-center gap-1.5 rounded-md px-3.5 py-1.5 text-xs font-medium ${
                mode === 'image'
                  ? 'bg-white text-slate-900 shadow-sm dark:bg-blue-600 dark:text-white'
                  : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
              }`}
            >
              <ImageIcon className="h-3.5 w-3.5" />
              <span>Image Studio</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('video');
                setErrorMsg(null);
              }}
              className={`inline-flex items-center gap-1.5 rounded-md px-3.5 py-1.5 text-xs font-medium ${
                mode === 'video'
                  ? 'bg-white text-slate-900 shadow-sm dark:bg-blue-600 dark:text-white'
                  : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
              }`}
            >
              <Film className="h-3.5 w-3.5" />
              <span>Video Studio (Omni 1.2)</span>
            </button>
          </div>
        </div>

        {/* Prompt & Parameters */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-[#101724]">
          <label className="block text-xs font-semibold text-slate-800 dark:text-slate-200">
            {mode === 'image' ? 'Image Generation Prompt' : 'Text-to-Video Scene & Motion Prompt'}
          </label>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={3}
            placeholder={
              mode === 'image'
                ? 'e.g., Minimalist obsidian and brushed-gold bull emblem on a matte black studio pedestal, dramatic rim lighting, crisp architectural photography'
                : 'e.g., Slow cinematic aerial drone glide over green hills in Kigali at sunrise, gentle golden mist rising, realistic cinematography'
            }
            className="mt-2 w-full rounded-lg border border-slate-300 bg-slate-50 p-3 text-sm text-slate-900 outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
          />

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            {mode === 'image' ? (
              <div className="flex flex-wrap items-center gap-3 text-xs">
                <label className="flex items-center gap-2 text-slate-600 dark:text-slate-300">
                  <span>Aspect Ratio</span>
                  <select
                    value={imageAspect}
                    onChange={(e) => setImageAspect(e.target.value as typeof imageAspect)}
                    className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                  >
                    <option value="1:1">1:1 Square</option>
                    <option value="16:9">16:9 Landscape</option>
                    <option value="9:16">9:16 Portrait</option>
                    <option value="4:3">4:3 Standard</option>
                    <option value="3:4">3:4 Vertical</option>
                  </select>
                </label>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-3 text-xs">
                <label className="flex items-center gap-2 text-slate-600 dark:text-slate-300">
                  <span>Aspect Ratio</span>
                  <select
                    value={videoAspect}
                    onChange={(e) => setVideoAspect(e.target.value as '16:9' | '9:16')}
                    className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                  >
                    <option value="16:9">16:9 Landscape</option>
                    <option value="9:16">9:16 Portrait</option>
                  </select>
                </label>
                <label className="flex items-center gap-2 text-slate-600 dark:text-slate-300">
                  <span>Duration</span>
                  <select
                    value={videoDuration}
                    onChange={(e) => setVideoDuration(e.target.value)}
                    className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                  >
                    <option value="5s">5 seconds</option>
                    <option value="8s">8 seconds</option>
                    <option value="10s">10 seconds</option>
                    <option value="15s">15 seconds</option>
                  </select>
                </label>
                <label className="flex items-center gap-2 text-slate-600 dark:text-slate-300">
                  <span>Resolution</span>
                  <select
                    value={videoResolution}
                    onChange={(e) => setVideoResolution(e.target.value as '360p' | '720p' | '1080p')}
                    className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                  >
                    <option value="360p">360p (Fast)</option>
                    <option value="720p">720p (HD)</option>
                    <option value="1080p">1080p (Full HD)</option>
                  </select>
                </label>
              </div>
            )}

            <button
              type="button"
              disabled={generating || !prompt.trim()}
              onClick={handleGenerate}
              className="inline-flex items-center gap-2 rounded-lg bg-amber-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              <span>
                {generating
                  ? mode === 'image'
                    ? 'Generating Image...'
                    : 'Generating Video (Omni 1.2)...'
                  : mode === 'image'
                  ? 'Generate Image'
                  : 'Generate Video'}
              </span>
            </button>
          </div>
        </div>

        {errorMsg && (
          <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-xs text-amber-700 dark:text-amber-200">
            {errorMsg}
          </div>
        )}

        {/* Output Preview */}
        {mode === 'image' && imageResult && (
          <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-[#101724]">
            <div className="mb-3 flex items-center justify-between text-xs text-slate-500">
              <span className="font-mono">
                {imageResult.model} · {imageResult.aspectRatio}
              </span>
              <a
                href={imageResult.imageDataUrl}
                download={`remy-image-${Date.now()}.png`}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <Download className="h-3.5 w-3.5" />
                <span>Download PNG</span>
              </a>
            </div>
            <div className="overflow-hidden rounded-lg border border-slate-200 bg-slate-950 dark:border-slate-800">
              <img src={imageResult.imageDataUrl} alt="Generated output" className="mx-auto max-h-[520px] w-auto object-contain" />
            </div>
            {imageResult.textNote && (
              <p className="mt-3 text-xs text-slate-600 dark:text-slate-400">{imageResult.textNote}</p>
            )}
          </div>
        )}

        {mode === 'video' && videoResult && (
          <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-[#101724]">
            <div className="mb-3 flex items-center justify-between text-xs text-slate-500">
              <span className="font-mono">
                {videoResult.model} · {videoResult.aspectRatio} · {videoResult.duration} · {videoResult.resolution}
              </span>
              {(videoResult.videoDataUrl || videoResult.videoUri) && (
                <a
                  href={videoResult.videoDataUrl || videoResult.videoUri}
                  download={`remy-video-${Date.now()}.mp4`}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  <Download className="h-3.5 w-3.5" />
                  <span>Download Video</span>
                </a>
              )}
            </div>
            <div className="overflow-hidden rounded-lg border border-slate-200 bg-slate-950 dark:border-slate-800">
              <video
                src={videoResult.videoDataUrl || videoResult.videoUri}
                controls
                playsInline
                className="mx-auto max-h-[520px] w-full"
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
