# Third-party notices

Apollo is MIT licensed. It ships one dependency that is not, and this file is
the notice that licence asks for.

## JASSUB (libass, compiled to WebAssembly)

Used to draw ASS/SSA subtitles with their original typesetting — positions,
fonts, colours, karaoke — which WebVTT cannot express. It is the same renderer
Jellyfin's own web client uses.

* Package: [`jassub`](https://github.com/ThaUnknown/jassub)
* Declared licence: `LGPL-2.1-or-later AND (FTL OR GPL-2.0-or-later) AND MIT
  AND MIT-Modern-Variant AND ISC AND NTP AND Zlib AND BSL-1.0`

libass itself is ISC, but the WebAssembly build links **FreeType** (FTL or
GPL-2.0-or-later) and **fribidi** (LGPL-2.1-or-later), so the `.wasm` Apollo
serves is covered by copyleft terms even though Apollo's own source is not.

Apollo links the published build unmodified and does not alter it. What that
obligation amounts to in practice is this notice, and telling you where the
source is:

* libass — <https://github.com/libass/libass>
* FreeType — <https://freetype.org/>
* fribidi — <https://github.com/fribidi/fribidi>
* The build that combines them — <https://github.com/ThaUnknown/jassub>

If you would rather not distribute it, the renderer is optional in two senses:
**Settings → Keep the original typesetting** turns it off for a viewer, and
turning it off means the WebAssembly is never fetched rather than fetched and
unused. Removing it from a build entirely means dropping the `jassub`
dependency and `src/lib/assRenderer.ts`; ASS subtitles then fall back to the
same cleaned-up `<track>` path SubRip uses, keeping italics and `\an`
placement but losing the rest of the typesetting.
