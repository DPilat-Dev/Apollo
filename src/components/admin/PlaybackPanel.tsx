import { useState } from 'react'
import { useEncodingConfig, useServerConfig } from '../../lib/queries'
import {
  ConfigPanel,
  NumberInput,
  Section,
  Select,
  TextInput,
  ToggleRow,
  ToggleRows,
  Warning,
} from './controls'

const SUBTABS = ['Resume', 'Streaming', 'Transcoding', 'Trickplay'] as const
type SubTab = (typeof SUBTABS)[number]

const HW_ACCEL = [
  { value: '', label: 'None (software)' },
  { value: 'qsv', label: 'Intel QuickSync (QSV)' },
  { value: 'nvenc', label: 'NVIDIA NVENC' },
  { value: 'amf', label: 'AMD AMF' },
  { value: 'vaapi', label: 'VAAPI' },
  { value: 'videotoolbox', label: 'Apple VideoToolbox' },
  { value: 'rkmpp', label: 'Rockchip MPP' },
  { value: 'v4l2m2m', label: 'Video4Linux2' },
]

const PRESETS = ['auto', 'veryslow', 'slower', 'slow', 'medium', 'fast', 'faster', 'veryfast', 'superfast', 'ultrafast']

export function PlaybackPanel() {
  const [sub, setSub] = useState<SubTab>('Resume')

  return (
    <div>
      <div className="mb-5 flex flex-wrap gap-1.5">
        {SUBTABS.map((s) => (
          <button
            key={s}
            onClick={() => setSub(s)}
            className={`rounded-lg px-3.5 py-1.5 text-sm transition ${
              sub === s ? 'bg-accent text-white' : 'bg-white/8 text-white/60 hover:bg-white/15'
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      {sub === 'Resume' && <ResumeSection />}
      {sub === 'Streaming' && <StreamingSection />}
      {sub === 'Transcoding' && <TranscodingSection />}
      {sub === 'Trickplay' && <TrickplaySection />}
    </div>
  )
}

function ResumeSection() {
  const { query, save } = useServerConfig()
  return (
    <ConfigPanel query={query} save={save}>
      {(draft, set) => (
        <Section
          title="Resume thresholds"
          hint="Below the minimum, playback starts over; above the maximum, it counts as watched."
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <NumberInput
              label="Minimum resume (%)"
              value={draft.MinResumePct ?? 0}
              min={0}
              max={100}
              onChange={(v) => set('MinResumePct', v)}
            />
            <NumberInput
              label="Maximum resume (%)"
              value={draft.MaxResumePct ?? 0}
              min={0}
              max={100}
              onChange={(v) => set('MaxResumePct', v)}
            />
            <NumberInput
              label="Minimum resume duration (s)"
              hint="Titles shorter than this never appear in Continue Watching"
              value={draft.MinResumeDurationSeconds ?? 0}
              min={0}
              onChange={(v) => set('MinResumeDurationSeconds', v)}
            />
            <NumberInput
              label="Minimum audiobook resume (%)"
              value={draft.MinAudiobookResume ?? 0}
              min={0}
              max={100}
              onChange={(v) => set('MinAudiobookResume', v)}
            />
            <NumberInput
              label="Maximum audiobook resume (%)"
              value={draft.MaxAudiobookResume ?? 0}
              min={0}
              max={100}
              onChange={(v) => set('MaxAudiobookResume', v)}
            />
          </div>
        </Section>
      )}
    </ConfigPanel>
  )
}

function StreamingSection() {
  const { query, save } = useServerConfig()
  return (
    <ConfigPanel query={query} save={save}>
      {(draft, set) => (
        <>
          <Section title="Bandwidth">
            <NumberInput
              label="Remote client bitrate limit (Mbps)"
              hint="0 means no limit. Applies to clients outside the local network."
              value={Math.round((draft.RemoteClientBitrateLimit ?? 0) / 1_000_000)}
              min={0}
              onChange={(v) => set('RemoteClientBitrateLimit', v * 1_000_000)}
            />
          </Section>

          <Section title="Chapter images">
            <div className="grid gap-3 sm:grid-cols-2">
              <NumberInput
                label="Dummy chapter duration (s)"
                hint="0 disables generated chapters for media without them"
                value={draft.DummyChapterDuration ?? 0}
                min={0}
                onChange={(v) => set('DummyChapterDuration', v)}
              />
              <TextInput
                label="Chapter image resolution"
                value={String(draft.ChapterImageResolution ?? '')}
                onChange={(v) =>
                  set('ChapterImageResolution', v as typeof draft.ChapterImageResolution)
                }
              />
            </div>
          </Section>
        </>
      )}
    </ConfigPanel>
  )
}

function TranscodingSection() {
  const { query, save } = useEncodingConfig()
  return (
    <ConfigPanel
      query={query}
      save={save}
      note={
        <Warning>
          Hardware acceleration only works if the server can reach the device and ffmpeg was built
          with support for it. If playback starts failing after a change here, set it back to None.
        </Warning>
      }
    >
      {(draft, set) => (
        <>
          <Section title="Hardware acceleration">
            <div className="grid gap-3 sm:grid-cols-2">
              <Select
                label="Acceleration"
                value={draft.HardwareAccelerationType ?? ''}
                options={HW_ACCEL}
                onChange={(v) =>
                  set('HardwareAccelerationType', v as typeof draft.HardwareAccelerationType)
                }
              />
              <TextInput
                label="Device (VAAPI / QSV)"
                value={draft.VaapiDevice ?? ''}
                placeholder="/dev/dri/renderD128"
                onChange={(v) => set('VaapiDevice', v)}
              />
            </div>
            <div className="mt-3">
              <ToggleRows>
                <ToggleRow
                  label="Hardware encoding"
                  hint="Encode as well as decode on the GPU"
                  checked={Boolean(draft.EnableHardwareEncoding)}
                  onChange={() => set('EnableHardwareEncoding', !draft.EnableHardwareEncoding)}
                />
                <ToggleRow
                  label="Allow HEVC encoding"
                  checked={Boolean(draft.AllowHevcEncoding)}
                  onChange={() => set('AllowHevcEncoding', !draft.AllowHevcEncoding)}
                />
                <ToggleRow
                  label="Allow AV1 encoding"
                  checked={Boolean(draft.AllowAv1Encoding)}
                  onChange={() => set('AllowAv1Encoding', !draft.AllowAv1Encoding)}
                />
                <ToggleRow
                  label="Tone mapping"
                  hint="Convert HDR to SDR when the client cannot handle HDR"
                  checked={Boolean(draft.EnableTonemapping)}
                  onChange={() => set('EnableTonemapping', !draft.EnableTonemapping)}
                />
                <ToggleRow
                  label="VPP tone mapping"
                  hint="Intel-specific tone mapping path"
                  checked={Boolean(draft.EnableVppTonemapping)}
                  onChange={() => set('EnableVppTonemapping', !draft.EnableVppTonemapping)}
                />
              </ToggleRows>
            </div>
          </Section>

          <Section title="Quality">
            <div className="grid gap-3 sm:grid-cols-2">
              <Select
                label="Encoder preset"
                hint="Faster presets use less CPU and more bitrate"
                value={draft.EncoderPreset ?? 'auto'}
                options={PRESETS.map((p) => ({ value: p, label: p }))}
                onChange={(v) => set('EncoderPreset', v as typeof draft.EncoderPreset)}
              />
              <NumberInput
                label="Encoding threads"
                hint="0 lets ffmpeg decide"
                value={draft.EncodingThreadCount ?? 0}
                min={-1}
                onChange={(v) => set('EncodingThreadCount', v)}
              />
              <NumberInput
                label="H.264 CRF"
                hint="Lower is better quality. 23 is a common default."
                value={draft.H264Crf ?? 23}
                min={0}
                max={51}
                onChange={(v) => set('H264Crf', v)}
              />
              <NumberInput
                label="H.265 CRF"
                value={draft.H265Crf ?? 28}
                min={0}
                max={51}
                onChange={(v) => set('H265Crf', v)}
              />
            </div>
          </Section>

          <Section title="Throttling and cleanup">
            <ToggleRows>
              <ToggleRow
                label="Throttle transcodes"
                hint="Pause encoding once enough is buffered ahead"
                checked={Boolean(draft.EnableThrottling)}
                onChange={() => set('EnableThrottling', !draft.EnableThrottling)}
              />
              <ToggleRow
                label="Delete old segments"
                hint="Remove HLS segments the client has already played"
                checked={Boolean(draft.EnableSegmentDeletion)}
                onChange={() => set('EnableSegmentDeletion', !draft.EnableSegmentDeletion)}
              />
              <ToggleRow
                label="Audio VBR"
                checked={Boolean(draft.EnableAudioVbr)}
                onChange={() => set('EnableAudioVbr', !draft.EnableAudioVbr)}
              />
              <ToggleRow
                label="Subtitle extraction"
                hint="Pull embedded subtitles out ahead of playback"
                checked={Boolean(draft.EnableSubtitleExtraction)}
                onChange={() => set('EnableSubtitleExtraction', !draft.EnableSubtitleExtraction)}
              />
            </ToggleRows>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <NumberInput
                label="Throttle delay (s)"
                value={draft.ThrottleDelaySeconds ?? 0}
                min={0}
                onChange={(v) => set('ThrottleDelaySeconds', v)}
              />
              <NumberInput
                label="Segments to keep (s)"
                value={draft.SegmentKeepSeconds ?? 0}
                min={0}
                onChange={(v) => set('SegmentKeepSeconds', v)}
              />
            </div>
          </Section>

          <Section title="Paths">
            <div className="space-y-3">
              <TextInput
                label="Transcode temp path"
                value={draft.TranscodingTempPath ?? ''}
                placeholder="Leave empty for the default"
                hint="Point this at fast storage; transcodes write a lot"
                onChange={(v) => set('TranscodingTempPath', v)}
              />
              <TextInput
                label="ffmpeg path"
                value={draft.EncoderAppPath ?? ''}
                onChange={(v) => set('EncoderAppPath', v)}
              />
              <TextInput
                label="Fallback font path"
                value={draft.FallbackFontPath ?? ''}
                onChange={(v) => set('FallbackFontPath', v)}
              />
            </div>
          </Section>
        </>
      )}
    </ConfigPanel>
  )
}

/**
 * Trickplay lives inside ServerConfiguration rather than its own section, so
 * this edits a nested object and writes the whole document back.
 */
function TrickplaySection() {
  const { query, save } = useServerConfig()
  return (
    <ConfigPanel
      query={query}
      save={save}
      note={
        <Warning>
          Trickplay images are generated per library and can take a long time on a large
          collection. Enable extraction on the libraries that need it under the Libraries tab.
        </Warning>
      }
    >
      {(draft, set) => {
        const tp = draft.TrickplayOptions ?? {}
        const setTp = <K extends keyof typeof tp>(key: K, value: (typeof tp)[K]) =>
          set('TrickplayOptions', { ...tp, [key]: value })

        return (
          <>
            <Section title="Generation">
              <ToggleRows>
                <ToggleRow
                  label="Hardware acceleration"
                  hint="Use the GPU to decode while generating thumbnails"
                  checked={Boolean(tp.EnableHwAcceleration)}
                  onChange={() => setTp('EnableHwAcceleration', !tp.EnableHwAcceleration)}
                />
                <ToggleRow
                  label="Hardware encoding"
                  checked={Boolean(tp.EnableHwEncoding)}
                  onChange={() => setTp('EnableHwEncoding', !tp.EnableHwEncoding)}
                />
                <ToggleRow
                  label="Key-frame only extraction"
                  hint="Much faster, slightly less precise scrubbing"
                  checked={Boolean(tp.EnableKeyFrameOnlyExtraction)}
                  onChange={() =>
                    setTp('EnableKeyFrameOnlyExtraction', !tp.EnableKeyFrameOnlyExtraction)
                  }
                />
              </ToggleRows>
            </Section>

            <Section title="Output">
              <div className="grid gap-3 sm:grid-cols-2">
                <NumberInput
                  label="Interval (ms)"
                  hint="Time between thumbnails"
                  value={tp.Interval ?? 10000}
                  min={1000}
                  onChange={(v) => setTp('Interval', v)}
                />
                <TextInput
                  label="Width resolutions"
                  hint="Comma separated, e.g. 320"
                  value={(tp.WidthResolutions ?? []).join(',')}
                  onChange={(v) =>
                    setTp(
                      'WidthResolutions',
                      v
                        .split(',')
                        .map((s) => Number(s.trim()))
                        .filter((n) => Number.isFinite(n) && n > 0),
                    )
                  }
                />
                <NumberInput
                  label="Tile width"
                  value={tp.TileWidth ?? 10}
                  min={1}
                  onChange={(v) => setTp('TileWidth', v)}
                />
                <NumberInput
                  label="Tile height"
                  value={tp.TileHeight ?? 10}
                  min={1}
                  onChange={(v) => setTp('TileHeight', v)}
                />
                <NumberInput
                  label="JPEG quality"
                  value={tp.JpegQuality ?? 90}
                  min={1}
                  max={100}
                  onChange={(v) => setTp('JpegQuality', v)}
                />
                <NumberInput
                  label="Qscale"
                  hint="-1 uses JPEG quality instead"
                  value={tp.Qscale ?? 4}
                  min={-1}
                  max={31}
                  onChange={(v) => setTp('Qscale', v)}
                />
                <NumberInput
                  label="Process threads"
                  value={tp.ProcessThreads ?? 0}
                  min={0}
                  onChange={(v) => setTp('ProcessThreads', v)}
                />
              </div>
            </Section>
          </>
        )
      }}
    </ConfigPanel>
  )
}
