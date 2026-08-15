# Enclave: SolidJS Migration Plan

This document outlines the strategy for migrating Enclave's frontend from Next.js (React) to SolidJS (via SolidStart).

## 1. Architectural Shift

Enclave currently uses Next.js App Router (`src/app`), heavily relying on React components, hooks, and Shadcn UI.

In the new architecture:

- **Framework:** SolidStart will replace Next.js, providing a similar file-based routing and SSR experience but powered by SolidJS.
- **Reactivity:** Solid's fine-grained reactivity (Signals) will replace React's Virtual DOM and Hooks (`useState`, `useEffect`). Components in Solid execute exactly once, and only the specific DOM nodes tied to updated signals will re-render.
- **UI Library:** Shadcn UI (which relies on Radix Primitives for React) will be replaced with a SolidJS equivalent (e.g., Kobalte or shadcn-solid).

## 2. Phase 1: Foundation and Setup

1. **Initialize SolidStart:** Bootstrap a new SolidStart project to act as the target architecture.
2. **Port Configuration:** Migrate `tailwind.config.js`, `postcss.config.js`, and global CSS over to the new SolidStart setup.
3. **UI Primitive Swap:**

- Identify all Shadcn UI components currently used (buttons, dialogs, dropdowns).
- Install and configure `kobalte`(Solid's accessible unstyled primitives) and set up`shadcn-solid` to replicate the existing design system.

## 3. Phase 2: Component Migration

1. **State Translation:**

- Convert all `useState`calls to`createSignal`.
- Convert all `useEffect`calls to`createEffect`or`onMount`.
- Convert `useMemo`to`createMemo`.
1. **JSX Adjustments:**

- Solid uses standard HTML attributes (e.g., `class`instead of`className`, `for`instead of`htmlFor`).
- Control flow components must be used instead of array mapping (`<For each={items}>`instead of`items.map()`).
- Conditional rendering uses `<Show when={condition}>`instead of`condition && <Component />`.
1. **Routing:** Port `src/app` page components to SolidStart's file-based routing equivalent (`src/routes`).

## 4. Phase 3: Data Fetching and SSR

1. **Server Functions:** Replace Next.js Server Actions with SolidStart's Server Functions (`"use server"`).
2. **Resource Loading:** Migrate data fetching (currently likely done via Next.js fetch caching or React Query) to Solid's `createResource` for seamless SSR hydration and suspense integration.
3. **Database Integration:** Ensure `drizzle-orm`and`@libsql/client` logic is properly encapsulated in server-only modules so secrets don't leak to the client bundle.

## 5. Trade-offs & Considerations

- **Pros:** Blazing fast client-side performance, smaller bundle sizes, no Virtual DOM overhead, highly predictable reactivity (no stale closures or dependency array bugs).
- **Cons:** Smaller ecosystem compared to React (fewer drop-in libraries), learning curve for shifting from component-lifecycle mental model to fine-grained reactivity.
