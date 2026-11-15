# ImagingTech website

The ImagingTech trade-print website: homepage, About page, product pages with live pricing, and a product admin. Plain HTML, CSS and JavaScript with no build step and no frameworks, so you can open it in VS Code and edit straight away.

---

## 1. Get it running in VS Code (5 minutes)

1. **Unzip** this folder somewhere convenient, e.g. `Documents/ImagingTech-website`.
2. **Open VS Code → File → Open Folder…** and choose the `ImagingTech-website` folder.
3. VS Code will offer to install the **recommended extensions**. Click **Install**:
   - **Live Server**: previews the site in your browser and reloads on every save.
   - **Prettier**: tidies code formatting (optional).
4. In the file list, **right-click `index.html` → Open with Live Server**.
   The site opens at `http://127.0.0.1:5500/index.html`.

> Use Live Server rather than double-clicking the HTML files. Opened straight from disk, browsers block the product data in `data/`, so product pages would fall back to their built-in content and the menu links wouldn't appear.

---

## 2. What's in the folder

```
ImagingTech-website/
├── index.html                 Homepage
├── about.html                 About ImagingTech
├── business-cards-14pt.html   Product page: Business Cards
├── postcards.html             Product page: Postcards
├── flyers.html                Product page: Flyers
├── vinyl-banners.html         Product page: Vinyl Banners
├── product.html               Shared product page for every other product (product.html#page-id)
├── admin.html                 Product admin (full editing only on Claude, see section 5)
├── data/
│   ├── products.json          Content and pricing for every product page
│   └── menu.json              Main menu: categories → products → Standard / Specialty options
├── js/
│   └── local-data.js          Reads data/*.json when the site runs outside Claude
├── images/
│   ├── print/                 Print product photos (+ small "-thumb" versions for the menu)
│   ├── tradeshow/             Trade show & events photos
│   ├── hero-tiles/            Homepage hero photo wall
│   └── *.jpg                  Category and sign photos
└── .vscode/                   Recommended extensions and settings
```

Each HTML page is self-contained: **styles are in a `<style>` block at the top** and **scripts are at the bottom**.

---

## 3. Common edits

| I want to… | Where |
|---|---|
| Change homepage text or sections | `index.html`. Each section starts with a comment like `<!-- ===== Print products band ===== -->` |
| Change the About page | `about.html` |
| Change a product's description, bullets, prices, dropdowns, Details or File Prep tabs | `data/products.json`, under that product's id |
| Add, rename or remove Standard / Specialty options in the menu | `data/menu.json` |
| Swap a photo | Replace the file in `images/` with the same name, or change the `src="images/…"` path |
| Change brand colours | The `:root { --indigo: …; --green: …; }` block at the top of each page's `<style>` |
| Change the phone number, email or footer links | Every page, see "Header and footer" below |

### Header and footer are copied into every page
The top bar, main menu, mobile menu and footer are repeated in each HTML file. To change them everywhere, use **Find & Replace across files** (`Ctrl+Shift+H` on Windows, `Cmd+Shift+H` on Mac).

### How pricing works (`data/products.json`)
```
price = price for the chosen quantity
        × "mult" of the chosen choice in every dropdown
        × "rush" (if Rush turnaround is picked)
```
- `prices`: list of `{ "qty": 500, "price": 19.5 }`. These are the totals with the first choice in every dropdown.
- `fields`: the dropdowns. Each choice has a `mult`: `1` = no change, `1.15` = 15% more, `0.9` = 10% less. `"def": true` marks the preselected choice.
- `defaultQty`: the quantity selected when the page opens.

**All prices in the project are sample figures.** Replace them with your real trade prices.

### Add a new product page
1. In `data/products.json`, copy an existing entry, give it a new id (lowercase-with-dashes, e.g. `"booklets-saddle-stitched"`) and edit it.
2. In `data/menu.json`, find the option it belongs to and add `"doc": "booklets-saddle-stitched"` to it.
3. The page is live at `product.html#booklets-saddle-stitched`, and the option becomes a link in the site menu.

### Product photos on product pages
Add an `images` list to the product in `products.json`. The four main product pages also have built-in artwork that shows when `images` is empty. Images uploaded through the admin on Claude are stored on Claude and are **not** in this folder. To use local files, edit the gallery markup in the page directly.

---

## 4. Things that are placeholders

- Many links are `href="#"`: Help & FAQs, Our Equipment, Contact Us, template downloads, most "Shop now" buttons.
- **Add to Cart** only bumps the cart counter. There is no real cart or checkout.
- **Get a Quote / Request a Trade Quote**, the newsletter sign-up and the search box don't send anything yet.
- Brochures, Booklets, Door Hangers, Greeting Cards, Invitations and all Signs / Stickers / Promotional products have no page content yet.

---

## 5. Claude version vs. this folder

The live version of the site runs on Claude, which provides the database behind the **admin** (add, edit and delete products, image uploads).

| | On Claude | This folder (Live Server or any web host) |
|---|---|---|
| Pages, menus, pricing calculator | ✅ | ✅ |
| Product data | Claude's database | `data/products.json` and `data/menu.json` |
| Admin: browse | ✅ | ✅ (read-only) |
| Admin: save, upload images | ✅ | ❌ (edit the JSON files instead) |

`js/local-data.js` makes the switch automatically: on Claude it steps aside, and anywhere else it reads the JSON files. The data in this folder is a **snapshot from 15 Nov 2026**. Changes made in the Claude admin after that won't be in it.

---

## 6. Putting it on the web

The site is hosted on **GitHub Pages** (repo `julianniki-cyber/ImagingTech-website`). Every push to `main` redeploys it within a minute or two.

### Live admin editing with Supabase (free, no card)
`js/local-data.js` switches to Supabase as soon as `SUPABASE_CONFIG` at the top of it is filled in. Until then the site runs read-only from `data/*.json`.

One-time setup (about 10 minutes):
1. Sign up at **supabase.com** (GitHub login works) → **New project**. Pick a name, a database password (save it somewhere) and a nearby region, on the Free plan.
2. **SQL Editor → New query**: paste all of `supabase.sql`, change `EDITOR_EMAIL` on the last line to your email, and click **Run**.
3. **Authentication → URL Configuration**: set **Site URL** to `https://julianniki-cyber.github.io/ImagingTech-website/` and add `https://julianniki-cyber.github.io/ImagingTech-website/**` under **Redirect URLs**. For local testing, also add `http://127.0.0.1:5500/**`.
4. **Project Settings → API**: copy the **Project URL** and the **anon public** key into `SUPABASE_CONFIG` in `js/local-data.js`, then commit and push.
5. Open `admin.html` on the live site, enter your email, and click the login link that arrives. On the first login, the contents of `data/*.json` are copied into the database. From then on, admin saves and image uploads are live for every visitor.

After step 5, Supabase holds the real data and the JSON files are only a fallback. Edit products in the admin, not in the JSON files.

Free-plan limits: 500 MB database, 1 GB images. A project with no traffic for about a week is paused; restore it from the dashboard. Supabase's built-in login emails are rate-limited (a few per hour), which is fine for a handful of editors.

Quotes, the cart and sign-up forms still need wiring up (they can use the same Supabase project).

---

## 7. Suggested next steps

1. Put in your real prices and product options (`data/products.json`).
2. Replace the `#` links with real pages (Contact, FAQs, Equipment).
3. Move the repeated header and footer into one shared file. A small static-site tool such as **Eleventy** handles this cleanly.
4. Choose a host, then a backend for quotes, cart and admin.
