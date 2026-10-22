module.exports = {
  solidity: {
    version: "0.8.30",
    settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: "cancun" },
  },
  networks: { hardhat: { chainId: 31337 } },
  mocha: { timeout: 40000 },
};
