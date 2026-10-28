---
paths:
  - "extensions/**"
  - "theme-snippets/**"
---

# Storefront and theme rules

- Blocks inherit theme fonts and colours. Don't hard-code fonts. Only the menu button uses the brand red outline and navy text.
- Cards: 3 per row on desktop, 1 per row on mobile, with the same content on both (photo, title, price, city/state).
- **Never** render Add to Cart, shipping, returns or guarantee messaging on classifieds pages.
- Always show the "Private seller listing" badge and the OCP disclaimer on listing pages.
- The header button (`theme-snippets/classifieds-header-button.liquid`) renders only when `shop.metafields.classifieds.live_count > 0`. It goes in the header icon area (desktop) and first in the mobile drawer. **Never add it to the main menu row**, so no menu link moves into "More". The floating "Classifieds button" app embed (`blocks/floating-button.liquid`, bottom left or right) is an optional alternative with the same `live_count` rule.
- Images use `srcset` from the `_thumb`, `_medium` and `_large` CloudFront variants, with `loading="lazy"` and the listing title as alt text.
