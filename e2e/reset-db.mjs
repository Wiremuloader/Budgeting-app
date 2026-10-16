// Runs before the e2e server starts: every run begins with an empty database.
import fs from "node:fs";
fs.rmSync(".data/e2e", { recursive: true, force: true });
