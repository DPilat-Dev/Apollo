import { useEffect, useState } from 'react'
import type {
  BaseItemDto,
  MediaSourceInfo,
  MediaStream,
} from '@jellyfin/sdk/lib/generated-client/models'

export interface TrackSelection {
  mediaSourceId?: string
  audioIndex?: number
  subtitleIndex?: number | null
}

/**
 * What's actually in the file, and which tracks playback should start with.
 *
 * Choosing here rather than mid-playback matters because the server decides
 * audio and burned-in subtitles when it builds the stream: picking first means
 * one transcode instead of starting, switching, and restarting.
 */
export function MediaTracks({
  item,
  selection,
  onChange,
}: {
  item: BaseItemDto
  selection: TrackSelection
  onChange: (next: TrackSelection) => void
}) {
  const sources = item.MediaSources ?? []
  const source =
    sources.find((s) => s.Id === selection.mediaSourceId) ?? sources[0] ?? null

  // Default to the file's own preferred tracks until the user picks otherwise.
  useEffect(() => {
    if (!source) return
    if (selection.mediaSourceId === source.Id) return
    const audio = streamsOf(source, 'Audio')
    onChange({
      mediaSourceId: source.Id ?? undefined,
      audioIndex: (audio.find((s) => s.IsDefault) ?? audio[0])?.Index ?? undefined,
      subtitleIndex: null,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source?.Id])

  if (!source) return null

  const video = streamsOf(source, 'Video')
  const audio = streamsOf(source, 'Audio')
  const subs = streamsOf(source, 'Subtitle')

  return (
    <section className="mt-10 px-4 sm:px-14">
      <h2 className="mb-4 text-xl font-semibold">Video &amp; Audio</h2>

      <div className="max-w-3xl space-y-4">
        {sources.length > 1 && (
          <Picker
            label="Version"
            value={source.Id ?? ''}
            options={sources.map((s) => ({
              value: s.Id ?? '',
              label: versionLabel(s),
            }))}
            onChange={(value) => onChange({ ...selection, mediaSourceId: value })}
          />
        )}

        <div className="rounded-xl border border-white/10 bg-ink-soft/50 p-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-white/40">
            Video
          </p>
          {video.length === 0 ? (
            <p className="text-sm text-white/40">No video track.</p>
          ) : (
            video.map((s) => (
              <p key={s.Index} className="text-sm text-white/80">
                {s.DisplayTitle ?? describeVideo(s)}
              </p>
            ))
          )}
          <p className="mt-1 text-xs text-white/40">
            {[
              source.Container?.toUpperCase(),
              source.Size ? `${(source.Size / 1_000_000_000).toFixed(2)} GB` : null,
              source.Bitrate ? `${(source.Bitrate / 1_000_000).toFixed(1)} Mbps` : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>

        <Picker
          label={`Audio${audio.length ? ` · ${audio.length} track${audio.length > 1 ? 's' : ''}` : ''}`}
          value={String(selection.audioIndex ?? '')}
          options={audio.map((s) => ({
            value: String(s.Index),
            label: s.DisplayTitle ?? describeAudio(s),
          }))}
          empty="No audio tracks"
          onChange={(value) => onChange({ ...selection, audioIndex: Number(value) })}
        />

        <Picker
          label={`Subtitles${subs.length ? ` · ${subs.length} track${subs.length > 1 ? 's' : ''}` : ''}`}
          value={selection.subtitleIndex == null ? '' : String(selection.subtitleIndex)}
          options={[
            { value: '', label: 'Off' },
            ...subs.map((s) => ({
              value: String(s.Index),
              label: `${s.DisplayTitle ?? s.Language ?? `Track ${s.Index}`}${
                s.IsExternal ? ' (external)' : ''
              }${s.IsForced ? ' (forced)' : ''}`,
            })),
          ]}
          onChange={(value) =>
            onChange({ ...selection, subtitleIndex: value === '' ? null : Number(value) })
          }
        />
      </div>
    </section>
  )
}

function streamsOf(source: MediaSourceInfo, type: string): MediaStream[] {
  return (source.MediaStreams ?? []).filter((s) => s.Type === type)
}

function versionLabel(s: MediaSourceInfo) {
  const video = (s.MediaStreams ?? []).find((m) => m.Type === 'Video')
  const resolution = video?.Height ? `${video.Height}p` : null
  // Source names often already say "1080p"; don't repeat it back.
  const name = s.Name ?? null
  const parts = [
    name,
    resolution && !name?.toLowerCase().includes(resolution) ? resolution : null,
    s.Container?.toUpperCase(),
  ]
  return parts.filter(Boolean).join(' · ')
}

function describeVideo(s: MediaStream) {
  return [
    s.Codec?.toUpperCase(),
    s.Width && s.Height ? `${s.Width}×${s.Height}` : null,
    s.VideoRangeType && s.VideoRangeType !== 'SDR' ? s.VideoRangeType : null,
    s.BitRate ? `${(s.BitRate / 1_000_000).toFixed(1)} Mbps` : null,
  ]
    .filter(Boolean)
    .join(' · ')
}

function describeAudio(s: MediaStream) {
  return [s.Language, s.Codec?.toUpperCase(), s.Channels ? `${s.Channels}ch` : null]
    .filter(Boolean)
    .join(' · ')
}

function Picker({
  label,
  value,
  options,
  empty,
  onChange,
}: {
  label: string
  value: string
  options: { value: string; label: string }[]
  empty?: string
  onChange: (value: string) => void
}) {
  return (
    <label className="block rounded-xl border border-white/10 bg-ink-soft/50 p-4">
      <span className="mb-2 block text-xs font-semibold uppercase tracking-wider text-white/40">
        {label}
      </span>
      {options.length === 0 ? (
        <p className="text-sm text-white/40">{empty ?? 'None'}</p>
      ) : (
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-lg border border-white/15 bg-ink-soft px-3 py-2 text-sm outline-none transition hover:border-white/35"
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )}
    </label>
  )
}

/** Turns a selection into the query string the player reads. */
export function trackParams(selection: TrackSelection): string {
  const params = new URLSearchParams()
  if (selection.mediaSourceId) params.set('source', selection.mediaSourceId)
  if (selection.audioIndex != null) params.set('audio', String(selection.audioIndex))
  if (selection.subtitleIndex != null) params.set('subtitle', String(selection.subtitleIndex))
  const query = params.toString()
  return query ? `?${query}` : ''
}

export function useTrackSelection() {
  return useState<TrackSelection>({})
}
