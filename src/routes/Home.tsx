import { useMemo, useRef } from 'react'
import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models'
import { Billboard } from '../components/Billboard'
import { Row } from '../components/Row'
import { useItemsRow, useLatest, useNextUp, useResume, useViews } from '../lib/queries'

export function Home() {
  const { data: views } = useViews()
  const resume = useResume()
  const nextUp = useNextUp()

  const movieView = views?.find((v) => v.CollectionType === 'movies')
  const libraries = (views ?? []).filter((v) => v.CollectionType !== 'livetv')

  const trending = useItemsRow('trending', {
    includeItemTypes: ['Movie', 'Series'],
    recursive: true,
    sortBy: ['CommunityRating'],
    sortOrder: ['Descending'],
    limit: 20,
    minCommunityRating: 7,
  })

  /*
    The hero is drawn from what this person actually watches: things they are
    part-way through, plus a random pick of things they have finished. Random
    ordering comes from the server so it differs between visits rather than
    being the same five titles forever.
  */
  const watchedAgain = useItemsRow('watchedAgain', {
    includeItemTypes: ['Movie', 'Series'],
    recursive: true,
    isPlayed: true,
    sortBy: ['Random'],
    limit: 20,
  })

  const recentlyAdded = useItemsRow('recentlyAdded', {
    includeItemTypes: ['Movie', 'Series'],
    recursive: true,
    sortBy: ['DateCreated'],
    sortOrder: ['Descending'],
    limit: 20,
  })

  const favorites = useItemsRow('favorites', {
    includeItemTypes: ['Movie', 'Series'],
    recursive: true,
    isFavorite: true,
    limit: 20,
  })

  const unwatchedMovies = useItemsRow(
    'unwatched',
    {
      parentId: movieView?.Id,
      includeItemTypes: ['Movie'],
      recursive: true,
      isPlayed: false,
      sortBy: ['Random'],
      limit: 20,
    },
    Boolean(movieView?.Id),
  )

  /*
    Shuffled once per visit rather than on every render: a seed fixed at mount
    keeps the order stable while you are on the page, but different next time.
  */
  const shuffleSeed = useRef(Math.random())

  const billboardItems = useMemo<BaseItemDto[]>(() => {
    const personal = [...(resume.data ?? []), ...(watchedAgain.data ?? [])]

    // A hero without wide art looks broken, so art is a hard requirement —
    // episodes inherit their series' backdrop, which counts.
    const hasArt = (i: BaseItemDto) =>
      Boolean(i.BackdropImageTags?.length || i.ParentBackdropImageTags?.length)

    const seen = new Set<string>()
    const dedupe = (items: BaseItemDto[]) =>
      items.filter((i) => {
        if (!i.Id || seen.has(i.Id)) return false
        seen.add(i.Id)
        return true
      })

    const chosen = shuffle(dedupe(personal.filter(hasArt)), shuffleSeed.current)

    // Nothing watched yet — fall back so a new account still gets a hero.
    if (chosen.length >= 3) return chosen
    const fallback = dedupe([...(trending.data ?? []), ...(recentlyAdded.data ?? [])].filter(hasArt))
    return [...chosen, ...fallback]
  }, [resume.data, watchedAgain.data, trending.data, recentlyAdded.data])

  return (
    <div className="pb-24">
      <Billboard items={billboardItems} />

      {/*
        Rows ride up into the billboard's fade so the transition reads as one
        surface. Keep this smaller than the billboard's bottom padding — going
        past it puts the first row on top of the Play / More Info buttons.
      */}
      <div className="relative z-10 -mt-8 sm:-mt-16">
        <Row
          title="Continue Watching"
          items={resume.data}
          isLoading={resume.isLoading}
          error={resume.error}
          onRetry={() => void resume.refetch()}
          shape="landscape"
          showProgress
        />
        <Row
          title="Next Up"
          items={nextUp.data}
          isLoading={nextUp.isLoading}
          error={nextUp.error}
          onRetry={() => void nextUp.refetch()}
          shape="landscape"
        />
        <Row
          title="Recently Added"
          items={recentlyAdded.data}
          isLoading={recentlyAdded.isLoading}
          error={recentlyAdded.error}
          onRetry={() => void recentlyAdded.refetch()}
        />
        <Row
          title="Top Rated"
          items={trending.data}
          isLoading={trending.isLoading}
          error={trending.error}
          onRetry={() => void trending.refetch()}
        />

        {/* One row per library, the way Jellyfin's own home is laid out. A
            child component so each can own its query without breaking the
            rules of hooks as `views` loads. */}
        {libraries.map((view) => (
          <LatestInLibrary key={view.Id} view={view} />
        ))}
        <Row
          title="My List"
          items={favorites.data}
          isLoading={favorites.isLoading}
          error={favorites.error}
          onRetry={() => void favorites.refetch()}
        />
        <Row
          title="Because You Haven't Watched It Yet"
          items={unwatchedMovies.data}
          isLoading={unwatchedMovies.isLoading}
          error={unwatchedMovies.error}
          onRetry={() => void unwatchedMovies.refetch()}
        />
      </div>
    </div>
  )
}

/** "Recently Added in Movies" — /Items/Latest scoped to one library. */
function LatestInLibrary({ view }: { view: BaseItemDto }) {
  const { data, isLoading, error, refetch } = useLatest(view.Id ?? undefined, 20)
  return (
    <Row
      title={`Recently Added in ${view.Name ?? 'Library'}`}
      items={data}
      isLoading={isLoading}
      error={error}
      onRetry={() => void refetch()}
    />
  )
}

/** Deterministic shuffle so a fixed seed gives a stable order. */
function shuffle<T>(items: T[], seed: number): T[] {
  const out = [...items]
  let random = seed
  for (let i = out.length - 1; i > 0; i--) {
    // Cheap LCG — this only has to look unordered, not be cryptographic.
    random = (random * 9301 + 49297) % 233280
    const j = Math.floor((random / 233280) * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}
