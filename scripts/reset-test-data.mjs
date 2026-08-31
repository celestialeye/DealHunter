import { rmSync } from "node:fs";
import path from "node:path";

rmSync(path.join(process.cwd(), ".dealhunter-test"), {
  recursive: true,
  force: true,
});
