import { runDueScans } from "../src/lib/monitoring";
import { enrichNextProduct } from "../src/lib/product-crawler";

const once = process.argv.includes("--once");
let tickRunning = false;

function scheduleNextTick() {
  const delayMs = 5_000 + Math.floor(Math.random() * 10_001);
  setTimeout(() => {
    void runTick()
      .catch((error) => {
        console.error(error);
      })
      .finally(scheduleNextTick);
  }, delayMs);
}

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
    scheduleNextTick();
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
