import type { DatabaseSync } from "node:sqlite";

interface BuiltInRetailer {
  id: string;
  name: string;
  slug: string;
  domains: string[];
  imageDomains: string[];
}

const builtInRetailers: BuiltInRetailer[] = [
  {
    id: "retailer-pokemon-center",
    name: "Pokémon Center",
    slug: "pokemon-center",
    domains: ["pokemoncenter.com"],
    imageDomains: ["pokemoncenter.com", "assets.pokemon.com"],
  },
  {
    id: "retailer-best-buy",
    name: "Best Buy",
    slug: "best-buy",
    domains: ["bestbuy.com"],
    imageDomains: ["bestbuy.com", "pisces.bbystatic.com"],
  },
  {
    id: "retailer-target",
    name: "Target",
    slug: "target",
    domains: ["target.com"],
    imageDomains: [
      "target.com",
      "target.scene7.com",
      "scene7.targetimg1.com",
      "targetimg1.com",
    ],
  },
  {
    id: "retailer-walmart",
    name: "Walmart",
    slug: "walmart",
    domains: ["walmart.com"],
    imageDomains: ["walmart.com", "i5.walmartimages.com"],
  },
  {
    id: "retailer-gamestop",
    name: "GameStop",
    slug: "gamestop",
    domains: ["gamestop.com"],
    imageDomains: ["gamestop.com", "media.gamestop.com"],
  },
  {
    id: "retailer-costco",
    name: "Costco",
    slug: "costco",
    domains: ["costco.com"],
    imageDomains: ["costco.com", "mobilecontent.costco.com"],
  },
  {
    id: "retailer-sams-club",
    name: "Sam's Club",
    slug: "sams-club",
    domains: ["samsclub.com"],
    imageDomains: ["samsclub.com", "scene7.samsclub.com"],
  },
  {
    id: "retailer-barnes-noble",
    name: "Barnes & Noble",
    slug: "barnes-noble",
    domains: ["barnesandnoble.com"],
    imageDomains: ["barnesandnoble.com", "prodimage.images-bn.com"],
  },
  {
    id: "retailer-tcgplayer",
    name: "TCGplayer",
    slug: "tcgplayer",
    domains: ["tcgplayer.com"],
    imageDomains: ["tcgplayer.com", "product-images.tcgplayer.com"],
  },
];

export function seedRetailerRegistry(database: DatabaseSync) {
  const now = new Date().toISOString();
  const insert = database.prepare(
    `INSERT OR IGNORE INTO retailers
     (id, name, slug, domains_json, image_domains_json,
      authenticity_status, enabled, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'BUILT_IN', 1, ?, ?)`,
  );
  for (const retailer of builtInRetailers) {
    insert.run(
      retailer.id,
      retailer.name,
      retailer.slug,
      JSON.stringify(retailer.domains),
      JSON.stringify(retailer.imageDomains),
      now,
      now,
    );
  }

  if (process.env.DEALHUNTER_ALLOW_LOCAL_WEBHOOKS === "1") {
    insert.run(
      "retailer-local-test",
      "Local Test Retailer",
      "local-test",
      JSON.stringify(["127.0.0.1", "localhost"]),
      JSON.stringify(["127.0.0.1", "localhost"]),
      now,
      now,
    );
  }

  database.exec(`
    UPDATE listings
    SET retailer_id = (
      SELECT retailers.id
      FROM retailers
      WHERE lower(retailers.name) = lower(listings.retailer)
      LIMIT 1
    )
    WHERE retailer_id IS NULL;
  `);
}

export function hostnameMatches(hostname: string, domain: string) {
  const normalizedHost = hostname.toLowerCase().replace(/\.$/, "");
  const normalizedDomain = domain.toLowerCase().replace(/\.$/, "");
  return (
    normalizedHost === normalizedDomain ||
    normalizedHost.endsWith(`.${normalizedDomain}`)
  );
}
