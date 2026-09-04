/*
  JASSUB's worker, with one hint taken off it first.

  The order of these two imports is the entire content of this file. See
  `assWorkerPatch.ts` for why it is a separate module, and `canvasHints.ts` for
  what the hint does to an Android compositor.

  JASSUB starts this with `type: 'module'` whatever URL it is given, so this is
  loaded as an ES module and the ordering guarantee holds.
*/
import './assWorkerPatch'
import 'jassub/dist/worker/worker.js'
