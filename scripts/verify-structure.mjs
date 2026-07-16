import { findMissingPaths } from "./required-structure.mjs";

const args = process.argv.slice(2);
let rootDir = process.cwd();
const requiredPaths = [];

for (let index = 0; index < args.length; index += 1) {
  const option = args[index];
  const value = args[index + 1];

  if ((option === "--root" || option === "--required-path") && !value) {
    throw new TypeError(`${option} requires a value`);
  }

  if (option === "--root") {
    rootDir = value;
    index += 1;
  } else if (option === "--required-path") {
    requiredPaths.push(value);
    index += 1;
  } else {
    throw new TypeError(`Unknown option: ${option}`);
  }
}

const missingPaths = await findMissingPaths(
  rootDir,
  requiredPaths.length > 0 ? requiredPaths : undefined,
);

if (missingPaths.length > 0) {
  console.error("Repository structure verification failed:");
  for (const path of missingPaths) {
    console.error(`- ${path}`);
  }
  process.exitCode = 1;
} else {
  console.log("Repository structure verification passed.");
}
