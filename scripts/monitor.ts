import { runDueScans } from "../src/lib/monitoring";
import { enrichNextProduct } from "../src/lib/product-crawler";

const once = process.argv.includes("--once");
let tickRunning = false;

async function tick() {
  const count = await runDueScans();
  const enriched = await enrichNextProduct();
  console.log(
    `[${new Date().toISOString()}] completed ${count} due observation(s), ${enriched} metadata crawl(s)`,
  );
}

async function runTick() {
  if (tickRunning) {
    console.log(
      `[${new Date().toISOString()}] skipped scheduler tick because the previous tick is still running`,
    );
    return;
  }
  tickRunning = true;
  try {
    await tick();
  } finally {
    tickRunning = false;
  }
}

async function main() {
  await runTick();
  if (!once) {
    setInterval(() => {
      void runTick().catch((error) => {
        console.error(error);
      });
    }, 10_000);
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
