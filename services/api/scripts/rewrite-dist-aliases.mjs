import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ALIAS_PREFIX = "@/";

const SPECIFIER = /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(["'])([^"'\n]+)\2/g;

const toPosix = (value) => value.split(path.sep).join("/");

const relativeSpecifier = (fromDir, target) => {
  const relative = toPosix(path.relative(fromDir, target));
  return relative.startsWith(".") ? relative : `./${relative}`;
};

export const rewriteSource = (source, fileDir, distRoot) =>
  source.replace(SPECIFIER, (match, lead, quote, specifier) => {
    if (!specifier.startsWith(ALIAS_PREFIX)) return match;
    const target = path.join(distRoot, specifier.slice(ALIAS_PREFIX.length));
    return `${lead}${quote}${relativeSpecifier(fileDir, target)}${quote}`;
  });

const isBuiltFile = (name) => name.endsWith(".js") || name.endsWith(".d.ts");

export const listBuiltFiles = (dir) =>
  readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => (a.name < b.name ? -1 : 1))
    .flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return listBuiltFiles(full);
      return isBuiltFile(entry.name) ? [full] : [];
    });

const countAliases = (source) =>
  [...source.matchAll(SPECIFIER)].filter(([, , , specifier]) =>
    specifier.startsWith(ALIAS_PREFIX),
  ).length;

export const rewriteDist = (distRoot) => {
  let files = 0;
  let specifiers = 0;
  for (const file of listBuiltFiles(distRoot)) {
    const source = readFileSync(file, "utf8");
    const rewritten = rewriteSource(source, path.dirname(file), distRoot);
    if (rewritten === source) continue;
    writeFileSync(file, rewritten);
    files += 1;
    specifiers += countAliases(source);
  }
  return { files, specifiers };
};

const isFile = (candidate) =>
  existsSync(candidate) && statSync(candidate).isFile();

export const verifyDist = (distRoot) => {
  const problems = [];
  for (const file of listBuiltFiles(distRoot)) {
    const source = readFileSync(file, "utf8");
    for (const [, , , specifier] of source.matchAll(SPECIFIER)) {
      const where = toPosix(path.relative(distRoot, file));
      if (specifier.startsWith(ALIAS_PREFIX)) {
        problems.push(`${where}: unrewritten alias "${specifier}"`);
      } else if (
        specifier.startsWith(".") &&
        !isFile(path.resolve(path.dirname(file), specifier))
      ) {
        problems.push(`${where}: "${specifier}" does not resolve to a file`);
      }
    }
  }
  return problems;
};

const main = () => {
  const args = process.argv.slice(2);
  const checkOnly = args.includes("--check");
  const target = args.find((arg) => !arg.startsWith("--"));
  const distRoot = path.resolve(
    target ??
      path.join(path.dirname(fileURLToPath(import.meta.url)), "../dist"),
  );
  if (!existsSync(distRoot)) {
    console.error(`dist directory not found: ${distRoot}`);
    process.exit(1);
  }
  if (!checkOnly) {
    const { files, specifiers } = rewriteDist(distRoot);
    console.log(`rewrote ${specifiers} alias specifiers in ${files} files`);
  }
  const problems = verifyDist(distRoot);
  if (problems.length) {
    for (const problem of problems) console.error(problem);
    process.exit(1);
  }
  console.log("dist specifiers resolve");
};

if (
  process.argv[1] &&
  pathToFileURL(process.argv[1]).href === import.meta.url
) {
  main();
}
