export const BASE_URL = (
  __ENV.BASE_URL || "http://host.docker.internal:4000"
).replace(/\/+$/, "");

export const API_PREFIX = "/api/v1";

export const SMOKE = Boolean(__ENV.SMOKE);

export const P95_MS = Number(__ENV.P95_MS || 1000);

const VOCABULARY = [
  "react",
  "node",
  "python",
  "design",
  "marketing",
  "data",
  "mobile",
  "devops",
];

const OFFSETS = [0, 20];

const searchVariants = (sorts, extra = []) => {
  const variants = [];
  for (const word of VOCABULARY) {
    for (const sort of sorts) {
      for (const offset of OFFSETS) {
        variants.push(`query=${word}&sort=${sort}&limit=20&offset=${offset}`);
      }
    }
  }
  for (const sort of sorts) {
    variants.push(`sort=${sort}&limit=20`);
  }
  return variants.concat(extra);
};

export const ROUTES = [
  {
    route: "feed",
    path: `${API_PREFIX}/jobs/public`,
    weight: 10,
    variants: searchVariants(
      ["newest", "budget", "rating", "proposals"],
      ["limit=20", "paymentVerified=true&limit=20"],
    ),
  },
  {
    route: "freelancer_search",
    path: `${API_PREFIX}/freelancer/search`,
    weight: 5,
    variants: searchVariants([
      "recommended",
      "rating",
      "success",
      "projects",
      "rate-low",
    ]),
  },
  {
    route: "agency_search",
    path: `${API_PREFIX}/agency/search`,
    weight: 2,
    variants: searchVariants(["recommended", "rating", "projects", "rate-low"]),
  },
  {
    route: "ready",
    path: `${API_PREFIX}/ready`,
    weight: 3,
    variants: [""],
  },
];

export const ROUTE_SLOTS = ROUTES.flatMap((entry) =>
  Array.from({ length: entry.weight }, () => entry),
);

export const FORWARDED_POOL_SIZE = 5000;

export const forwardedAddress = (index) => {
  const n = index % FORWARDED_POOL_SIZE;
  return `10.77.${Math.floor(n / 250)}.${(n % 250) + 1}`;
};

const stage = (name, rate, duration, startTime) => ({
  name,
  rate,
  duration,
  startTime,
});

export const STAGES = SMOKE
  ? [stage("smoke", 5, "10s", "0s")]
  : [
      stage("warmup", 10, "30s", "0s"),
      stage("rps_25", 25, "60s", "30s"),
      stage("rps_50", 50, "60s", "90s"),
      stage("rps_100", 100, "60s", "150s"),
      stage("rps_200", 200, "60s", "210s"),
    ];

export const PRE_ALLOCATED_VUS = 50;

export const MAX_VUS = 400;
