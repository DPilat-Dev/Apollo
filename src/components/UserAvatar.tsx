import { useEffect, useState } from 'react'
import { avatarView, type AvatarInput } from '../lib/userImages'

interface Props extends AvatarInput {
  /** Size, shape and background — every place an avatar appears wants its own. */
  className?: string
  /** Sign-in draws two of these above the fold and does not want them lazy. */
  eager?: boolean
}

/**
 * A user's face, or the first letter of their name.
 *
 * One component for all five of them — the nav, the sign-in picker, both
 * dashboard lists and the user editor. They were five copies of
 * `name.charAt(0).toUpperCase()`, which is how they came to disagree about an
 * account with no name at all, and adding pictures five times over would have
 * been the same mistake with more of it.
 *
 * Which of the two to draw, and how to crop a picture that is not square, are
 * `avatarView`'s to decide; this only renders the answer.
 */
export function UserAvatar({ className = '', eager = false, ...input }: Props) {
  const view = avatarView(input)

  /*
    A tag is a promise that a picture exists, and it can be broken. This server
    stores a zero-byte file when its own upload fails, so the account keeps a
    tag pointing at nothing and the avatar became an empty box with the letter
    gone — the fallback keyed on the tag being absent, and it was present.

    Keyed on the URL so a new picture gets a fresh attempt rather than
    inheriting the last one's failure.
  */
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [view.src])

  return (
    <span
      className={`flex items-center justify-center overflow-hidden ${className}`}
      aria-hidden="true"
    >
      {view.src && !failed ? (
        <img
          src={view.src}
          onError={() => setFailed(true)}
          alt=""
          loading={eager ? 'eager' : 'lazy'}
          fetchPriority={eager ? 'high' : 'auto'}
          decoding="async"
          // Cover, never contain: letterboxing a photograph inside a circle
          // leaves bars of background where a face should be. What that crop
          // keeps is the aspect ratio's business.
          className="h-full w-full object-cover"
          style={{ objectPosition: view.objectPosition }}
        />
      ) : (
        view.initial
      )}
    </span>
  )
}
