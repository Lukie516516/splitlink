import fs from "node:fs";
const a = JSON.parse(
  fs.readFileSync("artifacts/contracts/SplitLink.sol/SplitLink.json"),
);
console.log(
  JSON.stringify(
    {
      mode: "unsigned deployment plan — no broadcast",
      constructor: { USDC: "0x3600000000000000000000000000000000000000" },
      bytecode: a.bytecode,
      requirements: [
        "G3 canonical runtime verification",
        "G4 reviewed source, controlled wallet, explicit signature and deployment authorization",
        "Capture deployment receipt/block, runtime bytecode hash, immutable token, exact ABI and public host origin",
        "Keep writes disabled until manifest validation and hosted checks pass",
      ],
    },
    null,
    2,
  ),
);
