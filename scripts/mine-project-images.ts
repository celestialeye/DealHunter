import { mineProjectImages } from "../src/lib/product-crawler";

async function main() {
  const projectId = process.argv[2] ?? "pokemon-30th-celebration";
  const results = await mineProjectImages(projectId);
  for (const result of results) {
    console.log(
      `${result.status.padEnd(11)} ${result.productName}${result.detail ? ` — ${result.detail}` : ""}`,
    );
  }
  const cached = results.filter(
    (result) => result.status === "CACHED" || result.status === "EXISTING",
  ).length;
  console.log(`Cached image coverage: ${cached}/${results.length}`);
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
