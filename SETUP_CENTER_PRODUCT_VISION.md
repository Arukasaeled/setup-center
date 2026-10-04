# Setup Center — Product Vision

> **Setup Center is a personal creative & development workbench for turning discovered ideas into reusable systems, and reusable systems into the next thing you build.**

---

## 1. Product Definition

Setup Center is no longer defined primarily as an environment installer, software bootstrapper, or style gallery.

Its personal/development edition is a **Creative & Development Workbench** centered on a simple transfer loop:

**Discover → Collect → Understand → Assemble → Modify → Preview → Export → Reuse**

The product exists to reduce the cold-start cost of creation.

When starting a new project, presentation, competition entry, interface, landing page, dashboard, visual asset, or other creative work, the user should not need to begin from a blank page. Setup Center should help surface previously collected references, complete visual systems, reusable UI parts, templates, resources, and implementation specifications.

The core principle is:

> **Setup = Transfer.**  
> Transfer what has already been discovered, understood, refined, or built into the next piece of work.

---

## 2. Two Product Editions

Setup Center should be treated as one codebase with two product profiles rather than two permanently diverging products.

### Personal / Development Edition

This is the primary edition.

It is designed for long-term personal use, experimentation, collection, visual research, system building, and export.

It may include:

- UI reference library
- Visual Preset library
- Visual Preset editing
- Fork / variant workflows
- advanced specification editing
- export tools
- local experiments
- development resources
- software and environment tools
- templates
- agent-oriented tooling

The personal edition may be more experimental and may expose capabilities that are not appropriate for public distribution.

### Distribution Edition

This is a curated public edition.

It may focus on:

- Software
- Environment
- Resources
- Templates
- Stable visual solutions
- Setup / bootstrap workflows

The distribution edition should be generated from the same underlying runtime and shared modules, but may expose a reduced feature set.

The two editions should not be maintained as permanently diverging branches.

---

## 3. Core Product Areas

### 3.1 UI — Visual Parts Library

`UI` is the raw material layer.

It is a personal visual scrapbook and reusable parts bin for **anything worth learning from visually**.

A UI item may come from:

- website design
- application UI
- games
- dashboards
- PPT / presentation design
- posters
- editorial layouts
- image composition
- typography
- charts
- icons
- animation
- loading states
- photography
- branding
- navigation patterns
- controls
- cards
- headers
- menus
- data displays

An item does not need to be immediately reusable.

The minimum valid UI item can be:

- screenshot
- source URL
- title
- tags
- note

A richer item may additionally contain:

- design analysis
- layout breakdown
- color extraction
- typography
- spacing
- composition rules
- interaction notes
- CSS
- HTML
- React implementation
- SVG
- tokens
- assets
- portable design principles

The system should allow incomplete items to become richer over time.

AI may be used to analyze a visual reference and turn it into a more structured, editable, reusable part.

### Key Principle

> **UI stores parts, not complete systems.**

---

### 3.2 Visual Presets — Complete Visual Systems

A Visual Preset is a complete, reusable visual system.

It is not merely a theme, palette, or CSS skin.

A mature Visual Preset may define:

- visual goal
- overall atmosphere
- page composition
- shell
- navigation
- typography
- palette
- spacing
- surfaces
- cards
- lists
- buttons
- forms
- detail presentation
- modal treatment
- icon direction
- image treatment
- charts
- motion
- interaction character
- reusable parts
- portable ideas
- use cases
- constraints
- do / don't rules

A Visual Preset should be understandable as a system and transferable to different products.

Examples include:

- Desktop Studio
- Natural History
- Terminal Collage
- Blueprint Drafting
- Scrapbook
- Split-Flap Board
- Patch Bay

### Key Principle

> **UI = Parts**  
> **Visual Preset = System**

The relationship is bidirectional:

**Parts → Visual Preset**

A preset may be assembled from useful parts.

**Visual Preset → Parts**

A useful preset may be decomposed into reusable parts.

---

## 4. Setup Center as the Standard Benchmark

Setup Center itself is the standard live benchmark for Visual Presets.

The current application structure is relatively fixed, which is useful rather than limiting.

Each Visual Preset can be applied to the same functional surfaces:

- navigation
- dashboard
- lists
- cards
- resources
- detail view
- modal
- search
- buttons
- forms
- status
- filters

This allows direct comparison between visual systems using the same content and the same application.

The benchmark answers:

> What does this visual system actually feel like when applied to a real product?

### Future Direction

A preset may later support both:

- **Benchmark** — the common Setup Center reference environment
- **Showcase** — a custom scene better suited to the preset

Examples of future showcases:

- landing page
- PPT page
- poster
- dashboard
- mobile UI
- desktop application
- portfolio
- presentation board

The benchmark is required first. Showcase is optional.

---

## 5. Browsing Philosophy

The system must support purposeless browsing.

The user should be able to open the library and simply look.

This is intentional.

Visual literacy is partly built through repeated exposure.

Setup Center should behave more like walking through a mall, gallery, archive, or design collection than like an AI assistant forcing the user to specify a goal before seeing anything.

The main browsing loop should be:

**Open → Browse → Notice → Remember → Save / Fork when useful**

AI recommendation may exist, but must not dominate the experience.

The product should help the user make decisions, not replace the user's judgment.

---

## 6. Discovery Modes

The system should support both low-intent and high-intent discovery.

### Mode A — Browse

No goal required.

The user browses all available systems and parts.

### Mode B — Filter

The user may filter by visual language.

Examples:

- Editorial
- Industrial
- Terminal
- Scientific
- Desktop
- Minimal
- Hardware
- Playful
- Retro
- Experimental

### Mode C — Use Case

The user may filter by the kind of work being created.

Examples:

- software UI
- competition
- PPT
- landing page
- dashboard
- developer tool
- AI / agent
- data visualization
- poster
- portfolio

### Mode D — Assisted Discovery

The user may provide a loose intent such as:

> “I need to make an AI competition project.”

The system may surface several appropriate directions and explain why they may fit.

It should not automatically decide which visual direction is “best.”

---

## 7. Visual Preset Editing

Visual Presets must remain understandable and editable.

Editing should have two levels.

### Basic Editor

Fast visual controls for common modifications:

- palette
- typography
- spacing
- density
- border
- radius
- shadow
- motion
- layout tendencies
- surface
- accent
- contrast

Changes should update the live benchmark immediately.

### Advanced Editor

Direct access to the underlying system:

- manifest
- tokens
- CSS
- specification
- assets
- metadata

The GUI is only one view of the specification.

The specification is the actual asset.

---

## 8. Fork / Variant Model

Visual Presets should behave more like Git repositories than saved themes.

A user should be able to:

- Fork a preset
- create variants
- modify locally
- compare against parent
- retain source information
- export
- re-import later

A local preset should preserve at least:

```text
id
parentId
sourceId
sourceVersion
createdAt
updatedAt
changes
assets
notes
```

Example:

```text
Desktop Studio
├── My Desktop Studio
│   ├── Competition Variant
│   └── Compact Variant
└── Experimental Variant
```

Full merge / rebase behavior is not required initially.

The data model should simply avoid treating a fork as an unrelated copied JSON file.

---

## 9. Export Is the End Product

Applying a preset to Setup Center is not the final goal.

The real value is:

**See → Understand → Modify → Take Away**

A Visual Preset should be exportable in several forms.

### Human Design Specification

Readable Markdown / HTML describing:

- visual intent
- layout
- typography
- palette
- spacing
- components
- interaction
- constraints
- use cases

### Agent Specification

A deterministic implementation brief that can be given to:

- Gemini
- Claude
- Codex
- other coding/design agents

The specification should not depend on any one model.

### Machine-Readable Tokens

Examples:

- JSON
- design tokens
- CSS variables

### Asset Package

May include:

- SVG
- images
- icon references
- font references
- code snippets
- source links

### Portable Preset Package

A complete archive containing:

- preset manifest
- assets
- specification
- tokens
- source metadata
- README

This package should be easy to store locally or in cloud storage.

---

## 10. UI Parts and Presets Are Portable Assets

Neither UI Parts nor Visual Presets should be tied permanently to Setup Center.

Setup Center is:

- browser
- previewer
- editor
- organizer
- exporter

The assets themselves should remain portable.

A useful visual system should be reusable in:

- a new software project
- a website
- a PPT
- a competition entry
- a dashboard
- a poster
- a portfolio
- another future tool

The product should preserve transferable design knowledge rather than only implementation-specific code.

---

## 11. Vault Architecture

### Setup Center App

Owns:

- runtime
- renderer
- preview surfaces
- editing tools
- search
- filters
- gallery
- export
- Fork workflow
- Setup actions
- software/environment capabilities

### Setup Center Vault

Owns:

- Visual Presets
- UI assets
- Resources
- Patterns
- Templates
- Skills
- other remotely distributable content

Pure content should not require an App Release.

A Visual Preset that only depends on already-supported runtime capabilities should be deliverable through the Vault.

A new App Release is required only when the content needs new runtime capability, such as:

- new React rendering behavior
- new shell grammar
- new navigation grammar
- new runtime primitive
- new native command
- new application capability

### Source of Truth

The Vault is the content source of truth.

The App should not manually maintain a second copy of every remotely published visual asset.

If offline bundled content is needed, it should be generated from a pinned Vault snapshot.

---

## 12. Release Model

### Content Release

Used for:

- Visual Presets
- UI Parts
- resources
- patterns
- templates
- skills

Flow:

**Vault Content → Validation → Snapshot Commit → Immutable Tag → Release Checkpoint**

### App Release

Used for:

- runtime changes
- renderer changes
- native features
- new grammar
- editing capabilities
- export capabilities
- bug fixes requiring client code

This separation must remain clear.

---

## 13. Personal Edition Priorities

The Personal / Development Edition should prioritize:

1. fast browsing
2. visual memory building
3. collecting useful parts
4. live visual comparison
5. understanding why a design works
6. modifying systems without destroying them
7. Forking variants
8. exporting reusable specifications
9. portability
10. low friction

The system does not need to become a heavy professional design suite.

It should stay fast enough that opening it is easier than searching from scratch.

---

## 14. Distribution Edition Priorities

The public Distribution Edition may prioritize:

1. software setup
2. environment setup
3. curated resources
4. templates
5. stable Visual Presets
6. safe Vault updates
7. simple user experience

Personal experiments do not need to be exposed publicly.

The public edition should be a curated subset, not a separate product lineage.

---

## 15. Non-Goals

Setup Center is not intended to become:

- a full Figma replacement
- a full Photoshop replacement
- a PPT editor
- a generic chat-first AI assistant
- a massive node-based design tool
- a mandatory AI decision engine
- a style marketplace
- a system where every visual reference must be fully structured before saving
- a runtime that continuously sacrifices usability for experimental layout research

The product should remain useful even when AI is unavailable.

---

## 16. Design Principles

### Browse Before Ask

Show useful material before asking the user to describe what they want.

### Parts and Systems

Keep raw inspiration and complete systems separate, but interoperable.

### Understand Before Reuse

A useful asset should become easier to understand over time.

### Modify Without Losing Origin

Fork rather than destroy the source.

### Export Knowledge, Not Just Appearance

A visual system should be portable as specification, tokens, code, and assets.

### Stable Benchmark

Setup Center provides a consistent surface for comparing visual systems.

### Content Is Cheap, Runtime Is Expensive

Prefer Vault content updates when no new client capability is required.

### One Codebase, Multiple Profiles

Personal and Distribution editions should share the same technical foundation.

### AI Assists Judgment

AI may analyze, extract, recommend, and transform, but the user remains the decision maker.

---

## 17. Long-Term Direction

Visual design is the first mature pillar, not necessarily the final scope.

The same transfer model may later expand to:

- Code
- Workflow
- Prompt
- Template
- Agent
- Resource
- Software
- Environment

The long-term concept is a personal system that remembers useful things, turns them into structured reusable assets, and makes them available when a new project begins.

The core loop remains:

> **Discover → Transfer → Build**

---

## 18. Product North Star

A successful Setup Center should make this scenario normal:

> A new project begins.  
> Instead of searching the internet from zero, open Setup Center.  
> Browse familiar visual systems and saved parts.  
> Find a direction.  
> Apply it to the benchmark.  
> Fork it.  
> Adjust it.  
> Export the specification.  
> Give the specification to a person or an Agent.  
> Start building.

If Setup Center consistently reduces the distance between **“I want to make something”** and **“I already have a strong starting system”**, the product is doing its job.
