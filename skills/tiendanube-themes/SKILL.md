---
name: tiendanube-themes
description: "Apply when changing, reviewing or planning work on a Tiendanube / Nuvemshop storefront theme: sectionable themes (Ipanema) with sections, blocks, {% schema %}, JSON templates, layout templates, global settings, translations, versioning, forking, the Brand Editor, custom fields and SEO; classic (legacy) themes synced over FTP with config/*.txt; the Twig objects and filters both use; and the Nuvemshop CLI (auth, pull, diff, check, push, watch, fork, unfork, update, publish). Complements the official Agent Skills bundled with the CLI: use it to choose the path (data file, custom code block, fork, FTP), to review a change before it reaches the store, and to keep theme work apart from NubeSDK apps and Admin data."
license: MIT
compatibility: "Nuvemshop / Tiendanube storefront themes: sectionable themes (Ipanema) and classic themes, edited with the Nuvemshop CLI (@tiendanube/cli, Node.js 24.15 or newer). Not for headless storefronts or NubeSDK app code."
metadata:
  author: commente.me
  version: "0.1.0"
---

# Storefront themes: sectionable (Ipanema) and classic

## When this skill applies

Use this skill when a task touches the look or markup of a Nuvemshop / Tiendanube storefront theme, or when you must decide whether a request is a theme job at all.

- Adding, reordering or configuring sections and blocks in `templates/pages/*.json` or `templates/layout/*.json`
- Writing or reviewing a section or block `.tpl` file and its `{% schema %}`
- Changing global settings (`config/settings_schema.json`, `config/settings_data.json`) or translations
- Deciding whether a change needs a fork, and what the fork costs in updates
- Coordinating CLI pushes with merchants who edit in the Brand Editor
- Maintaining a classic theme over FTP (`templates/*.tpl`, `snipplets/`, `config/*.txt`)
- Showing product custom fields (`metafields_v2`) or adjusting SEO output in a theme

Do not use this skill for:

- App code that renders into the storefront through slots (use `tiendanube-nube-sdk`)
- Admin pages or embedded app UI (use `tiendanube-admin-apps`)
- Products, prices, orders or custom field definitions through the API (use `tiendanube-catalog`, `tiendanube-orders-fulfillment`, `tiendanube-rest-api`)
- Checkout and payment behavior (use `tiendanube-shipping-payment-apps`)

## Decision rules

- **Install and follow the official skills first.** Run `nuvemshop skills install` after installing the CLI and start a new agent session. Those skills (`nuvemshop-theme-use-cases`, `nuvemshop-theme-fork-workflow`, `nuvemshop-theme-ftp-workflow`, `nuvemshop-fork-and-push-rules`, `nuvemshop-ipanema-architecture`, `nuvemshop-ipanema-schema-reference`, `nuvemshop-classic-theme-architecture`) own the command sequences and the schema vocabulary; update them with `npm update -g @tiendanube/cli`. This skill adds what they leave to judgment: which path to choose, what to check in review, known traps, and where theme work stops and NubeSDK or the Admin begins.
- The merchant runs `nuvemshop auth login` in their own terminal. Never run it for them and never ask for the token in chat: it grants access to the store's themes.
- Identify the family before editing: `nuvemshop theme list --json`. Sectionable means CLI sync with drafts; legacy means FTP, where every push lands on the live store and the platform cannot undo it.
- For a store on an older theme, recommend a new Ipanema draft adapted to the brand; work on the legacy theme only when the merchant explicitly asks.
- Pick the lightest path for a sectionable theme, in this order: (1) Brand Editor for a color or text, (2) data files (`templates/**`, `config/settings_data.json`), (3) the `custom` section with a `code` block for your own HTML, CSS or JS, (4) fork for anything that changes `.tpl` code, schemas, layout, `static/` or translations.
- Forking freezes the theme to an exact version and stops automatic minor and patch updates; it cannot be reversed in place. `theme unfork` makes a new base draft that keeps data files and drops code edits.
- `theme update` and `theme unfork` create a new draft and need a free theme slot; check `meta.max_installations` in `theme list --json`.
- Put shopping logic that the merchant should not move in a snippet; put anything the merchant adds, removes or reorders in a section or block.
- A request to install apps, change checkout or payments, or edit products, prices or orders is not a theme job. Say so and route it.
- Apps integrate through `component('nubesdk-slot', ...)` and `data-store` attributes. The theme keeps those points; app logic belongs in the app.
- Classic themes use `config/settings.txt`, `defaults.txt`, `variants.txt`, `sections.txt`, `translations.txt`, `{% template_content %}` and the `translate` filter; none of that applies to Ipanema, and FTP never applies to Ipanema.

## Hard constraints

### Constraint: Confirm the store and the theme family before any write

Check `nuvemshop auth list` and `nuvemshop theme list --json` before pulling or pushing, and match the command family to the theme.

**Why this matters**

The token belongs to the store that was signed in; `--theme-id` only picks a theme inside it. Sync, fork and update fail with `THEME_NOT_SECTIONABLE` on a legacy theme, and FTP writes to a legacy store go live at once with no draft or history.

**Detection**

`theme push` run in a folder whose `.nuvem` points to an unexpected alias, `theme ftp push` aimed at an Ipanema store, or no `theme list` output in the session before the first write.

**Correct**

```bash
nuvemshop auth list
nuvemshop theme list --json        # read is_sectionable / base_theme_type and which theme is productive
nuvemshop theme pull --theme-id 4100200
```

**Wrong**

```bash
nuvemshop theme ftp push -y        # on a store whose live theme is Ipanema
```

### Constraint: Do not count on code pushes to a base theme

On a theme that is not forked, only `templates/**` and `config/settings_data.json` are uploaded. Choose the custom section with a code block, or fork on purpose.

**Why this matters**

Other changed files are listed as `Skipped (not forked, but has changes)` and the push still exits `0`, so a script that trusts the exit code reports success while nothing changed. `theme diff` does not list brand-new `sections/*.tpl` or `blocks/*.tpl` files on a base theme, so they are easy to miss.

**Detection**

Edits under `sections/`, `blocks/`, `snippets/`, `layouts/`, `static/`, `translations/` or `config/settings_schema.json` while `manifest.json` says `"forked": false`.

**Correct**

```json
"custom_acme": {
  "type": "custom",
  "blocks": {
    "code_acme": { "type": "code", "settings": { "width": "fill", "code": "<div class=\"acme-strip\">Acme week</div>" } }
  },
  "block_order": ["code_acme"]
}
```

Add `"custom_acme"` to `order` too; a section missing from `order` does not render. The code block prints plain HTML, CSS and JS, without Twig.

**Wrong**

```bash
cp acme-banner.tpl sections/ && nuvemshop theme push -y && echo "deployed"
```

### Constraint: Pull and diff right before every push

Run `nuvemshop theme diff --detailed` before `theme push`, and pull again if it shows a data file you did not edit.

**Why this matters**

The Brand Editor and the CLI write the same data files and nothing merges them: the last write wins. Push also deletes remote files that do not exist locally, so a template the merchant created after your pull is removed. `theme push` does not send the `revision_token`, so it is not blocked.

**Detection**

A push run from an old checkout, a `templates/pages/*.json` in the diff that the task did not mention, or `Deleted` entries for alternative templates (`<type>.<name>.json`).

**Correct**

```bash
git commit -am "wip" && nuvemshop theme pull -y
# re-apply the edit, then
nuvemshop theme diff --detailed
nuvemshop theme check && nuvemshop theme push
```

**Wrong**

```bash
nuvemshop theme push --force -y    # stale copy, no diff, editor changes lost
```

### Constraint: Change a draft, preview it, publish only on request

Work on a draft (`theme create --base-theme ipanema`, `theme clone`, or the draft `theme update` returns), share `theme preview`, and run `theme publish` only when the merchant says so.

**Why this matters**

Saving in the Brand Editor on the published theme publishes immediately, and `theme publish` replaces the live theme. Publishing a clone also discards Brand Editor edits made on the live theme since the clone was taken.

**Detection**

`--published` on `push` or `watch`, `theme publish` in an automated script, or a clone published without aligning `config/settings_data.json` from the live theme.

**Correct**

```bash
nuvemshop theme clone
nuvemshop theme pull --theme-id 4100311
nuvemshop theme push && nuvemshop theme preview   # send the link, wait for approval
```

**Wrong**

```bash
nuvemshop theme watch --published
```

### Constraint: Keep the editor and app contract of every block

A block's root element prints `{{ block | block_attributes }}`. Keep `nubesdk-slot` components, `data-store` attributes and underscore-prefixed snippets (`_cart-item.tpl`) where the theme put them.

**Why this matters**

Without `block_attributes` the merchant cannot select the block in the editor. Installed apps target slots and `data-store` anchors, and the backend looks up underscore snippets by exact name and path; removing or renaming any of them breaks things silently.

**Detection**

A forked block without `block_attributes`, a diff that drops a `component('nubesdk-slot'` line or a `data-store=` attribute, or a renamed `snippets/**/_*.tpl`.

**Correct**

```twig
<div class="acme-note" {{ block | block_attributes }} data-store="acme-note-{{ block.id }}">
  {{ block.settings.text }}
</div>
```

**Wrong**

```twig
<div class="acme-note">{{ block.settings.text | raw }}</div>
```

### Constraint: Declare every new schema label in every schema translation file

A new `t:` key used in a `{% schema %}`, a preset or a template value must exist in each `translations/*.schema.json` the theme ships; storefront text goes through `| t` with keys in each `<locale>.json`.

**Why this matters**

A missing key shows the raw `t:` string in the editor. Hardcoded storefront text ignores the shopper's locale, and the editor locale and the storefront locale are independent.

**Detection**

`"label": "t:settings.acme_label"` added in a fork with no matching key in `en.schema.json`, `es.schema.json` and `pt.default.schema.json`, or literal copy inside a `.tpl`.

**Correct**

```json
{ "type": "setting", "setting_type": "toggle", "id": "show_badge", "label": "t:settings.show_badge", "default": true }
```

**Wrong**

```json
{ "type": "setting", "setting_type": "toggle", "id": "show_badge", "label": "Show badge" }
```

## Preferred pattern

Render flow of a sectionable theme:

```text
layouts/layout.tpl            head-tags, style tokens, platform_head_content
  {% layout_template 'header' %}   -> templates/layout/header.json
  {{ page_template_content }}      -> templates/pages/<page>.json
     sections/<type>.tpl  reads section.settings, loops section.blocks
       blocks/<type>.tpl  reads block.settings, may loop block.blocks
         snippets/<path>.tpl  shopping logic, receives only what `with {}` passes
  {% layout_template 'footer' %}   -> templates/layout/footer.json
```

A section that renders any accepted block without a per-type chain:

```twig
{% set settings = section.settings %}
<div class="acme-section" data-section-id="{{ section.id }}">
  {% for block in section.blocks %}
    {% include 'blocks/' ~ block.type ~ '.tpl' with { block: block } %}
  {% endfor %}
</div>
{% schema %}
{ "name": "t:names.acme", "max_blocks": 6, "blocks": [{ "tags": ["general"] }],
  "settings": [{ "type": "setting", "setting_type": "color", "id": "text_color", "label": "t:settings.text", "default_setting": "text_color" }],
  "presets": [{ "name": "t:names.acme", "blocks": [{ "type": "heading" }] }] }
{% endschema %}
```

Working loop with the CLI: confirm store, pull, edit, `theme diff --detailed`, `theme check`, push to a draft, preview, wait for approval, publish. After `theme update`, run `theme pull --theme-id <new_id>` and re-check custom CSS and code blocks, because selectors can change between versions.

## Common failure modes

- Trusting the identifier tables of the schema reference for every version: they describe Ipanema major 1. Read the pulled theme's own schemas.
- Adding a `heading` block set to "Heading 1" and expecting an `<h1>`: the block renders a `<div>`. The page `<h1>` comes from fixed theme code.
- Adding `<title>`, description or canonical tags in a fork: `component('head-tags')` already prints them.
- Expecting `theme push` to send `custom/` (it is skipped) or empty files (the rest uploads, exit code `1`); reformatted JSON counts as modified.
- Renaming a custom field in the Admin and expecting `product.metafields_v2.custom.<slug>` to follow: the slug is fixed at creation.
- Using `| raw` on values the shopper typed. Keep it for trusted settings and platform data.
- Hitting the 25-section limit of a template, or the theme slot limit, during `update`.

## Review checklist

- [ ] The store alias and theme id were confirmed, and the theme family matches the commands used
- [ ] The lightest path was chosen; a fork, if any, was agreed knowing it stops automatic updates
- [ ] `theme diff --detailed` lists only intended files, with no unexpected deletions, and `theme check` passes
- [ ] Every block root prints `block_attributes`; slots, `data-store` anchors and underscore snippets are intact
- [ ] New `t:` keys exist in every `*.schema.json`; storefront text uses `| t`
- [ ] The change sits on a draft with a preview link; publishing waits for explicit approval
- [ ] For legacy themes, the merchant accepted that FTP pushes are live and cannot be undone

## Related skills

- [`tiendanube-nube-sdk`](../tiendanube-nube-sdk/SKILL.md): app content rendered into theme slots
- [`tiendanube-admin-apps`](../tiendanube-admin-apps/SKILL.md): Admin-side app UI, not the Brand Editor
- [`tiendanube-catalog`](../tiendanube-catalog/SKILL.md): product data, SEO fields and custom field values the theme reads
- [`tiendanube-rest-api`](../tiendanube-rest-api/SKILL.md): authentication and conventions of the Admin API

## Reference

- [Agent Skills](https://nuvemshop.dev/en-US/themes/developer-tools/cli/agent-skills.md): names of the official skills, install, update and project options
- [Modifying themes with AI](https://nuvemshop.dev/en-US/ai-agents/agentic-theme-development.md): token stays with the merchant, draft and preview before publish, what agents do not do
- [Getting Started](https://nuvemshop.dev/en-US/themes/getting-started.md): Brand Editor vs CLI, `is_sectionable`, FTP not for Ipanema
- [Sectionable Themes](https://nuvemshop.dev/en-US/themes/sectionable-themes/overview.md): sections, blocks, snippets, JSON templates and render flow
- [Folder Structure](https://nuvemshop.dev/en-US/themes/sectionable-themes/folder-structure.md): folders, locales and fallback
- [Sections](https://nuvemshop.dev/en-US/themes/sectionable-themes/sections.md): block loop and section schema keys
- [Blocks](https://nuvemshop.dev/en-US/themes/sectionable-themes/blocks.md): `block_attributes`, accepted types, nesting, `code` block
- [Templates](https://nuvemshop.dev/en-US/themes/sectionable-themes/templates.md): JSON shape, alternative templates, 25-section limit
- [Layouts](https://nuvemshop.dev/en-US/themes/sectionable-themes/layouts.md): single `layout.tpl`, slots, platform tags
- [Layout Templates](https://nuvemshop.dev/en-US/themes/sectionable-themes/layout-templates.md): header and footer templates, `disabled`
- [Snippets](https://nuvemshop.dev/en-US/themes/sectionable-themes/snippets.md): explicit parameters, underscore names
- [Global Settings](https://nuvemshop.dev/en-US/themes/sectionable-themes/global-settings.md): panels and `default_setting`
- [Translations](https://nuvemshop.dev/en-US/themes/sectionable-themes/translations.md): `| t` vs `t:` and missing keys
- [Schema Reference](https://nuvemshop.dev/en-US/themes/sectionable-themes/schema-reference.md): setting types, keys, Ipanema major 1 identifiers
- [Versioning](https://nuvemshop.dev/en-US/themes/sectionable-themes/versioning.md): tracks, update algorithm and conflicts
- [Forking](https://nuvemshop.dev/en-US/themes/sectionable-themes/forking.md): source vs data files, custom section and code block
- [Brand Editor](https://nuvemshop.dev/en-US/themes/sectionable-themes/brand-editor.md): file mapping, save behavior, coexistence with push
- [Custom fields](https://nuvemshop.dev/en-US/themes/sectionable-themes/custom-fields.md): `metafields_v2` and fixed slugs
- [SEO](https://nuvemshop.dev/en-US/themes/sectionable-themes/seo.md): platform head tags, headings, alt text
- [App integration](https://nuvemshop.dev/en-US/themes/sectionable-themes/app-integration.md): slots and `data-store` anchors
- [Classic Themes: Getting Started](https://nuvemshop.dev/en-US/themes/classic-themes/getting-started.md): legacy folders and FTP model
- [Classic Themes: Configuration](https://nuvemshop.dev/en-US/themes/classic-themes/theme-architecture/configuration.md): `config/*.txt` files
- [Twig Templating](https://nuvemshop.dev/en-US/themes/twig-reference/twig.md): syntax and `template` conditionals
- [Objects Reference](https://nuvemshop.dev/en-US/themes/twig-reference/objects.md): `section`, `block`, `settings`, globals
- [Filters & Methods](https://nuvemshop.dev/en-US/themes/twig-reference/filters-methods.md): `raw`, `t`, `block_attributes`, `static_inline`
- [CLI Getting Started](https://nuvemshop.dev/en-US/themes/developer-tools/cli/getting-started.md): sign-in, aliases, `.nuvem`, CI token
- [Sectionable theme development](https://nuvemshop.dev/en-US/themes/developer-tools/cli/sectionable-theme-development.md): pull, push rules, check, diff, fork, update
- [Legacy theme development (FTP)](https://nuvemshop.dev/en-US/themes/developer-tools/cli/ftp-theme-development.md): `auth ftp`, FTP push and deletions
- [Theme Management](https://nuvemshop.dev/en-US/themes/developer-tools/cli/theme-management.md): create, clone, publish, preview, delete, slot limit
- [Troubleshooting](https://nuvemshop.dev/en-US/themes/developer-tools/cli/troubleshooting.md): skipped files, empty files, validation, remote changes
