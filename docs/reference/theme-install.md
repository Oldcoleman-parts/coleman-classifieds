# Installing the classifieds storefront (F06-T2)

What the merchant (or the developer, on the dev store) does once, in the Shopify admin, after the app is installed and the extension is pushed (`shopify app dev` on the dev store, `shopify app deploy` for production, run by a human).

The app creates the `classified_listing` definition and the `classifieds.live_count` shop metafield itself, the first time a listing goes live (or the hourly `publishing.reconcile` task runs). Listing pages are at `/pages/classified-listing/<handle>`.

## 1. Listing page template

1. **Online Store → Themes → Customize** on the OCP theme.
2. Template picker → **Metaobjects → Classified listing** → create the default template (until it exists, listing pages return 404).
3. Remove the template's default sections, then **Add section → Apps → Classified listing**.
4. Save.

The block always shows the "Private seller listing" badge and the disclaimer. A closed listing shows "This listing is no longer available" and nothing else about it.

## 2. Browse page

1. **Online Store → Pages → Add page**: title **Classifieds**, handle `classifieds` (the address is `/pages/classifieds`; the header button and closed listings link there, and retired listing addresses redirect there).
2. In the theme editor, create a page template `page.classifieds`, add **Apps → Classifieds browse**, and assign the template to the page.
3. Leave the page **out of the main menu**: the header button is the way in.

## 3. Hide from search engines

**Theme settings → App embeds → Classifieds noindex** → on. It adds `noindex, nofollow` to listing pages and (setting on by default) to the browse page.

Listings are metaobjects, so they never appear in storefront search, predictive search, collections, New Arrivals or product feeds. Shopify still lists metaobject pages in `sitemap.xml` and has no per-entry switch to remove them; the embed is what keeps them out of search results.

## 4. Header button

1. **Edit code** → `Snippets` → **Add a new snippet** `classifieds-header-button`, and paste `theme-snippets/classifieds-header-button.liquid` from this repository.
2. In the header section (Dawn-based themes: `sections/header.liquid`), find the **icon area** (the element that holds the search, account and cart icons) and add, as its first child:
   ```liquid
   {% render 'classifieds-header-button', variant: 'header' %}
   ```
   **Never** add it to the menu row (`header__inline-menu` / the menu list).
3. In the mobile drawer (Dawn: `snippets/header-drawer.liquid`), add as the first item inside the drawer's menu container:
   ```liquid
   {% render 'classifieds-header-button', variant: 'drawer' %}
   ```
4. Save.

The button shows only while `classifieds.live_count > 0`. From 990px to 1279px it is the lantern icon only; from 1280px it adds the word "Classifieds" (at most 132px wide), so the menu row keeps its space.

## 5. Check

- At 1280px and 1440px: every main menu link is still in the row (none moved into "More"), with and without a live listing.
- At 390px: the button is the first item in the drawer.
- With no live listings the button is gone and the browse page shows its empty text.
