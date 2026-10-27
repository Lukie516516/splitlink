import fs from "node:fs";
import path from "node:path";
import solc from "solc";
const sources = Object.fromEntries(
  fs
    .readdirSync("contracts")
    .filter((n) => n.endsWith(".sol"))
    .map((n) => [
      `contracts/${n}`,
      { content: fs.readFileSync(`contracts/${n}`, "utf8") },
    ]),
);
const input = {
  language: "Solidity",
  sources,
  settings: {
    optimizer: { enabled: true, runs: 200 },
    evmVersion: "paris",
    outputSelection: {
      "*": { "*": ["abi", "evm.bytecode", "evm.deployedBytecode"] },
    },
  },
};
const output = JSON.parse(
  solc.compile(JSON.stringify(input), {
    import: (p) => {
      try {
        return {
          contents: fs.readFileSync(path.join("node_modules", p), "utf8"),
        };
      } catch {
        return { error: `Missing ${p}` };
      }
    },
  }),
);
for (const e of output.errors ?? []) console.error(e.formattedMessage);
if (output.errors?.some((e) => e.severity === "error")) process.exit(1);
for (const [source, contracts] of Object.entries(output.contracts))
  for (const [name, c] of Object.entries(contracts)) {
    const dir = `artifacts/${source}`;
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      `${dir}/${name}.json`,
      JSON.stringify(
        {
          _format: "hh-sol-artifact-1",
          contractName: name,
          sourceName: source,
          abi: c.abi,
          bytecode: "0x" + c.evm.bytecode.object,
          deployedBytecode: "0x" + c.evm.deployedBytecode.object,
          linkReferences: c.evm.bytecode.linkReferences,
          deployedLinkReferences: c.evm.deployedBytecode.linkReferences,
        },
        null,
        2,
      ),
    );
    if (name === "SplitLink") {
      fs.writeFileSync(
        "src/lib/generatedAbi.ts",
        `// Generated from the Studio-origin contract, solc ${solc.version()}.\nexport const generatedAbi=${JSON.stringify(c.abi, null, 2)} as const;\n`,
      );
    }
  }
console.log(
  `Compiled Studio-origin contract with ${solc.version()}, optimizer200, Paris target.`,
);
