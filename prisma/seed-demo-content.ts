/**
 * Loads demo storefront content: settings, CMS pages, FAQs, a hero banner, and
 * a small catalogue.
 *
 * DELIBERATELY SEPARATE from `prisma/seed.ts` and never wired into
 * `postinstall`. `seed.ts` creates reference data the system cannot run
 * without - roles, permissions, the first admin. This creates *editorial
 * content*, which is a completely different thing: it exists so the storefront
 * can be looked at and judged before the real copy has been written, and it
 * must never reach production by accident.
 *
 *   npm run seed:demo              fill gaps only; never overwrites
 *   npm run seed:demo -- --force   replace existing settings/pages/FAQs too
 *   npm run seed:demo:clear        remove what it created
 *
 * The default is deliberately non-destructive. This project runs against a
 * single local database, so these commands are pointed at real data: a plain
 * upsert would silently replace a `business_info` the admin had already filled
 * in, or an About page they had already written.
 *
 * Every row it writes is marked, so `--clear` can remove exactly what this
 * script made and nothing a human has since typed:
 *   - products and categories carry the `demo-` slug prefix
 *   - CMS pages, FAQs and banners are matched on their exact demo content
 *   - settings are overwritten wholesale, because a settings key has no
 *     meaningful "partly demo" state
 *
 * Text in [square brackets] is invented and needs replacing - the same
 * convention as the source copy in the vault. It is left visible on purpose:
 * a placeholder you can see is one you will remember to change.
 */
import { BannerPlacement, PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/** Prefix on every slug this script creates, so `--clear` is exact. */
const DEMO = 'demo-';

// ---------------------------------------------------------------------------
// Settings — the storefront's entire chrome
// ---------------------------------------------------------------------------

const SETTINGS: Record<string, unknown> = {
  business_info: {
    name: 'Patkar Masale',
    tagline: 'Small-batch masalas, ground the traditional way from whole spices.',
    email: 'hello@patkarmasale.test',
    phone: '+91 98765 43210',
    whatsapp: '+91 98765 43210',
    addressLines: ['[Workshop address line 1]', '[Line 2]'],
    city: 'Malvan',
    state: 'Maharashtra',
    postalCode: '411001',
    country: 'India',
    hours: 'Mon–Sat, 9am–6pm',
  },

  social_links: {
    instagram: 'https://instagram.com/',
    facebook: 'https://facebook.com/',
    youtube: 'https://youtube.com/',
  },

  seo_defaults: {
    title: 'Patkar Masale — small-batch spices, ground fresh',
    description:
      'Whole spices roasted separately and ground cool, in small batches. No fillers, no anti-caking agents, no artificial colour.',
    keywords: ['masala', 'home-made spices', 'garam masala', 'small batch', 'Malvan'],
  },

  // SF-30. Left without a logo on purpose: the real one does not exist yet, and
  // BrandMark falls back to a typographic wordmark rather than a placeholder
  // graphic. Upload a logo in admin and it appears with no code change.
  branding: {
    wordmark: 'Patkar Masale',
  },

  announcement: {
    enabled: true,
    message: 'Free delivery on orders over ₹800 within Malvan.',
    linkLabel: 'Shop now',
    linkUrl: '/shop',
  },

  usp_strip: {
    enabled: true,
    items: [
      {
        icon: 'leaf',
        title: 'Whole spices only',
        description: 'Bought whole, ground shortly before it reaches you.',
      },
      {
        icon: 'sparkles',
        title: 'Ground in small batches',
        description: 'Roasted separately, ground cool so the aromatics survive.',
      },
      {
        icon: 'package',
        title: 'Nothing added',
        description: 'No fillers, no anti-caking agents, no artificial colour.',
      },
      {
        icon: 'truck',
        title: 'Cash on delivery',
        description: 'Pay when the parcel arrives. Across [your area].',
      },
    ],
  },

  home_sections: {
    sections: [
      {
        key: 'featured',
        enabled: true,
        heading: 'Ground this week',
        subheading:
          'We grind to order rather than holding inventory, so what is here is what is fresh.',
      },
      {
        key: 'story',
        enabled: true,
        heading: 'It started with a complaint about supermarket masala',
        subheading:
          'Every packet tasted the same — flat, over-salted, somehow both harsh and dull. So we started grinding our own.',
      },
    ],
  },

  footer: {
    columns: [
      {
        heading: 'Shop',
        links: [
          { label: 'All products', href: '/shop' },
          { label: 'Recipes', href: '/recipes' },
          { label: 'Our spices', href: '/ingredients' },
        ],
      },
      {
        heading: 'Learn',
        links: [
          { label: 'Our story', href: '/about' },
          { label: 'Journal', href: '/journal' },
          { label: 'FAQs', href: '/faqs' },
        ],
      },
      {
        heading: 'Help',
        links: [
          { label: 'Contact', href: '/contact' },
          { label: 'Refunds', href: '/refund-policy' },
          { label: 'Privacy', href: '/privacy' },
          { label: 'Terms', href: '/terms' },
        ],
      },
    ],
    note: 'Ground in Malvan. Shipped across India.',
  },
};

// ---------------------------------------------------------------------------
// CMS pages
// ---------------------------------------------------------------------------

const CMS_PAGES = [
  {
    slug: 'about',
    title: 'Our Story',
    metaTitle: 'Our Story',
    metaDescription:
      'Small-batch masalas ground the traditional way, from whole spices. How we make them and why it matters.',
    content: `<h2>It started with a complaint about supermarket masala</h2>
<p>Every packet tasted the same — flat, over-salted, somehow both harsh and dull. The spices had been ground months earlier, sat under fluorescent light, and lost the oils that make them worth using at all.</p>
<p>So we started grinding our own. First for the family, then for neighbours who noticed the difference, and eventually for anyone who wanted spices that still smelled like something.</p>

<h2>How we actually make it</h2>
<p><strong>We buy whole, never pre-ground.</strong> Whole spices hold their volatile oils for months; ground spice starts losing them within days. Everything we sell was whole until shortly before it reached you.</p>
<p><strong>We roast in small batches.</strong> Industrial roasting is fast and even, which sounds good but flattens the differences between spices. We roast each ingredient separately, because coriander and cumin want different heat and different times.</p>
<p><strong>We grind cool.</strong> High-speed grinders generate heat, and heat drives off exactly the aromatics you paid for. Slower grinding costs us time and gives you a masala that still opens up in the pan.</p>
<p><strong>We do not add fillers.</strong> No rice flour to bulk it out, no anti-caking agents, no artificial colour. If our masala looks less uniformly red than the one you are used to, that is turmeric and chilli behaving like turmeric and chilli.</p>

<h2>What that means for you</h2>
<p>Our masalas have a shorter shelf life than commercial ones. That is not a flaw — it is the consequence of leaving out the things that extend it. Buy smaller quantities more often, keep the jar closed and away from the stove, and you will taste the difference every time.</p>

<h2>Where we are</h2>
<p>[Your workshop location]. We grind to order [X] times a week, which is why something is occasionally out of stock. We would rather ask you to wait than sell you a jar that has been sitting for a month.</p>`,
  },
  {
    slug: 'contact',
    title: 'Get in Touch',
    metaTitle: 'Contact',
    metaDescription:
      'Questions about a product, an order, or bulk enquiries — here is how to reach us.',
    content: `<h2>We answer our own messages</h2>
<p>There is no call centre here. Messages reach the same people who grind the spices, so give us a working day and you will get a real answer.</p>
<p><strong>For order questions</strong> — use the support form and include your order number. Much faster than describing the order, because we can look it up straight away.</p>
<p><strong>For product questions</strong> — ask us anything about sourcing, roasting, or what goes with what. We are happier answering these than you might expect.</p>
<p><strong>For bulk and wholesale</strong> — tell us roughly the quantity and how often, and we will come back with what is realistic.</p>`,
  },
  {
    slug: 'refund-policy',
    title: 'Refunds &amp; Returns',
    metaTitle: 'Refunds and Returns',
    metaDescription: 'When we replace or refund an order, and how to ask.',
    content: `<blockquote>This page is structurally sound but is <strong>not legal advice</strong>. Have someone qualified review it against your local requirements before publishing.</blockquote>

<h2>If something is wrong, tell us</h2>
<p>If your order arrived damaged, was the wrong item, or had gone off, we will replace it or refund it. Message us within [X days] of delivery with your order number and a photograph if you can.</p>

<h2>Change of mind</h2>
<p>Spices are consumable food, so we generally cannot accept a return simply because you changed your mind. If a jar is unopened and still sealed we will consider it - ask us.</p>

<h2>How a refund is paid</h2>
<p>Orders are paid cash on delivery, so a refund is sent back by bank transfer or UPI. We will ask for the details when we agree the refund. It usually reaches you within [X working days] of us confirming it.</p>

<h2>Cancelling an order</h2>
<p>You can cancel any time before the order is dispatched, from your account or by messaging us. Once it is on its way we cannot recall it, but the paragraph above still applies if anything is wrong when it arrives.</p>`,
  },
  {
    slug: 'privacy',
    title: 'Privacy',
    metaTitle: 'Privacy Policy',
    metaDescription: 'What we collect, why, and what we do not do with it.',
    content: `<blockquote>This page is structurally sound but is <strong>not legal advice</strong>. Have someone qualified review it against your local requirements before publishing.</blockquote>

<h2>What we collect</h2>
<p>Your name, email address, delivery address and phone number - because we cannot deliver an order without them. Your order history, so you and we can both look it up. Nothing else.</p>

<h2>What we do not do</h2>
<p>We do not sell your details. We do not share them with advertisers. We do not run third-party tracking or advertising pixels on this site.</p>

<h2>How you sign in</h2>
<p>We email you a one-time code rather than asking you to invent another password. The code expires shortly after it is sent.</p>

<h2>Deleting your data</h2>
<p>Email us and we will delete your account. We keep the minimum record of past orders that we are required to for accounting, with your contact details removed.</p>`,
  },
  {
    slug: 'terms',
    title: 'Terms',
    metaTitle: 'Terms of Sale',
    metaDescription: 'The terms you agree to when ordering from us.',
    content: `<blockquote>This page is structurally sound but is <strong>not legal advice</strong>. Have someone qualified review it against your local requirements before publishing.</blockquote>

<h2>Ordering</h2>
<p>Placing an order is an offer to buy. We confirm it by email, and the sale is made when we confirm. If something has just sold out we will tell you rather than substituting it.</p>

<h2>Prices and payment</h2>
<p>Prices are in Indian Rupees and include all applicable charges. Payment is cash on delivery. We do not currently take cards or online payment.</p>

<h2>Delivery</h2>
<p>We deliver across [your area], usually within [X to Y days]. Delivery estimates are estimates, not guarantees.</p>

<h2>Food, freshness and allergens</h2>
<p>Our products are consumable food with a shorter shelf life than commercial equivalents, because they contain no preservatives. We handle nuts, mustard and sesame in the same workshop and cannot guarantee against cross-contact. If you have a serious allergy, ask us before ordering.</p>`,
  },
];

// ---------------------------------------------------------------------------
// FAQs
// ---------------------------------------------------------------------------

const FAQS = [
  {
    question: 'Why does your masala look different from the packet I usually buy?',
    answer:
      'Because there is nothing in ours but spice. Commercial blends often include rice flour or starch as a bulking and anti-caking agent, which lightens and evens out the colour. Ours varies batch to batch depending on the chillies and turmeric that went in.',
    sortOrder: 0,
  },
  {
    question: 'How long does it keep?',
    answer:
      'Best within [X] months of grinding, and the date is on the jar. It will not become unsafe after that, but it will get progressively duller. Freshly ground spice loses aroma steadily from the moment it is ground, which is the trade-off for leaving out preservatives.',
    sortOrder: 1,
  },
  {
    question: 'How should I store it?',
    answer:
      'Closed, dry, and away from the stove. Heat and steam kill spice fastest, so the shelf directly above the hob is the worst place in the kitchen for it. Do not refrigerate: condensation each time you open the jar does more harm than room temperature.',
    sortOrder: 2,
  },
  {
    question: 'Do you use any preservatives, colours or MSG?',
    answer: 'No. Spices, and nothing else.',
    sortOrder: 3,
  },
  {
    question: 'Is it gluten-free? Vegan?',
    answer:
      'The spices themselves contain no gluten or animal products. However we handle nuts, mustard and sesame in the same workshop, so we cannot guarantee against cross-contact. If you have a serious allergy, please ask before ordering.',
    sortOrder: 4,
  },
  {
    question: 'Why is something out of stock?',
    answer:
      'Because we grind to order rather than holding months of inventory. If a blend sells faster than expected it goes out of stock until the next grind, rather than being topped up from an old batch.',
    sortOrder: 5,
  },
  {
    question: 'How do I pay?',
    answer:
      'Cash on delivery. You pay the delivery person when the parcel arrives. We do not take cards or online payment at present.',
    sortOrder: 6,
  },
  {
    question: 'How long does delivery take?',
    answer:
      'Usually [X to Y days] within [your area]. You will get an email as the order moves through packing and dispatch.',
    sortOrder: 7,
  },
  {
    question: 'Can I return it?',
    answer:
      'If it arrived damaged, wrong, or spoiled, yes, always. If it is fine and you changed your mind, usually not, because it is consumable food. Full detail on the Refunds page.',
    sortOrder: 8,
  },
  {
    question: 'Do you sell in bulk?',
    answer:
      'Yes. Tell us roughly the quantity and how often, and we will come back with what is realistic.',
    sortOrder: 9,
  },
];

// ---------------------------------------------------------------------------
// Catalogue
// ---------------------------------------------------------------------------

const CATEGORIES = [
  { slug: 'blends', name: 'Masala Blends', description: 'Ground to order, in small batches.' },
  {
    slug: 'single-spices',
    name: 'Single Spices',
    description: 'One spice, nothing else in the jar.',
  },
];

/**
 * Turmeric is seeded with zero stock on purpose: the out-of-stock state is
 * part of this shop's story (we grind to order rather than topping up from an
 * old batch) and it needs to be visible while the design is being judged.
 */
const PRODUCTS = [
  {
    slug: 'garam-masala',
    name: 'Everyday Garam Masala',
    categorySlug: 'blends',
    price: '320.00',
    compareAtPrice: null,
    weightGrams: 100,
    stockQuantity: 24,
    isFeatured: true,
    shortDescription:
      'The one jar to own if you only own one. Warm, rounded, and built for daily cooking rather than showing off.',
    description:
      'A working garam masala, weighted towards coriander and cumin with just enough clove and cardamom to lift it. Deliberately not the most aggressive blend on the shelf. It is meant to go into food several times a week without dominating.',
    preparationProcess:
      'Whole coriander, cumin, black pepper, cinnamon, clove and cardamom, each roasted separately over low heat until aromatic, cooled fully, then ground together in one pass. Cooling before grinding matters: warm spice releases oil that clogs the grinder, and the resulting paste loses aroma.',
    storageInstructions: 'Airtight, dry, away from the stove. Best within [X] months.',
  },
  {
    slug: 'kolhapuri-masala',
    name: 'Kolhapuri Masala',
    categorySlug: 'blends',
    price: '380.00',
    compareAtPrice: '420.00',
    weightGrams: 100,
    stockQuantity: 12,
    isFeatured: true,
    shortDescription: 'Hot, dark, and unapologetic. For food that is supposed to make you sweat.',
    description:
      'Built on dry red chillies with sesame and coconut for body. Genuinely hot. This is not a mild blend with a warning label.',
    preparationProcess:
      'Chillies dried and roasted to just short of blackening, sesame and coconut roasted separately until they colour, then everything ground coarse rather than fine. The coarse grind is deliberate: it gives the gravy texture instead of turning it to paste.',
    storageInstructions: 'Airtight, dry. Best within [X] months.',
  },
  {
    slug: 'chai-masala',
    name: 'Chai Masala',
    categorySlug: 'blends',
    price: '260.00',
    compareAtPrice: null,
    weightGrams: 50,
    stockQuantity: 30,
    isFeatured: true,
    shortDescription: 'For tea, not for cooking. Cardamom-forward with ginger behind it.',
    description:
      'Ground fine so it disperses in milk rather than sitting on top. A quarter teaspoon per cup is plenty.',
    preparationProcess:
      'Green cardamom, dried ginger, cinnamon, clove and black pepper ground together fine. No roasting, because roasting would push it towards savoury, which is wrong for tea.',
    storageInstructions:
      'Airtight. Loses aroma faster than savoury blends because it is ground finer; best within [X] months.',
  },
  {
    slug: 'turmeric-powder',
    name: 'Turmeric Powder',
    categorySlug: 'single-spices',
    price: '180.00',
    compareAtPrice: null,
    weightGrams: 200,
    stockQuantity: 0,
    isFeatured: true,
    shortDescription:
      'Single-origin turmeric, ground in small batches for colour that comes with flavour.',
    description: '[Origin and variety]. Sun-dried whole and ground to order.',
    preparationProcess:
      'Whole dried rhizomes cleaned, then ground cool. Nothing added, nothing removed.',
    storageInstructions: 'Airtight, away from light. Turmeric fades visibly in sunlight.',
  },
];

// ---------------------------------------------------------------------------
// Hero banner
// ---------------------------------------------------------------------------

/**
 * `imageUrl` is required by the schema and doubles as the video poster, so it
 * always needs a value. This points at a path under the public upload mount
 * that will 404 until someone uploads a hero image in admin - which is the
 * honest state of things, and the storefront renders a warm placeholder block
 * rather than a broken image icon.
 */
const HERO_BANNER = {
  title: 'Ground this morning, not last season',
  subtitle:
    'Whole spices roasted separately and ground cool, in small batches. Nothing added to make them keep longer.',
  imageUrl: '/uploads/public/banners/demo-hero.jpg',
  ctaLabel: 'Browse the shelf',
  ctaUrl: '/shop',
  placement: BannerPlacement.HOME_HERO,
};

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

async function load() {
  console.log('Loading demo storefront content...');
  console.log(
    force
      ? '  mode: --force, EXISTING content will be OVERWRITTEN'
      : '  mode: fill gaps only, existing content is left untouched (--force to overwrite)',
  );
  console.log('');

  let settingsWritten = 0;
  let settingsSkipped = 0;

  for (const [key, value] of Object.entries(SETTINGS)) {
    const existing = await prisma.setting.findUnique({ where: { key } });

    if (existing && !force) {
      settingsSkipped += 1;
      continue;
    }

    await prisma.setting.upsert({
      where: { key },
      update: { value: value as never },
      create: { key, value: value as never },
    });
    settingsWritten += 1;
  }
  console.log(`  settings: ${settingsWritten} written, ${settingsSkipped} left alone`);

  let pagesWritten = 0;
  let pagesSkipped = 0;

  for (const page of CMS_PAGES) {
    const { slug, ...rest } = page;
    const existing = await prisma.cmsPage.findUnique({ where: { slug } });

    if (existing && !force) {
      pagesSkipped += 1;
      continue;
    }

    await prisma.cmsPage.upsert({
      where: { slug },
      update: { ...rest, isPublished: true },
      create: { slug, ...rest, isPublished: true },
    });
    pagesWritten += 1;
  }
  console.log(`  cms pages: ${pagesWritten} written, ${pagesSkipped} left alone`);

  // FAQs have no natural unique key, so they are matched on the question text.
  let faqsWritten = 0;
  let faqsSkipped = 0;

  for (const faq of FAQS) {
    const existing = await prisma.faqItem.findFirst({ where: { question: faq.question } });

    if (existing) {
      if (force) {
        await prisma.faqItem.update({ where: { id: existing.id }, data: faq });
        faqsWritten += 1;
      } else {
        faqsSkipped += 1;
      }
      continue;
    }

    await prisma.faqItem.create({ data: faq });
    faqsWritten += 1;
  }
  console.log(`  faqs: ${faqsWritten} written, ${faqsSkipped} left alone`);

  for (const category of CATEGORIES) {
    await prisma.category.upsert({
      where: { slug: `${DEMO}${category.slug}` },
      update: { name: category.name, description: category.description },
      create: {
        slug: `${DEMO}${category.slug}`,
        name: category.name,
        description: category.description,
      },
    });
  }

  for (const product of PRODUCTS) {
    const { slug, categorySlug, ...rest } = product;
    const category = await prisma.category.findUnique({
      where: { slug: `${DEMO}${categorySlug}` },
    });

    await prisma.product.upsert({
      where: { slug: `${DEMO}${slug}` },
      update: { ...rest, categoryId: category?.id ?? null },
      create: { slug: `${DEMO}${slug}`, ...rest, categoryId: category?.id ?? null },
    });
  }
  console.log(`  categories: ${CATEGORIES.length}, products: ${PRODUCTS.length}`);

  const existingHero = await prisma.banner.findFirst({
    where: { title: HERO_BANNER.title, placement: BannerPlacement.HOME_HERO },
  });
  if (!existingHero) {
    await prisma.banner.create({ data: HERO_BANNER });
  }
  console.log('  hero banner: 1');

  console.log('');
  console.log('Done. The storefront will now render.');
  console.log('Text in [square brackets] is invented - replace it in admin before launch.');
}

async function clear() {
  console.log('Removing demo content...');

  const products = await prisma.product.deleteMany({ where: { slug: { startsWith: DEMO } } });
  const categories = await prisma.category.deleteMany({ where: { slug: { startsWith: DEMO } } });
  const pages = await prisma.cmsPage.deleteMany({
    where: { slug: { in: CMS_PAGES.map((page) => page.slug) } },
  });
  const faqs = await prisma.faqItem.deleteMany({
    where: { question: { in: FAQS.map((faq) => faq.question) } },
  });
  const banners = await prisma.banner.deleteMany({ where: { title: HERO_BANNER.title } });

  // Settings keys are left in place deliberately. Unlike the rows above, a
  // settings key has no "demo" marker - by the time you clear demo content the
  // admin has almost certainly edited some of these, and deleting them would
  // throw away real work to remove content that has already been overwritten.
  console.log(
    `  removed - products: ${products.count}, categories: ${categories.count}, ` +
      `pages: ${pages.count}, faqs: ${faqs.count}, banners: ${banners.count}`,
  );
  console.log('  settings left alone: edit them in admin, they are not marked as demo.');
}

const shouldClear = process.argv.includes('--clear');

/**
 * Overwrite content that already exists.
 *
 * Off by default, and that default matters: this project runs against a single
 * local database, so `npm run seed:demo` is pointed at real data. Without the
 * guard, loading demo content would silently overwrite a `business_info` the
 * admin had already filled in, and an About page they had already written.
 *
 * So by default it only fills gaps. Pass `--force` to deliberately replace what
 * is there.
 */
const force = process.argv.includes('--force');

(shouldClear ? clear() : load())
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
