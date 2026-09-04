import { installCanvasHintPatch } from './canvasHints'

/*
  A module that exists for its side effect, and for the ordering that gives it.

  This cannot be a statement inside `assWorker.ts`: `import` declarations are
  hoisted and their modules evaluated before any statement in the file that
  imports them, so a call written between two imports runs after both of them —
  which is to say, after JASSUB has already made its context. A module's
  dependencies, on the other hand, evaluate in the order they are imported. So
  the patch has to *be* a dependency to land before libass does.
*/
installCanvasHintPatch(globalThis as unknown as Parameters<typeof installCanvasHintPatch>[0])
