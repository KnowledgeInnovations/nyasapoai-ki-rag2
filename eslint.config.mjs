import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

/**
 * The files allowed to call an AI provider directly.
 *
 * Every one of them must call assertModelEnabled/isModelEnabled from
 * src/lib/modelSwitch.ts before the request leaves, and recordUsage from
 * src/lib/usage.ts after it returns. That is an invariant ten call sites
 * each have to remember, and convention fails exactly when it matters —
 * when someone unfamiliar adds a feature in a hurry. An eleventh call site
 * added without the gate would silently escape a control an owner believes
 * stopped everything, and spend money nobody can see.
 *
 * Adding a file here is the deliberate act that makes it reviewable.
 */
const PROVIDER_CALL_SITES = [
  "src/lib/claude.ts",
  "src/lib/agenticAnswer.ts",
  "src/lib/agentTools.ts",
  "src/lib/answerVerifier.ts",
  "src/lib/rerank.ts",
  "src/lib/documentProcess.ts",
  "src/app/api/chat/route.ts",
  "src/app/api/document-search/route.ts",
  "src/app/api/dashboard/insight/route.ts",
  "src/app/api/dashboard/insights-batch/route.ts",
];

const NO_RAW_PROVIDER_CALL = {
  selector: "Literal[value=/api\\.(anthropic|openai)\\.com/]",
  message:
    "Direct call to an AI provider. Every provider call must pass the off switch " +
    "(assertModelEnabled/isModelEnabled in src/lib/modelSwitch.ts) and record its " +
    "usage (recordUsage in src/lib/usage.ts). Prefer claudeComplete(). If this really " +
    "is a new call site, add the gate and the usage recording, then add the file to " +
    "PROVIDER_CALL_SITES in eslint.config.mjs so the exception is visible in review.",
};

/**
 * Severity is never the length of a list.
 *
 * processing_warnings holds entries of two kinds: a 'note' records a step
 * that SUCCEEDED and is worth logging, anything else is a degradation.
 * Counting the array treated success as failure and put an amber warning
 * on four healthy documents, which is how a workspace owner came to ask
 * for the AI to be switched off. src/lib/documentStatus.ts is the one
 * place that decides; read it from there.
 */
const NO_WARNING_COUNTING = [
  {
    selector:
      "MemberExpression[property.name='length'] > MemberExpression[property.name='processing_warnings']",
    message:
      "Counting processing_warnings treats a success note as a problem. Use " +
      "hasRealWarnings()/documentStatusKind() from src/lib/documentStatus.ts.",
  },
  {
    selector:
      "MemberExpression[property.name='length'] > ChainExpression > MemberExpression[property.name='processing_warnings']",
    message:
      "Counting processing_warnings treats a success note as a problem. Use " +
      "hasRealWarnings()/documentStatusKind() from src/lib/documentStatus.ts.",
  },
  {
    selector:
      "MemberExpression[property.name='length'] > LogicalExpression > MemberExpression[property.name='processing_warnings']",
    message:
      "Counting processing_warnings treats a success note as a problem. Use " +
      "hasRealWarnings()/documentStatusKind() from src/lib/documentStatus.ts.",
  },
];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Ad-hoc CommonJS dev helpers at the repository root (ask-test.js,
    // get-test-session.js, watch-uploads.js and friends). They predate the
    // flat config, use require(), and are run by hand rather than shipped.
    //
    // Linting them failed `npm run lint` with seven errors nobody intended
    // to fix, which meant the command was never run and the real rules
    // below went unenforced. A lint that always fails is a lint that is
    // always ignored. Application code is src/ and scripts/, both linted.
    "*.js",
  ]),

  {
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": [
        "error",
        NO_RAW_PROVIDER_CALL,
        ...NO_WARNING_COUNTING,
      ],
    },
  },

  // The known provider call sites. They keep the warning-counting rules and
  // are exempt only from the raw-call rule.
  {
    files: PROVIDER_CALL_SITES,
    rules: {
      "no-restricted-syntax": ["error", ...NO_WARNING_COUNTING],
    },
  },

  // documentStatus.ts is the module the rules point at, so it is the one
  // place allowed to read the array directly.
  {
    files: ["src/lib/documentStatus.ts"],
    rules: { "no-restricted-syntax": ["error", NO_RAW_PROVIDER_CALL] },
  },
]);

export default eslintConfig;
