import { useMemo, useRef } from 'react'
import { Link } from 'react-router-dom'
import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models'
import { Billboard } from '../components/Billboard'
import { Row } from '../components/Row'
import {
  useBoxSets,
  useCurrentUser,
  useItemsRow,
  useLatest,
  useNextUp,
  useRecapLink,
  useRemoveFromResume,
  useResume,
  useViews,
} from '../lib/queries'
import { shouldShowCollections } from '../lib/boxSets'
import { isBrowsableLibrary } from '../lib/collections'
import { querySurface } from '../lib/querySurface'
import { useDocumentTitle } from '../lib/useDocumentTitle'
import { pageTitle } from '../lib/pageTitle'
import { LoadFailure } from '../components/LoadFailure'

/** Enough to fill the shelf without building a hundred cards nobody scrolls to. */
const COLLECTIONS_IN_ROW = 24

export function Home() {
  const viewsQuery = useViews()
  const { data: views } = viewsQuery
  /*
    The user, not `useIsAdmin()`. That returns false while `/Users/Me` is still
    in flight, which is indistinguishable from "not an administrator" — so if
    `/UserViews` answered `[]` first, the owner of the server was told their own
    account had been granted nothing and to go and ask whoever runs it.
  */
  const me = useCurrentUser()
  const isAdmin = Boolean(me.data?.Policy?.IsAdministrator)
  const resume = useResume()
  const nextUp = useNextUp()
  const removeFromResume = useRemoveFromResume()
  const boxSets = useBoxSets()
  const recap = useRecapLink()

  useDocumentTitle(pageTitle())

  const movieView = views?.find((v) => v.CollectionType === 'movies')
  const libraries = (views ?? []).filter((v) => isBrowsableLibrary(v.CollectionType))

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

  /*
    Said out loud rather than drawn as an empty page.

    Everything below is library content, and every piece of it renders nothing
    when it has nothing — the billboard holds its box open, each row returns
    null — so an account with no libraries got a nav bar over 84vh of empty
    hero and no explanation. Placed after every hook above, because the hooks
    have to run in the same order whichever of these comes back.

    Asked about `libraries` and not about the raw answer, which is not the same
    list: Apollo has no live-TV surface, so a guide is filtered out of the rows
    below and has to be filtered out of this question too. Otherwise an account
    holding nothing but Live TV is `ready`, and gets exactly the blank hero this
    exists to prevent.
  */
  const surface = querySurface({
    isPending: viewsQuery.isPending,
    isError: viewsQuery.isError,
    data: views ? libraries : undefined,
  })
  /*
    The empty case waits for the account as well. It is the one branch whose
    wording depends on who is reading it, and an administrator told to go and
    ask an administrator for access is worse than a moment of loading.
  */
  if (surface === 'failed' || (surface === 'empty' && !me.isPending)) {
    return (
      <div className="mx-auto max-w-2xl px-4 pb-24 pt-32 sm:px-14">
        <h1 className="text-2xl font-bold sm:text-3xl">
          {surface === 'failed' ? "Your libraries didn't load" : 'Nothing to watch here yet'}
        </h1>
        {surface === 'failed' ? (
          /* The heading has said what happened, so the panel says why — and its
             fallback is for a server that did not give a reason, rather than the
             heading again in other words. */
          <LoadFailure
            error={viewsQuery.error}
            fallback="The server did not say why."
            onRetry={() => void viewsQuery.refetch()}
            className="mt-4"
          />
        ) : (
          <>
            <p className="mt-3 text-sm text-white/55">
              {/* True of an account with no libraries and of one holding only a
                  TV guide, which lands here for the same reason. */}
              {isAdmin
                ? 'This server has no libraries of films or shows yet. Point one at a folder and this page fills itself in.'
                : 'This account has not been given access to any films or shows. Whoever runs the server can grant it — until then there is nothing for Apollo to show.'}
            </p>
            {isAdmin && (
              <Link
                to="/admin"
                className="mt-5 inline-block rounded bg-accent px-4 py-2 text-sm font-semibold transition hover:bg-accent-hot"
              >
                Add a library
              </Link>
            )}
          </>
        )}
      </div>
    )
  }

  return (
    <div className="pb-24">
      <Billboard items={billboardItems} />

      {/*
        Rows ride up into the billboard's fade so the transition reads as one
        surface. Keep this smaller than the billboard's bottom padding — going
        past it puts the first row on top of the Play / More Info buttons.
      */}
      <div className="relative z-10 -mt-8 sm:-mt-16">
        {/*
          December and January only, and only once the probe has found viewing
          in the year — `useRecapLink` returns nothing the rest of the time, so
          for ten months this strip is not in the tree at all. It sits above the
          rows because it is the one thing on this page with a season, and below
          the billboard because it is not what anyone came here to press.
        */}
        {recap && (
          <div className="mb-6 px-4 sm:px-14">
            <Link
              to={recap.href}
              className="inline-flex items-center gap-2 rounded-full border border-accent/40 bg-accent/10 px-4 py-2 text-sm font-semibold text-accent transition hover:border-accent hover:bg-accent/20"
            >
              {recap.label}
              <span aria-hidden className="text-white/50">
                →
              </span>
            </Link>
          </div>
        )}
        {/*
          Dismissal belongs to this row alone. What the × does is clear the
          saved position, and a position is the only reason anything is in this
          row — every other row is a query over the library (newest, favourite,
          highest rated), where the card is not a piece of state the viewer put
          there and there is nothing to remove but the film itself. Next Up is
          the near miss: it looks dismissable, but it is derived from played
          state, so an × there would have to mark an episode watched to make it
          go, which is a claim about the viewer rather than a tidy-up.
        */}
        <Row
          title="Continue Watching"
          items={resume.data}
          isLoading={resume.isLoading}
          error={resume.error}
          onRetry={() => void resume.refetch()}
          shape="landscape"
          showProgress
          onRemove={(item) => {
            if (item.Id) removeFromResume.mutate(item.Id)
          }}
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

        {/* Gated on the query rather than left to Row's own empty check: Row
            still draws its heading and skeletons while loading, which on a
            server with no collections is a shelf that appears and then leaves.
            Somebody who has curated none should never see the word at all. */}
        {shouldShowCollections(boxSets) && (
          <Row title="Collections" items={boxSets.data?.slice(0, COLLECTIONS_IN_ROW)} />
        )}
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
