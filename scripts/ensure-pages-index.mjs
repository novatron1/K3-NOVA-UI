import {
  copyFileSync,
  existsSync,
  mkdirSync,
  rmSync,
} from "node:fs";
import { resolve } from "node:path";

const dist = resolve(process.cwd(), "dist");
const index = resolve(dist, "index.html");
const pagesEntry = resolve(dist, "pages.html");

if (existsSync(index)) {
  process.stdout.write("pages_entry_verified\n");
  process.exit(0);
}

if (!existsSync(pagesEntry)) {
  process.stderr.write("pages_entry_missing\n");
  process.exit(1);
}

mkdirSync(dist, { recursive: true });
copyFileSync(pagesEntry, index);
rmSync(pagesEntry);
process.stdout.write("pages_entry_normalized\n");
