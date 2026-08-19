// TypeScript 7 enables `noUncheckedSideEffectImports` by default, which requires
// an explicit ambient module declaration for untyped side-effect imports such as
// plain (non-CSS-module) stylesheet imports (e.g. `import './globals.css'` in
// app/layout.tsx). Next.js does not yet ship this declaration itself
// (see https://github.com/vercel/next.js/issues/88197), so it lives here.
declare module '*.css'
