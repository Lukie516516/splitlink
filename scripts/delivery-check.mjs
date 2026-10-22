import fs from "node:fs";
import { sourceDigest } from "./source-fingerprint.mjs";

const read = (file) => {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
};
const ci = read("outputs/ci/summary.json");
const review = read("outputs/review-resolution.json");
const evidence = read("submission/evidence.json");
const digest = sourceDigest().sha256;
const localBlockers = [];
if (ci?.status !== "passed" || ci?.source?.sha256 !== digest)
  localBlockers.push("CI has not passed for the current source fingerprint.");
if (
  review?.status !== "approved-local" ||
  review?.sourceSha256 !== digest ||
  review?.blockingFindings !== 0
)
  localBlockers.push(
    "Independent review and repair closure are missing or stale.",
  );
const required = [
  "rulesVerifiedAt",
  "acceptedStudioWorkflowEvidence",
  "deadlineWithTimezone",
  "builderProfileUrl",
  "studioProjectUrl",
  "studioExportRevision",
  "publicRepositoryUrl",
  "publicAppUrl",
  "canonicalTokenIntegrationEvidence",
  "mainnetContractAddress",
  "mainnetDeploymentBlock",
  "mainnetSettlementHash",
  "mainnetExplorerUrl",
  "actualHostAcceptanceEvidence",
  "videoUrl",
];
const externalMissing = required.filter((key) => !evidence?.[key]);
const report = {
  checkedAt: new Date().toISOString(),
  sourceSha256: digest,
  localAcceptance: localBlockers.length ? "blocked" : "passed",
  localBlockers,
  externalMissing,
  submissionStatus: evidence?.submissionReceiptUrl
    ? "receipt-recorded-unverified"
    : "not-submitted",
  scope:
    "Evidence completeness only. Supplied links/claims still require independent verification; this check does not certify eligibility or broadcast transactions.",
};
fs.mkdirSync("outputs", { recursive: true });
fs.writeFileSync(
  "outputs/delivery-status.json",
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report, null, 2));
if (
  localBlockers.length ||
  (!process.argv.includes("--local") && externalMissing.length)
)
  process.exitCode = 1;
