import { useQuery } from '@tanstack/react-query'
import { useApi } from '../../lib/auth'
import {
  useCountries,
  useCultures,
  useLocalizationOptions,
  useServerConfig,
} from '../../lib/queries'
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

export function GeneralPanel() {
  const api = useApi()
  const { query, save } = useServerConfig()
  const cultures = useCultures()
  const countries = useCountries()
  const uiCultures = useLocalizationOptions()

  // Quick Connect is read-only here: the server exposes availability, and the
  // switch below lives in ServerConfiguration.QuickConnectAvailable.
  const quickConnect = useQuery({
    queryKey: ['quickConnectEnabled'],
    queryFn: () => api.quickConnectEnabled(),
  })

  const languageOptions = [
    { value: '', label: 'Any language' },
    ...(cultures.data ?? [])
      .filter((c) => c.TwoLetterISOLanguageName)
      .map((c) => ({ value: c.TwoLetterISOLanguageName!, label: c.DisplayName ?? c.Name ?? '' })),
  ]

  const countryOptions = [
    { value: '', label: 'Any country' },
    ...(countries.data ?? [])
      .filter((c) => c.TwoLetterISORegionName)
      .map((c) => ({ value: c.TwoLetterISORegionName!, label: c.DisplayName ?? c.Name ?? '' })),
  ]

  const uiOptions = (uiCultures.data ?? []).map((o) => ({
    value: o.Value ?? '',
    label: o.Name ?? o.Value ?? '',
  }))

  return (
    <ConfigPanel
      query={query}
      save={save}
      savedMessage="Saved. Some of these need a server restart."
      note={
        <Warning>
          Changing the metadata or cache path moves where Jellyfin writes; the server must be able
          to read and write the new location, and existing data is not moved for you.
        </Warning>
      }
    >
      {(draft, set) => (
        <>
          <Section title="Server">
            <div className="grid gap-3 sm:grid-cols-2">
              <TextInput
                label="Server name"
                value={draft.ServerName ?? ''}
                hint="Shown to clients on the network"
                onChange={(v) => set('ServerName', v)}
              />
              <Select
                label="Display language"
                value={draft.UICulture ?? ''}
                options={uiOptions.length ? uiOptions : [{ value: '', label: 'Loading…' }]}
                onChange={(v) => set('UICulture', v)}
              />
            </div>
          </Section>

          <Section
            title="Metadata"
            hint="Defaults for new libraries; each library can override them."
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <Select
                label="Preferred metadata language"
                value={draft.PreferredMetadataLanguage ?? ''}
                options={languageOptions}
                onChange={(v) => set('PreferredMetadataLanguage', v)}
              />
              <Select
                label="Metadata country"
                value={draft.MetadataCountryCode ?? ''}
                options={countryOptions}
                onChange={(v) => set('MetadataCountryCode', v)}
              />
            </div>
          </Section>

          <Section title="Paths">
            <div className="space-y-3">
              <TextInput
                label="Metadata path"
                value={draft.MetadataPath ?? ''}
                placeholder="Leave empty for the default location"
                onChange={(v) => set('MetadataPath', v)}
              />
              <TextInput
                label="Cache path"
                value={draft.CachePath ?? ''}
                placeholder="Leave empty for the default location"
                onChange={(v) => set('CachePath', v)}
              />
            </div>
          </Section>

          <Section title="Quick Connect">
            <ToggleRows>
              <ToggleRow
                label="Quick Connect"
                hint={
                  quickConnect.data === false
                    ? 'Currently reported as unavailable by the server'
                    : 'Let clients sign in with a code instead of a password'
                }
                checked={Boolean(draft.QuickConnectAvailable)}
                onChange={() => set('QuickConnectAvailable', !draft.QuickConnectAvailable)}
              />
            </ToggleRows>
          </Section>

          <Section title="Library behaviour">
            <ToggleRows>
              <ToggleRow
                label="Folder view"
                hint="Show raw media folders alongside libraries"
                checked={Boolean(draft.EnableFolderView)}
                onChange={() => set('EnableFolderView', !draft.EnableFolderView)}
              />
              <ToggleRow
                label="Group movies into collections"
                checked={Boolean(draft.EnableGroupingMoviesIntoCollections)}
                onChange={() =>
                  set(
                    'EnableGroupingMoviesIntoCollections',
                    !draft.EnableGroupingMoviesIntoCollections,
                  )
                }
              />
              <ToggleRow
                label="Group shows into collections"
                checked={Boolean(draft.EnableGroupingShowsIntoCollections)}
                onChange={() =>
                  set(
                    'EnableGroupingShowsIntoCollections',
                    !draft.EnableGroupingShowsIntoCollections,
                  )
                }
              />
              <ToggleRow
                label="Show specials within seasons"
                checked={Boolean(draft.DisplaySpecialsWithinSeasons)}
                onChange={() =>
                  set('DisplaySpecialsWithinSeasons', !draft.DisplaySpecialsWithinSeasons)
                }
              />
              <ToggleRow
                label="Allow client log upload"
                hint="Clients may send their own logs to the server"
                checked={Boolean(draft.AllowClientLogUpload)}
                onChange={() => set('AllowClientLogUpload', !draft.AllowClientLogUpload)}
              />
            </ToggleRows>
          </Section>

          <Section
            title="Performance"
            hint="Higher concurrency finishes scans sooner but competes with playback for CPU."
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <NumberInput
                label="Parallel image encoding limit"
                hint="0 uses half the available cores"
                value={draft.ParallelImageEncodingLimit ?? 0}
                min={0}
                onChange={(v) => set('ParallelImageEncodingLimit', v)}
              />
              <NumberInput
                label="Library scan concurrency"
                hint="0 picks a value from the core count"
                value={draft.LibraryScanFanoutConcurrency ?? 0}
                min={0}
                onChange={(v) => set('LibraryScanFanoutConcurrency', v)}
              />
              <NumberInput
                label="Metadata refresh concurrency"
                value={draft.LibraryMetadataRefreshConcurrency ?? 0}
                min={0}
                onChange={(v) => set('LibraryMetadataRefreshConcurrency', v)}
              />
              <NumberInput
                label="Image extraction timeout (ms)"
                value={draft.ImageExtractionTimeoutMs ?? 0}
                min={0}
                onChange={(v) => set('ImageExtractionTimeoutMs', v)}
              />
              <NumberInput
                label="Library monitor delay (s)"
                hint="How long to wait after a file change before scanning"
                value={draft.LibraryMonitorDelay ?? 0}
                min={0}
                onChange={(v) => set('LibraryMonitorDelay', v)}
              />
              <NumberInput
                label="Inactive session threshold (min)"
                value={draft.InactiveSessionThreshold ?? 0}
                min={0}
                onChange={(v) => set('InactiveSessionThreshold', v)}
              />
            </div>
          </Section>

          <Section title="Retention">
            <div className="grid gap-3 sm:grid-cols-2">
              <NumberInput
                label="Log retention (days)"
                value={draft.LogFileRetentionDays ?? 0}
                min={0}
                onChange={(v) => set('LogFileRetentionDays', v)}
              />
              <NumberInput
                label="Activity log retention (days)"
                value={draft.ActivityLogRetentionDays ?? 0}
                min={0}
                onChange={(v) => set('ActivityLogRetentionDays', v)}
              />
            </div>
          </Section>
        </>
      )}
    </ConfigPanel>
  )
}
