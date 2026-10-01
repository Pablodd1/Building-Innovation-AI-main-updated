# 🤖 AI Agent Engineering Standards & Governance (AGENTS.md)

This document establishes the mandatory architectural, code quality, security, and verification standards for all AI agents, subagents, and automated coding assistants operating in the **Building Innovation AI** repository.

---

## 🎯 Mandatory Agent Directive

Every AI agent operating in this repository **MUST ALWAYS** apply, verify, and strictly adhere to both core skill disciplines before modifying code, creating pull requests, or committing changes:

1. **GitHub Open Code Review, Security & Verification Standards** (CodeRabbit Suite)
2. **Modern Web Quality, React Best Practices, SEO & Accessibility Standards** (Vercel & Addy Osmani Suites)

All 13 official agent skills are installed and pinned in `.agents/skills/` and tracked in `skills-lock.json`.

---

## 🛡️ Discipline 1: Code Review, Security & Verification Protocol

### 1. Pre-Commit Diff & Scope Verification
- Before staging any file, execute `git diff` or review code changes line-by-line.
- Preserve existing comments, docstrings, and architectural patterns unless explicitly requested to refactor.
- Ensure no accidental edits, formatting churn, or unrelated files are included.

### 2. Zero Secret Exposure & Credential Security
- **NEVER** hardcode API keys, database passwords, JWT secrets, or private tokens directly in client-side code, git tracking, or public endpoints.
- Environment variables must always be loaded via `process.env` with safe fallbacks and secret manager bindings.
- All sensitive authentication endpoints must employ rate limiting, CORS restrictions, and secure headers.

### 3. Build & Compilation Gate
- No changes may be committed to `main` without passing a zero-error clean build:
  ```sh
  npm run build
  ```
- Both frontend (`vite build`) and backend bundle (`esbuild server/index.ts`) must compile cleanly.

### 4. Semantic Commit Hygiene
- All commit messages must follow standard Conventional Commits:
  - `feat(...)`: New user-facing or platform features.
  - `fix(...)`: Bug fixes or compliance corrections.
  - `perf(...)`: Performance and bundle size optimizations.
  - `refactor(...)`: Code adjustments without feature changes.
  - `chore(...)`: Dependency updates, build configurations, or CI/CD scripts.

---

## ⚡ Discipline 2: Web Quality, React Architecture, SEO & Accessibility

### 1. Modern React Architecture & Composition (Vercel Best Practices)
- **Eliminate Waterfall Requests:** Co-locate data fetching and trigger parallel requests via `Promise.all` or unified endpoints to minimize round-trip latencies.
- **Composition Patterns:** Favor compound components and composition over prop drilling and deeply nested monolithic components.
- **Render Efficiency:** Memoize expensive calculations (`useMemo`), optimize callback references (`useCallback`), and ensure React DOM attributes follow standard camelCase (e.g., `fetchPriority`, `tabIndex`, `readOnly`).

### 2. Core Web Vitals & Performance Optimization (Addy Osmani Suite)
- **Largest Contentful Paint (LCP < 2.5s):** Preload hero images and critical web fonts; prioritize primary above-the-fold assets.
- **Interaction to Next Paint (INP < 200ms):** Keep main-thread tasks under 50ms; use non-blocking microtasks for state transitions.
- **Cumulative Layout Shift (CLS < 0.1):** Always specify explicit `width`, `height`, or aspect-ratio bounding boxes on images and dynamic UI containers.

### 3. Technical SEO & Web Standards
- Maintain valid canonical URLs, XML sitemaps (`/sitemap.xml`), and search crawler rules (`/robots.txt`).
- Ensure structured OpenGraph and Twitter Card metadata accompany all key product and landing pages.

### 4. Accessibility (WCAG 2.2 AA Compliance)
- Guarantee all interactive elements have keyboard focus indicators, adequate contrast ratios (minimum 4.5:1), and descriptive `aria-label` tags for screen readers.
- Ensure form inputs feature explicit `<label>` bindings and clear validation messages.

---

## 🔍 Discipline 3: Automated Jev Error Monitoring

- Real-time route health and error classification are automated via **Jev System-1** (`model: 'jev-1'`) and executed locally or via CI/CD:
  ```sh
  node scripts/jev-audit.mjs
  ```
- Scheduled GitHub Action (`.github/workflows/jev-monitor.yml`) executes every 6 hours and on push to detect operational regressions instantly.

---

## 📦 Installed Agent Skills Reference Manifest

| Skill Identifier | Source Suite | Primary Focus |
| :--- | :--- | :--- |
| `accessibility` | `addyosmani/web-quality-skills` | WCAG 2.2 AA, ARIA, screen reader optimization |
| `autofix` | `coderabbitai/skills` | Automated patch generation & lint remediation |
| `best-practices` | `addyosmani/web-quality-skills` | Modern web standards and architecture |
| `code-review` | `coderabbitai/skills` | Automated security & code review audits |
| `core-web-vitals` | `addyosmani/web-quality-skills` | LCP, INP, CLS optimization metrics |
| `deploy-to-vercel` | `vercel-labs/agent-skills` | Vercel edge and serverless deployment |
| `performance` | `addyosmani/web-quality-skills` | Runtime, memory, and asset speed tuning |
| `seo` | `addyosmani/web-quality-skills` | Technical SEO, structured data, canonicalization |
| `vercel-composition-patterns` | `vercel-labs/agent-skills` | React composition & modular component hierarchy |
| `vercel-optimize` | `vercel-labs/agent-skills` | Bundle size reduction & tree-shaking |
| `vercel-react-best-practices` | `vercel-labs/agent-skills` | Modern React idioms, hooks, and clean state flow |
| `web-design-guidelines` | `vercel-labs/agent-skills` | Visual consistency, typography & layout hierarchy |
| `web-quality-audit` | `addyosmani/web-quality-skills` | Full-spectrum lighthouse & health auditing |
